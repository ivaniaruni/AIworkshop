import "dotenv/config";

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import Ajv from "ajv";

const app = express();
app.use(express.json({ limit: "1mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

const PORT = Number(process.env.PORT || 3001);
const CEREBRAS_BASE_URL =
  process.env.CEREBRAS_BASE_URL || "https://api.cerebras.ai/v1";
const CEREBRAS_MODEL = process.env.CEREBRAS_MODEL || "llama-3.3-70b";
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;

// ---------- Carga prompt + schema ----------
const ajv = new Ajv();

const promptPath = path.join(__dirname, "prompt.md");
const schemaPath = path.join(
  __dirname,
  "schemas",
  "police_anomalies.schema.json"
);

let systemPrompt = "";
let policeSchema = null;
let validatePolice = null;

async function loadConfig() {
  systemPrompt = await fs.readFile(promptPath, "utf-8");
  policeSchema = JSON.parse(await fs.readFile(schemaPath, "utf-8"));
  validatePolice = ajv.compile(policeSchema);
}

await loadConfig();

// ---------- Health ----------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "llm-workshop-app" });
});

// ---------- Listar modelos (extra) ----------
app.get("/api/models", async (req, res) => {
  try {
    if (!CEREBRAS_API_KEY) {
      return res.status(500).json({ error: "Missing CEREBRAS_API_KEY" });
    }

    const r = await fetch(`${CEREBRAS_BASE_URL}/models`, {
      headers: {
        Authorization: `Bearer ${CEREBRAS_API_KEY}`,
      },
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    res.json(data);
  } catch (err) {
    res.status(500).json({
      error: "Failed to list models",
      details: err?.message ?? String(err),
    });
  }
});

// ---------- Nuevo endpoint: detector de anomalías ----------
app.post("/api/police-anomalies", async (req, res) => {
  try {
    if (!CEREBRAS_API_KEY) {
      return res.status(500).json({ error: "Missing CEREBRAS_API_KEY" });
    }

    const {
      report_text,
      report_type,
      location_scope = null,
      incident_datetime = null,
      time_window = null,
      temperature = 0.2,
      maxTokens = 350,
    } = req.body ?? {};

    if (!report_text || !report_text.trim()) {
      return res.status(400).json({ error: "report_text is required" });
    }
    if (!report_type || !report_type.trim()) {
      return res.status(400).json({ error: "report_type is required" });
    }

    const inputJson = {
      report_text,
      report_type,
      location_scope,
      incident_datetime,
      time_window,
    };

    const payload = {
      model: CEREBRAS_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify(inputJson),
        },
      ],
      temperature,
      max_tokens: maxTokens,
      stream: false,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "police_anomalies",
          strict: true,
          schema: policeSchema,
        },
      },
    };

    const r = await fetch(`${CEREBRAS_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CEREBRAS_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    const content = data?.choices?.[0]?.message?.content ?? "";
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      return res.status(502).json({
        error: "LLM response is not valid JSON",
        raw: content,
      });
    }

    const valid = validatePolice(parsed);
    if (!valid) {
      return res.status(502).json({
        error: "LLM response does not match schema",
        details: validatePolice.errors,
        raw: parsed,
      });
    }

    res.json({
      model: data?.model ?? CEREBRAS_MODEL,
      data: parsed,
      raw: parsed,
      usage: data?.usage ?? null,
    });
  } catch (err) {
    res.status(500).json({
      error: "Police anomaly detection failed",
      details: err?.message ?? String(err),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Running on http://localhost:${PORT}`);
});