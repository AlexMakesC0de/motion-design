import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Scene, ScenePreview } from "../api/types";
import { onStudioEvent } from "../app/useStudio";

const SAVE_PAUSE_MS = 400;

type Pending = { timer: ReturnType<typeof setTimeout>; scene: Scene; run: string };

const base = (run: string) => `/api/films/${encodeURIComponent(run)}/scenes`;

/**
 * A film's scenes. Edits show at once and are sent after 400 ms of quiet, one
 * request per scene; generating flushes them first so it compiles what is on screen.
 */
export function useScenes(run: string) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The one pending save per scene id; also read by reload() so a load never
  // overwrites an edit that has not been sent yet.
  const pending = useRef(new Map<string, Pending>());
  const latest = useRef(0);
  const held = useRef<Scene[]>([]);
  held.current = scenes;

  const reload = useCallback(() => {
    const ticket = ++latest.current;
    return api<{ idea: unknown; scenes: Scene[] }>(base(run))
      .then((d) => {
        if (ticket !== latest.current) return;
        setScenes(d.scenes.map((s) => pending.current.get(s.id)?.scene ?? s));
        setError(null);
        setLoading(false);
      })
      .catch((e: ApiError) => {
        if (ticket !== latest.current) return;
        setError(e.message);
        setLoading(false);
      });
  }, [run]);

  useEffect(() => {
    setScenes([]);
    setLoading(true);
    reload();
  }, [reload]);

  useEffect(
    () =>
      onStudioEvent((e) => {
        if (e.event === "hello") reload();
        if (e.event === "job" && held.current.some((s) => s.versions.some((v) => v.job === e.data.id))) reload();
      }),
    [reload],
  );

  const send = useCallback(async (id: string, p: Pending) => {
    clearTimeout(p.timer);
    if (pending.current.get(id) === p) pending.current.delete(id);
    try {
      const saved = await api<Scene>(`${base(p.run)}/${encodeURIComponent(id)}`, { method: "PUT", body: p.scene });
      // The server's copy (checked, times derived) lands unless typing went on meanwhile.
      if (p.run === run && !pending.current.has(id)) setScenes((list) => list.map((s) => (s.id === id ? saved : s)));
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, [run]);

  /** Send every pending save now. */
  const flush = useCallback(() => Promise.all([...pending.current].map(([id, p]) => send(id, p))).then(() => undefined), [send]);

  // Leaving the film (or the page) must not lose the last edit.
  useEffect(() => () => { void flush(); }, [flush]);

  const save = useCallback((scene: Scene) => {
    setScenes((list) => list.map((s) => (s.id === scene.id ? scene : s)));
    const old = pending.current.get(scene.id);
    if (old) clearTimeout(old.timer);
    const p: Pending = { scene, run, timer: setTimeout(() => void send(scene.id, p), SAVE_PAUSE_MS) };
    pending.current.set(scene.id, p);
  }, [run, send]);

  const create = useCallback(async () => {
    const scene = await api<Scene>(base(run), { method: "POST", body: {} });
    setScenes((list) => [...list, scene]);
    return scene;
  }, [run]);

  const remove = useCallback(async (id: string) => {
    const p = pending.current.get(id);
    if (p) clearTimeout(p.timer);
    pending.current.delete(id);
    await api(`${base(run)}/${encodeURIComponent(id)}`, { method: "DELETE" });
    setScenes((list) => list.filter((s) => s.id !== id));
  }, [run]);

  const preview = useCallback(async (id: string) => {
    await flush();
    return api<ScenePreview>(`${base(run)}/${encodeURIComponent(id)}/prompt`);
  }, [run, flush]);

  /** A draft or a final starts a job; the scene comes back with the new version. */
  const make = useCallback(async (id: string, step: "draft" | "final", body?: unknown) => {
    await flush();
    const r = await api<{ scene: Scene }>(`${base(run)}/${encodeURIComponent(id)}/${step}`, { method: "POST", body: body ?? {} });
    setScenes((list) => list.map((s) => (s.id === id ? r.scene : s)));
    return r;
  }, [run, flush]);

  const draft = useCallback((id: string) => make(id, "draft"), [make]);
  const final = useCallback((id: string, resolution: string) => make(id, "final", { resolution }), [make]);

  const choose = useCallback(async (id: string, job: string) => {
    const scene = await api<Scene>(`${base(run)}/${encodeURIComponent(id)}/choose`, { method: "POST", body: { job } });
    setScenes((list) => list.map((s) => (s.id === id ? scene : s)));
    return scene;
  }, [run]);

  /** A picture for a slot, stored in the film's refs folder; resolves to its source ("file:refs/<name>"). */
  const uploadRef = useCallback(async (file: File) => {
    const r = await api<{ source: string }>(`/api/films/${encodeURIComponent(run)}/refs?name=${encodeURIComponent(file.name)}`, { file: { data: file, name: file.name } });
    return r.source;
  }, [run]);

  return { scenes, loading, error, create, save, remove, preview, draft, final, choose, uploadRef };
}
