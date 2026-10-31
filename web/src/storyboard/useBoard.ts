import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { BoardView, DirectorMenu } from "../api/types";
import { onStudioEvent } from "../app/useStudio";

let menuCache: Promise<DirectorMenu> | null = null;
/** The director's menu and the models for the inspector's selects; read once. */
export function loadMenu(): Promise<DirectorMenu> {
  return (menuCache ??= api<DirectorMenu>("/api/director/menu").catch((e) => {
    menuCache = null;
    throw e;
  }));
}
export const resetMenuForTests = () => {
  menuCache = null;
};

/**
 * A film's storyboard, read again whenever something may have changed it: a
 * job of this film moved, the chat finished a tool step (it may have saved
 * the plan or made a still), a task of this film ended, or the stream
 * reconnected. `apply` takes the board an action answered with.
 */
export function useBoard(film: string) {
  const [board, setBoard] = useState<BoardView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!film) return;
    const mine = ++seq.current;
    api<BoardView>(`/api/films/${encodeURIComponent(film)}/board`)
      .then((b) => {
        if (mine !== seq.current) return;
        setBoard(b);
        setError(null);
      })
      .catch((e) => mine === seq.current && setError(e instanceof ApiError ? e.message : String(e)));
  }, [film]);

  useEffect(() => {
    setBoard(null);
    setError(null);
    load();
  }, [load]);

  useEffect(
    () =>
      onStudioEvent((e) => {
        if (e.event === "hello") load();
        else if (e.event === "job" && e.data.run === film) load();
        else if (e.event === "task" && e.data.run === film && e.data.state !== "running") load();
        else if (e.event === "chat" && e.data.film === film && e.data.entry?.kind === "tool" && e.data.entry.state !== "running") load();
      }),
    [film, load],
  );

  const apply = useCallback((b: BoardView) => {
    seq.current++;
    setBoard(b);
    setError(null);
  }, []);

  return { board, error, reload: load, apply };
}
