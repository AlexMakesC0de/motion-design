import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { JobView } from "../api/types";
import { onStudioEvent } from "../app/useStudio";

/** `job` in place of its old version, newest first. */
export function mergeJob(list: JobView[], job: JobView): JobView[] {
  return [job, ...list.filter((j) => j.id !== job.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The film's takes, kept live by SSE job events; reloaded when the stream reconnects. */
export function useJobs(run: string) {
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    const q = run ? `run=${encodeURIComponent(run)}&limit=200` : "limit=200";
    return api<JobView[]>(`/api/jobs?${q}`)
      .then((list) => {
        setJobs(list);
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message));
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
