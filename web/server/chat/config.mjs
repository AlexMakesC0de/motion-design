// The chat connection: which backend answers (the ChatGPT subscription
// through Codex, or an API key for OpenAI, Anthropic, OpenRouter or any
// OpenAI-compatible service) and the model for each API-key backend, in
// ~/.config/kie/chat.json. Keys live in files of their own, mode 600: the
// OpenAI key in ~/.config/kie/openai.key (or OPENAI_API_KEY), the others in
// chat-<backend>.key beside chat.json (or their own environment variable).
// KIE_CHAT_FILE and KIE_OPENAI_KEY_FILE relocate the files (tests). Nothing
// here ever returns a key to a caller outside the server.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { unknown } from "../../../cli/lib/errors.mjs";

/** The API-key backends: who they are, where their key comes from, and where they answer. */
export const KEY_BACKENDS = {
  openai: { label: "OpenAI", env: "OPENAI_API_KEY", baseUrl: "https://api.openai.com/v1" },
  anthropic: { label: "Anthropic (Claude)", env: "ANTHROPIC_API_KEY", baseUrl: "https://api.anthropic.com/v1" },
  openrouter: { label: "OpenRouter", env: "OPENROUTER_API_KEY", baseUrl: "https://openrouter.ai/api/v1" },
  compatible: { label: "Another OpenAI-compatible service", env: null, baseUrl: null },
};
export const BACKENDS = ["codex", ...Object.keys(KEY_BACKENDS)];

export const chatConfigPath = () => process.env.KIE_CHAT_FILE || join(homedir(), ".config", "kie", "chat.json");
export const openaiKeyPath = () => process.env.KIE_OPENAI_KEY_FILE || join(homedir(), ".config", "kie", "openai.key");

/** The file a backend's pasted key is kept in. */
export function keyPath(backend) {
  if (backend === "openai") return openaiKeyPath();
  if (!Object.hasOwn(KEY_BACKENDS, backend)) throw unknown(`No API-key backend "${backend}".`, { field: "backend" });
  return join(dirname(chatConfigPath()), `chat-${backend}.key`);
}

// An address the compatible backend may be sent to: https anywhere, or plain http on this computer (Ollama, LM Studio).
const BASE_URL = /^(https:\/\/[^\s/?#]+|http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?)(\/[^\s?#]*)?$/;
const MODEL = /^[A-Za-z0-9._:/@-]{1,120}$/;

/** The address, checked: https anywhere, or http on this computer. Throws code 3 otherwise. */
export function checkBaseUrl(url) {
  if (typeof url !== "string" || !BASE_URL.test(url)) throw unknown("The address must start with https://, or http://localhost for a model on this computer.", { field: "baseUrl" });
  return url.replace(/\/+$/, "");
}

/** True when the address is a local one, where a key is optional. */
export const isLocal = (url) => /^http:\/\//.test(url ?? "");

function readFile() {
  try {
    const c = JSON.parse(readFileSync(chatConfigPath(), "utf8"));
    return c && typeof c === "object" ? c : {};
  } catch {
    return {};
  }
}

/**
 * { backend, model } plus baseUrl for the compatible backend. A missing or
 * unreadable file is "not configured". Each API-key backend keeps its own
 * model, so switching back finds the one picked before.
 */
export function readConnection() {
  const c = readFile();
  const backend = BACKENDS.includes(c.backend) ? c.backend : null;
  const own = backend && typeof c.models?.[backend] === "string" ? c.models[backend] : null;
  // A file from before per-backend models has only `model`, the OpenAI one.
  const legacy = typeof c.model === "string" && c.model ? c.model : null;
  const model = backend ? (own ?? legacy) : null;
  const baseUrl = backend === "compatible" && typeof c.baseUrl === "string" && BASE_URL.test(c.baseUrl) ? c.baseUrl : null;
  return { backend, model, ...(baseUrl ? { baseUrl } : {}) };
}

function writeAtomic(path, text, mode) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode });
  renameSync(tmp, path);
  chmodSync(path, mode);
}

export function writeConnection({ backend, model, baseUrl }) {
  if (!BACKENDS.includes(backend)) throw unknown(`backend must be one of ${BACKENDS.join(", ")}.`, { field: "backend" });
  if (model != null && (typeof model !== "string" || !MODEL.test(model))) {
    throw unknown("model must be a model id such as the ones the key lists.", { field: "model" });
  }
  if (baseUrl != null) baseUrl = checkBaseUrl(baseUrl);
  const old = readFile();
  const models = { ...(old.models && typeof old.models === "object" ? old.models : {}) };
  if (model != null && backend !== "codex") models[backend] = model;
  // `model` is the chosen backend's own, so a file read without `models` stays right.
  const next = { backend, model: model ?? null, models, baseUrl: baseUrl ?? (typeof old.baseUrl === "string" ? old.baseUrl : null) };
  writeAtomic(chatConfigPath(), `${JSON.stringify(next, null, 2)}\n`, 0o600);
  return readConnection();
}

/** Where a backend's key comes from, without reading it out: "env", "file" or null. */
export function backendKeySource(backend) {
  const env = KEY_BACKENDS[backend]?.env;
  if (env && process.env[env]?.trim()) return "env";
  const file = keyPath(backend);
  return existsSync(file) && readFileSync(file, "utf8").trim() ? "file" : null;
}

/** A backend's key, for the request to that service only. */
export function backendKey(backend) {
  const env = KEY_BACKENDS[backend]?.env;
  const fromEnv = env ? process.env[env]?.trim() : null;
  if (fromEnv) return fromEnv;
  const file = keyPath(backend);
  return existsSync(file) ? readFileSync(file, "utf8").trim() || null : null;
}

/** Save a pasted key, mode 600. Checked for shape only; the model list is what proves it works. */
export function saveBackendKey(backend, key) {
  const k = typeof key === "string" ? key.trim() : "";
  const name = KEY_BACKENDS[backend]?.label ?? "API";
  if (!/^[\x21-\x7e]{20,400}$/.test(k)) throw unknown(`That does not look like an ${name} API key. Paste the whole key, with no spaces.`, { field: "key" });
  writeAtomic(keyPath(backend), `${k}\n`, 0o600);
}

/** Forget a pasted key (the file only; an environment variable stays). */
export function removeBackendKey(backend) {
  const file = keyPath(backend);
  if (existsSync(file)) writeAtomic(file, "", 0o600);
}

// The OpenAI names the chat began with.
export const keySource = () => backendKeySource("openai");
export const openaiKey = () => backendKey("openai");
export const saveOpenaiKey = (key) => {
  const k = typeof key === "string" ? key.trim() : "";
  if (!/^[\x21-\x7e]{20,400}$/.test(k)) throw unknown("That does not look like an OpenAI API key. Paste the whole key, with no spaces.", { field: "key" });
  saveBackendKey("openai", k);
};
