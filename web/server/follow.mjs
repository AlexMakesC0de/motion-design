// Waits on jobs this server submitted, in the background, so the page never
// holds a request open for minutes. waitJob does the polling, the download and
// the cost settling; events.mjs sees the job file change and tells the page.
//
// Only jobs submitted here (marked `via: "studio"`) are followed. Core settles
// each job once, so a job the CLI or an MCP client is also waiting on is
// downloaded and recorded by whichever finishes first, never twice.
import { openJobs } from "../../cli/core/jobs.mjs";
import { waitJob } from "../../cli/core/generate.mjs";
import { redact } from "../../cli/lib/redact.mjs";

const pause = (ms) => new Promise((r) => setTimeout(r, ms).unref());

/**
 * `rounds` waits of up to `timeoutMs` each. A round can also end at once (the
 * download of a finished take failed), so rounds are spaced by `backoffMs`,
 * doubling each time. `onChange(id)` is called when a job starts or stops
 * being followed, so the page can be told without waiting for a poll.
 */
export function createFollower({
  catalog,
  deps = {},
  timeoutMs = 20 * 60_000,
  rounds = 3,
  backoffMs = 15_000,
  sleep = pause,
  onChange = () => {},
  log = (m) => process.stderr.write(m),
} = {}) {
  const running = new Map();

  async function run(id) {
    try {
      for (let i = 0; i < rounds; i++) {
        if (i > 0) await sleep(backoffMs * 2 ** (i - 1));
        const w = await waitJob(catalog, openJobs(), id, { timeoutMs, deps: deps.generate });
        if (w.outcome !== "pending") return w.outcome;
      }
      return "pending"; // still running after every round: Check again picks it up from here
    } catch (err) {
      log(`studio: stopped following ${id}: ${redact(err?.message ?? String(err))}\n`);
      return "error";
    }
  }

  const tell = (id) => {
    try {
      onChange(id);
    } catch {
      // a listener's problem never stops the follower
    }
  };

  const follower = {
    /** Start waiting on `id` unless already waiting. Resolves to the last outcome; never rejects. */
    follow(id) {
      if (running.has(id)) return running.get(id);
      // Deferred a tick so `running` holds the promise before any of it runs.
      const p = Promise.resolve()
        .then(() => run(id))
        .finally(() => {
          running.delete(id);
          tell(id);
        });
      running.set(id, p);
      tell(id);
      return p;
    },
    has: (id) => running.has(id),
    /**
     * At start: follow again every studio job a previous run of the server
     * left waiting (submitted, or uncertain with a task id to read). Returns
     * the ids it picked up.
     */
    resume(store = openJobs()) {
      const ids = store
        .list({ states: ["submitted", "uncertain"] })
        .filter((j) => j.via === "studio" && j.upstreamTaskId)
        .map((j) => j.id);
      for (const id of ids) follower.follow(id);
      return ids;
    },
    /** Resolves when every job followed so far has settled or been let go (tests). */
    idle: () => Promise.all([...running.values()]),
  };
  return follower;
}
