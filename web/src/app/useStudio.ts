import { useEffect, useState, useSyncExternalStore } from "react";
import { api, ApiError } from "../api/client";
import { subscribe } from "../api/events";
import type { SpendView, StudioEvent } from "../api/types";

type Listener = (e: StudioEvent) => void;
const listeners = new Set<Listener>();

/** Screens listen for job and library events here. */
export function onStudioEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useRoute(): string {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("hashchange", cb);
      return () => window.removeEventListener("hashchange", cb);
    },
    () => window.location.hash,
  );
}

export function useStudio() {
  const [spend, setSpend] = useState<SpendView | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<SpendView>("/api/spend")
        .then((s) => alive && setSpend(s))
        .catch((e: ApiError) => alive && e.offline && setOnline(false));
    load();
    const stop = subscribe(
      (e) => {
        if (e.event === "spend") setSpend(e.data);
        listeners.forEach((fn) => fn(e));
      },
      (up) => {
        if (!alive) return;
        setOnline(up);
        if (up) load();
      },
    );
    return () => {
      alive = false;
      stop();
    };
  }, []);

  return { spend, online };
}
