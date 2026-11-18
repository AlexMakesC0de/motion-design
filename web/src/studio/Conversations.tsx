// The Image page's conversations: its pictures grouped by the conversation id
// the server kept on each job, listed in a small panel floating at the left.
// Pictures made before conversations (or outside the page) share one entry.
import { useState } from "react";
import type { JobView } from "../api/types";
import { Icon } from "../app/icons";

/** Pictures with no conversation id: made before conversations, or from the CLI or chat. */
export const EARLIER = "earlier";

export interface Conversation {
  id: string;
  title: string;
  /** Newest first, as useJobs keeps them. */
  takes: JobView[];
  updatedAt: string;
  cover: string | null;
}

/** A fresh id for a conversation nothing has been made in yet (the server accepts c- and 4 to 32 of a-z0-9). */
export function newConversationId(): string {
  return `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Image takes (newest first) grouped into conversations, the most recently active first. */
export function conversationsOf(takes: JobView[]): Conversation[] {
  const groups = new Map<string, JobView[]>();
  for (const t of takes) {
    const id = t.thread ?? EARLIER;
    groups.set(id, [...(groups.get(id) ?? []), t]);
  }
  return [...groups].map(([id, list]) => ({
    id,
    title: id === EARLIER ? "Earlier pictures" : (list.at(-1)?.prompt?.replace(/\s+/g, " ").trim() || "Untitled"),
    takes: list,
    updatedAt: list[0].updatedAt ?? list[0].createdAt,
    cover: list.find((t) => t.state === "succeeded" && t.media[0])?.media[0] ?? null,
  }));
}

/** "now", "5m", "3h", "2d", or the date. */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const FOLDED = "image.conversations.folded";

export function Conversations({ list, current, now, onPick, onNew }: { list: Conversation[]; current: string; now: number; onPick: (id: string) => void; onNew: () => void }) {
  const [folded, setFolded] = useState(() => localStorage.getItem(FOLDED) === "1");
  const fold = (f: boolean) => {
    setFolded(f);
    localStorage.setItem(FOLDED, f ? "1" : "0");
  };
  const fresh = !list.some((c) => c.id === current);

  if (folded) {
    return (
      <div className="convos convos--folded">
        <button type="button" className="convos__fold" aria-label="Show conversations" aria-expanded="false" onClick={() => fold(false)}>
          <Icon name="chat" size={16} />
          <span className="mono">{list.length}</span>
        </button>
        <button type="button" className="convos__fold" aria-label="New conversation" disabled={fresh} onClick={onNew}>
          <Icon name="plus" size={16} />
        </button>
      </div>
    );
  }

  return (
    <nav className="convos" aria-label="Conversations">
      <div className="convos__head">
        <span className="convos__title">Conversations</span>
        <button type="button" className="convos__icon" aria-label="Hide conversations" aria-expanded="true" onClick={() => fold(true)}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <button type="button" className="convos__new" aria-current={fresh || undefined} disabled={fresh} onClick={onNew}>
        <Icon name="plus" size={14} /> New conversation
      </button>
      {list.length > 0 && (
        <ul className="convos__list">
          {list.map((c) => (
            <li key={c.id}>
              <button type="button" className="convo" aria-current={c.id === current || undefined} onClick={() => onPick(c.id)}>
                {c.cover ? <img className="convo__cover" src={c.cover} alt="" /> : <span className="convo__cover" aria-hidden="true" />}
                <span className="convo__text">
                  <span className="convo__title">{c.title}</span>
                  <span className="convo__meta">
                    {c.takes.length} {c.takes.length === 1 ? "picture" : "pictures"} · {ago(c.updatedAt, now)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
