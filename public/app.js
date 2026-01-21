const root = document.getElementById("app");

root.innerHTML = `
  <div class="card">
    <h2>Chat</h2>

    <div class="row">
      <label>
        conversation_id
        <input id="conversation_id" type="text" value="conv-1" />
      </label>

      <label>
        student_id
        <input id="student_id" type="text" value="A12" />
      </label>

      <label>
        week_id
        <input id="week_id" type="text" value="2026-W02" />
      </label>

      <label>
        mode
        <select id="mode">
          <option value="student" selected>student</option>
          <option value="tutor">tutor</option>
        </select>
      </label>
    </div>

    <label class="small">
      <input type="checkbox" id="debug" checked />
      debug
    </label>

    <div class="card" id="chatlog" style="background:#f9fafb;"></div>

    <div class="row">
      <input id="message" type="text" style="flex:1" placeholder="Escribe tu mensaje..." />
      <button id="send">Enviar</button>
    </div>

    <div id="error" class="small"></div>
  </div>
`;

const chatlog = document.getElementById("chatlog");
const errorEl = document.getElementById("error");

function addMsg(who, text) {
  const div = document.createElement("div");
  div.className = "anomaly-card"; // reutiliza estilo
  div.innerHTML = `<div class="small"><strong>${who}:</strong></div><pre style="margin:6px 0 0">${escapeHtml(text)}</pre>`;
  chatlog.appendChild(div);
  chatlog.scrollTop = chatlog.scrollHeight;
}

function escapeHtml(s) {
  return (s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

document.getElementById("send").addEventListener("click", async () => {
  errorEl.textContent = "";

  const conversation_id = document.getElementById("conversation_id").value.trim();
  const student_id = document.getElementById("student_id").value.trim();
  const week_id = document.getElementById("week_id").value.trim();
  const mode = document.getElementById("mode").value;
  const debug = document.getElementById("debug").checked;
  const message = document.getElementById("message").value.trim();

  if (!conversation_id || !student_id || !week_id || !mode || !message) {
    errorEl.textContent = "Faltan campos obligatorios.";
    return;
  }

  addMsg("Tú", message);
  document.getElementById("message").value = "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id,
        student_id,
        week_id,
        message,
        mode,
        debug
      })
    });

    const body = await res.json();

    if (!res.ok) {
      console.error(body);
      errorEl.textContent = body.error || "Error del backend";
      return;
    }

    addMsg("Agente", body.response.reply_md);

    if (debug && body.debug) {
      addMsg("Debug", JSON.stringify(body.debug, null, 2));
    }
  } catch (err) {
    console.error(err);
    errorEl.textContent = "Error llamando al backend";
  }
});