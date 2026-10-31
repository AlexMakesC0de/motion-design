import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { ChatEntry, ChatSettingsView } from "../api/types";
import { ConnectionForm, connectionShort } from "./ConnectionForm";
import { ToolStep } from "./ToolStep";
import { useChat } from "./useChat";
import "./chat.css";

export const NOT_CONNECTED = "Chat isn't connected. Choose the ChatGPT subscription, or paste an OpenAI API key.";

function Entry({ entry }: { entry: ChatEntry }) {
  switch (entry.kind) {
    case "user":
      return <li className="chat__msg chat__msg--user">{entry.text}</li>;
    case "assistant":
      return (
        <li className="chat__msg chat__msg--assistant" aria-busy={entry.streaming}>
          {entry.text}
        </li>
      );
    case "tool":
      return (
        <li className="chat__step">
          <ToolStep entry={entry} />
        </li>
      );
    case "notice":
      return (
        <li className="chat__notice" data-tone={entry.tone}>
          {entry.text}
        </li>
      );
  }
}

/**
 * The Studio's chat in the chat drawer, tied to the film being worked in.
 * Each film keeps its own conversation (runs/<film>/chat.jsonl). The chat works through the same
 * tools as the CLI and the MCP server, so jobs it starts show up in the feed
 * like any other. With nothing connected it shows the two ways to connect.
 */
export function ChatPanel({
  film,
  outbox,
  onClose,
  onTaken,
}: {
  film: string | null;
  outbox?: { id: number; text: string } | null;
  onClose: () => void;
  /** Called once the outbox message is sent or left in the box, so it is not handed over again. */
  onTaken?: () => void;
}) {
  const [settings, setSettings] = useState<ChatSettingsView | null>(null);
  // Whether /api/chat-settings has answered (or failed): until then we can't tell if a handed message can be sent.
  const [checked, setChecked] = useState(false);
  const [text, setText] = useState("");
  const chat = useChat(film);
  const log = useRef<HTMLOListElement>(null);

  useEffect(() => {
    api<ChatSettingsView>("/api/chat-settings")
      .then(setSettings)
      .catch(() => {})
      .finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.entries]);

  const connected = settings?.backend != null;

  // A message handed over from elsewhere on the page (the storyboard's "Plan this"): sent at once when the chat can
  // take it, otherwise left in the box to send by hand. A drawer that has just opened waits for the settings first.
  const handed = useRef<number | null>(null);
  useEffect(() => {
    if (!outbox || !checked || handed.current === outbox.id) return;
    handed.current = outbox.id;
    onTaken?.();
    if (connected && !chat.busy) chat.send(outbox.text).then((sent) => !sent && setText(outbox.text));
    else setText(outbox.text);
  }, [outbox, checked, connected, chat, onTaken]);

  const via = settings ? connectionShort(settings) : null;
  const picker = settings != null && (!connected || chat.connect);

  async function submit() {
    const message = text.trim();
    if (!message || chat.busy) return;
    if (await chat.send(message)) setText("");
  }

  return (
    <aside className="chat" aria-label="Chat">
      <header className="chat__head">
        <h2 className="chat__title">Chat</h2>
        {film && <span className="chat__film mono">{film}</span>}
        <button type="button" className="button button--quiet chat__hide" onClick={onClose}>
          Close chat
        </button>
        {via && !picker && <span className="chat__via">{via}</span>}
      </header>

      {picker && settings && (
        <div className="chat__connect">
          <p className="chat__intro">{chat.connect && chat.error ? chat.error : NOT_CONNECTED}</p>
          <ConnectionForm
            initial={settings}
            onSaved={(next) => {
              setSettings(next);
              chat.setConnect(false);
            }}
          />
        </div>
      )}

      <ol className="chat__log" aria-label="Messages" ref={log}>
        {chat.entries.map((e) => (
          <Entry key={e.id} entry={e} />
        ))}
      </ol>
      {!chat.entries.length && !picker && (
        <p className="chat__empty">{film ? `Ask about ${film}: a price, a shot, a change. Jobs the chat starts appear in the film.` : "Pick a film to chat about it."}</p>
      )}
      {chat.error && !chat.connect && (
        <p className="chat__error" role="alert">
          {chat.error}
        </p>
      )}

      <form
        className="chat__form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          className="chat__input"
          aria-label="Message"
          rows={3}
          value={text}
          disabled={!film}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {chat.busy ? (
          <button type="button" className="button" onClick={chat.stop}>
            Stop
          </button>
        ) : (
          <button type="submit" className="button" disabled={!film || !connected || !text.trim()}>
            Send
          </button>
        )}
      </form>
    </aside>
  );
}
