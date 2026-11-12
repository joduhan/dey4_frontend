// POST /api/chat — Gemini function-calling 에이전트 (Vercel 서버리스 함수)
//  1) 사용자 질문 + 도구 선언(get_weather, find_spots)을 Gemini에 보낸다
//  2) Gemini가 functionCall 로 도구 선택 → 서버가 실행 → 결과를 되돌려 준다
//  3) 도구 호출이 더 없을 때까지 반복하고 최종 답변(+호출 기록, 추천 장소)을 반환한다
// GEMINI_API_KEY 는 서버 환경변수로만 사용되며 브라우저로 나가지 않는다.
const { TOOLS, TOOL_DECLARATIONS } = require("./_lib");

// 첫 모델이 응답하지 않거나(시간 초과) 제공 종료·과부하면 다음 모델로 자동 전환한다.
const MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
  ...(process.env.GEMINI_FALLBACK_MODELS ?? "gemini-flash-latest,gemini-flash-lite-latest")
    .split(",").map((m) => m.trim()).filter(Boolean),
];
let preferred = 0; // 같은 인스턴스에서 한 번 성공한 모델을 우선 사용
const MAX_STEPS = 6;     // 도구 호출 반복 상한
const MAX_HISTORY = 12;  // 대화 기록 상한
const MAX_TEXT = 1000;   // 메시지 길이 상한
// 함수 전체 시간 예산(ms). vercel.json 의 maxDuration(60초)보다 짧게 잡아, 플랫폼 504 대신 원인이 보이는 오류를 돌려준다.
const BUDGET_MS = Number(process.env.CHAT_BUDGET_MS) || 50000;
const MODEL_TIMEOUT_MS = Number(process.env.CHAT_MODEL_TIMEOUT_MS) || 22000; // 모델 1개당 응답 대기 상한

const SYSTEM = `너는 한국 여행·나들이 추천 에이전트다. 두 가지 도구를 가지고 있다.
- get_weather: 지역의 실시간 날씨와 미세먼지 조회
- find_spots: 지역 주변 장소 검색

규칙:
1. 날씨를 묻는 질문 → get_weather 를 호출해 실제 값으로 답한다. 값을 지어내지 않는다.
2. 장소 검색만 요청 → find_spots 를 호출한다.
3. "어디 갈까/뭐 하지/추천" 같은 질문 → 먼저 get_weather 로 날씨를 확인하고, 그 결과에 맞춰 find_spots 의 category 를 고른다.
   - 비·눈이 오거나 강수확률이 높으면 indoor 또는 museum, cafe
   - 미세먼지가 '나쁨' 이상이면 실내 위주, 야외는 마스크 안내
   - 맑고 미세먼지가 좋으면 attraction, park, beach 같은 야외
4. 지역이 불분명하면 한 번만 되묻는다. 도구가 error 를 반환하면 다른 지역 이름으로 한 번 더 시도한다.
5. 답변은 한국어로 간결하게. 추천할 때는 날씨·미세먼지 근거를 한 줄로 먼저 말하고, 장소는 이름과 이유를 짧게 나열한다. 도구가 준 장소만 추천한다.`;

function summarize(name, result) {
  if (result.error) return result.error;
  if (name === "get_weather") return `${result.location} ${result.temperature_c}°C ${result.condition}, PM10 ${result.pm10 ?? "-"}`;
  if (name === "find_spots") return `${result.area} · ${result.category} ${result.count}곳`;
  return "";
}

const RETRYABLE = [404, 429, 500, 502, 503, 504];

async function callModel(key, model, contents, timeoutMs) {
  const post = async (withThinking) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        signal: ctl.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents,
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
          // 생각(thinking) 수준을 낮춰 응답 지연을 줄인다. temperature 는 기본값 사용(Gemini 3 권장).
          ...(withThinking ? { generationConfig: { thinkingConfig: { thinkingLevel: process.env.GEMINI_THINKING_LEVEL || "low" } } } : {}),
        }),
      });
      return { res, data: await res.json().catch(() => ({})) };
    } catch (e) {
      if (e.name === "AbortError") {
        throw Object.assign(new Error(`${model}: ${Math.round(timeoutMs / 1000)}초 안에 응답 없음`), { retryable: true });
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };

  let { res, data } = await post(true);
  // 모델이 thinking 설정을 지원하지 않으면 설정 없이 한 번 더 시도
  if (res.status === 400 && /think/i.test(data.error?.message || "")) ({ res, data } = await post(false));
  if (!res.ok) {
    throw Object.assign(new Error(`${model}: ${data.error?.message || `HTTP ${res.status}`}`), { retryable: RETRYABLE.includes(res.status) });
  }
  return data;
}

// 우선 모델부터 차례로 시도. 응답 없음/제공 종료/과부하만 다음 모델로 넘어가고, 그 외 오류는 바로 반환한다.
async function callGemini(key, contents, deadline) {
  const errors = [];
  for (let i = 0; i < MODELS.length; i++) {
    const idx = (preferred + i) % MODELS.length;
    const remaining = deadline - Date.now();
    if (remaining < 5000) break;
    try {
      const data = await callModel(key, MODELS[idx], contents, Math.min(MODEL_TIMEOUT_MS, remaining - 2000));
      preferred = idx;
      return { data, model: MODELS[idx] };
    } catch (e) {
      errors.push(e.message);
      console.error("[gemini]", e.message);
      if (!e.retryable) throw new Error(errors.join(" → "));
    }
  }
  throw new Error(errors.length ? errors.join(" → ") : "응답 시간이 부족합니다");
}

// 모델이 시간 내에 답을 못 줄 때, 이미 조회한 도구 결과만으로 간단한 답을 만든다.
function fallbackReply(results) {
  const lines = [];
  for (const { name, result } of results) {
    if (result.error) continue;
    if (name === "get_weather") {
      lines.push(
        `**${result.location}** 현재 ${result.temperature_c}°C, ${result.condition}. ` +
          `미세먼지 PM10 ${result.pm10 ?? "-"}${result.pm10_grade ? `(${result.pm10_grade})` : ""}, ` +
          `초미세먼지 PM2.5 ${result.pm2_5 ?? "-"}${result.pm2_5_grade ? `(${result.pm2_5_grade})` : ""}.`
      );
    } else if (name === "find_spots" && Array.isArray(result.spots) && result.spots.length) {
      lines.push(`${result.area} 주변 추천 장소:`);
      result.spots.slice(0, 6).forEach((s) => lines.push(`* **${s.name}** — ${s.description || s.type || ""}`));
    }
  }
  if (!lines.length) return null;
  return lines.join("\n") + "\n\n(AI 응답이 늦어 조회 결과만 정리했어요.)";
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST 만 지원합니다." });
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "서버에 GEMINI_API_KEY 환경변수가 설정되지 않았습니다." });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const msgs = Array.isArray(body?.messages) ? body.messages : null;
  if (!msgs || msgs.length === 0) return res.status(400).json({ error: "messages 배열이 필요합니다." });

  // 텍스트 대화 기록만 받아 Gemini contents 로 변환 (마지막은 사용자 발화여야 함)
  const contents = msgs
    .slice(-MAX_HISTORY)
    .filter((m) => m && (m.role === "user" || m.role === "model") && typeof m.text === "string" && m.text.trim())
    .map((m) => ({ role: m.role, parts: [{ text: m.text.slice(0, MAX_TEXT) }] }));
  if (contents.length === 0 || contents[contents.length - 1].role !== "user") {
    return res.status(400).json({ error: "마지막 메시지는 user 여야 합니다." });
  }

  const toolCalls = [];
  const spots = [];
  const results = []; // {name, result}
  const timings = []; // 모델 호출별 소요 시간 진단용
  const deadline = Date.now() + BUDGET_MS;
  const partial = (why) => {
    const reply = fallbackReply(results);
    return reply ? { reply, toolCalls, spots, model: `자동 요약 (${why})` } : null;
  };
  try {
    let usedModel = null;
    for (let step = 0; step < MAX_STEPS; step++) {
      if (deadline - Date.now() < 6000) {
        const p = partial("시간 부족");
        if (p) return res.status(200).json(p);
        return res.status(504).json({
          error: `응답 시간이 부족해 중단했습니다. (모델 호출: ${timings.join(", ") || "없음"}) 잠시 후 다시 시도해 주세요.`,
          toolCalls, spots,
        });
      }
      const t0 = Date.now();
      const { data, model } = await callGemini(key, contents, deadline);
      timings.push(`${model} ${((Date.now() - t0) / 1000).toFixed(1)}초`);
      usedModel = model;
      const cand = data.candidates?.[0];
      if (!cand?.content) {
        const why = data.promptFeedback?.blockReason || cand?.finishReason || "빈 응답";
        return res.status(502).json({ error: `Gemini 가 답변을 만들지 못했습니다 (${why}).` });
      }
      const parts = cand.content.parts || [];
      const calls = parts.filter((p) => p.functionCall);

      if (calls.length === 0) {
        const reply = parts.map((p) => p.text || "").join("").trim();
        return res.status(200).json({ reply: reply || "답변을 만들지 못했습니다.", toolCalls, spots, model: usedModel });
      }

      contents.push(cand.content); // 모델의 호출 내용을 그대로 기록(생각 서명 포함)
      const responses = await Promise.all(
        calls.map(async (p) => {
          const { name, args } = p.functionCall;
          const fn = TOOLS[name];
          let result;
          try {
            result = fn ? await fn(args || {}) : { error: `알 수 없는 도구: ${name}` };
          } catch (e) {
            result = { error: `도구 실행 실패: ${e.message}` };
          }
          results.push({ name, result });
          toolCalls.push({ name, args: args || {}, ok: !result.error, summary: summarize(name, result) });
          if (name === "find_spots" && Array.isArray(result.spots)) {
            spots.push(...result.spots.map((s) => ({ ...s, category: result.category })));
          }
          return { functionResponse: { name, response: { result } } };
        })
      );
      contents.push({ role: "user", parts: responses });
    }
    return res.status(200).json({ reply: "도구 호출이 너무 많아 중단했습니다. 질문을 조금 더 구체적으로 해 주세요.", toolCalls, spots });
  } catch (e) {
    console.error(e, timings);
    const p = partial("모델 오류");
    if (p) return res.status(200).json(p);
    return res.status(502).json({ error: `에이전트 오류: ${e.message}${timings.length ? ` (완료된 호출: ${timings.join(", ")})` : ""}` });
  }
};
