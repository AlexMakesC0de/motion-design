import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { RUNS_DIR } from "../lib/run.mjs";
import { unknown, usage } from "../lib/errors.mjs";

export const JOBS_DIR = join(RUNS_DIR, ".jobs");

/**
 * Every state a job can be in, and what it counts against the daily cap:
 * its estimate, its actual cost when the provider reported one, or nothing.
 * Only states that provably cost nothing count zero; everything uncertain
 * holds its estimate, because under-counting is how a cap stops meaning
 * anything.
 */
export const STATES = {
  reserved: "estimate", // written, not yet sent
  sending: "estimate", // written just before the create call
  submitted: "estimate", // the provider returned a task id
  uncertain: "estimate", // the create ended ambiguously; the job may exist
  succeeded: "actual",
  "failed-charged": "actual", // failed upstream, and the record reports a charge
  "failed-unconfirmed": "estimate", // failed, and nothing says what it cost
  "failed-confirmed-free": "zero", // rejected at create, or the record reports 0
  refused: "zero", // our own check stopped it; nothing left the machine
};

const NEXT = {
  reserved: ["sending", "refused"],
  sending: ["submitted", "uncertain", "failed-confirmed-free"],
  submitted: ["succeeded", "failed-charged", "failed-unconfirmed", "failed-confirmed-free"],
  uncertain: ["submitted", "succeeded", "failed-charged", "failed-unconfirmed", "failed-confirmed-free"],
};

export const UNSETTLED = new Set(["reserved", "sending", "submitted", "uncertain"]);

export function countedUsd(job) {
  const rule = STATES[job.state];
  if (rule === "zero") return 0;
  if (rule === "actual" && typeof job.actualUsd === "number") return job.actualUsd;
  return job.estimateUsd ?? 0;
}

/** The calendar date (YYYY-MM-DD) at `date` in `timeZone`. */
export function localDay(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export const systemTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM"; // exists, owned by someone else
  }
}

const ID = /^j-\d{8}-[0-9a-f]{6}$/;
const STALE_MS = 10 * 60_000;

/**
 * One JSON file per job under runs/.jobs/. Writes go to a temp file and are
 * renamed into place, so a crash never leaves half a record.
 */
export function openJobs(dir = JOBS_DIR, { now = () => new Date(), timeZone = systemTimeZone(), pid = process.pid } = {}) {
  const pathOf = (id) => {
    if (!ID.test(id ?? "")) throw usage(`"${id}" is not a local job id (j-YYYYMMDD-xxxxxx).`);
    return join(dir, `${id}.json`);
  };

  const save = (job) => {
    mkdirSync(dir, { recursive: true });
    const path = pathOf(job.id);
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(job, null, 2) + "\n");
    renameSync(tmp, path);
    return job;
  };

  function get(id) {
    const path = pathOf(id);
    if (!existsSync(path)) throw unknown(`No local job ${id} in ${dir}.`);
    return JSON.parse(readFileSync(path, "utf8"));
  }

  function create(fields) {
    const at = now();
    const day = localDay(at, timeZone);
    const id = `j-${day.replaceAll("-", "")}-${randomBytes(3).toString("hex")}`;
    return save({
      ...fields,
      id,
      state: "reserved",
      upstreamTaskId: null,
      actualUsd: null,
      costSource: "none",
      createdAt: at.toISOString(),
      timeZone,
      day,
      pid,
      history: [{ state: "reserved", at: at.toISOString() }],
    });
  }

  function transition(id, state, patch = {}) {
    const job = get(id);
    if (!NEXT[job.state]?.includes(state)) {
      throw usage(`Job ${id} cannot move from ${job.state} to ${state}.`);
    }
    const { note, ...rest } = patch;
    const at = now().toISOString();
    return save({ ...job, ...rest, state, history: [...job.history, { state, at, ...(note ? { note } : {}) }] });
  }

  function list({ states } = {}) {
    if (!existsSync(dir)) return [];
    const jobs = [];
    for (const f of readdirSync(dir)) {
      if (!/^j-.*\.json$/.test(f)) continue;
      try {
        jobs.push(JSON.parse(readFileSync(join(dir, f), "utf8")));
      } catch {
        // A record that does not parse is skipped, not fatal; it stays on disk to inspect.
      }
    }
    return jobs
      .filter((j) => !states || states.includes(j.state))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Settle records a crashed process left behind: older than 10 minutes and
   * their process gone. A reservation never reached the network, so it is
   * free. A send may have, so it becomes uncertain and keeps its estimate.
   */
  function sweep({ isAlive = pidAlive } = {}) {
    const cutoff = now().getTime() - STALE_MS;
    const changed = [];
    for (const job of list({ states: ["reserved", "sending"] })) {
      if (Date.parse(job.history.at(-1).at) > cutoff || isAlive(job.pid)) continue;
      try {
        changed.push(
          job.state === "reserved"
            ? transition(job.id, "refused", { reason: "abandoned", note: "abandoned before sending; nothing left the machine" })
            : transition(job.id, "uncertain", { note: "abandoned while sending; the job may exist upstream" }),
        );
      } catch (err) {
        // Another process settled it between the list and the move.
        if (!["reserved", "sending"].includes(get(job.id).state)) continue;
        throw err;
      }
    }
    return changed;
  }

  return { dir, now, create, get, transition, list, sweep };
}

/** The user's answer for an uncertain job. Deliberately CLI-only: no MCP tool calls this. */
export function resolveUncertain(store, id, { task, notCreated } = {}) {
  const job = store.get(id);
  if (job.state !== "uncertain") {
    throw usage(`Job ${id} is ${job.state}, not uncertain; there is nothing to resolve.`);
  }
  if (task) {
    return store.transition(id, "submitted", { upstreamTaskId: task, note: "resolved by the user: the task exists" });
  }
  if (notCreated) {
    return store.transition(id, "failed-confirmed-free", {
      actualUsd: 0,
      costSource: "user",
      note: "resolved by the user: no task was created",
    });
  }
  throw usage("Resolve with --task <provider task id> or --not-created.");
}

/** What to tell whoever is holding an uncertain job. Never "try again". */
export function uncertainMessage(job) {
  if (job.upstreamTaskId) {
    return (
      `Job ${job.id} may still be running at ${job.provider} (task ${job.upstreamTaskId}). ` +
      `Do not resubmit. Rejoin with: kie job ${job.id}`
    );
  }
  return (
    `Job ${job.id} may exist at ${job.provider}, but no task id came back. Do not resubmit. ` +
    `Check the provider's task log, then record what happened:\n` +
    `  kie job resolve ${job.id} --task <task id>     (it exists; rejoin it)\n` +
    `  kie job resolve ${job.id} --not-created        (it does not; release the hold)`
  );
}
