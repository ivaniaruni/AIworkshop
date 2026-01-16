const root = document.getElementById("app");

root.innerHTML = `
  <div class="card">
    <h2>Analizar reporte policial</h2>

    <div class="row">
      <label>
        Tipo de reporte
        <select id="report_type">
          <option value="">Selecciona...</option>
          <option value="robo">Robo</option>
          <option value="agresion">Agresión</option>
          <option value="trafico">Incidente de tráfico</option>
        </select>
      </label>

      <label>
        Ámbito / localización
        <input id="location_scope" type="text" placeholder="Distrito, barrio..." />
      </label>
    </div>

    <div class="row">
      <label>
        Fecha/hora incidente (opcional)
        <input id="incident_datetime" type="datetime-local" />
      </label>

      <label>
        Ventana temporal (opcional)
        <input id="time_window" type="text" placeholder="p.ej. última semana" />
      </label>
    </div>

    <label>
      Texto del reporte
      <textarea id="report_text" placeholder="Pega aquí el texto del reporte policial"></textarea>
    </label>

    <button id="analyze-btn">Analizar anomalías</button>

    <div id="error" class="small"></div>
  </div>

    <div id="result" class="card" style="display:none;">
    <div id="badge"></div>
    <div id="confidence"></div>
    <ul id="anomalies-list"></ul>

    <div class="result-footer">
      <label class="small toggle-json-label">
        <input type="checkbox" id="toggle-json" />
        Ver JSON (debug)
      </label>
    </div>
    <pre id="raw-json" style="display:none;"></pre>
  </div>
`;

const reportTextEl = document.getElementById("report_text");
const reportTypeEl = document.getElementById("report_type");
const locationScopeEl = document.getElementById("location_scope");
const incidentDatetimeEl = document.getElementById("incident_datetime");
const timeWindowEl = document.getElementById("time_window");
const analyzeBtn = document.getElementById("analyze-btn");
const errorEl = document.getElementById("error");

const resultCard = document.getElementById("result");
const badgeEl = document.getElementById("badge");
const confidenceEl = document.getElementById("confidence");
const anomaliesList = document.getElementById("anomalies-list");
const toggleJson = document.getElementById("toggle-json");
const rawJsonEl = document.getElementById("raw-json");

analyzeBtn.addEventListener("click", async () => {
  errorEl.textContent = "";

  const payload = {
    report_text: reportTextEl.value,
    report_type: reportTypeEl.value,
    location_scope: locationScopeEl.value || null,
    incident_datetime: incidentDatetimeEl.value || null,
    time_window: timeWindowEl.value || null,
  };

  if (!payload.report_text.trim() || !payload.report_type.trim()) {
    errorEl.textContent = "report_text y report_type son obligatorios";
    return;
  }

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "Analizando...";
  try {
    const res = await fetch("/api/police-anomalies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const body = await res.json();
    if (!res.ok) {
      console.error(body);
      errorEl.textContent = body.error || "Error en el análisis";
      return;
    }

    renderResult(body.data);
    rawJsonEl.textContent = JSON.stringify(body.raw, null, 2);
    resultCard.style.display = "block";
  } catch (err) {
    console.error(err);
    errorEl.textContent = "Error llamando al backend";
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "Analizar anomalías";
  }
});

function renderResult(data) {
  const { is_anomalous, confidence, anomalies } = data;

  badgeEl.textContent = is_anomalous ? "ANOMALÍA" : "OK";
  badgeEl.className = is_anomalous ? "badge badge-danger" : "badge badge-success";

  const pct = Math.round((confidence || 0) * 100);
  confidenceEl.textContent = `Confianza: ${pct}%`;

  anomaliesList.innerHTML = "";
  (anomalies || []).slice(0, 5).forEach((a) => {
    const li = document.createElement("li");
    li.className = "anomaly-card";
    li.innerHTML = `
      <div class="row">
        <strong>${a.type}</strong>
        <span class="severity severity-${a.severity}">${a.severity}</span>
      </div>
      <div class="small">
        ${truncate(a.evidence || "", 160)}
      </div>
      <div class="small">
        Acción recomendada: ${a.recommended_action || "-"}
      </div>
    `;
    anomaliesList.appendChild(li);
  });
}

function truncate(text, max) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "..." : text;
}

toggleJson.addEventListener("change", () => {
  rawJsonEl.style.display = toggleJson.checked ? "block" : "none";
});