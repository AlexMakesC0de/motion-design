// Anthropic backend: Claude through the Messages API with tool use, over
// plain fetch like the OpenAI backend (the studio server has no
// dependencies). Each turn sends the earlier user and assistant lines plus
// the new message, streams the reply, and runs the loop: Claude asks for a
// tool (tool_use), the server calls the MCP tool, the results go back in one
// user message (tool_result), until Claude answers in text. Within a turn
// every block Claude sent, thinking included, goes back unchanged.
import { redact } from "../../../cli/lib/redact.mjs";
import { ChatError, MAX_STEPS } from "./transcript.mjs";
import { backendKey } from "./config.mjs";
import { sseEvents } from "./openai.mjs";
import { parseArgs, runCall, serviceError, stopped } from "./calls.mjs";

export const API = "https://api.anthropic.com/v1";
export const VERSION = "2023-06-01";
/** Room for a reply and its thinking; the chat's replies are short, so this is rarely near. */
export const MAX_TOKENS = 16_000;
const WHO = "Anthropic";

const headers = (key) => ({ "x-api-key": key, "anthropic-version": VERSION, "content-type": "application/json" });

/** The key's Claude models, newest first, from GET /v1/models (free). */
export async function listModels({ key, fetch }) {
  const res = await fetch(`${API}/models?limit=100`, { headers: headers(key) });
  if (!res.ok) throw await serviceError(res, WHO, { redact });
  const { data = [] } = await res.json();
  return data
    .filter((m) => typeof m?.id === "string")
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")) || a.id.localeCompare(b.id))
    .map((m) => m.id);
}

/** MCP tools (Responses-API function shape, from tools.functions()) as Anthropic tools. */
export const anthropicTools = (functions) => functions.map((f) => ({ name: f.name, description: f.description, input_schema: f.parameters ?? { type: "object", properties: {} } }));

/** History as Messages input: it must start with the user. */
export function messagesFrom(history, text) {
  const out = [...history, { role: "user", content: text }];
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

/**
 * One streamed response, as its content blocks and stop reason. Text is
 * passed to the sink as it arrives, keyed `${step}:${index}`.
 */
async function readStream(body, { sink, step }) {
  const blocks = [];
  const json = new Map(); // index → the tool input's JSON so far
  let stop = null;
  for await (const e of sseEvents(body)) {
    if (e.type === "content_block_start") {
      blocks[e.index] = { ...e.content_block };
      if (e.content_block?.type === "tool_use") json.set(e.index, "");
    } else if (e.type === "content_block_delta") {
      const b = blocks[e.index];
      const d = e.delta ?? {};
      if (!b) continue;
      if (d.type === "text_delta") {
        b.text = (b.text ?? "") + d.text;
        sink.text(`${step}:${e.index}`, d.text);
      } else if (d.type === "input_json_delta") json.set(e.index, (json.get(e.index) ?? "") + (d.partial_json ?? ""));
      else if (d.type === "thinking_delta") b.thinking = (b.thinking ?? "") + (d.thinking ?? "");
      else if (d.type === "signature_delta") b.signature = d.signature;
    } else if (e.type === "content_block_stop") {
      const b = blocks[e.index];
      if (b?.type === "text") sink.textDone(`${step}:${e.index}`, b.text ?? "");
      if (b?.type === "tool_use") {
        // Sent back as {} when it never parsed; the raw text (not sent) lets runCall report the bad JSON.
        const raw = json.get(e.index) ?? "";
        const parsed = parseArgs(raw);
        b.input = parsed ?? {};
        Object.defineProperty(b, "raw", { value: parsed ? null : raw, enumerable: false });
      }
    } else if (e.type === "message_delta") stop = e.delta?.stop_reason ?? stop;
    else if (e.type === "error") throw new ChatError(`${WHO} error: ${redact(e.error?.message ?? "no message")}`);
  }
  if (!stop) throw new ChatError(`${WHO}'s reply ended early. Send the message again.`);
  return { blocks: blocks.filter(Boolean), stop };
}

/** One chat turn; resolves like the OpenAI backend's: {}, { budget } or { uncertain }. */
export async function runTurn({ key, model, instructions, history, text, tools, sink, signal, fetch }) {
  const toolList = anthropicTools(await tools.functions());
  const messages = messagesFrom(history, text);
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await fetch(`${API}/messages`, {
      method: "POST",
      signal,
      headers: headers(key),
      body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system: instructions, messages, tools: toolList, stream: true }),
    });
    if (!res.ok) throw await serviceError(res, WHO, { redact });
    const { blocks, stop } = await readStream(res.body, { sink, step });
    if (stop === "refusal") throw new ChatError("Claude declined to answer that. Try saying it another way.");
    messages.push({ role: "assistant", content: blocks });
    const calls = blocks.filter((b) => b.type === "tool_use");
    if (!calls.length) {
      if (stop === "max_tokens") sink.notice("The reply hit its length limit and was cut short.", "info");
      return {};
    }
    const results = [];
    for (const c of calls) {
      if (signal?.aborted) throw stopped();
      const { output, isError, end } = await runCall({ id: c.id, name: c.name, args: c.raw ?? c.input }, { tools, sink, signal });
      results.push({ type: "tool_result", tool_use_id: c.id, content: output, ...(isError ? { is_error: true } : {}) });
      if (end) return end;
    }
    messages.push({ role: "user", content: results });
    if (signal?.aborted) throw stopped();
  }
  throw new ChatError(`Stopped after ${MAX_STEPS} steps without a final answer. Ask again with a narrower request.`);
}

/** The backend as the chat sessions use it. `fetch` is injected (tests pass a fake Anthropic). */
export function anthropicBackend({ fetch = globalThis.fetch, tools }) {
  return {
    name: "anthropic",
    async ready(conn) {
      if (!backendKey("anthropic")) return { ok: false, message: "Paste an Anthropic API key in Settings first." };
      if (!conn.model) return { ok: false, message: "Pick the Claude model for the chat in Settings." };
      return { ok: true };
    },
    turn: ({ conn, ...rest }) => runTurn({ key: backendKey("anthropic"), model: conn.model, tools, fetch, ...rest }),
    models: () => listModels({ key: backendKey("anthropic"), fetch }),
  };
}
