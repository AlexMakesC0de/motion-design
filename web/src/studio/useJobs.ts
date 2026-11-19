import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { JobView } from "../api/types";
import { onStudioEvent } from "../app/useStudio";

const byNewest = (a: JobView, b: JobView) => b.createdAt.localeCompare(a.createdAt);

/** `job` in place of its old version, newest first. An older copy than the one held is ignored. */
export function mergeJob(list: JobView[], job: JobView): JobView[] {
  const held = list.find((j) => j.id === job.id);
  if (held && held.updatedAt > job.updatedAt) return list;
  return [job, ...list.filter((j) => j.id !== job.id)].sort(byNewest);
}

/**
 * A loaded list over what is held: each loaded job unless the stream already
 * brought a newer copy, plus held jobs the list does not have yet (a job event
 * that arrived while the request was out).
 */
export function mergeJobs(held: JobView[], loaded: JobView[]): JobView[] {
  const byId = new Map(held.map((j) => [j.id, j]));
  for (const j of loaded) {
    const h = byId.get(j.id);
    if (!h || h.updatedAt <= j.updatedAt) byId.set(j.id, j);
  }
  return [...byId.values()].sort(byNewest);
}

/** The film's takes, kept live by SSE job events; reloaded when the stream reconnects. */
export function useJobs(run: string) {
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Only the latest request may land: an answer for a film left behind, or
  // an earlier reload of this one, is dropped.
  const latest = useRef(0);

  const reload = useCallback(() => {
    const ticket = ++latest.current;
    const q = run ? `run=${encodeURIComponent(run)}&limit=200` : "limit=200";
    return api<JobView[]>(`/api/jobs?${q}`)
      .then((list) => {
        if (ticket !== latest.current) return;
        setJobs((held) => mergeJobs(held, Array.isArray(list) ? list : []));
        setError(null);
      })
      .catch((e: ApiError) => ticket === latest.current && setError(e.message));
  }, [run]);

  useEffect(() => {
    setJobs([]);
    reload();
  }, [reload]);

  useEffect(
    () =>
      onStudioEvent((e) => {
        if (e.event === "hello") reload();
        if (e.event === "job" && (!run || e.data.run === run)) setJobs((prev) => mergeJob(prev, e.data));
      }),
    [run, reload],
  );

  return { jobs, error, reload };
}

/** The current time, ticking every `ms`, for elapsed clocks. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
