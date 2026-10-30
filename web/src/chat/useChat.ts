import { useCallback, useEffect, useState } from "react";
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
export function useChat(film: string | null) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connect, setConnect] = useState(false);

  const load = useCallback(() => {
    if (!film) return Promise.resolve();
    return api<ChatView>(`/api/chat/${encodeURIComponent(film)}`)
      .then((v) => {
        setEntries(v.entries);
        setBusy(v.busy);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, [film]);

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
        const entry = e.data.entry;
        if (entry) setEntries((list) => upsert(list, entry));
      }),
    [film, load],
  );

  async function send(text: string): Promise<boolean> {
    if (!film) return false;
    setError(null);
    try {
      const r = await api<{ entry: ChatEntry }>(`/api/chat/${encodeURIComponent(film)}`, { method: "POST", body: { text } });
      setConnect(false);
      setBusy(true);
      setEntries((list) => upsert(list, r.entry));
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.detail.connect) setConnect(true);
      setError(e instanceof ApiError ? e.message : String(e));
      return false;
    }
  }

  async function stop() {
    if (!film) return;
    await api(`/api/chat/${encodeURIComponent(film)}/stop`, { method: "POST" }).catch(() => {});
  }

  return { entries, busy, error, connect, setConnect, send, stop };
}
