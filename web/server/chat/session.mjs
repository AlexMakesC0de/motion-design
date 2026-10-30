// Chat turns, one film at a time each. A turn runs on the server whatever the
// page does: its entries reach every open page as SSE `chat` events
// ({ film, busy, entry }), and GET /api/chat/:film returns the saved
// transcript plus the turn in progress, so a reload or a second tab catches
// up. The user's line is saved when it is sent; the turn's other entries are
// saved, in the order they began, when the turn ends. Jobs the chat starts
// reach the feed through the job watcher (events.mjs), not through here.
import { EXIT } from "../../../cli/lib/errors.mjs";
import { redact } from "../../../cli/lib/redact.mjs";
import { HttpError } from "../http.mjs";
import { readConnection } from "./config.mjs";
import { systemPrompt } from "./prompt.mjs";
import { ChatError, appendChat, budgetSentence, createTurnLog, historyMessages, readChat, userEntry } from "./transcript.mjs";

export const MAX_MESSAGE = 8_000;
export const NOT_CONNECTED = "Chat isn't connected. Choose the ChatGPT subscription, or paste an OpenAI API key.";

/** One sentence for the page, for anything a turn throws. */
function sentence(err) {
  if (err instanceof ChatError) return err.message;
  if (typeof err?.code === "number" && err.code >= EXIT.USAGE && err.code <= EXIT.UNCERTAIN) return redact(err.message);
  return `The chat stopped on an unexpected error: ${redact(err?.message ?? String(err))}`;
}

/**
 * `backends`: { openai, codex }, each { ready(conn), turn({...}) }.
 * `publish(event)` sends an SSE event; `tools` gives the MCP instructions.
 */
export function createChat({ backends, tools, publish = () => {} }) {
  const live = new Map(); // film → { log, ctrl, done }

  const emit = (film, entry) => publish({ event: "chat", data: { film, busy: live.has(film), entry } });

  return {
    view(film) {
      const { entries } = readChat(film);
      const turn = live.get(film);
      return { film, busy: Boolean(turn), entries: turn ? [...entries, ...turn.log.entries] : entries };
    },

    /** Start a turn and answer at once with the user's entry; the rest arrives as events. */
    async send(film, text) {
      if (typeof text !== "string" || !text.trim()) throw new HttpError(400, "Write a message first.", { field: "text" });
      if (text.length > MAX_MESSAGE) throw new HttpError(400, `A message is at most ${MAX_MESSAGE} characters.`, { field: "text" });
      if (live.has(film)) throw new HttpError(409, "The chat is still answering in this film. Wait for it, or press Stop.");
      const conn = readConnection();
      const backend = conn.backend ? backends[conn.backend] : null;
      if (!backend) throw new HttpError(409, NOT_CONNECTED, { connect: true });
      const ready = await backend.ready(conn);
      if (!ready.ok) throw new HttpError(409, ready.message, { connect: true });
      if (live.has(film)) throw new HttpError(409, "The chat is still answering in this film. Wait for it, or press Stop.");

      const saved = readChat(film);
      const user = userEntry(text.trim());
      appendChat(film, [user]);
      const turn = { ctrl: new AbortController(), log: createTurnLog((e) => emit(film, e)) };
      live.set(film, turn);
      emit(film, user);

      turn.done = (async () => {
        try {
          const instructions = systemPrompt({ film, mcpInstructions: await tools.instructions() });
          const out = await backend.turn({
            conn,
            film,
            text: user.text,
            history: historyMessages(saved.entries),
            saved,
            instructions,
            sink: turn.log,
            signal: turn.ctrl.signal,
          });
          if (out?.budget) turn.log.say(budgetSentence(out.budget));
        } catch (err) {
          if (turn.ctrl.signal.aborted) turn.log.notice("Stopped.", "info");
          else turn.log.notice(sentence(err));
        } finally {
          turn.log.settle();
          try {
            appendChat(film, turn.log.entries);
          } catch (err) {
            process.stderr.write(`studio: could not save the chat for ${film}: ${redact(err.message)}\n`);
          }
          live.delete(film);
          publish({ event: "chat", data: { film, busy: false, entry: null } });
        }
      })();
      return { entry: user };
    },

    /** Stop the film's turn. True when one was running. */
    stop(film) {
      const turn = live.get(film);
      if (!turn) return false;
      turn.ctrl.abort();
      return true;
    },

    /** Films with a turn running. */
    films: () => [...live.keys()],

    /** Resolves when the film's turn (if any) has ended and been saved. Tests and shutdown. */
    async idle(film) {
      const films = film ? [film] : [...live.keys()];
      await Promise.all(films.map((f) => live.get(f)?.done));
    },
  };
}
