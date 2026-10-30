// API-key backend: the OpenAI Responses API with function calling, over plain
// fetch (no SDK). Each turn sends the film's earlier user and assistant lines
// plus the new message, streams the reply (response.output_text.delta), and
// runs the loop: the model calls a function, the server calls the MCP tool,
// the result goes back as a function_call_output, until the model answers in
// text. Requests are stateless (store: false): within a turn, each response's
// output items go back as input, without their status field.
import { EXIT } from "../../../cli/lib/errors.mjs";
import { redact } from "../../../cli/lib/redact.mjs";
import { ChatError, MAX_STEPS, resultText } from "./transcript.mjs";
import { openaiKey } from "./config.mjs";

export const API = "https://api.openai.com/v1";
const MAX_TOOL_OUTPUT = 20_000;

// /v1/models says nothing about what a model can do, so keep the text model families and drop the rest.
const TEXT_MODEL = /^(gpt-|o\d|chatgpt-)/;
const NOT_TEXT = /(audio|realtime|tts|transcribe|image|embedding|search|moderation|instruct|dall-e|whisper)/;

async function openaiError(res) {
  let message = `HTTP ${res.status}`;
  try {
    message = (await res.json())?.error?.message ?? message;
  } catch {
    // not JSON; the status says enough
  }
  if (res.status === 401) return new ChatError("OpenAI refused the API key (401). Paste a new key in Settings.", { connect: true });
  if (res.status === 429) return new ChatError(`OpenAI says this key is over its rate or quota limit (429): ${redact(message)}`);
  return new ChatError(`OpenAI error (HTTP ${res.status}): ${redact(message)}`);
}

const auth = (key) => ({ authorization: `Bearer ${key}` });

/** The key's text models, newest first, from GET /v1/models (free). */
export async function listModels({ key, fetch }) {
  const res = await fetch(`${API}/models`, { headers: auth(key) });
  if (!res.ok) throw await openaiError(res);
  const { data = [] } = await res.json();
  return data
    .filter((m) => typeof m?.id === "string" && TEXT_MODEL.test(m.id) && !NOT_TEXT.test(m.id))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id))
    .map((m) => m.id);
}

/** Server-sent events from a fetch body, as parsed JSON data. */
export async function* sseEvents(body) {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
    let cut;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data && data !== "[DONE]") yield JSON.parse(data);
    }
  }
}

const messageText = (item) =>
  (item.content ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text)
    .join("");

/** What the model reads back from a tool: its text, then its structured data. */
function toolOutput(result) {
  const text = resultText(result);
  const data = result?.structuredContent ? `\n${JSON.stringify(result.structuredContent)}` : "";
  return `${text}${data}`.slice(0, MAX_TOOL_OUTPUT);
}

const stopped = () => new ChatError("Stopped.");

const BAD_ARGS = { isError: true, content: [{ type: "text", text: "Error 1: the arguments were not valid JSON." }], _meta: { error: { code: EXIT.USAGE } } };

/**
 * One chat turn. `sink` receives the transcript (text deltas, tool steps);
 * `tools` is createTools(). Resolves {} when the model answered, or
 * { budget: message } when a limit refused a job: the turn stops there.
 */
export async function runTurn({ key, model, instructions, history, text, tools, sink, signal, fetch }) {
  const functions = await tools.functions();
  const input = [...history, { role: "user", content: text }];
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await fetch(`${API}/responses`, {
      method: "POST",
      signal,
      headers: { ...auth(key), "content-type": "application/json" },
      body: JSON.stringify({ model, instructions, input, tools: functions, stream: true, store: false, parallel_tool_calls: false }),
    });
    if (!res.ok) throw await openaiError(res);

    let response = null;
    for await (const e of sseEvents(res.body)) {
      if (e.type === "response.output_text.delta") sink.text(e.item_id, e.delta);
      else if (e.type === "response.output_item.done" && e.item?.type === "message") sink.textDone(e.item.id, messageText(e.item));
      else if (e.type === "response.completed" || e.type === "response.incomplete") response = e.response;
      else if (e.type === "response.failed") throw new ChatError(`OpenAI could not finish the reply: ${redact(e.response?.error?.message ?? "no reason given")}`);
      else if (e.type === "error") throw new ChatError(`OpenAI error: ${redact(e.message ?? e.error?.message ?? "no message")}`);
    }
    if (!response) throw new ChatError("OpenAI's reply ended early. Send the message again.");

    const output = response.output ?? [];
    input.push(...output.map(({ status: _status, ...item }) => item));
    const calls = output.filter((item) => item.type === "function_call");
    if (!calls.length) return {};
    for (const call of calls) {
      if (signal?.aborted) throw stopped();
      let args;
      try {
        args = call.arguments ? JSON.parse(call.arguments) : {};
      } catch {
        args = null;
      }
      sink.toolStart(call.call_id, call.name, args ?? {});
      const result = args === null ? BAD_ARGS : await tools.call(call.name, args, { signal });
      const failed = sink.toolDone(call.call_id, call.name, result);
      input.push({ type: "function_call_output", call_id: call.call_id, output: toolOutput(result) });
      if (failed?.code === EXIT.BUDGET) return { budget: failed.message };
      if (signal?.aborted) throw stopped();
    }
  }
  throw new ChatError(`Stopped after ${MAX_STEPS} steps without a final answer. Ask again with a narrower request.`);
}

/** The backend as the chat sessions use it. `fetch` is injected (tests pass a fake OpenAI). */
export function openaiBackend({ fetch = globalThis.fetch, tools }) {
  return {
    name: "openai",
    async ready(conn) {
      if (!openaiKey()) return { ok: false, message: "Chat isn't connected. Choose the ChatGPT subscription, or paste an OpenAI API key." };
      if (!conn.model) return { ok: false, message: "Pick the model for the API-key chat." };
      return { ok: true };
    },
    turn: ({ conn, ...rest }) => runTurn({ key: openaiKey(), model: conn.model, tools, fetch, ...rest }),
    models: () => listModels({ key: openaiKey(), fetch }),
  };
}
