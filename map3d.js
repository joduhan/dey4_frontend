// three.js 3D 날씨 지도 (뉴스 기상 코너 스타일)
//  - 지형: AWS Terrarium 실제 고도 타일 → 고도별 색 + 어두운 바다 + 빛나는 시도 경계선(provinces.json)
//  - 막대: 지역별 미세먼지 농도에 비례, 등급 색으로 발광하며 자라나는 효과
//  - 라벨: 유리 질감 칩(지역명 · 날씨 아이콘 · 기온)
//  - 조작: 드래그 회전 / 휠 확대 / 우클릭 이동 / 클릭하면 해당 지점 날씨·미세먼지 조회
const OVERVIEW = ["서울", "인천", "춘천", "강릉", "청주", "홍성", "대전", "전주", "광주", "목포",
  "대구", "안동", "울산", "부산", "창원", "제주", "울릉"];

const GRADE = [
  { name: "좋음", color: "#3b9dff" },
  { name: "보통", color: "#2fd37a" },
  { name: "나쁨", color: "#ffa23a" },
  { name: "매우나쁨", color: "#ff5a5a" },
];
const NONE_COLOR = "#8a97ab";
const LIMITS = { pm10: [30, 80, 150], pm2_5: [15, 35, 75] }; // 환경부 기준
const BAR_SCALE = { pm10: 0.025, pm2_5: 0.05 }; // 농도 1당 막대 높이

function gradeOf(metric, v) {
  if (v == null) return { name: "-", color: NONE_COLOR };
  const i = LIMITS[metric].findIndex((limit) => v <= limit);
  return GRADE[i === -1 ? 3 : i];
}

// ---------- 타일 / 좌표 계산 (웹 메르카토르) ----------
const Z = 8, N = 2 ** Z;
const TILE_UNITS = 10;        // 타일 1장 = 씬 단위 10
const UNIT_M = 12620;         // 씬 단위 1 ≈ 12.6km (북위 36도, 줌 8)
const EXAG = 8;               // 고도 과장 배율
const BOUNDS = { latMin: 33.0, latMax: 38.8, lonMin: 124.5, lonMax: 132.0 };

function tileXY(lat, lon) {
  const r = (lat * Math.PI) / 180;
  return {
    fx: ((lon + 180) / 360) * N,
    fy: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N,
  };
}
const tl = tileXY(BOUNDS.latMax, BOUNDS.lonMin);
const br = tileXY(BOUNDS.latMin, BOUNDS.lonMax);
const X0 = Math.floor(tl.fx), Y0 = Math.floor(tl.fy);
const TW = Math.floor(br.fx) - X0 + 1, TH = Math.floor(br.fy) - Y0 + 1;
const W_UNITS = TW * TILE_UNITS, H_UNITS = TH * TILE_UNITS;
const EW = TW * 256, EH = TH * 256;

function toWorld(lat, lon) {
  const { fx, fy } = tileXY(lat, lon);
  return { x: (fx - X0) * TILE_UNITS, z: (fy - Y0) * TILE_UNITS };
}
function toLatLon(x, z) {
  const fx = x / TILE_UNITS + X0, fy = z / TILE_UNITS + Y0;
  return {
    lon: (fx / N) * 360 - 180,
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * fy) / N))) * 180) / Math.PI,
  };
}

let elev = null; // Float32Array(EW*EH): 씬 단위 높이
function heightAt(x, z) {
  if (!elev) return 0;
  const px = Math.min(EW - 1, Math.max(0, Math.round((x / W_UNITS) * (EW - 1))));
  const py = Math.min(EH - 1, Math.max(0, Math.round((z / H_UNITS) * (EH - 1))));
  return elev[py * EW + px];
}

function loadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(url));
    img.src = url;
  });
}

async function stitch(urlFn) {
  const canvas = document.createElement("canvas");
  canvas.width = EW;
  canvas.height = EH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const jobs = [];
  for (let y = Y0; y < Y0 + TH; y++) {
    for (let x = X0; x < X0 + TW; x++) {
      jobs.push(
        loadImg(urlFn(x, y))
          .then((img) => ctx.drawImage(img, (x - X0) * 256, (y - Y0) * 256))
          .catch(() => {}) // 일부 타일 실패는 무시
      );
    }
  }
  await Promise.all(jobs);
  return canvas;
}

// ---------- 지형 텍스처 (방송 지도 스타일) ----------
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const HYPSO = [
  [0, [104, 182, 118]], [120, [158, 205, 116]], [350, [216, 208, 126]],
  [700, [206, 162, 100]], [1200, [172, 128, 94]], [1800, [246, 241, 233]],
];
function landColor(m) {
  if (m <= 0) return HYPSO[0][1];
  for (let i = 1; i < HYPSO.length; i++) {
    if (m < HYPSO[i][0]) return mix(HYPSO[i - 1][1], HYPSO[i][1], (m - HYPSO[i - 1][0]) / (HYPSO[i][0] - HYPSO[i - 1][0]));
  }
  return HYPSO[HYPSO.length - 1][1];
}
const SEA_SHALLOW = [24, 104, 160], SEA_DEEP = [4, 22, 46];
const NEIGHBOR_LOW = [46, 64, 92], NEIGHBOR_HIGH = [96, 112, 140];

function tracePath(ctx, provinces) {
  ctx.beginPath();
  for (const f of provinces.features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        ring.forEach(([lon, lat], i) => {
          const { fx, fy } = tileXY(lat, lon);
          const x = (fx - X0) * 256, y = (fy - Y0) * 256;
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        });
        ctx.closePath();
      }
    }
  }
}

function paintTexture(elevM, provinces) {
  // 대한민국 영역 마스크
  let mask = null;
  if (provinces) {
    const mc = document.createElement("canvas");
    mc.width = EW; mc.height = EH;
    const mctx = mc.getContext("2d", { willReadFrequently: true });
    mctx.fillStyle = "#fff";
    tracePath(mctx, provinces);
    mctx.fill("evenodd");
    mask = mctx.getImageData(0, 0, EW, EH).data;
  }

  const canvas = document.createElement("canvas");
  canvas.width = EW; canvas.height = EH;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(EW, EH);
  const px = img.data;
  const FADE = 0.09;
  for (let y = 0; y < EH; y++) {
    for (let x = 0; x < EW; x++) {
      const i = y * EW + x;
      const m = elevM[i];
      const kr = mask ? mask[i * 4 + 3] / 255 : m > 1 ? 1 : 0;
      let base;
      if (m > 1) base = mix(NEIGHBOR_LOW, NEIGHBOR_HIGH, Math.min(1, m / 1000)); // 이웃 나라 육지
      else base = mix(SEA_SHALLOW, SEA_DEEP, Math.min(1, Math.sqrt(Math.max(0, -m) / 1500)));
      const c = kr > 0 ? mix(base, landColor(m), kr) : base;
      // 가장자리를 배경색으로 서서히 투명하게
      const d = Math.min(x / EW, 1 - x / EW, y / EH, 1 - y / EH);
      const s = Math.min(1, d / FADE);
      px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2];
      px[i * 4 + 3] = 255 * s * s * (3 - 2 * s);
    }
  }
  ctx.putImageData(img, 0, 0);

  // 시도 경계선 (은은한 광채 + 흰 선)
  if (provinces) {
    ctx.lineJoin = "round";
    tracePath(ctx, provinces);
    ctx.strokeStyle = "rgba(120, 205, 255, 0.28)";
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  return canvas;
}

// ---------- 오버레이(제목 배너, 범례) ----------
const box = document.getElementById("map");
const loadingEl = document.createElement("div");
loadingEl.className = "map-loading";
loadingEl.textContent = "3D 지형 불러오는 중...";
const tipEl = document.createElement("div");
tipEl.className = "map-tip";
tipEl.hidden = true;
const bannerEl = document.createElement("div");
bannerEl.className = "map-banner";
bannerEl.innerHTML = '<b>전국 날씨</b><span id="map-stamp"></span>';
const legendEl = document.createElement("div");
legendEl.className = "map-legend";
box.append(loadingEl, tipEl, bannerEl, legendEl);

function stamp() {
  const d = new Date();
  const day = "일월화수목금토"[d.getDay()];
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${day}) ${pad(d.getHours())}:${pad(d.getMinutes())} 기준`;
}

function renderLegend(metric) {
  const [a, b, c] = LIMITS[metric];
  const ranges = [`~${a}`, `~${b}`, `~${c}`, `${c + 1}~`];
  legendEl.innerHTML =
    `<em>${metric === "pm10" ? "미세먼지 PM10" : "초미세먼지 PM2.5"}</em>` +
    GRADE.map((g, i) => `<span><i style="background:${g.color}"></i>${g.name} <small>${ranges[i]}</small></span>`).join("");
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch {
  loadingEl.textContent = "이 브라우저는 WebGL을 지원하지 않아 3D 지도를 표시할 수 없습니다.";
}

if (renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setClearColor(0x000000, 0);
  box.insertBefore(renderer.domElement, box.firstChild);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 600);
  const center = toWorld(35.8, 127.9);
  const target = new THREE.Vector3(center.x, 0, center.z);
  const FINAL_OFFSET = new THREE.Vector3(0, 48, 42);
  const START_OFFSET = new THREE.Vector3(-46, 78, 20);
  camera.position.copy(target).add(START_OFFSET);
  camera.lookAt(target);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 4;
  controls.maxDistance = 120;
  controls.enabled = false; // 인트로 동안 비활성

  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x1a2a44, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 0.85);
  sun.position.set(center.x - 40, 35, center.z - 25); // 낮은 각도 → 산세 음영
  scene.add(sun);

  function resize() {
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(box);
  resize();

  // ---------- 인트로 카메라 ----------
  let introStart = null;
  const INTRO_MS = 2600;
  function endIntro() {
    introStart = null;
    camera.position.copy(target).add(FINAL_OFFSET);
    controls.enabled = true;
  }

  // ---------- 지형 ----------
  let terrain = null;
  const barGroup = new THREE.Group();
  scene.add(barGroup);

  async function buildTerrain() {
    const [elevCanvas, provinces] = await Promise.all([
      stitch((x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`),
      fetch("provinces.json").then((r) => r.json()).catch(() => null),
    ]);

    const data = elevCanvas.getContext("2d").getImageData(0, 0, EW, EH).data;
    const elevM = new Float32Array(EW * EH);
    elev = new Float32Array(EW * EH);
    for (let i = 0; i < elevM.length; i++) {
      const m = data[i * 4] * 256 + data[i * 4 + 1] + data[i * 4 + 2] / 256 - 32768;
      elevM[i] = m;
      elev[i] = (Math.max(0, m) / UNIT_M) * EXAG; // 바다(음수)는 0
    }

    const SEG = 383;
    const geo = new THREE.PlaneGeometry(W_UNITS, H_UNITS, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    geo.translate(W_UNITS / 2, 0, H_UNITS / 2); // 북서쪽 모서리가 원점, 북쪽이 -z
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();

    const tex = new THREE.CanvasTexture(paintTexture(elevM, provinces));
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    terrain = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0, transparent: true })
    );
    scene.add(terrain);
    loadingEl.hidden = true;
    introStart = performance.now();

    drawOverview();
    api.show(lastPlace, false);
  }

  // ---------- 막대 + 라벨 ----------
  let overview = []; // {name, lat, lon, temp, code, pm10, pm2_5}
  let growing = [];  // 등장 애니메이션 대상

  function currentMetric() {
    return document.querySelector('input[name="metric"]:checked').value;
  }

  function makeLabel(name, icon, temp, color) {
    const W = 280, H = 140;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    const rr = (x, y, w, h, r) => {
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    };
    g.shadowColor = color;
    g.shadowBlur = 14;
    rr(10, 10, W - 20, H - 20, 26);
    const grad = g.createLinearGradient(0, 10, 0, H - 10);
    grad.addColorStop(0, "rgba(22, 44, 82, 0.95)");
    grad.addColorStop(1, "rgba(6, 16, 36, 0.95)");
    g.fillStyle = grad;
    g.fill();
    g.shadowBlur = 0;
    g.lineWidth = 4;
    g.strokeStyle = color;
    g.stroke();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#a9c7ee";
    g.font = "bold 28px 'Malgun Gothic', sans-serif";
    g.fillText(name, W / 2, 40);
    g.fillStyle = "#fff";
    g.font = "46px 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";
    g.fillText(icon, 88, 92);
    g.font = "bold 54px 'Segoe UI', sans-serif";
    g.fillText(`${Math.round(temp)}°`, 184, 92);
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.set(3.8, 1.9, 1);
    sprite.renderOrder = 10;
    return sprite;
  }

  function disposeGroup(group) {
    group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.map?.dispose();
      o.material?.dispose();
    });
    group.clear();
  }

  function drawOverview() {
    disposeGroup(barGroup);
    growing = [];
    if (!elev) return;
    const metric = currentMetric();
    renderLegend(metric);
    const t0 = performance.now();
    overview.forEach((p, idx) => {
      const g = gradeOf(metric, p[metric]);
      const col = new THREE.Color(g.color);
      const w = toWorld(p.lat, p.lon);
      const base = heightAt(w.x, w.z);
      const h = 0.3 + (p[metric] ?? 0) * BAR_SCALE[metric];

      const barGeo = new THREE.CylinderGeometry(0.2, 0.2, h, 20);
      barGeo.translate(0, h / 2, 0);
      const bar = new THREE.Mesh(barGeo, new THREE.MeshStandardMaterial({
        color: col, emissive: col, emissiveIntensity: 0.55, roughness: 0.4,
      }));
      bar.position.set(w.x, base, w.z);
      bar.userData.place = p;

      const haloGeo = new THREE.CylinderGeometry(0.42, 0.42, h, 24, 1, true);
      haloGeo.translate(0, h / 2, 0);
      const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({
        color: col, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      halo.position.copy(bar.position);
      halo.raycast = () => {}; // 클릭 대상 제외

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.45, 0.85, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.position.set(w.x, base + 0.05, w.z);
      ring.raycast = () => {};

      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), new THREE.MeshBasicMaterial({ color: col }));
      cap.position.set(w.x, base, w.z);
      cap.raycast = () => {};

      const label = makeLabel(p.name, (WMO[p.code] ?? ["❓"])[0], p.temp, g.color);
      label.position.set(w.x, base + 1, w.z);
      label.userData.place = p;

      barGroup.add(ring, halo, bar, cap, label);
      growing.push({ bar, halo, cap, label, base, h, t0: t0 + idx * 70 });
    });
  }

  async function loadOverview() {
    const pts = OVERVIEW.map((n) => KR_REGIONS.find((r) => r[0] === n)).filter(Boolean);
    const lat = pts.map((r) => r[2]).join(",");
    const lon = pts.map((r) => r[3]).join(",");
    const getJson = (url) => fetch(url).then((r) => r.json());
    try {
      const [w, a] = await Promise.all([
        getJson(`${WEATHER_URL}?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`),
        getJson(`${AIR_URL}?latitude=${lat}&longitude=${lon}&current=pm10,pm2_5&timezone=auto`).catch(() => null),
      ]);
      if (!Array.isArray(w)) throw new Error(w.reason || "날씨 응답 오류");
      const airOk = Array.isArray(a); // 요청 한도 초과 등으로 미세먼지만 실패해도 날씨는 표시
      overview = pts.map((r, i) => ({
        name: r[0], lat: r[2], lon: r[3],
        temp: w[i].current.temperature_2m,
        code: w[i].current.weather_code,
        pm10: airOk ? a[i].current.pm10 : null,
        pm2_5: airOk ? a[i].current.pm2_5 : null,
      }));
      document.getElementById("map-stamp").textContent = stamp();
      drawOverview();
      setStatus(airOk ? "" : "미세먼지 정보를 가져오지 못했습니다 (API 요청 한도 초과일 수 있습니다).", !airOk);
    } catch (err) {
      console.error(err);
      setStatus(`지도 전체 날씨를 불러오지 못했습니다. ${err.message}`, true);
    }
  }

  // ---------- 선택 지점 핀 + 카메라 이동 ----------
  const PIN_COLOR = 0xffd54a;
  const pin = new THREE.Mesh(
    new THREE.ConeGeometry(0.38, 1.1, 16).rotateX(Math.PI),
    new THREE.MeshStandardMaterial({ color: PIN_COLOR, emissive: PIN_COLOR, emissiveIntensity: 0.7 })
  );
  const pulse = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 0.95, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: PIN_COLOR, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
  );
  pin.visible = pulse.visible = false;
  pin.raycast = pulse.raycast = () => {};
  scene.add(pin, pulse);
  let lastPlace = null;
  let flyGoal = null;

  const api = (window.mapApi = {
    show(place, fly) {
      if (!place) return;
      lastPlace = place;
      const w = toWorld(place.latitude, place.longitude);
      const y = heightAt(w.x, w.z);
      pin.position.set(w.x, y + 1.05, w.z);
      pulse.position.set(w.x, y + 0.06, w.z);
      pin.visible = pulse.visible = true;
      if (fly) flyGoal = new THREE.Vector3(w.x, y, w.z);
    },
  });

  // ---------- 클릭 / 호버 ----------
  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  function pick(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const targets = terrain ? [...barGroup.children, terrain] : [...barGroup.children];
    return ray.intersectObjects(targets, false)[0];
  }

  function nearestName(lat, lon) {
    let best = "", bestD = Infinity;
    const k = Math.cos((lat * Math.PI) / 180);
    for (const [ko, , la, lo] of KR_REGIONS) {
      const d = (la - lat) ** 2 + ((lo - lon) * k) ** 2;
      if (d < bestD) { bestD = d; best = ko; }
    }
    return best;
  }

  let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => {
    down = [e.clientX, e.clientY];
    if (introStart) endIntro(); // 인트로 중 조작하면 즉시 종료
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return; // 드래그는 클릭이 아님
    down = null;
    const hit = pick(e);
    if (!hit) return;
    const p = hit.object.userData.place;
    if (p) {
      load({ name: `${p.name}, 대한민국`, latitude: p.lat, longitude: p.lon });
    } else if (hit.object === terrain) {
      const { lat, lon } = toLatLon(hit.point.x, hit.point.z);
      load({ name: `선택 지점 (가까운 곳: ${nearestName(lat, lon)})`, latitude: lat, longitude: lon });
    }
  });

  let hoverBusy = false;
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (hoverBusy || e.buttons) { tipEl.hidden = true; return; }
    hoverBusy = true;
    requestAnimationFrame(() => {
      hoverBusy = false;
      const hit = pick(e);
      const p = hit?.object.userData.place;
      renderer.domElement.style.cursor = hit ? "pointer" : "grab";
      if (!p) { tipEl.hidden = true; return; }
      const fmt = (v) => (v == null ? "-" : Math.round(v));
      const g = gradeOf(currentMetric(), p[currentMetric()]);
      tipEl.textContent = `${p.name} · PM10 ${fmt(p.pm10)} / PM2.5 ${fmt(p.pm2_5)} (${g.name})`;
      const r = box.getBoundingClientRect();
      tipEl.style.left = `${e.clientX - r.left + 12}px`;
      tipEl.style.top = `${e.clientY - r.top + 12}px`;
      tipEl.hidden = false;
    });
  });

  document.querySelectorAll('input[name="metric"]').forEach((el) =>
    el.addEventListener("change", drawOverview)
  );

  // ---------- 렌더 루프 ----------
  const easeOut = (k) => 1 - (1 - k) ** 3;
  renderer.setAnimationLoop((now) => {
    // 인트로: 높은 곳에서 전국이 보이는 각도로 선회하며 하강
    if (introStart) {
      const k = Math.min(1, (performance.now() - introStart) / INTRO_MS);
      camera.position.copy(target).add(START_OFFSET.clone().lerp(FINAL_OFFSET, easeOut(k)));
      camera.lookAt(target);
      if (k >= 1) endIntro();
    } else {
      if (flyGoal) {
        const d = flyGoal.clone().sub(controls.target);
        if (d.length() < 0.02) flyGoal = null;
        else {
          d.multiplyScalar(0.08);
          controls.target.add(d);
          camera.position.add(d);
        }
      }
      controls.update();
    }

    // 막대가 순서대로 자라나는 효과
    const t = performance.now();
    for (const o of growing) {
      const e = Math.max(0.001, easeOut(Math.min(1, Math.max(0, (t - o.t0) / 900))));
      o.bar.scale.y = o.halo.scale.y = e;
      o.cap.position.y = o.base + o.h * e;
      o.label.position.y = o.base + o.h * e + 1.15;
    }

    // 선택 핀 펄스
    const s = (t / 1000) % 1.4 / 1.4;
    pulse.scale.setScalar(1 + s * 1.6);
    pulse.material.opacity = 0.8 * (1 - s);
    pin.rotation.y += 0.03;

    renderer.render(scene, camera);
  });

  buildTerrain().catch((err) => {
    console.error(err);
    loadingEl.textContent = "지형 데이터를 불러오지 못했습니다.";
  });
  renderLegend(currentMetric());
  loadOverview();
  setInterval(loadOverview, 3 * REFRESH_MS); // 지역 수만큼 요청이 나가므로 15분마다
}
