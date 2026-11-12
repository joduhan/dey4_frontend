// 지도: 전국 대표 지역의 날씨+미세먼지를 한 번에 표시하고, 클릭한 지점의 값을 보여준다
const OVERVIEW = ["서울", "인천", "수원", "춘천", "강릉", "청주", "홍성", "대전", "세종", "전주", "광주", "목포",
  "대구", "안동", "울산", "부산", "창원", "제주", "울릉"];

const GRADE = [
  { name: "좋음", color: "#2f80ed" },
  { name: "보통", color: "#27ae60" },
  { name: "나쁨", color: "#f2994a" },
  { name: "매우나쁨", color: "#eb5757" },
];
const LIMITS = { pm10: [30, 80, 150], pm2_5: [15, 35, 75] }; // 환경부 기준

function gradeOf(metric, v) {
  if (v == null) return { name: "-", color: "#9aa0a6" };
  const i = LIMITS[metric].findIndex((limit) => v <= limit);
  return GRADE[i === -1 ? 3 : i];
}

const map = L.map("map").setView([36.2, 127.8], 7);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: "© OpenStreetMap",
}).addTo(map);

const overviewLayer = L.layerGroup().addTo(map);
let overview = []; // {name, lat, lon, temp, code, pm10, pm2_5}
let pickMarker = null;

function currentMetric() {
  return document.querySelector('input[name="metric"]:checked').value;
}

function drawOverview() {
  overviewLayer.clearLayers();
  const metric = currentMetric();
  overview.forEach((p) => {
    const g = gradeOf(metric, p[metric]);
    const icon = (WMO[p.code] ?? ["❓"])[0];
    const html =
      `<div class="pin" style="background:${g.color}">` +
      `<span>${icon}</span><b>${Math.round(p.temp)}°</b></div>`;
    L.marker([p.lat, p.lon], {
      icon: L.divIcon({ html, className: "", iconSize: [58, 28], iconAnchor: [29, 14] }),
    })
      .bindTooltip(
        `${p.name} · PM10 ${p.pm10 ?? "-"} / PM2.5 ${p.pm2_5 ?? "-"} (${g.name})`,
        { direction: "top", offset: [0, -14] }
      )
      .on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        load({ name: `${p.name}, 대한민국`, latitude: p.lat, longitude: p.lon });
      })
      .addTo(overviewLayer);
  });
}

async function loadOverview() {
  const pts = OVERVIEW.map((n) => KR_REGIONS.find((r) => r[0] === n)).filter(Boolean);
  const lat = pts.map((r) => r[2]).join(",");
  const lon = pts.map((r) => r[3]).join(",");
  try {
    const [w, a] = await Promise.all([
      cachedJson(`${WEATHER_URL}?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`, 4 * 60 * 1000),
      // 미세먼지가 한도(429) 등으로 실패해도 날씨 마커는 그린다
      cachedJson(`${AIR_URL}?latitude=${lat}&longitude=${lon}&current=pm10,pm2_5&timezone=auto`, AIR_TTL).catch(() => null),
    ]);
    overview = pts.map((r, i) => ({
      name: r[0], lat: r[2], lon: r[3],
      temp: w[i].current.temperature_2m,
      code: w[i].current.weather_code,
      pm10: a?.[i]?.current?.pm10 ?? null,
      pm2_5: a?.[i]?.current?.pm2_5 ?? null,
    }));
    drawOverview();
  } catch {
    setStatus("지도 전체 날씨를 불러오지 못했습니다.", true);
  }
}

// app.js 에서 호출: 선택된 지점에 마커를 찍고(검색 시에는 지도 이동)
// 에이전트가 추천한 장소 마커 (보라색)
const spotsLayer = L.layerGroup().addTo(map);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

window.mapApi = {
  showSpots(spots) {
    spotsLayer.clearLayers();
    const pts = [];
    (spots || []).forEach((s, i) => {
      if (typeof s.lat !== "number" || typeof s.lon !== "number") return;
      pts.push([s.lat, s.lon]);
      L.marker([s.lat, s.lon], {
        icon: L.divIcon({
          className: "",
          html: `<div class="spot-pin"><span>${i + 1}</span></div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
      })
        .bindPopup(
          `<b>${esc(s.name)}</b><br>${esc(s.description || s.type || "")}` +
            (s.address ? `<br><small>${esc(s.address)}</small>` : "") +
            (s.distance_km != null ? `<br><small>중심에서 ${s.distance_km}km</small>` : "") +
            (/^https?:\/\//.test(s.url || "") ? `<br><a href="${esc(s.url)}" target="_blank" rel="noopener">자세히</a>` : "")
        )
        .addTo(spotsLayer);
    });
    if (pts.length) map.fitBounds(pts, { padding: [50, 50], maxZoom: 13 });
  },
  show(place, fly) {
    const ll = [place.latitude, place.longitude];
    if (pickMarker) pickMarker.setLatLng(ll);
    else pickMarker = L.circleMarker(ll, { radius: 9, color: "#fff", weight: 3, fillColor: "#111", fillOpacity: 1 }).addTo(map);
    if (fly) map.flyTo(ll, Math.max(map.getZoom(), 9), { duration: 0.8 });
  },
};

// 지도 빈 곳 클릭 → 그 좌표의 값 + 가까운 내장 지역 이름
map.on("click", (e) => {
  const { lat, lng } = e.latlng;
  let best = null, bestD = Infinity;
  for (const [ko, , la, lo] of KR_REGIONS) {
    const d = map.distance([lat, lng], [la, lo]);
    if (d < bestD) { bestD = d; best = ko; }
  }
  load({ name: `선택 지점 (가까운 곳: ${best})`, latitude: lat, longitude: lng });
});

document.querySelectorAll('input[name="metric"]').forEach((el) =>
  el.addEventListener("change", drawOverview)
);

loadOverview();
setInterval(loadOverview, REFRESH_MS);
