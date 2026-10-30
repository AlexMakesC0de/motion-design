import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { ChatEntry, ChatSettingsView } from "../api/types";
import { ConnectionForm } from "./ConnectionForm";
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
 * The Studio's chat, tied to the film being worked in. Each film keeps its own
 * conversation (runs/<film>/chat.jsonl). The chat works through the same
 * tools as the CLI and the MCP server, so jobs it starts show up in the feed
 * like any other. With nothing connected it shows the two ways to connect.
 */
export function ChatPanel({ film }: { film: string | null }) {
  const [open, setOpen] = useState(true);
  const [settings, setSettings] = useState<ChatSettingsView | null>(null);
  const [text, setText] = useState("");
  const chat = useChat(film);
  const log = useRef<HTMLOListElement>(null);

  useEffect(() => {
    api<ChatSettingsView>("/api/chat-settings")
      .then(setSettings)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.entries]);

  const connected = settings?.backend != null;
  const picker = settings != null && (!connected || chat.connect);

  async function submit() {
    const message = text.trim();
    if (!message || chat.busy) return;
    if (await chat.send(message)) setText("");
  }

  if (!open) {
    return (
      <aside className="chat chat--closed" aria-label="Chat">
        <button type="button" className="chat__toggle" aria-expanded="false" onClick={() => setOpen(true)}>
          Show chat
        </button>
      </aside>
    );
  }

  return (
    <aside className="chat" aria-label="Chat">
      <header className="chat__head">
        <h2 className="chat__title">Chat</h2>
        {film && <span className="chat__film mono">{film}</span>}
        <button type="button" className="button button--quiet chat__hide" aria-expanded="true" onClick={() => setOpen(false)}>
          Hide chat
        </button>
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
        <p className="chat__empty">{film ? `Ask about ${film}: a price, a shot, a change. Jobs the chat starts appear in the feed.` : "Pick a film to chat about it."}</p>
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
