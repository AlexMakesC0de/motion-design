import { useState } from "react";
import { api, ApiError } from "../api/client";
import type { FilmFile, TaskView } from "../api/types";

/** The files of one kind in the film, newest first, for the pickers. */
export const filesOf = (files: FilmFile[], kind: FilmFile["kind"]) => files.filter((f) => f.kind === kind).reverse();

/**
 * Posts a finishing request. The server answers at once with the task it
 * started (or refuses), and the task's progress arrives as SSE task events.
 */
export function useStart(onStarted: (t: TaskView) => void) {
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  async function start(path: string, body: unknown) {
    setSending(true);
    setError(null);
    try {
      const { task } = await api<{ task: TaskView }>(path, { method: "POST", body });
      onStarted(task);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }
  return { start, error, sending };
}
