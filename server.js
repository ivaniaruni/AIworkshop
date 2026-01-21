import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import Ajv from "ajv";

import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { AgentExecutor, createToolCallingAgent } from "langchain/agents";
import { AIMessage, HumanMessage } from "@langchain/core/messages";

const app = express();
app.use(express.json({ limit: "1mb" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

const PORT = Number(process.env.PORT || 3001);
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;
const CEREBRAS_MODEL = process.env.CEREBRAS_MODEL || "llama-3.3-70b";
const MAX_STEPS = Number(process.env.MAX_STEPS || 4);

if (!CEREBRAS_API_KEY) console.warn("Missing CEREBRAS_API_KEY");

const ajv = new Ajv();

// ------- cargar prompt sistema + schema respuesta -------
const systemPromptPath = path.join(__dirname, "prompts", "practice_agent.system.md");
const responseSchemaPath = path.join(__dirname, "schemas", "practice_agent.response.schema.json");

const systemPromptText = await fs.readFile(systemPromptPath, "utf-8");
const responseSchema = JSON.parse(await fs.readFile(responseSchemaPath, "utf-8"));
const validateResponse = ajv.compile(responseSchema);

// ------- memoria conversaciones (RAM) -------
const conversations = new Map(); // conversation_id -> BaseMessage[]

// ------- helpers lectura/escritura JSON local -------
async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw);
}
async function writeJson(filePath, obj) {
  await fs.writeFile(filePath, JSON.stringify(obj, null, 2), "utf-8");
}

// ------- final step con Structured Outputs (Cerebras) -------
async function cerebrasFinalJson({ messages, schema }) {
  const r = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CEREBRAS_API_KEY}`,
      "Content-Type": "application/json",
      "X-Cerebras-3rd-Party-Integration": "langchain",
    },
    body: JSON.stringify({
      model: CEREBRAS_MODEL,
      messages,
      temperature: 0,
      stream: false,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "practice_agent_response",
          strict: true,
          schema,
        },
      },
    }),
  });

  const data = await r.json();
  if (!r.ok) throw new Error(`Cerebras final step failed: ${JSON.stringify(data)}`);

  return data?.choices?.[0]?.message?.content ?? "";
}

// ------- Tool schemas (AJV) para validar args antes de ejecutar -------
async function loadToolSchema(name) {
  const p = path.join(__dirname, "schemas", "tools", `${name}.schema.json`);
  return JSON.parse(await fs.readFile(p, "utf-8"));
}

const toolSchemas = {
  get_student_profile: ajv.compile(await loadToolSchema("get_student_profile")),
  list_week_tasks: ajv.compile(await loadToolSchema("list_week_tasks")),
  create_followup_task: ajv.compile(await loadToolSchema("create_followup_task")),
};

// ------- Tools reales (mock/local) -------
async function getStudentProfile({ student_id }) {
  const students = await readJson(path.join(__dirname, "data", "students.json"));
  return students.find((s) => s.student_id === student_id) ?? null;
}

async function listWeekTasks({ student_id, week_id }) {
  const all = await readJson(path.join(__dirname, "data", "week_tasks.json"));
  const entry = all.find((x) => x.student_id === student_id && x.week_id === week_id);
  return entry?.tasks ?? [];
}

async function createFollowupTask({ student_id, title, priority, due_date }) {
  const followupsPath = path.join(__dirname, "data", "followups.json");
  const followups = await readJson(followupsPath);

  const followup_id = `fu_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  followups.push({
    followup_id,
    student_id,
    title,
    priority,
    due_date,
    created_at: new Date().toISOString(),
  });

  await writeJson(followupsPath, followups);
  return { followup_id };
}

// ------- Wrappers LangChain tool() con Zod + validación AJV -------
const get_student_profile = tool(
  async (args) => {
    const ok = toolSchemas.get_student_profile(args);
    if (!ok) throw new Error(`Invalid args: ${JSON.stringify(toolSchemas.get_student_profile.errors)}`);
    return JSON.stringify(await getStudentProfile(args));
  },
  {
    name: "get_student_profile",
    description: "Obtiene perfil del estudiante: nombre, empresa, tutor, objetivos.",
    schema: z.object({ student_id: z.string() }),
  }
);

const list_week_tasks = tool(
  async (args) => {
    const ok = toolSchemas.list_week_tasks(args);
    if (!ok) throw new Error(`Invalid args: ${JSON.stringify(toolSchemas.list_week_tasks.errors)}`);
    return JSON.stringify(await listWeekTasks(args));
  },
  {
    name: "list_week_tasks",
    description: "Lista tareas de la semana para student_id y week_id con estado y RA.",
    schema: z.object({ student_id: z.string(), week_id: z.string() }),
  }
);

const create_followup_task = tool(
  async (args) => {
    const ok = toolSchemas.create_followup_task(args);
    if (!ok) throw new Error(`Invalid args: ${JSON.stringify(toolSchemas.create_followup_task.errors)}`);
    return JSON.stringify(await createFollowupTask(args));
  },
  {
    name: "create_followup_task",
    description: "Crea una tarea de seguimiento y la persiste en data/followups.json",
    schema: z.object({
      student_id: z.string(),
      title: z.string(),
      priority: z.enum(["low", "medium", "high"]),
      due_date: z.string(),
    }),
  }
);

const tools = [get_student_profile, list_week_tasks, create_followup_task];

// ------- LLM LangChain apuntando a Cerebras (como enunciado) -------
const llm = new ChatOpenAI({
  model: CEREBRAS_MODEL,
  temperature: 0.2,
  openAIApiKey: CEREBRAS_API_KEY,
  configuration: {
    baseURL: "https://api.cerebras.ai/v1",
    defaultHeaders: {
      "X-Cerebras-3rd-Party-Integration": "langchain",
    },
  },
});

// Prompt agent (history + scratchpad)
const agentPrompt = ChatPromptTemplate.fromMessages([
  ["system", systemPromptText],
  new MessagesPlaceholder("chat_history"),
  ["human", "{input}"],
  new MessagesPlaceholder("agent_scratchpad"),
]);

const agent = await createToolCallingAgent({
  llm,
  tools,
  prompt: agentPrompt,
});

const executor = new AgentExecutor({
  agent,
  tools,
  verbose: false,
  maxIterations: MAX_STEPS,
});

// ------- Endpoint /api/chat -------
app.post("/api/chat", async (req, res) => {
  const t0 = Date.now();

  try {
    const { conversation_id, student_id, week_id, message, mode, debug } = req.body ?? {};

    if (!conversation_id || !student_id || !week_id || !message || !mode) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const history = conversations.get(conversation_id) ?? [];

    // Lo que “ve” el agente (incluye contexto mínimo + mensaje)
    const input = JSON.stringify({ student_id, week_id, mode, message });

    // 1) Tool loop (LangChain)
    const agentResult = await executor.invoke({
      input,
      chat_history: history,
    });

    // 2) Final step: JSON estricto con schema (Cerebras structured outputs)
    const finalText = await cerebrasFinalJson({
      messages: [
        { role: "system", content: systemPromptText },
        { role: "user", content: input },
        { role: "assistant", content: agentResult.output },
        {
          role: "user",
          content: "Genera la respuesta final siguiendo EXACTAMENTE el schema. Devuelve SOLO JSON válido.",
        },
      ],
      schema: responseSchema,
    });

    let parsed;
    try {
      parsed = JSON.parse(finalText);
    } catch {
      return res.status(502).json({ error: "Final response not valid JSON", raw: finalText });
    }

    if (!validateResponse(parsed)) {
      return res.status(502).json({
        error: "Final response does not match schema",
        details: validateResponse.errors,
        raw: parsed,
      });
    }

    // Guardar historial mínimo (para siguientes turnos)
    const newHistory = [
      ...history,
      new HumanMessage({ content: message }),
      new AIMessage({ content: parsed.reply_md }),
    ];
    conversations.set(conversation_id, newHistory);

    const out = { response: parsed };

    if (debug) {
      out.debug = {
        latency_ms: Date.now() - t0,
        steps_max: MAX_STEPS,
        agent_output_preview: String(agentResult.output ?? "").slice(0, 500),
      };
    }

    return res.json(out);
  } catch (err) {
    return res.status(500).json({ error: "Chat failed", details: err?.message ?? String(err) });
  }
});

app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));