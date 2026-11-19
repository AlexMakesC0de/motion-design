// The chat: a film's transcript, sending a message, stopping a turn, and the
// connection settings (backend, API keys, model, the compatible service's
// address, Codex login). Explore's chat has routes of its own under
// /api/explore/chat. Keys are written here and never read back out:
// responses say only whether one is saved and where it comes from.
import { HttpError } from "../http.mjs";
import { ChatError, conversationKey } from "../chat/transcript.mjs";
import { conversationId, deleteConversation, listConversations, setArchived } from "../chat/conversations.mjs";
import {
  BACKENDS,
  KEY_BACKENDS,
  checkBaseUrl,
  backendKeySource,
  isLocal,
  keyPath,
  keySource,
  openaiKeyPath,
  readConnection,
  removeBackendKey,
  saveBackendKey,
  saveOpenaiKey,
  writeConnection,
} from "../chat/config.mjs";
import { runDir } from "../../../cli/lib/run.mjs";
import * as f from "./fields.mjs";

/** The film from the path, checked as a run slug (code 1 for a bad one), without making its folder. */
const film = (params) => {
  runDir(params.film, { create: false });
  return params.film;
};

export function connectionView() {
  const conn = readConnection();
  const source = keySource();
  const keys = Object.fromEntries(
    Object.entries(KEY_BACKENDS).map(([id, b]) => {
      const s = backendKeySource(id);
      return [id, { label: b.label, keySaved: s !== null, keySource: s, keyFile: keyPath(id), keyEnv: b.env }];
    }),
  );
  return {
    backend: conn.backend,
    model: conn.model,
    ...(conn.baseUrl ? { baseUrl: conn.baseUrl } : {}),
    openai: { keySaved: source !== null, keySource: source, keyFile: openaiKeyPath(), keyEnv: "OPENAI_API_KEY" },
    keys,
  };
}

const keyBackend = (id) => {
  if (!Object.hasOwn(KEY_BACKENDS, id)) throw new HttpError(404, `No API-key backend "${id}". Backends: ${Object.keys(KEY_BACKENDS).join(", ")}.`);
  return id;
};

/** A ChatError from a service as an HTTP error: a refused key asks to connect again. */
function asHttp(err) {
  if (err instanceof ChatError) return new HttpError(err.connect ? 409 : 502, err.message, { connect: err.connect });
  return err;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const word = (v) => (typeof v === "string" ? v.replace(/[^\w .:@/-]/g, "").slice(0, 80) : null);

/**
 * Explore's prompt bar as one line for the model, from what the page sent.
 * Only short known fields are read; anything else is dropped.
 */
export function barLine(bar) {
  if (!bar || typeof bar !== "object") return null;
  const parts = [];
  const kind = bar.kind === "image" || bar.kind === "video" ? bar.kind : null;
  if (kind) parts.push(kind);
  if (word(bar.model)) parts.push(`model ${word(bar.model)}`);
  if (word(bar.aspectRatio)) parts.push(word(bar.aspectRatio));
  if (Number.isFinite(bar.durationS)) parts.push(`${bar.durationS}s`);
  if (word(bar.resolution)) parts.push(word(bar.resolution));
  parts.push(word(bar.look) ? `look ${word(bar.look)}` : "no look");
  const picks = bar.picks && typeof bar.picks === "object" ? Object.entries(bar.picks).filter(([k, v]) => word(k) && word(v)).map(([k, v]) => `${word(k)} ${word(v)}`) : [];
  parts.push(picks.length ? `picks ${picks.join(", ")}` : "no camera or lighting picks");
  const refs = Array.isArray(bar.refs) ? bar.refs.filter((r) => word(r?.source) && word(r?.role)).map((r) => `${word(r.source)} as ${word(r.role)}`) : [];
  parts.push(refs.length ? `references ${refs.join(", ")}` : "no references");
  if (typeof bar.sound === "boolean" && kind === "video") parts.push(`sound ${bar.sound ? "on" : "off"}`);
  if (Number.isInteger(bar.count)) parts.push(`${bar.count} take${bar.count > 1 ? "s" : ""}`);
  return clip(`(The prompt bar now: ${parts.join(" · ")}.)`, 1500);
}

export function registerChat(router, { chat, backends, codex, explore }) {
  router.get("/api/chat/:film", ({ params }) => chat.view(film(params)));
  router.post("/api/chat/:film", ({ params, body }) => chat.send(film(params), body?.text));
  router.post("/api/chat/:film/stop", ({ params }) => ({ stopped: chat.stop(film(params)) }));

  // The Studio page's conversations, each its own chat in the explore run, with only free, read-only tools.
  // ?archived=1 lists the archived ones (Settings); the page lists the rest.
  const convo = (params) => conversationKey(conversationId(params.id));
  const busy = (params) => explore.films().includes(convo(params));
  router.get("/api/explore/chats", ({ query }) => listConversations({ archived: query.get("archived") === "1" }));
  router.get("/api/explore/chats/:id", ({ params }) => explore.view(convo(params)));
  router.post("/api/explore/chats/:id", ({ params, body }) => explore.send(convo(params), body?.text, { context: barLine(body?.bar) }));
  router.post("/api/explore/chats/:id/stop", ({ params }) => ({ stopped: explore.stop(convo(params)) }));
  router.put("/api/explore/chats/:id/archived", ({ params, body = {} }) => {
    if (typeof body.archived !== "boolean") throw f.invalid("archived", "archived must be true or false.");
    return setArchived(conversationId(params.id), body.archived, { busy: busy(params) });
  });
  router.delete("/api/explore/chats/:id", ({ params }) => deleteConversation(conversationId(params.id), { busy: busy(params) }));

  router.get("/api/chat-settings", () => connectionView());

  router.put("/api/chat-settings", ({ body = {} }) => {
    const backend = f.text(body, "backend", { required: true });
    if (!BACKENDS.includes(backend)) throw f.invalid("backend", `backend must be one of ${BACKENDS.join(", ")}.`);
    const model = f.text(body, "model") ?? null;
    const baseUrl = f.text(body, "baseUrl") ?? null;
    if (backend !== "codex" && !model) throw f.invalid("model", "Pick the model for the API-key chat.");
    if (backend === "compatible" && !baseUrl && !readConnection().baseUrl) throw f.invalid("baseUrl", "Give the service's address.");
    writeConnection({ backend, model: backend === "codex" ? null : model, baseUrl: backend === "compatible" ? baseUrl : null });
    return connectionView();
  });

  router.put("/api/chat-settings/openai-key", ({ body = {} }) => {
    saveOpenaiKey(body.key);
    return connectionView();
  });

  router.put("/api/chat-settings/keys/:backend", ({ params, body = {} }) => {
    saveBackendKey(keyBackend(params.backend), body.key);
    return connectionView();
  });

  router.delete("/api/chat-settings/keys/:backend", ({ params }) => {
    removeBackendKey(keyBackend(params.backend));
    return connectionView();
  });

  /**
   * The backend's models, from its own free model list. ?backend= picks it
   * (OpenAI when left out); ?baseUrl= is the compatible service's address
   * before it is saved.
   */
  router.get("/api/chat-settings/models", async ({ query }) => {
    const id = keyBackend(query.get("backend") || "openai");
    const conn = readConnection();
    const baseUrl = id === "compatible" ? query.get("baseUrl") || conn.baseUrl || null : null;
    if (id === "compatible") {
      if (!baseUrl) throw new HttpError(409, "Give the service's address first.", { connect: true });
      checkBaseUrl(baseUrl);
    }
    if (!backendKeySource(id) && !(id === "compatible" && isLocal(baseUrl))) {
      throw new HttpError(409, `Paste ${id === "openai" ? "an OpenAI" : `the ${KEY_BACKENDS[id].label}`} API key first.`, { connect: true });
    }
    try {
      return { models: await backends[id].models({ ...conn, baseUrl: baseUrl ? checkBaseUrl(baseUrl) : null }) };
    } catch (err) {
      throw asHttp(err);
    }
  });

  /** Codex login: starts `codex app-server`, sends initialize and account/read, nothing else. */
  router.get("/api/chat-settings/codex", () => codex.status());
}
