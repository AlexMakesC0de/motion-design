import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { ChatEntry, ChatView } from "../api/types";
import { onStudioEvent } from "../app/useStudio";

/** Put `entry` in place of the one with its id, or at the end. */
export function upsert(entries: ChatEntry[], entry: ChatEntry): ChatEntry[] {
  const i = entries.findIndex((e) => e.id === entry.id);
  if (i < 0) return [...entries, entry];
  const next = entries.slice();
  next[i] = entry;
  return next;
}

/**
 * A film's chat: the saved transcript plus the turn in progress, kept current
 * by the stream's `chat` events. `connect` is true when the server said the
 * chat is not connected (or the connection stopped working): the panel then
 * shows the two ways to connect.
 */
export function useChat(film: string | null, path: string | null = null) {
  // Explore's chat has its own routes (/api/explore/chat); a film's is /api/chat/<film>.
  const base = path ?? (film ? `/api/chat/${encodeURIComponent(film)}` : null);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connect, setConnect] = useState(false);
  // The film the panel shows now, and a number per transcript read: an answer
  // for another film, or one older than the newest read, is dropped.
  const current = useRef(film);
  current.current = film;
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!film) return Promise.resolve();
    const mine = ++seq.current;
    const fresh = () => mine === seq.current && current.current === film;
    return api<ChatView>(base!)
      .then((v) => {
        if (!fresh()) return;
        setEntries(Array.isArray(v?.entries) ? v.entries : []);
        setBusy(Boolean(v?.busy));
      })
      .catch((e) => fresh() && setError(e instanceof ApiError ? e.message : String(e)));
  }, [film, base]);

  useEffect(() => {
    setEntries([]);
    setBusy(false);
    setError(null);
    load();
  }, [load]);

  useEffect(
    () =>
      onStudioEvent((e) => {
        // A reconnected stream may have missed entries: read the film's chat again.
        if (e.event === "hello") load();
        if (e.event !== "chat" || e.data.film !== film) return;
        setBusy(e.data.busy);
        if (e.data.reset) setEntries([]);
        const entry = e.data.entry;
        if (entry) setEntries((list) => upsert(list, entry));
      }),
    [film, load],
  );

  /** `extra` goes in the request body beside the text (Explore's prompt bar). */
  async function send(text: string, extra: Record<string, unknown> = {}): Promise<boolean> {
    if (!film) return false;
    const sentFor = film;
    setError(null);
    try {
      const r = await api<{ entry: ChatEntry }>(base!, { method: "POST", body: { text, ...extra } });
      if (current.current !== sentFor) return true; // sent to the film that was open; the chat now shows another
      setConnect(false);
      setBusy(true);
      setEntries((list) => upsert(list, r.entry));
      return true;
    } catch (e) {
      if (current.current !== sentFor) return false;
      if (e instanceof ApiError && e.detail.connect) setConnect(true);
      setError(e instanceof ApiError ? e.message : String(e));
      return false;
    }
  }

  async function stop() {
    if (!film) return;
    await api(`${base}/stop`, { method: "POST" }).catch(() => {});
  }

  /** Explore's New chat: the server keeps the old lines unread; the reset event empties the list. */
  async function clear() {
    if (!path) return;
    try {
      await api(`${path}/new`, { method: "POST" });
      setEntries([]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return { entries, busy, error, connect, setConnect, send, stop, clear };
}
