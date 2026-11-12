const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const REFRESH_MS = 5 * 60 * 1000; // 5분마다 자동 갱신

// WMO weather code → [아이콘, 설명]
const WMO = {
  0: ["☀️", "맑음"],
  1: ["🌤️", "대체로 맑음"],
  2: ["⛅", "구름 조금"],
  3: ["☁️", "흐림"],
  45: ["🌫️", "안개"],
  48: ["🌫️", "서리 안개"],
  51: ["🌦️", "약한 이슬비"],
  53: ["🌦️", "이슬비"],
  55: ["🌦️", "강한 이슬비"],
  56: ["🌧️", "약한 어는 이슬비"],
  57: ["🌧️", "강한 어는 이슬비"],
  61: ["🌧️", "약한 비"],
  63: ["🌧️", "비"],
  65: ["🌧️", "강한 비"],
  66: ["🌧️", "약한 어는 비"],
  67: ["🌧️", "강한 어는 비"],
  71: ["🌨️", "약한 눈"],
  73: ["🌨️", "눈"],
  75: ["❄️", "강한 눈"],
  77: ["❄️", "싸락눈"],
  80: ["🌦️", "약한 소나기"],
  81: ["🌧️", "소나기"],
  82: ["⛈️", "강한 소나기"],
  85: ["🌨️", "약한 눈 소나기"],
  86: ["❄️", "강한 눈 소나기"],
  95: ["⛈️", "뇌우"],
  96: ["⛈️", "우박을 동반한 뇌우"],
  99: ["⛈️", "강한 우박 뇌우"],
};

const $ = (id) => document.getElementById(id);
let currentPlace = null;
let timer = null;

function setStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.classList.toggle("error", isError);
}

// Open-Meteo 지오코딩 (한국 한정)
async function geoSearch(name) {
  const url = `${GEO_URL}?name=${encodeURIComponent(name)}&count=8&language=ko&countryCode=KR&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("도시 검색에 실패했습니다.");
  const data = await res.json();
  return (data.results || []).map((r) => ({
    name: r.name,
    sub: [r.admin1, r.admin2].filter(Boolean).join(" "),
    label: [r.name, r.admin1, "대한민국"].filter(Boolean).join(", "),
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

// 내장 목록에서 첫 글자(한글/영문) 기준 즉시 추천
function localSearch(q) {
  const lower = q.toLowerCase();
  const base = stripSuffix(q);
  return KR_REGIONS.filter(([ko, en]) =>
    ko.startsWith(base) || ko.startsWith(q) || en.toLowerCase().startsWith(lower)
  ).map(([ko, en, latitude, longitude]) => ({
    name: ko, sub: en, label: `${ko}, 대한민국`, latitude, longitude,
  }));
}

// 한글로 결과가 없으면 접미사 제거 → 영어(로마자) 변환 순으로 재시도
async function apiSearchWithFallback(q) {
  const candidates = [q];
  const stripped = stripSuffix(q);
  if (stripped && stripped !== q) candidates.push(stripped);
  if (hasHangul(q)) candidates.push(romanizeHangul(stripped || q));
  for (const c of candidates) {
    const found = await geoSearch(c);
    if (found.length) return found;
  }
  return [];
}

async function searchPlaces(q) {
  const local = localSearch(q);
  let remote = [];
  if (q.length >= 2) {
    try { remote = await apiSearchWithFallback(q); } catch { /* 내장 목록만 사용 */ }
  }
  const seen = new Set(local.map((p) => `${p.latitude.toFixed(1)},${p.longitude.toFixed(1)}`));
  const merged = [...local];
  for (const p of remote) {
    const key = `${p.latitude.toFixed(1)},${p.longitude.toFixed(1)}`;
    if (!seen.has(key)) { seen.add(key); merged.push(p); }
  }
  return merged.slice(0, 10);
}

async function fetchWeather({ latitude, longitude }) {
  const params = new URLSearchParams({
    latitude,
    longitude,
    current:
      "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
    timezone: "auto",
  });
  const res = await fetch(`${WEATHER_URL}?${params}`);
  if (!res.ok) throw new Error("날씨 정보를 가져오지 못했습니다.");
  const data = await res.json();
  return { current: data.current, units: data.current_units };
}

// Open-Meteo 는 IP당 호출 한도가 있어(429), 응답을 localStorage 에 캐시한다.
// 캐시가 신선하면 네트워크를 쓰지 않고, 요청이 실패하면 오래된 캐시라도 사용한다.
async function cachedJson(url, ttlMs) {
  const key = "om:" + url;
  let hit = null;
  try { hit = JSON.parse(localStorage.getItem(key)); } catch {}
  if (hit && Date.now() - hit.t < ttlMs) return hit.d;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), d })); } catch {}
    return d;
  } catch (e) {
    if (hit) return hit.d; // 오래된 값이라도 표시
    throw e;
  }
}
const AIR_TTL = 30 * 60 * 1000; // 대기질 모델은 1시간 단위로 갱신되므로 30분 캐시

async function fetchAir({ latitude, longitude }) {
  const params = new URLSearchParams({ latitude, longitude, current: "pm10,pm2_5", timezone: "auto" });
  return (await cachedJson(`${AIR_URL}?${params}`, AIR_TTL)).current;
}

function setDust(id, metric, v) {
  const g = gradeOf(metric, v);
  const el = $(id);
  el.textContent = v == null ? "-" : `${Math.round(v)} μg/m³`;
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.style.background = g.color;
  badge.textContent = g.name;
  el.appendChild(badge);
}

function render(place, { current, units }, air) {
  setDust("pm10", "pm10", air?.pm10);
  setDust("pm25", "pm2_5", air?.pm2_5);
  const [icon, desc] = WMO[current.weather_code] ?? ["❓", "알 수 없음"];
  $("place").textContent = place.name;
  $("icon").textContent = icon;
  $("temp").textContent = `${Math.round(current.temperature_2m)}${units.temperature_2m}`;
  $("desc").textContent = desc;
  $("feels").textContent = `${Math.round(current.apparent_temperature)}${units.apparent_temperature}`;
  $("humidity").textContent = `${current.relative_humidity_2m}${units.relative_humidity_2m}`;
  $("wind").textContent = `${current.wind_speed_10m} ${units.wind_speed_10m}`;
  $("precip").textContent = `${current.precipitation} ${units.precipitation}`;
  $("updated").textContent = `관측 시각: ${current.time.replace("T", " ")} (현지 시간)`;
  $("weather").hidden = false;
}

async function load(place, fly = false) {
  setStatus("불러오는 중...");
  try {
    const [weather, air] = await Promise.all([
      fetchWeather(place),
      fetchAir(place).catch(() => null), // 미세먼지 실패해도 날씨는 표시
    ]);
    currentPlace = place;
    render(place, weather, air);
    window.mapApi?.show(place, fly);
    setStatus("");
    clearInterval(timer);
    timer = setInterval(() => load(currentPlace), REFRESH_MS);
  } catch (err) {
    setStatus(err.message, true);
  }
}

// ---- 자동완성 UI ----
const input = $("city-input");
const list = $("suggestions");
let items = [];
let active = -1;
let debounce = null;
let seq = 0; // 늦게 도착한 이전 응답 무시용

function closeList() {
  list.hidden = true;
  active = -1;
}

function renderList(q) {
  list.innerHTML = "";
  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = `'${q}' 검색 결과가 없습니다.`;
    list.appendChild(li);
  }
  items.forEach((p, i) => {
    const li = document.createElement("li");
    li.innerHTML = `${p.name}<small></small>`;
    li.querySelector("small").textContent = p.sub;
    li.addEventListener("mousedown", (e) => { e.preventDefault(); choose(i); });
    list.appendChild(li);
  });
  list.hidden = false;
}

function setActive(i) {
  active = i;
  [...list.children].forEach((li, idx) => li.classList.toggle("active", idx === i));
}

function choose(i) {
  const p = items[i];
  if (!p) return;
  input.value = p.name;
  closeList();
  load({ name: p.label, latitude: p.latitude, longitude: p.longitude }, true);
}

input.addEventListener("input", () => {
  clearTimeout(debounce);
  const q = input.value.trim();
  if (!q) { closeList(); return; }
  // 내장 목록은 즉시 표시
  items = localSearch(q);
  renderList(q);
  const mySeq = ++seq;
  debounce = setTimeout(async () => {
    const result = await searchPlaces(q);
    if (mySeq !== seq) return;
    items = result;
    renderList(q);
  }, 250);
});

input.addEventListener("keydown", (e) => {
  if (list.hidden || items.length === 0) return;
  if (e.key === "ArrowDown") { e.preventDefault(); setActive((active + 1) % items.length); }
  else if (e.key === "ArrowUp") { e.preventDefault(); setActive((active - 1 + items.length) % items.length); }
  else if (e.key === "Escape") closeList();
});

input.addEventListener("blur", closeList);

$("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  if (!list.hidden && items.length) { choose(active >= 0 ? active : 0); return; }
  setStatus("지역 검색 중...");
  try {
    const result = await searchPlaces(q);
    if (!result.length) throw new Error(`'${q}' 지역을 찾을 수 없습니다.`);
    items = result;
    choose(0);
  } catch (err) {
    $("weather").hidden = true;
    setStatus(err.message, true);
  }
});

// 기본값: 서울
load({ name: "서울, 대한민국", latitude: 37.5665, longitude: 126.978 });
