// Waits on jobs this server submitted, in the background, so the page never
// holds a request open for minutes. waitJob does the polling, the download and
// the cost settling; events.mjs sees the job file change and tells the page.
//
// Only jobs submitted here are followed. A job the CLI or an MCP client is
// already waiting on would otherwise be downloaded twice.
import { openJobs } from "../../cli/core/jobs.mjs";
import { waitJob } from "../../cli/core/generate.mjs";
import { redact } from "../../cli/lib/redact.mjs";

export function createFollower({ catalog, deps = {}, timeoutMs = 20 * 60_000, rounds = 3, log = (m) => process.stderr.write(m) } = {}) {
  const running = new Map();

  async function run(id) {
    try {
      for (let i = 0; i < rounds; i++) {
        const w = await waitJob(catalog, openJobs(), id, { timeoutMs, deps: deps.generate });
        if (w.outcome !== "pending") return w.outcome;
      }
      return "pending"; // still running after every round: Check again picks it up from here
    } catch (err) {
      log(`studio: stopped following ${id}: ${redact(err?.message ?? String(err))}\n`);
      return "error";
    }
  }

  return {
    /** Start waiting on `id` unless already waiting. Resolves to the last outcome; never rejects. */
    follow(id) {
      if (running.has(id)) return running.get(id);
      // Deferred a tick so `running` holds the promise before any of it runs.
      const p = Promise.resolve()
        .then(() => run(id))
        .finally(() => running.delete(id));
      running.set(id, p);
      return p;
    },
    has: (id) => running.has(id),
    /** Resolves when every job followed so far has settled or been let go (tests). */
    idle: () => Promise.all([...running.values()]),
  };
}
