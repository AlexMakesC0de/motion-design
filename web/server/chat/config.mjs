// The chat connection: which backend answers (the ChatGPT subscription
// through Codex, or an OpenAI API key) and the model for the API-key mode,
// in ~/.config/kie/chat.json; the OpenAI key itself in
// ~/.config/kie/openai.key (mode 600) or OPENAI_API_KEY. KIE_CHAT_FILE and
// KIE_OPENAI_KEY_FILE relocate the two files (tests). Nothing here ever
// returns the key to a caller outside the server.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { unknown } from "../../../cli/lib/errors.mjs";

export const BACKENDS = ["codex", "openai"];
export const chatConfigPath = () => process.env.KIE_CHAT_FILE || join(homedir(), ".config", "kie", "chat.json");
export const openaiKeyPath = () => process.env.KIE_OPENAI_KEY_FILE || join(homedir(), ".config", "kie", "openai.key");

/** { backend: "codex" | "openai" | null, model: string | null }. A missing or unreadable file is "not configured". */
export function readConnection() {
  try {
    const c = JSON.parse(readFileSync(chatConfigPath(), "utf8"));
    return {
      backend: BACKENDS.includes(c?.backend) ? c.backend : null,
      model: typeof c?.model === "string" && c.model ? c.model : null,
    };
  } catch {
    return { backend: null, model: null };
  }
}

function writeAtomic(path, text, mode) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode });
  renameSync(tmp, path);
  chmodSync(path, mode);
}

export function writeConnection({ backend, model }) {
  if (!BACKENDS.includes(backend)) throw unknown(`backend must be one of ${BACKENDS.join(", ")}.`, { field: "backend" });
  if (model != null && (typeof model !== "string" || !/^[A-Za-z0-9._:-]{1,100}$/.test(model))) {
    throw unknown("model must be a model id such as the ones the key lists.", { field: "model" });
  }
  writeAtomic(chatConfigPath(), `${JSON.stringify({ backend, model: model ?? null }, null, 2)}\n`, 0o600);
  return readConnection();
}

/** Where the key comes from, without reading it out: "env", "file" or null. */
export function keySource() {
  if (process.env.OPENAI_API_KEY?.trim()) return "env";
  const file = openaiKeyPath();
  return existsSync(file) && readFileSync(file, "utf8").trim() ? "file" : null;
}

/** The key, for the request to OpenAI only. */
export function openaiKey() {
  const env = process.env.OPENAI_API_KEY?.trim();
  if (env) return env;
  const file = openaiKeyPath();
  return existsSync(file) ? readFileSync(file, "utf8").trim() || null : null;
}

/** Save a pasted key, mode 600. Checked for shape only; the model list is what proves it works. */
export function saveOpenaiKey(key) {
  const k = typeof key === "string" ? key.trim() : "";
  if (!/^[\x21-\x7e]{20,400}$/.test(k)) throw unknown("That does not look like an OpenAI API key. Paste the whole key, with no spaces.", { field: "key" });
  writeAtomic(openaiKeyPath(), `${k}\n`, 0o600);
}
