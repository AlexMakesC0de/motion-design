// One Server-Sent Events stream for the page. Jobs started anywhere (this
// page, the chat, the CLI, Codex through MCP) land in runs/.jobs, so watching
// that folder is how every take reaches the feed.
import { existsSync, mkdirSync, watch } from "node:fs";
import { JOBS_DIR } from "../../cli/core/jobs.mjs";
import { LIBRARY_DIR } from "../../cli/lib/run.mjs";
import { context, jobView, spendView } from "./state.mjs";

export const formatEvent = ({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export function takeSnapshot({ following } = {}) {
  const { store, limits, library } = context();
  store.sweep();
  return {
    jobs: new Map(store.list().map((j) => [j.id, jobView(j, following)])),
    spend: spendView(store, limits),
    library: library.list(),
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Events that turn `prev` into `next`. Pure. */
export function diff(prev, next) {
  if (!prev) return [];
  const out = [];
  for (const [id, job] of next.jobs) {
    if (!same(prev.jobs.get(id), job)) out.push({ event: "job", data: job });
  }
  if (!same(prev.spend, next.spend)) out.push({ event: "spend", data: next.spend });
  if (!same(prev.library, next.library)) out.push({ event: "library", data: next.library });
  return out;
}

export function createEvents({ pollMs = 2_000, snapshot = takeSnapshot } = {}) {
  const clients = new Set();
  let last = null;
  let timer = null;

  const check = () => {
    let next;
    try {
      next = snapshot();
    } catch (err) {
      process.stderr.write(`studio: event snapshot failed: ${err.message}\n`);
      return;
    }
    const events = diff(last, next);
    last = next;
    for (const e of events) for (const c of clients) c.write(formatEvent(e));
  };
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(check, 150);
  };

  const watchers = [];
  for (const dir of [JOBS_DIR, LIBRARY_DIR]) {
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      watchers.push(watch(dir, { recursive: dir === LIBRARY_DIR }, soon));
    } catch {
      // fs.watch is best effort; the poll below still catches every change.
    }
  }
  const poll = setInterval(check, pollMs);
  check();

  return {
    /** Look again soon: something changed that no file watcher sees (a job stopped being followed). */
    nudge: soon,
    /** How many responses are subscribed right now. */
    size: () => clients.size,
    /** Attach an HTTP response as a subscriber. */
    subscribe(res) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(formatEvent({ event: "hello", data: { at: new Date().toISOString() } }));
      const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
      const client = { write: (s) => res.write(s) };
      clients.add(client);
      res.on("close", () => {
        clearInterval(ping);
        clients.delete(client);
      });
    },
    close() {
      clearInterval(poll);
      clearTimeout(timer);
      for (const w of watchers) w.close();
      clients.clear();
    },
  };
}
