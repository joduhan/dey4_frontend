// POST /api/chat — Gemini function-calling 에이전트 (Vercel 서버리스 함수)
//  1) 사용자 질문 + 도구 선언(get_weather, find_spots)을 Gemini에 보낸다
//  2) Gemini가 functionCall 로 도구 선택 → 서버가 실행 → 결과를 되돌려 준다
//  3) 도구 호출이 더 없을 때까지 반복하고 최종 답변(+호출 기록, 추천 장소)을 반환한다
// GEMINI_API_KEY 는 서버 환경변수로만 사용되며 브라우저로 나가지 않는다.
const { TOOLS, TOOL_DECLARATIONS } = require("./_lib");

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_STEPS = 6;     // 도구 호출 반복 상한
const MAX_HISTORY = 12;  // 대화 기록 상한
const MAX_TEXT = 1000;   // 메시지 길이 상한

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

async function callGemini(key, contents) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents,
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      generationConfig: { temperature: 0.5 },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Gemini HTTP ${res.status}`);
  return data;
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
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const data = await callGemini(key, contents);
      const cand = data.candidates?.[0];
      if (!cand?.content) {
        const why = data.promptFeedback?.blockReason || cand?.finishReason || "빈 응답";
        return res.status(502).json({ error: `Gemini 가 답변을 만들지 못했습니다 (${why}).` });
      }
      const parts = cand.content.parts || [];
      const calls = parts.filter((p) => p.functionCall);

      if (calls.length === 0) {
        const reply = parts.map((p) => p.text || "").join("").trim();
        return res.status(200).json({ reply: reply || "답변을 만들지 못했습니다.", toolCalls, spots });
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
    console.error(e);
    return res.status(502).json({ error: `에이전트 오류: ${e.message}` });
  }
};
