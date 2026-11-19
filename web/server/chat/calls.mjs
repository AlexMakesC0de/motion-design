// What every API-key backend does with one function call the model made: show
// it, run the MCP tool, read the result back, and say when the turn must stop
// (a limit refused a job, or a job's outcome is unknown). The OpenAI backend
// (openai.mjs) does the same inline; Anthropic and the OpenAI-compatible
// services use this.
import { EXIT } from "../../../cli/lib/errors.mjs";
import { ChatError, resultText } from "./transcript.mjs";

const MAX_TOOL_OUTPUT = 20_000;

/** What the model reads back from a tool: its text, then its structured data. */
export function toolOutput(result) {
  const text = resultText(result);
  const data = result?.structuredContent ? `\n${JSON.stringify(result.structuredContent)}` : "";
  return `${text}${data}`.slice(0, MAX_TOOL_OUTPUT);
}

const BAD_ARGS = { isError: true, content: [{ type: "text", text: "Error 1: the arguments were not valid JSON." }], _meta: { error: { code: EXIT.USAGE } } };

export const stopped = () => new ChatError("Stopped.");

/** Arguments as the model sent them: a JSON string (OpenAI-shaped) or an object (Anthropic). null when unreadable. */
export function parseArgs(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (raw == null || raw === "") return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Run one call. Resolves { output, isError, end } where `end` is the turn's
 * result when it must stop here ({ budget } or { uncertain }), else null.
 */
export async function runCall({ id, name, args: raw }, { tools, sink, signal }) {
  if (signal?.aborted) throw stopped();
  const args = parseArgs(raw);
  sink.toolStart(id, name, args ?? {});
  const result = args === null ? BAD_ARGS : await tools.call(name, args, { signal });
  const failed = sink.toolDone(id, name, result);
  const end = failed?.code === EXIT.BUDGET ? { budget: failed.message } : failed?.code === EXIT.UNCERTAIN ? { uncertain: { tool: name, message: failed.message } } : null;
  return { output: toolOutput(result), isError: Boolean(failed), end };
}

/** A failed HTTP answer from a chat service as one sentence. `who` names the service. */
export async function serviceError(res, who, { redact }) {
  let message = `HTTP ${res.status}`;
  try {
    const body = await res.json();
    message = body?.error?.message ?? body?.message ?? (typeof body?.error === "string" ? body.error : null) ?? message;
  } catch {
    // not JSON; the status says enough
  }
  if (res.status === 401 || res.status === 403) return new ChatError(`${who} refused the API key (${res.status}). Paste a new key in Settings.`, { connect: true });
  if (res.status === 429) return new ChatError(`${who} says this key is over its rate or quota limit (429): ${redact(message)}`);
  return new ChatError(`${who} error (HTTP ${res.status}): ${redact(message)}`);
}
