// OpenAI-compatible backends: any service that answers the Chat Completions
// API with function calling. OpenRouter (one key for most models) and
// "another service" with its own address: Gemini, DeepSeek, Mistral, Groq,
// xAI, or a model on this computer through Ollama or LM Studio. Plain fetch,
// streamed; the loop is the OpenAI backend's: the model calls a function, the
// server calls the MCP tool, the result goes back as a tool message, until
// the model answers in text.
import { redact } from "../../../cli/lib/redact.mjs";
import { ChatError, MAX_STEPS } from "./transcript.mjs";
import { KEY_BACKENDS, backendKey, isLocal } from "./config.mjs";
import { sseEvents } from "./openai.mjs";
import { runCall, serviceError, stopped } from "./calls.mjs";

/** Where a compatible backend answers: OpenRouter's own address, or the one saved for "another service". */
export const baseOf = (backend, conn) => (backend === "openrouter" ? KEY_BACKENDS.openrouter.baseUrl : (conn?.baseUrl ?? null));
const whoOf = (backend) => (backend === "openrouter" ? "OpenRouter" : "The chat service");

const headers = (key) => ({
  "content-type": "application/json",
  ...(key ? { authorization: `Bearer ${key}` } : {}),
  // OpenRouter shows these on its activity page; harmless elsewhere.
  "x-title": "Shard studio",
});

/** The service's models that can call tools, from GET /models (free). OpenRouter marks them; others list everything. */
export async function listModels({ base, key, fetch, who = "The chat service" }) {
  const res = await fetch(`${base}/models`, { headers: headers(key) });
  if (!res.ok) throw await serviceError(res, who, { redact });
  const body = await res.json();
  const data = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  return data
    .filter((m) => typeof m?.id === "string" && (!Array.isArray(m.supported_parameters) || m.supported_parameters.includes("tools")))
    .map((m) => m.id.replace(/^models\//, ""))
    .sort((a, b) => a.localeCompare(b));
}

/** MCP tools (Responses-API function shape) as Chat Completions tools. */
export const chatTools = (functions) => functions.map((f) => ({ type: "function", function: { name: f.name, description: f.description, parameters: f.parameters } }));

/** One streamed reply: its text and its tool calls, in order. */
async function readStream(body, { sink, key }) {
  let text = "";
  const calls = []; // by index: { id, name, args }
  let finish = null;
  for await (const e of sseEvents(body)) {
    if (e?.error) throw new ChatError(`The chat service error: ${redact(e.error.message ?? String(e.error))}`);
    const choice = e?.choices?.[0];
    if (!choice) continue;
    const d = choice.delta ?? {};
    if (typeof d.content === "string" && d.content) {
      text += d.content;
      sink.text(key, d.content);
    }
    for (const t of d.tool_calls ?? []) {
      const i = t.index ?? calls.length;
      const c = (calls[i] ??= { id: null, name: "", args: "" });
      if (t.id) c.id = t.id;
      if (t.function?.name) c.name += t.function.name;
      if (t.function?.arguments) c.args += t.function.arguments;
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  if (!finish && !text && !calls.length) throw new ChatError("The chat service's reply ended early. Send the message again.");
  if (text) sink.textDone(key, text);
  return { text, calls: calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id ?? `call_${i}` })), finish };
}

/** One chat turn; resolves like the OpenAI backend's: {}, { budget } or { uncertain }. */
export async function runTurn({ base, key, model, instructions, history, text, tools, sink, signal, fetch, who = "The chat service" }) {
  const toolList = chatTools(await tools.functions());
  const messages = [{ role: "system", content: instructions }, ...history, { role: "user", content: text }];
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal,
      headers: headers(key),
      body: JSON.stringify({ model, messages, tools: toolList, stream: true, parallel_tool_calls: false }),
    });
    if (!res.ok) throw await serviceError(res, who, { redact });
    const reply = await readStream(res.body, { sink, key: `step${step}` });
    messages.push({
      role: "assistant",
      content: reply.text || null,
      ...(reply.calls.length ? { tool_calls: reply.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args || "{}" } })) } : {}),
    });
    if (!reply.calls.length) return {};
    for (const c of reply.calls) {
      if (signal?.aborted) throw stopped();
      const { output, end } = await runCall(c, { tools, sink, signal });
      messages.push({ role: "tool", tool_call_id: c.id, content: output });
      if (end) return end;
    }
    if (signal?.aborted) throw stopped();
  }
  throw new ChatError(`Stopped after ${MAX_STEPS} steps without a final answer. Ask again with a narrower request.`);
}

/** The backend for OpenRouter or "another service". `fetch` is injected (tests pass a fake service). */
export function compatibleBackend(backend, { fetch = globalThis.fetch, tools }) {
  const who = whoOf(backend);
  const key = () => backendKey(backend);
  return {
    name: backend,
    async ready(conn) {
      const base = baseOf(backend, conn);
      if (!base) return { ok: false, message: "Give the chat service's address in Settings first." };
      if (!key() && !isLocal(base)) return { ok: false, message: `Paste ${backend === "openrouter" ? "an OpenRouter" : "the service's"} API key in Settings first.` };
      if (!conn.model) return { ok: false, message: "Pick the model for the chat in Settings." };
      return { ok: true };
    },
    turn: ({ conn, ...rest }) => runTurn({ base: baseOf(backend, conn), key: key(), model: conn.model, tools, fetch, who, ...rest }),
    models: (conn) => listModels({ base: baseOf(backend, conn), key: key(), fetch, who }),
  };
}
