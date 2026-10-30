// The chat: a film's transcript, sending a message, stopping a turn, and the
// connection settings (backend, OpenAI key, model, Codex login). The key is
// written here and never read back out: responses say only whether one is
// saved and where it comes from.
import { HttpError } from "../http.mjs";
import { ChatError } from "../chat/transcript.mjs";
import { BACKENDS, keySource, openaiKeyPath, readConnection, saveOpenaiKey, writeConnection } from "../chat/config.mjs";
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
  return {
    backend: conn.backend,
    model: conn.model,
    openai: { keySaved: source !== null, keySource: source, keyFile: openaiKeyPath(), keyEnv: "OPENAI_API_KEY" },
  };
}

export function registerChat(router, { chat, openai }) {
  router.get("/api/chat/:film", ({ params }) => chat.view(film(params)));
  router.post("/api/chat/:film", ({ params, body }) => chat.send(film(params), body?.text));
  router.post("/api/chat/:film/stop", ({ params }) => ({ stopped: chat.stop(film(params)) }));

  router.get("/api/chat-settings", () => connectionView());

  router.put("/api/chat-settings", ({ body = {} }) => {
    const backend = f.text(body, "backend", { required: true });
    if (!BACKENDS.includes(backend)) throw f.invalid("backend", `backend must be one of ${BACKENDS.join(", ")}.`);
    const model = f.text(body, "model") ?? null;
    if (backend === "openai" && !model) throw f.invalid("model", "Pick the model for the API-key chat.");
    writeConnection({ backend, model: backend === "openai" ? model : readConnection().model });
    return connectionView();
  });

  router.put("/api/chat-settings/openai-key", ({ body = {} }) => {
    saveOpenaiKey(body.key);
    return connectionView();
  });

  /** The key's text models, from OpenAI's free model list. */
  router.get("/api/chat-settings/models", async () => {
    if (!keySource()) throw new HttpError(409, "Paste an OpenAI API key first.", { connect: true });
    try {
      return { models: await openai.models() };
    } catch (err) {
      if (err instanceof ChatError) throw new HttpError(err.connect ? 409 : 502, err.message, { connect: err.connect });
      throw err;
    }
  });
}
