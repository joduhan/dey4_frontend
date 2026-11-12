// 에이전트가 호출하는 도구 2개: get_weather(실시간 날씨), find_spots(장소 검색)
// 언더스코어(_)로 시작하는 파일은 Vercel에서 API 경로로 노출되지 않는다.
const { KR_REGIONS } = require("../regions.js");
const { SPOTS, COVERED_AREAS } = require("./_spots");

const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";

const WMO = {
  0: "맑음", 1: "대체로 맑음", 2: "구름 조금", 3: "흐림", 45: "안개", 48: "서리 안개",
  51: "약한 이슬비", 53: "이슬비", 55: "강한 이슬비", 56: "약한 어는 이슬비", 57: "강한 어는 이슬비",
  61: "약한 비", 63: "비", 65: "강한 비", 66: "약한 어는 비", 67: "강한 어는 비",
  71: "약한 눈", 73: "눈", 75: "강한 눈", 77: "싸락눈",
  80: "약한 소나기", 81: "소나기", 82: "강한 소나기", 85: "약한 눈 소나기", 86: "강한 눈 소나기",
  95: "뇌우", 96: "우박을 동반한 뇌우", 99: "강한 우박 뇌우",
};
const isPrecip = (c) => (c >= 51 && c <= 67) || (c >= 71 && c <= 77) || (c >= 80 && c <= 86) || c >= 95;

function dustGrade(metric, v) {
  if (v == null) return null;
  const limits = metric === "pm10" ? [30, 80, 150] : [15, 35, 75];
  const names = ["좋음", "보통", "나쁨", "매우나쁨"];
  const i = limits.findIndex((l) => v <= l);
  return names[i === -1 ? 3 : i];
}

async function fetchJson(url, options = {}, ms = 10000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ───────────── 지역 이름 → 좌표 ─────────────
const stripSuffix = (s) => s.replace(/(특별자치도|특별자치시|특별시|광역시|도|시|군|구)$/, "");

// 1) 내장 지역 표(주요 시·군) 우선  2) 카카오 키워드 검색(키가 있을 때)  3) Open-Meteo 지오코딩(한국 한정)
// Open-Meteo 는 '제주', '서귀포'를 못 찾거나 '부산'을 산 이름으로 찾는 등 부정확해서 내장 표를 먼저 쓴다.
async function geocode(name) {
  const q = String(name || "").trim();
  if (!q) return null;
  const base = stripSuffix(q);
  const lower = q.toLowerCase();

  const local =
    KR_REGIONS.find(([ko, en]) => ko === q || ko === base || en.toLowerCase() === lower) ||
    (base.length >= 2 ? KR_REGIONS.find(([ko]) => ko.startsWith(base)) : null);
  if (local) return { name: local[0], lat: local[2], lon: local[3] };

  // 카카오 키가 있으면 카카오 키워드 검색으로 한국 지명·명소를 정확히 찾는다
  const kakaoKey = process.env.KAKAO_REST_API_KEY;
  if (kakaoKey) {
    try {
      const data = await kakaoGet("keyword", { query: q, size: 1 }, kakaoKey);
      const d = data.documents?.[0];
      if (d) return { name: d.place_name, lat: Number(d.y), lon: Number(d.x) };
    } catch { /* Open-Meteo 로 대체 */ }
  }

  const candidates = [...new Set([q, base, base + "시", base + "군"])].filter(Boolean);
  for (const c of candidates) {
    const url = `${GEO_URL}?name=${encodeURIComponent(c)}&count=10&language=ko&countryCode=KR&format=json`;
    const data = await fetchJson(url);
    const list = data.results || [];
    if (!list.length) continue;
    // 도시·행정구역(PPL*, ADM*)을 우선하고 그중 인구가 많은 곳을 선택 (산·섬 등 동명 지형 회피)
    const places = list.filter((r) => /^(PPL|ADM)/.test(r.feature_code || ""));
    const pool = places.length ? places : list;
    const r = pool.sort((a, b) => (b.population || 0) - (a.population || 0))[0];
    return { name: [r.name, r.admin1].filter(Boolean).join(", "), lat: r.latitude, lon: r.longitude };
  }
  return null;
}

// ───────────── 도구 1: 실시간 날씨 ─────────────
async function getWeather({ location }) {
  const place = await geocode(location);
  if (!place) return { error: `'${location}' 지역을 찾지 못했습니다. 다른 이름(예: 시·군·구 이름)으로 다시 시도하세요.` };

  const wUrl = `${WEATHER_URL}?` + new URLSearchParams({
    latitude: place.lat,
    longitude: place.lon,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    forecast_days: "1",
    timezone: "Asia/Seoul",
  });
  const aUrl = `${AIR_URL}?` + new URLSearchParams({
    latitude: place.lat, longitude: place.lon, current: "pm10,pm2_5", timezone: "Asia/Seoul",
  });

  const [w, air] = await Promise.all([fetchJson(wUrl), fetchJson(aUrl).catch(() => null)]);
  const c = w.current;
  const d = w.daily;
  return {
    location: place.name,
    latitude: place.lat,
    longitude: place.lon,
    observed_at: c.time,
    condition: WMO[c.weather_code] ?? "알 수 없음",
    is_raining_or_snowing: isPrecip(c.weather_code),
    temperature_c: c.temperature_2m,
    feels_like_c: c.apparent_temperature,
    humidity_percent: c.relative_humidity_2m,
    wind_kmh: c.wind_speed_10m,
    precipitation_mm: c.precipitation,
    today_max_c: d?.temperature_2m_max?.[0],
    today_min_c: d?.temperature_2m_min?.[0],
    today_rain_probability_percent: d?.precipitation_probability_max?.[0],
    pm10: air?.current?.pm10 ?? null,
    pm10_grade: dustGrade("pm10", air?.current?.pm10),
    pm2_5: air?.current?.pm2_5 ?? null,
    pm2_5_grade: dustGrade("pm2_5", air?.current?.pm2_5),
    note: air ? "미세먼지는 측정값이 아닌 대기질 모델 값" : "미세먼지 정보를 가져오지 못함",
  };
}

// ───────────── 도구 2: 장소 검색 ─────────────
// 카테고리별 카카오 로컬 API 조회 방식 (KAKAO_REST_API_KEY 가 있을 때 사용)
const CATEGORIES = {
  attraction: { indoor: false, radius: 10000, kakao: { code: "AT4" } },
  museum: { indoor: true, radius: 10000, kakao: { keywords: ["박물관", "미술관"], code: "CT1" } },
  park: { indoor: false, radius: 10000, kakao: { keywords: ["공원"], code: "AT4" } },
  beach: { indoor: false, radius: 10000, kakao: { keywords: ["해수욕장"], code: "AT4" } },
  cafe: { indoor: true, radius: 3000, kakao: { code: "CE7" } },
  restaurant: { indoor: true, radius: 3000, kakao: { code: "FD6" } },
  indoor: { indoor: true, radius: 10000, kakao: { keywords: ["박물관", "미술관", "아쿠아리움", "과학관"] } },
};

function distKm(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 카카오 로컬 API — 키워드(복수)·카테고리 코드로 주변 검색 후 합쳐서 가까운 순 정렬
const KAKAO_BASE = "https://dapi.kakao.com/v2/local/search";
async function kakaoGet(path, params, key) {
  return fetchJson(`${KAKAO_BASE}/${path}.json?${new URLSearchParams(params)}`, {
    headers: { Authorization: `KakaoAK ${key}` },
  });
}

async function searchKakao(center, cat, n, key) {
  const { code, keywords } = cat.kakao;
  const base = { x: center.lon, y: center.lat, radius: Math.min(cat.radius, 20000), size: 15 };
  const requests = keywords
    ? keywords.map((q) => kakaoGet("keyword", { ...base, query: q, sort: "distance", ...(code ? { category_group_code: code } : {}) }, key))
    : [kakaoGet("category", { ...base, category_group_code: code, sort: "distance" }, key)];
  const results = await Promise.all(requests);

  const seen = new Set();
  const spots = [];
  for (const d of results.flatMap((r) => r.documents || [])) {
    const id = d.id || `${d.place_name}|${d.address_name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    spots.push({
      name: d.place_name,
      type: (d.category_name || "").split(" > ").pop(),
      lat: Number(d.y),
      lon: Number(d.x),
      distance_km: d.distance ? Math.round(Number(d.distance) / 100) / 10 : Math.round(distKm(center.lat, center.lon, Number(d.y), Number(d.x)) * 10) / 10,
      address: d.road_address_name || d.address_name || undefined,
      url: d.place_url || undefined,
    });
  }
  return spots.sort((a, b) => a.distance_km - b.distance_km).slice(0, n);
}

// 내장 큐레이션 데이터셋 검색 (키 불필요): 기준 지역 반경 안에서 카테고리가 맞는 장소를 가까운 순으로
const DATASET_RADIUS_KM = 40;
function searchDataset(center, category, n) {
  return SPOTS
    .filter((s) => (category === "indoor" ? s.indoor : s.category === category))
    .map((s) => ({ ...s, distance_km: Math.round(distKm(center.lat, center.lon, s.lat, s.lon) * 10) / 10 }))
    .filter((s) => s.distance_km <= DATASET_RADIUS_KM)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, n)
    .map(({ name, category: c, lat, lon, distance_km, desc }) => ({ name, type: c, lat, lon, distance_km, description: desc }));
}

async function findSpots({ area, category = "attraction", limit = 6 }) {
  const cat = CATEGORIES[category];
  if (!cat) return { error: `지원하지 않는 category: ${category}. 가능한 값: ${Object.keys(CATEGORIES).join(", ")}` };
  const center = await geocode(area);
  if (!center) return { error: `'${area}' 지역을 찾지 못했습니다. 다른 이름으로 다시 시도하세요.` };
  const n = Math.min(Math.max(parseInt(limit) || 6, 1), 10);

  const kakaoKey = process.env.KAKAO_REST_API_KEY;
  let spots, source;
  if (kakaoKey) {
    try {
      spots = await searchKakao(center, cat, n, kakaoKey);
      source = "kakao";
    } catch (e) {
      return { error: `카카오 장소 검색 실패(${e.message}). 잠시 후 다시 시도하세요.` };
    }
  } else if (category === "cafe" || category === "restaurant") {
    return { error: `'${category}' 검색은 서버에 KAKAO_REST_API_KEY 가 설정되어 있어야 합니다. 대신 attraction, museum, park, beach, indoor 로 검색하세요.` };
  } else {
    spots = searchDataset(center, category, n);
    source = "curated";
  }

  return {
    area: center.name,
    category,
    source,
    count: spots.length,
    spots: spots.map((s) => ({ ...s, indoor: cat.indoor })),
    ...(spots.length === 0
      ? { note: `검색 결과가 없습니다. 다른 category로 시도하거나, 기본 데이터가 있는 지역(${COVERED_AREAS.join(", ")}) 중에서 골라 보세요.` }
      : {}),
  };
}

const TOOLS = { get_weather: getWeather, find_spots: findSpots };

// Gemini function calling 선언
const TOOL_DECLARATIONS = [
  {
    name: "get_weather",
    description: "한국의 특정 지역(도시·시군구·명소 이름)의 실시간 날씨와 미세먼지(PM10, PM2.5), 오늘의 최고/최저 기온과 강수확률을 조회한다. 날씨나 야외 활동 가능 여부를 판단할 때 사용한다.",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string", description: "지역 이름. 예: 서울, 제주, 해운대, 강릉" },
      },
      required: ["location"],
    },
  },
  {
    name: "find_spots",
    description: "한국의 특정 지역 주변에서 장소(관광지, 박물관, 공원, 해변, 카페, 식당, 실내 놀거리)를 검색한다. 어디 갈지, 뭘 할지 추천할 때 사용한다.",
    parameters: {
      type: "object",
      properties: {
        area: { type: "string", description: "검색할 지역 이름. 예: 서울, 제주, 부산" },
        category: {
          type: "string",
          enum: Object.keys(CATEGORIES),
          description: "attraction=관광명소, museum=박물관·미술관, park=공원·정원, beach=해변, cafe=카페, restaurant=식당, indoor=비 올 때 좋은 실내 장소",
        },
        limit: { type: "integer", description: "결과 개수 (1~10, 기본 6)" },
      },
      required: ["area", "category"],
    },
  },
];

module.exports = { TOOLS, TOOL_DECLARATIONS, getWeather, findSpots, geocode };
