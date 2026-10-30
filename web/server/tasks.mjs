// Finishing tasks. Assemble, captions, variants and text cards run ffmpeg and
// the render engine for seconds to minutes, so an endpoint starts one here and
// answers at once; core spawns the tools as child processes, so the server
// keeps answering while they run. The page follows each task through SSE
// `task` events (and GET /api/tasks after a reconnect).
//
// One task per film at a time: two tasks in one film could pick the same free
// output name (core numbers outputs when it starts writing) or rewrite the
// same record (assembly.json, variants.json). A second request is refused
// with 409 rather than queued. Tasks are kept in memory, the last 50; their
// outputs are files in the run, which the film page lists from disk.
//
// Every task is given an AbortSignal, which the endpoint passes to the core
// function that starts ffmpeg or the render engine; aborting it kills those
// processes (core's run). A task is aborted when it outlives its limit (a hung
// render would otherwise hold its film for good), when the user cancels it,
// and when the studio shuts down. Each ends as a failed task with a plain
// message, and the film is free again.
import { randomBytes } from "node:crypto";
import { redact } from "../../cli/lib/redact.mjs";
import { HttpError } from "./http.mjs";

const KEEP = 50;

/** How long a task may run, by kind, before it is stopped. A text card is the shortest job. */
export const TASK_TIMEOUTS_MS = { assemble: 15 * 60_000, caption: 15 * 60_000, variants: 15 * 60_000, card: 10 * 60_000 };

const span = (ms) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${ms / 1000} seconds`);
const STOPPED = {
  timeout: (ms) => `It was still running after ${span(ms)}, so the studio stopped it. Try again, and if it keeps stalling check the files it uses and run kie doctor.`,
  cancel: () => "Cancelled.",
  shutdown: () => "Stopped because the studio was shut down.",
};

/** Seconds of output ffmpeg has written, from the last "time=HH:MM:SS.ss" in `text`; null when there is none. */
export function progressSeconds(text) {
  const last = [...String(text).matchAll(/time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g)].at(-1);
  return last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : null;
}

/**
 * `onChange(task)` hears every start and end, and progress at most once per
 * `throttleMs`. A task is { id, run, tool, label, state: running | done |
 * failed, startedAt, endedAt, outS, outputs, warnings, error }.
 */
export function createTasks({ onChange = () => {}, throttleMs = 1000, now = () => Date.now(), timeouts = TASK_TIMEOUTS_MS } = {}) {
  const tasks = new Map(); // id -> task, oldest first
  const busy = new Map(); // run -> id of its running task
  const running = new Map(); // id -> promise, for idle()
  const stoppers = new Map(); // id -> stop(cause), for a running task
  const iso = () => new Date(now()).toISOString();
  const copy = (t) => ({ ...t, outputs: [...t.outputs], warnings: [...t.warnings] });

  const tell = (t) => {
    try {
      onChange(copy(t));
    } catch {
      // a listener's problem never stops a task
    }
  };

  const prune = () => {
    for (const [id, t] of tasks) {
      if (tasks.size <= KEEP) break;
      if (t.state !== "running") tasks.delete(id);
    }
  };

  return {
    /**
     * Run `work({ progress, signal })` for film `run` in the background and
     * return the task at once. `work` resolves to { outputs: [{ name, url }],
     * warnings? }; pass `progress` as core's `onLine` so ffmpeg's lines move the
     * task along, and `signal` to core so the tools can be stopped.
     */
    start(run, tool, label, work) {
      const held = busy.get(run);
      if (held) throw new HttpError(409, `${tasks.get(held).label} is still running in ${run}. Wait for it to finish, then try again.`);
      const task = { id: `t-${randomBytes(4).toString("hex")}`, run, tool, label, state: "running", startedAt: iso(), endedAt: null, outS: null, outputs: [], warnings: [], error: null };
      tasks.set(task.id, task);
      busy.set(run, task.id);
      prune();
      tell(task);

      let told = now();
      const progress = (line) => {
        const s = progressSeconds(line);
        if (s == null) return;
        task.outS = s;
        if (now() - told >= throttleMs) {
          told = now();
          tell(task);
        }
      };
      // Why the task was aborted, if it was: the message a stopped task shows is ours, not the killed tool's.
      const controller = new AbortController();
      const limit = timeouts[tool];
      let stopped = null;
      const stop = (cause) => {
        if (stopped || task.state !== "running") return;
        stopped = STOPPED[cause](limit);
        controller.abort();
      };
      stoppers.set(task.id, stop);
      const timer = limit ? setTimeout(() => stop("timeout"), limit) : null;
      timer?.unref();

      // Deferred a tick so the caller has the task before any of the work runs.
      const p = Promise.resolve()
        .then(() => {
          // Stopped in the same breath as it started: nothing is launched.
          if (controller.signal.aborted) throw new Error("Stopped before it began.");
          return work({ progress, signal: controller.signal });
        })
        .then(
          (r) => {
            task.state = "done";
            task.outputs = r?.outputs ?? [];
            task.warnings = r?.warnings ?? [];
          },
          (err) => {
            task.state = "failed";
            task.error = stopped ?? redact(err?.message ?? String(err));
          },
        )
        .finally(() => {
          clearTimeout(timer);
          stoppers.delete(task.id);
          task.endedAt = iso();
          busy.delete(run);
          running.delete(task.id);
          tell(task);
        });
      running.set(task.id, p);
      return copy(task);
    },
    /**
     * Stop a running task: its tools are killed and it ends as failed, "Cancelled."
     * Returns the task as it is now (still running until the tools are gone; the
     * page hears it end like any other task). 404 for an id never seen, 409 for a
     * task that has already ended.
     */
    cancel(id) {
      const task = tasks.get(id);
      if (!task) throw new HttpError(404, "There is no such task. It may be older than the last 50, or from before the studio restarted.");
      if (task.state !== "running") throw new HttpError(409, `${task.label} has already finished.`);
      stoppers.get(id)("cancel");
      return copy(task);
    },
    /** Stop every running task (the studio is shutting down); resolves when they have all ended. */
    stopAll() {
      for (const stop of [...stoppers.values()]) stop("shutdown");
      return Promise.all([...running.values()]);
    },
    get: (id) => (tasks.has(id) ? copy(tasks.get(id)) : null),
    /** Newest first; only film `run`'s when given. */
    list: (run) => [...tasks.values()].filter((t) => !run || t.run === run).reverse().map(copy),
    /** Resolves when every task started so far has ended (tests). */
    idle: () => Promise.all([...running.values()]),
  };
}
