// AI 여행 도우미 채팅: /api/chat (Gemini function-calling 에이전트) 호출
const chatLog = document.getElementById("chat-log");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatBtn = chatForm.querySelector("button");
const history = []; // [{role: "user" | "model", text}]

const TOOL_LABEL = { get_weather: "날씨 조회", find_spots: "장소 검색" };

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 간단한 마크다운(굵게, 목록, 줄바꿈)만 처리. 먼저 이스케이프하므로 안전하다.
function renderText(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/^\s*[*-]\s+/gm, "• ")
    .replace(/\n/g, "<br>");
}

function addMessage(role, html) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.innerHTML = html;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

function toolChips(toolCalls) {
  if (!toolCalls?.length) return "";
  const chips = toolCalls.map((t) => {
    const args = Object.values(t.args || {}).join(", ");
    return (
      `<span class="chip ${t.ok ? "" : "fail"}" title="${escapeHtml(t.summary || "")}">` +
      `🔧 ${escapeHtml(t.name)}(${escapeHtml(args)}) — ${escapeHtml(TOOL_LABEL[t.name] || "")}` +
      `<small>${escapeHtml(t.summary || "")}</small></span>`
    );
  });
  return `<div class="chips">${chips.join("")}</div>`;
}

async function send(text) {
  text = text.trim();
  if (!text) return;
  chatInput.value = "";
  addMessage("user", renderText(text));
  history.push({ role: "user", text });
  chatBtn.disabled = chatInput.disabled = true;
  const pending = addMessage("model pending", "생각하는 중... (날씨와 장소를 조회합니다)");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `서버 오류 (${res.status})`);

    pending.className = "msg model";
    pending.innerHTML = toolChips(data.toolCalls) + `<div>${renderText(data.reply)}</div>`;
    history.push({ role: "model", text: data.reply });
    if (data.spots?.length) window.mapApi?.showSpots(data.spots);
    // 가장 마지막에 조회한 날씨 지점으로 오른쪽 카드도 갱신하지는 않고, 지도에는 추천 장소만 표시
  } catch (err) {
    pending.className = "msg model error";
    pending.textContent = `오류: ${err.message}`;
    history.pop(); // 실패한 질문은 기록에서 제외해 재시도 가능
  } finally {
    chatBtn.disabled = chatInput.disabled = false;
    chatInput.focus();
    chatLog.scrollTop = chatLog.scrollHeight;
  }
}

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  send(chatInput.value);
});

document.querySelectorAll(".examples button").forEach((b) =>
  b.addEventListener("click", () => send(b.textContent))
);

addMessage(
  "model",
  "안녕하세요! 실시간 날씨와 미세먼지를 확인해서 가볼 만한 곳을 추천해 드려요. 아래 예시를 눌러 보거나 직접 물어보세요."
);
