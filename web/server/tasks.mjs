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
import { randomBytes } from "node:crypto";
import { redact } from "../../cli/lib/redact.mjs";
import { HttpError } from "./http.mjs";

const KEEP = 50;

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
export function createTasks({ onChange = () => {}, throttleMs = 1000, now = () => Date.now() } = {}) {
  const tasks = new Map(); // id -> task, oldest first
  const busy = new Map(); // run -> id of its running task
  const running = new Map(); // id -> promise, for idle()
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
     * Run `work({ progress })` for film `run` in the background and return the
     * task at once. `work` resolves to { outputs: [{ name, url }], warnings? };
     * pass `progress` as core's `onLine` so ffmpeg's lines move the task along.
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
      // Deferred a tick so the caller has the task before any of the work runs.
      const p = Promise.resolve()
        .then(() => work({ progress }))
        .then(
          (r) => {
            task.state = "done";
            task.outputs = r?.outputs ?? [];
            task.warnings = r?.warnings ?? [];
          },
          (err) => {
            task.state = "failed";
            task.error = redact(err?.message ?? String(err));
          },
        )
        .finally(() => {
          task.endedAt = iso();
          busy.delete(run);
          running.delete(task.id);
          tell(task);
        });
      running.set(task.id, p);
      return copy(task);
    },
    get: (id) => (tasks.has(id) ? copy(tasks.get(id)) : null),
    /** Newest first; only film `run`'s when given. */
    list: (run) => [...tasks.values()].filter((t) => !run || t.run === run).reverse().map(copy),
    /** Resolves when every task started so far has ended (tests). */
    idle: () => Promise.all([...running.values()]),
  };
}
