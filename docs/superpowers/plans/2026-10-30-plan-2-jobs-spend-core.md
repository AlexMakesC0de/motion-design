# Plan 2: local job records, the daily spend cap and a shared generation core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every paid submission gets a local job id written before the network is touched, a daily dollar cap is enforced through reservations, actual cost comes from kie's `creditsConsumed`, and submitting and waiting move out of `cli/kie.mjs` into `cli/core/` so the MCP server (plan 4) can call them.

**Architecture:** Three new modules in `cli/core/`. `jobs.mjs` is a file-per-job store under `runs/.jobs/` with a fixed state machine. `spend.mjs` reads `~/.config/kie/limits.json`, sums today's jobs and reserves under a short O_EXCL lock that is never held across a network call. `generate.mjs` holds `submitJob` (plan, reserve, create) and `waitJob` (poll, download, settle cost), with the provider calls injectable for tests. `cli/kie.mjs` becomes a formatter over them and gains `kie limits` and `kie job resolve`.

**Tech stack:** Node ≥20 ESM, `node:test`, no new packages.

**Spec:** [2026-10-30-mcp-server-design.md](../specs/2026-10-30-mcp-server-design.md), "Jobs", "Spend guard", build steps 2-3. Plan 1 must have landed (it adds `estimateUsd`, `effectiveRoute`, `params`).

**Scope decisions, recorded so a reviewer can check them:**

- Only generation moves into `core/` here. The finishing functions already live in `cli/lib/` as callable functions (`assemble`, `makeVariants`, `burnCaptions`, `render`, `extractFrames`) and the MCP server can call them directly, so moving them would be churn. Read-only listing helpers for MCP (`list_models`, `estimate`, `status`) are written in plan 4, where their only new caller is.
- One state is added to the spec's table: `failed-charged`, for a task that failed upstream but whose record reports credits consumed. The spec only had `failed-unconfirmed` for "failed, unknown charge", which would mislabel a known charge. Task 7 records this in the spec's revision log.
- A create the provider rejects outright (code 4 at create time) becomes `failed-confirmed-free`. That matches the existing failover policy in `canFailOver`, which already relies on "rejected at create means nothing was created".
- A budget or cap refusal writes no job record at all. Nothing was sent, and the refusal is in the error.

---

## File map

| File | Change |
|---|---|
| `cli/core/jobs.mjs` | new: `openJobs`, `STATES`, `UNSETTLED`, `countedUsd`, `localDay`, `pidAlive`, `resolveUncertain`, `uncertainMessage` |
| `cli/core/spend.mjs` | new: `readLimits`, `setDailyLimit`, `limitsPath`, `spentToday`, `dailyPosition`, `withSpendLock`, `reserve` |
| `cli/core/generate.mjs` | new: `submitJob`, `waitJob` |
| `cli/lib/providers.mjs` | add `taskCost` |
| `cli/lib/client.mjs` | `queryTask` returns a failed task's record instead of calling it unreadable |
| `cli/lib/ledger.mjs` | `summarise` reports actual cost from task records |
| `cli/models.json` | kie provider gets `usdPerCredit: 0.005` |
| `cli/kie.mjs` | `generate` and `kie job` call the core; new `kie limits`, `kie job resolve`; `kie preflight` and `kie spend` show the cap and actual cost |
| `tests/jobs.test.mjs`, `tests/spend.test.mjs`, `tests/task-record.test.mjs`, `tests/generate.test.mjs` | new |
| `tests/fixtures/reserve-once.mjs` | new: child process used by the concurrency test |
| `cli/README.md`, `skills/motion-design/references/tool-routing.md`, spec | document it |

Baseline before this plan: 152 passing (end of plan 1).

**Test isolation rule for this plan:** `cli/lib/run.mjs` reads `KIE_RUNS_DIR` once, at import. Any test that touches the run directory, the job store's default location, the ledger or the spend lock sets `process.env.KIE_RUNS_DIR` (and `KIE_LIMITS_FILE`) to a fresh temp directory **before** importing the modules, using `await import(...)`. `node --test` runs each test file in its own process, so this does not leak between files.

---

### Task 1: The job store

**Files:**
- Create: `cli/core/jobs.mjs`
- Test: `tests/jobs.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/jobs.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

process.env.KIE_RUNS_DIR = mkdtempSync(join(tmpdir(), "kie-jobs-"));
const { EXIT } = await import("../cli/lib/errors.mjs");
const { openJobs, countedUsd, localDay, resolveUncertain, uncertainMessage } = await import("../cli/core/jobs.mjs");

const fresh = (opts = {}) => openJobs(mkdtempSync(join(tmpdir(), "kie-store-")), opts);
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid;

describe("a job is on disk before anything is sent", () => {
  test("create writes a reserved record with a local id, its day and its time zone", () => {
    const store = fresh({ now: () => new Date("2026-10-30T13:30:00Z"), timeZone: "Australia/Sydney" });
    const job = store.create({ run: "film", model: "seedance-2-5", provider: "kie", estimateUsd: 0.56 });
    assert.match(job.id, /^j-20261031-[0-9a-f]{6}$/, "the id carries the local date");
    assert.equal(job.state, "reserved");
    assert.equal(job.day, "2026-10-31");
    assert.equal(job.timeZone, "Australia/Sydney");
    assert.equal(job.upstreamTaskId, null);
    assert.deepEqual(store.get(job.id), job);
  });

  test("each legal move is recorded in the history", () => {
    const store = fresh();
    const { id } = store.create({ estimateUsd: 1 });
    store.transition(id, "sending");
    const job = store.transition(id, "submitted", { upstreamTaskId: "t1" });
    assert.deepEqual(job.history.map((h) => h.state), ["reserved", "sending", "submitted"]);
    assert.equal(job.upstreamTaskId, "t1");
  });

  test("an illegal move is refused and nothing changes", () => {
    const store = fresh();
    const { id } = store.create({ estimateUsd: 1 });
    assert.throws(() => store.transition(id, "succeeded"), /cannot move from reserved to succeeded/);
    assert.equal(store.get(id).state, "reserved");
  });

  test("a malformed id is a usage error, not a path", () => {
    assert.throws(() => fresh().get("../../etc/passwd"), { code: EXIT.USAGE });
  });

  test("list filters by state", () => {
    const store = fresh();
    const a = store.create({ estimateUsd: 1 });
    store.create({ estimateUsd: 1 });
    store.transition(a.id, "refused", { reason: "test" });
    assert.equal(store.list({ states: ["reserved"] }).length, 1);
    assert.equal(store.list().length, 2);
  });
});

describe("what each state counts against the cap", () => {
  const job = (state, extra = {}) => ({ state, estimateUsd: 2, actualUsd: null, ...extra });

  test("states still in flight count their estimate", () => {
    for (const s of ["reserved", "sending", "submitted", "uncertain", "failed-unconfirmed"]) {
      assert.equal(countedUsd(job(s)), 2, s);
    }
  });

  test("confirmed-free and refused count nothing", () => {
    assert.equal(countedUsd(job("failed-confirmed-free")), 0);
    assert.equal(countedUsd(job("refused")), 0);
  });

  test("settled jobs count the actual cost when the provider reported one", () => {
    assert.equal(countedUsd(job("succeeded", { actualUsd: 0.4 })), 0.4);
    assert.equal(countedUsd(job("failed-charged", { actualUsd: 0.1 })), 0.1);
    assert.equal(countedUsd(job("succeeded")), 2, "no report: the estimate stands");
  });
});

describe("records left behind by a crashed process are swept", () => {
  const old = new Date("2026-10-30T10:00:00Z");
  const later = new Date("2026-10-30T10:11:00Z");

  test("an abandoned reservation never left the machine, so it becomes refused and free", () => {
    let now = old;
    const store = fresh({ now: () => now, pid: deadPid() });
    const { id } = store.create({ estimateUsd: 1 });
    now = later;
    store.sweep();
    const job = store.get(id);
    assert.equal(job.state, "refused");
    assert.equal(job.reason, "abandoned");
    assert.equal(countedUsd(job), 0);
  });

  test("an abandoned send may have reached the provider, so it becomes uncertain and keeps its estimate", () => {
    let now = old;
    const store = fresh({ now: () => now, pid: deadPid() });
    const { id } = store.create({ estimateUsd: 1 });
    store.transition(id, "sending");
    now = later;
    store.sweep();
    assert.equal(store.get(id).state, "uncertain");
    assert.equal(countedUsd(store.get(id)), 1);
  });

  test("young records and records of a live process are left alone", () => {
    let now = old;
    const store = fresh({ now: () => now });
    const live = store.create({ estimateUsd: 1 });
    now = later;
    const young = store.create({ estimateUsd: 1 });
    store.sweep();
    assert.equal(store.get(live.id).state, "reserved", "this test process is alive");
    assert.equal(store.get(young.id).state, "reserved");
  });
});

describe("an uncertain job is settled only by the user", () => {
  const uncertainJob = (store) => {
    const { id } = store.create({ estimateUsd: 1, provider: "kie" });
    store.transition(id, "sending");
    return store.transition(id, "uncertain");
  };

  test("--task rejoins it as submitted", () => {
    const store = fresh();
    const job = resolveUncertain(store, uncertainJob(store).id, { task: "abc" });
    assert.equal(job.state, "submitted");
    assert.equal(job.upstreamTaskId, "abc");
  });

  test("--not-created settles it free", () => {
    const store = fresh();
    const job = resolveUncertain(store, uncertainJob(store).id, { notCreated: true });
    assert.equal(job.state, "failed-confirmed-free");
    assert.equal(countedUsd(job), 0);
  });

  test("a job that is not uncertain cannot be resolved", () => {
    const store = fresh();
    const { id } = store.create({ estimateUsd: 1 });
    assert.throws(() => resolveUncertain(store, id, { task: "x" }), /is reserved, not uncertain/);
  });

  test("the message without a task id says to check the log and resolve, never to resubmit", () => {
    const store = fresh();
    const msg = uncertainMessage(uncertainJob(store));
    assert.match(msg, /Do not resubmit/);
    assert.match(msg, /kie job resolve j-\S+ --task/);
    assert.match(msg, /--not-created/);
  });

  test("the message with a task id says to rejoin", () => {
    const msg = uncertainMessage({ id: "j-20261030-abcdef", provider: "kie", upstreamTaskId: "t9" });
    assert.match(msg, /kie job j-20261030-abcdef/);
    assert.doesNotMatch(msg, /resolve/);
  });
});

test("localDay reads the calendar date in a given zone", () => {
  const at = new Date("2026-10-30T13:30:00Z");
  assert.equal(localDay(at, "UTC"), "2026-10-30");
  assert.equal(localDay(at, "Australia/Sydney"), "2026-10-31");
  assert.equal(localDay(at, "America/Los_Angeles"), "2026-10-30");
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test tests/jobs.test.mjs`
Expected: FAIL, cannot find module `../cli/core/jobs.mjs`.

- [ ] **Step 3: Implement `cli/core/jobs.mjs`**

```js
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
      changed.push(
        job.state === "reserved"
          ? transition(job.id, "refused", { reason: "abandoned", note: "abandoned before sending; nothing left the machine" })
          : transition(job.id, "uncertain", { note: "abandoned while sending; the job may exist upstream" }),
      );
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
```

- [ ] **Step 4: Run the tests, then everything**

Run: `node --test tests/jobs.test.mjs && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: PASS; `pass 169`, `fail 0` (17 new).

- [ ] **Step 5: Commit**

```bash
git add cli/core/jobs.mjs tests/jobs.test.mjs
git commit -m "Add the local job store: an id on disk before anything is sent"
```

---

### Task 2: Limits, the daily total and reservations

**Files:**
- Create: `cli/core/spend.mjs`, `tests/fixtures/reserve-once.mjs`
- Test: `tests/spend.test.mjs`

- [ ] **Step 1: Create the child-process fixture**

`tests/fixtures/reserve-once.mjs` (not a test file; `npm test` only picks up `*.test.mjs`):

```js
// Reserve once against the store in KIE_RUNS_DIR with a $1 cap, and print the
// outcome. Two of these run at once to prove the lock works across processes.
const { openJobs } = await import("../../cli/core/jobs.mjs");
const { reserve } = await import("../../cli/core/spend.mjs");

try {
  const job = await reserve(openJobs(), { estimateUsd: Number(process.argv[2]) }, {
    limits: { dailyUsd: 1, allowRoots: [] },
  });
  console.log(`ok ${job.id}`);
} catch (e) {
  console.log(`refused ${e.code}`);
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/spend.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RUNS = mkdtempSync(join(tmpdir(), "kie-spend-"));
process.env.KIE_RUNS_DIR = RUNS;
process.env.KIE_LIMITS_FILE = join(RUNS, "limits.json");

const { EXIT } = await import("../cli/lib/errors.mjs");
const { openJobs } = await import("../cli/core/jobs.mjs");
const { readLimits, setDailyLimit, spentToday, dailyPosition, withSpendLock, reserve, LOCK_PATH } =
  await import("../cli/core/spend.mjs");

const fresh = (opts) => openJobs(mkdtempSync(join(tmpdir(), "kie-store-")), opts);
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid;

describe("limits", () => {
  test("no file means a $10 cap and no extra roots", () => {
    assert.deepEqual(readLimits(join(RUNS, "absent.json")), { dailyUsd: 10, allowRoots: [] });
  });

  test("setDailyLimit writes the cap and keeps the other settings", () => {
    const path = join(mkdtempSync(join(tmpdir(), "kie-lim-")), "limits.json");
    writeFileSync(path, JSON.stringify({ dailyUsd: 10, allowRoots: ["/Users/a/brand"] }));
    setDailyLimit("4.5", path);
    assert.deepEqual(readLimits(path), { dailyUsd: 4.5, allowRoots: ["/Users/a/brand"] });
  });

  test("a negative or non-numeric cap is refused", () => {
    assert.throws(() => setDailyLimit("-1", join(RUNS, "x.json")), { code: EXIT.USAGE });
    assert.throws(() => setDailyLimit("lots", join(RUNS, "x.json")), { code: EXIT.USAGE });
  });

  test("a broken limits file is an error, not a silent default", () => {
    const path = join(RUNS, "broken.json");
    writeFileSync(path, "{ nope");
    assert.throws(() => readLimits(path), /not valid JSON/);
  });
});

describe("today's total", () => {
  const day = (d, extra) => ({ day: d, timeZone: "UTC", estimateUsd: 1, actualUsd: null, ...extra });
  const now = new Date("2026-10-30T12:00:00Z");

  test("each state counts what the jobs table says, and other days count nothing", () => {
    const jobs = [
      day("2026-10-30", { state: "submitted" }), // 1
      day("2026-10-30", { state: "uncertain" }), // 1
      day("2026-10-30", { state: "succeeded", actualUsd: 0.25 }), // 0.25
      day("2026-10-30", { state: "failed-unconfirmed" }), // 1
      day("2026-10-30", { state: "failed-confirmed-free" }), // 0
      day("2026-10-30", { state: "refused" }), // 0
      day("2026-10-29", { state: "submitted" }), // yesterday
    ];
    assert.equal(spentToday(jobs, now), 3.25);
  });

  test("the day boundary is the job's own time zone, not UTC", () => {
    const store = fresh({ now: () => new Date("2026-10-30T12:30:00Z"), timeZone: "Australia/Sydney" });
    store.create({ estimateUsd: 2 }); // 23:30 on the 30th in Sydney
    assert.equal(spentToday(store.list(), new Date("2026-10-30T12:45:00Z")), 2, "still the 30th in Sydney");
    assert.equal(spentToday(store.list(), new Date("2026-10-30T13:05:00Z")), 0, "00:05 on the 31st in Sydney");
  });
});

describe("reservations", () => {
  test("a reservation within the cap is written as reserved", async () => {
    const store = fresh();
    const job = await reserve(store, { estimateUsd: 0.6 }, { limits: { dailyUsd: 1, allowRoots: [] } });
    assert.equal(job.state, "reserved");
    assert.equal(dailyPosition(store, { dailyUsd: 1 }).availableUsd, 0.4);
  });

  test("one over the cap is refused with code 2 and writes nothing", async () => {
    const store = fresh();
    await reserve(store, { estimateUsd: 0.6 }, { limits: { dailyUsd: 1, allowRoots: [] } });
    await assert.rejects(
      reserve(store, { estimateUsd: 0.6 }, { limits: { dailyUsd: 1, allowRoots: [] } }),
      (e) => e.code === EXIT.BUDGET && /\$0\.40 of today's \$1\.00 cap/.test(e.message) && /kie limits --daily/.test(e.message),
    );
    assert.equal(store.list().length, 1);
  });

  test("two processes reserving near the cap at once: exactly one succeeds", async () => {
    const fixture = fileURLToPath(new URL("./fixtures/reserve-once.mjs", import.meta.url));
    const runs = mkdtempSync(join(tmpdir(), "kie-race-"));
    const once = () =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [fixture, "0.6"], { env: { ...process.env, KIE_RUNS_DIR: runs } });
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        child.on("close", () => resolve(out.trim()));
      });
    const results = await Promise.all([once(), once()]);
    assert.equal(results.filter((r) => r.startsWith("ok ")).length, 1, results.join(" | "));
    assert.equal(results.filter((r) => r === "refused 2").length, 1, results.join(" | "));
  });

  test("a sweep runs first, so an abandoned reservation stops holding money", async () => {
    let now = new Date("2026-10-30T10:00:00Z");
    const store = fresh({ now: () => now, pid: deadPid() });
    store.create({ estimateUsd: 0.9 });
    now = new Date("2026-10-30T10:11:00Z");
    const job = await reserve(store, { estimateUsd: 0.9 }, { limits: { dailyUsd: 1, allowRoots: [] } });
    assert.equal(job.state, "reserved");
  });
});

describe("the spend lock", () => {
  test("it is gone once the work is done", async () => {
    await withSpendLock(() => assert.ok(existsSync(LOCK_PATH)));
    assert.ok(!existsSync(LOCK_PATH));
  });

  test("a lock left by a dead process is removed with a warning", async () => {
    writeFileSync(LOCK_PATH, JSON.stringify({ pid: deadPid(), at: new Date().toISOString(), token: "old" }));
    const warnings = [];
    const value = await withSpendLock(() => 42, { onWarn: (w) => warnings.push(w) });
    assert.equal(value, 42);
    assert.match(warnings[0], /stale spend lock/);
  });

  test("a lock held by a live process makes the caller give up with code 4", async () => {
    writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token: "theirs" }));
    try {
      await assert.rejects(withSpendLock(() => 1, { waitMs: 200 }), (e) => e.code === EXIT.PROVIDER && /lock is busy/.test(e.message));
      assert.equal(JSON.parse(readFileSync(LOCK_PATH, "utf8")).token, "theirs", "someone else's lock is not removed");
    } finally {
      (await import("node:fs")).unlinkSync(LOCK_PATH);
    }
  });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `node --test tests/spend.test.mjs`
Expected: FAIL, cannot find module `../cli/core/spend.mjs`.

- [ ] **Step 4: Implement `cli/core/spend.mjs`**

```js
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { RUNS_DIR } from "../lib/run.mjs";
import { budget, provider, usage } from "../lib/errors.mjs";
import { UNSETTLED, countedUsd, localDay, pidAlive } from "./jobs.mjs";

export const DEFAULT_LIMITS = { dailyUsd: 10, allowRoots: [] };
export const LOCK_PATH = join(RUNS_DIR, ".spend.lock");

/** ~/.config/kie/limits.json. No MCP tool writes it; `kie limits` is the only writer. */
export const limitsPath = () => process.env.KIE_LIMITS_FILE || join(homedir(), ".config", "kie", "limits.json");

export function readLimits(path = limitsPath()) {
  if (!existsSync(path)) return { ...DEFAULT_LIMITS };
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw usage(`${path} is not valid JSON (${e.message}). Fix it or delete it to return to a $10 cap.`);
  }
  const limits = { ...DEFAULT_LIMITS, ...raw };
  if (typeof limits.dailyUsd !== "number" || !(limits.dailyUsd >= 0)) {
    throw usage(`${path}: dailyUsd must be a number of dollars, 0 or more.`);
  }
  if (!Array.isArray(limits.allowRoots)) throw usage(`${path}: allowRoots must be a list of directories.`);
  return limits;
}

export function setDailyLimit(usd, path = limitsPath()) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n < 0) throw usage(`--daily wants a dollar amount of 0 or more, got "${usd}".`);
  const next = { ...readLimits(path), dailyUsd: n };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
  return next;
}

const round = (n) => Math.round(n * 10_000) / 10_000;

/** Sum of what today's jobs count, each judged in the time zone it was submitted in. */
export function spentToday(jobs, now = new Date()) {
  return round(
    jobs.filter((j) => j.day === localDay(now, j.timeZone)).reduce((sum, j) => sum + countedUsd(j), 0),
  );
}

export function dailyPosition(store, limits, now = store.now()) {
  const jobs = store.list();
  const spentUsd = spentToday(jobs, now);
  return {
    capUsd: limits.dailyUsd,
    spentUsd,
    availableUsd: round(Math.max(0, limits.dailyUsd - spentUsd)),
    unsettled: jobs.filter((j) => UNSETTLED.has(j.state)),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readLock(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Run `fn` holding runs/.spend.lock. The lock covers one local read-and-write
 * (check the total, write the reservation) and is never held across a network
 * call, so a slow provider cannot block every other job.
 *
 * A lock is stale when its process is gone or it is older than 30 seconds.
 * Known limit: two waiters that both judge the same lock stale can race on
 * removing it. Stale locks only follow a crash, so this is accepted.
 */
export async function withSpendLock(fn, { path = LOCK_PATH, staleMs = 30_000, waitMs = 5_000, onWarn = () => {} } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const started = Date.now();

  for (;;) {
    try {
      const fd = openSync(path, "wx");
      writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token }));
      closeSync(fd);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const held = readLock(path);
    const ageMs = held ? Date.now() - Date.parse(held.at) : Date.now() - (statSafe(path)?.mtimeMs ?? Date.now());
    const stale = held ? !pidAlive(held.pid) || ageMs > staleMs : ageMs > staleMs;
    if (stale) {
      try {
        unlinkSync(path);
      } catch {
        /* someone else removed it first */
      }
      onWarn(`Removed a stale spend lock (pid ${held?.pid ?? "?"}, taken ${held?.at ?? "at an unknown time"}).`);
      continue;
    }
    if (Date.now() - started > waitMs) {
      throw provider(
        `The spend lock is busy (${path}, held by pid ${held?.pid ?? "?"}). Nothing was submitted; try again in a moment.`,
      );
    }
    await sleep(25 + Math.random() * 50);
  }

  try {
    return await fn();
  } finally {
    if (readLock(path)?.token === token) unlinkSync(path);
  }
}

function statSafe(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * Reserve, then submit, then reconcile. This is the first step: under the lock,
 * settle abandoned records, check the estimate against what is left of today's
 * cap, and write the `reserved` record. Over the cap, nothing is written and
 * the error says only the user can raise it.
 */
export async function reserve(store, fields, { limits = readLimits(), lock = {} } = {}) {
  return withSpendLock(() => {
    store.sweep();
    const pos = dailyPosition(store, limits);
    if (fields.estimateUsd > pos.availableUsd) {
      throw budget(
        `Refused, nothing spent. Estimated $${fields.estimateUsd.toFixed(2)}; ` +
          `$${pos.availableUsd.toFixed(2)} of today's $${limits.dailyUsd.toFixed(2)} cap is available ` +
          `($${pos.spentUsd.toFixed(2)} spent or held). Ask the user; only they can raise it, with: kie limits --daily N`,
        { estimatedUsd: fields.estimateUsd, availableUsd: pos.availableUsd, capUsd: limits.dailyUsd },
      );
    }
    return store.create(fields);
  }, lock);
}
```

- [ ] **Step 5: Run the tests, then everything**

Run: `node --test tests/spend.test.mjs && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: PASS; `pass 182`, `fail 0` (13 new).

- [ ] **Step 6: Commit**

```bash
git add cli/core/spend.mjs tests/spend.test.mjs tests/fixtures/reserve-once.mjs
git commit -m "Add the daily cap: limits, today's total and locked reservations"
```

---

### Task 3: Read cost from the task record

kie's task record carries `creditsConsumed` (0 for failed tasks; docs.kie.ai task details, read 2026-10-30). Its documented failure example also carries body `code: 501`, which `readFailure` treats as an unreadable response, so a failed task would come back as "uncertain" instead of "failed".

**Files:**
- Modify: `cli/lib/providers.mjs`, `cli/lib/client.mjs`, `cli/models.json`
- Test: `tests/task-record.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/task-record.test.mjs`:

```js
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { loadCatalog } from "../cli/lib/models.mjs";
import { getProvider, taskCost } from "../cli/lib/providers.mjs";
import { queryTask } from "../cli/lib/client.mjs";

const catalog = loadCatalog();
const kie = getProvider(catalog, "kie");
const ws = getProvider(catalog, "wavespeed");

describe("cost comes from the provider's own task record", () => {
  test("kie credits convert at $0.005 each", () => {
    assert.deepEqual(taskCost(kie, { creditsConsumed: 112 }), { usd: 0.56, credits: 112 });
  });

  test("a failed task's 0 is a confirmed zero, not a missing value", () => {
    assert.deepEqual(taskCost(kie, { creditsConsumed: 0 }), { usd: 0, credits: 0 });
  });

  test("no figure, or a provider with no conversion, is null", () => {
    assert.equal(taskCost(kie, { state: "success" }), null);
    assert.equal(taskCost(ws, { creditsConsumed: 5 }), null);
  });
});

describe("a failed task is read as failed, not as unreadable", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => (globalThis.fetch = realFetch));

  test("kie's body code 501 with a task record returns the record", async () => {
    const record = { taskId: "t1", state: "fail", failMsg: "bad frame", creditsConsumed: 0 };
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 501, msg: "failed", data: record }), { status: 200 });
    assert.deepEqual(await queryTask(kie, "jobs", "t1", { key: "k", attempts: 1 }), record);
  });

  test("a body error with no task record is still an error", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 401, msg: "bad key" }), { status: 200 });
    await assert.rejects(queryTask(kie, "jobs", "t1", { key: "k", attempts: 1 }), /could not read task t1/);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test tests/task-record.test.mjs`
Expected: FAIL, `taskCost` is not exported.

- [ ] **Step 3: Add the conversion to `cli/models.json`**

In `providers.kie`, after `"creditUnit": "credits",` add:

```json
"usdPerCredit": 0.005,
"usdPerCreditSource": "kie.ai pricing page: 1,000 credits = $5 at the base tier (read 2026-10-24).",
```

- [ ] **Step 4: Add `taskCost` to `cli/lib/providers.mjs`**

Add after `providerCredits`:

```js
/**
 * What a finished task cost, from the provider's own record. kie reports
 * `creditsConsumed` per task (0 for a failed one). Balance differences cannot
 * stand in for it once two jobs overlap. Providers with no per-task figure
 * return null, and the caller keeps the estimate.
 */
export function taskCost(prov, data) {
  const credits = data?.creditsConsumed;
  if (typeof credits !== "number" || typeof prov.usdPerCredit !== "number") return null;
  return { usd: Math.round(credits * prov.usdPerCredit * 10_000) / 10_000, credits };
}
```

- [ ] **Step 5: Let `queryTask` return a failed task's record (`cli/lib/client.mjs`)**

In `queryTask`, replace:

```js
      const res = await request(url, { key, timeoutMs: 30_000 });
      const failure = readFailure(prov, res);
```

with:

```js
      const res = await request(url, { key, timeoutMs: 30_000 });
      // kie reports a FAILED task with a non-200 body code but a full task
      // record. That is an answer -- the task failed -- not an unreadable
      // response, and treating it as one turns a dead job into "uncertain".
      const record = res.json?.data;
      if (res.ok && record && typeof record === "object" && "state" in record) return record;
      const failure = readFailure(prov, res);
```

- [ ] **Step 6: Run the tests, then everything**

Run: `node --test tests/task-record.test.mjs && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: PASS; `pass 187`, `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add cli/lib/providers.mjs cli/lib/client.mjs cli/models.json tests/task-record.test.mjs
git commit -m "Read job cost from kie's task record, and read failed tasks as failed"
```

---

### Task 4: `submitJob` and `waitJob`

**Files:**
- Create: `cli/core/generate.mjs`
- Test: `tests/generate.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/generate.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RUNS = mkdtempSync(join(tmpdir(), "kie-gen-"));
process.env.KIE_RUNS_DIR = RUNS;
process.env.KIE_LIMITS_FILE = join(RUNS, "limits.json");
// Keys only make routes usable; every provider call below is a stub.
process.env.KIE_API_KEY = "test-kie";
process.env.WAVESPEED_API_KEY = "test-ws";

const { EXIT, provider, uncertain } = await import("../cli/lib/errors.mjs");
const { loadCatalog, resolveModel } = await import("../cli/lib/models.mjs");
const { openJobs, countedUsd } = await import("../cli/core/jobs.mjs");
const { LOCK_PATH } = await import("../cli/core/spend.mjs");
const { submitJob, waitJob } = await import("../cli/core/generate.mjs");

const catalog = loadCatalog();
const model = resolveModel(catalog, "seedance-2-5", "video");
const LIMITS = { dailyUsd: 10, allowRoots: [] };
const store = () => openJobs(mkdtempSync(join(tmpdir(), "kie-store-")));

const preflight = async (_c, _r, o) => ({ estimatedUsd: 0.56, basis: "stub", cap: o.budgetUsd ?? 3, creditsBefore: null });
const request = (extra = {}) => ({
  capability: "video",
  model,
  values: { prompt: "a fox", duration: 4, resolution: "480p", aspect_ratio: "16:9" },
  run: "gen-test",
  artifactBase: "out",
  ...extra,
});

describe("submitJob", () => {
  test("a clean create ends submitted, with the upstream id and the full history", async () => {
    const s = store();
    const calls = [];
    const r = await submitJob(catalog, request({ only: "kie" }), {
      store: s,
      limits: LIMITS,
      deps: { preflight, createTask: async (prov, fam, m, input) => (calls.push({ prov: prov.name, m, input }), { taskId: "t-1" }) },
    });
    assert.equal(r.job.state, "submitted");
    assert.equal(r.job.upstreamTaskId, "t-1");
    assert.deepEqual(r.job.history.map((h) => h.state), ["reserved", "sending", "submitted"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].m, "bytedance/seedance-2-5");
    assert.equal(calls[0].input.duration, 4);
  });

  test("a create that times out ends uncertain with no upstream id, is never retried, and says how to resolve", async () => {
    const s = store();
    let calls = 0;
    await assert.rejects(
      submitJob(catalog, request(), {
        store: s,
        limits: LIMITS,
        deps: { preflight, createTask: async () => { calls += 1; throw uncertain("timed out", null); } },
      }),
      (e) => e.code === EXIT.UNCERTAIN && /^j-/.test(e.localJobId) && /kie job resolve/.test(e.message),
    );
    assert.equal(calls, 1, "no fallback after an uncertain create, even with WaveSpeed available");
    const [job] = s.list();
    assert.equal(job.state, "uncertain");
    assert.equal(job.upstreamTaskId, null);
    assert.equal(countedUsd(job), 0.56);
  });

  test("a create rejected outright is free and falls over to the same model elsewhere", async () => {
    const s = store();
    const seen = [];
    const r = await submitJob(catalog, request(), {
      store: s,
      limits: LIMITS,
      deps: {
        preflight,
        createTask: async (prov) => {
          seen.push(prov.name);
          if (prov.name === "kie") throw provider("kie.ai rejected the request (code 500: busy)");
          return { taskId: "ws-1" };
        },
      },
    });
    assert.deepEqual(seen, ["kie", "wavespeed"]);
    assert.equal(r.job.provider, "wavespeed");
    const kieJob = s.list().find((j) => j.provider === "kie");
    assert.equal(kieJob.state, "failed-confirmed-free");
    assert.equal(countedUsd(kieJob), 0);
  });

  test("over today's cap: refused with code 2, nothing created, nothing sent", async () => {
    const s = store();
    let calls = 0;
    const deps = { preflight, createTask: async () => (calls++, { taskId: `t-${calls}` }) };
    const tight = { dailyUsd: 1, allowRoots: [] };
    await submitJob(catalog, request({ only: "kie" }), { store: s, limits: tight, deps });
    await assert.rejects(submitJob(catalog, request({ only: "kie" }), { store: s, limits: tight, deps }), { code: EXIT.BUDGET });
    assert.equal(calls, 1);
    assert.equal(s.list().length, 1);
  });

  test("the spend lock is not held while the provider is being called", async () => {
    const s = store();
    let heldDuringCall = null;
    await submitJob(catalog, request({ only: "kie" }), {
      store: s,
      limits: LIMITS,
      deps: {
        preflight,
        createTask: async () => {
          heldDuringCall = existsSync(LOCK_PATH);
          await new Promise((r) => setTimeout(r, 50));
          return { taskId: "slow" };
        },
      },
    });
    assert.equal(heldDuringCall, false);
  });

  test("a dry run plans the job and reserves nothing", async () => {
    const s = store();
    const r = await submitJob(catalog, request({ only: "kie", dryRun: true }), {
      store: s,
      limits: LIMITS,
      deps: { preflight, createTask: async () => assert.fail("must not submit") },
    });
    assert.equal(r.dryRun, true);
    assert.equal(r.estimateUsd, 0.56);
    assert.equal(s.list().length, 0);
  });
});

describe("waitJob", () => {
  const submitted = async (s) =>
    (await submitJob(catalog, request({ only: "kie" }), {
      store: s,
      limits: LIMITS,
      deps: { preflight, createTask: async () => ({ taskId: "t-w" }) },
    })).job;
  const download = async (_url, path) => writeFileSync(path, "video");

  test("success downloads into the run and records the cost from the task record", async () => {
    const s = store();
    const job = await submitted(s);
    const w = await waitJob(catalog, s, job.id, {
      deps: {
        waitForTask: async () => ({ urls: ["https://cdn.test/a.mp4"], data: { creditsConsumed: 112 }, elapsedS: 3 }),
        download,
        creditsAfter: async () => null,
      },
    });
    assert.equal(w.outcome, "succeeded");
    assert.equal(w.job.state, "succeeded");
    assert.equal(w.job.actualUsd, 0.56);
    assert.equal(w.job.costSource, "task-record");
    assert.ok(existsSync(w.artifacts[0]));
    assert.ok(w.artifacts[0].startsWith(join(RUNS, "gen-test")));
    const recorded = JSON.parse(readFileSync(join(RUNS, "gen-test", "job.json"), "utf8"));
    assert.equal(recorded.id, job.id);
  });

  test("a failure reported as 0 credits is confirmed free", async () => {
    const s = store();
    const job = await submitted(s);
    const w = await waitJob(catalog, s, job.id, {
      deps: { waitForTask: async () => { throw provider("task failed", { data: { state: "fail", creditsConsumed: 0 } }); } },
    });
    assert.equal(w.outcome, "failed");
    assert.equal(w.job.state, "failed-confirmed-free");
    assert.equal(countedUsd(w.job), 0);
  });

  test("a failure with no cost figure keeps counting its estimate", async () => {
    const s = store();
    const job = await submitted(s);
    const w = await waitJob(catalog, s, job.id, {
      deps: { waitForTask: async () => { throw provider("task failed", { data: { state: "fail" } }); } },
    });
    assert.equal(w.job.state, "failed-unconfirmed");
    assert.equal(countedUsd(w.job), 0.56);
  });

  test("running out of wait time is a normal result; the job stays submitted", async () => {
    const s = store();
    const job = await submitted(s);
    const w = await waitJob(catalog, s, job.id, {
      timeoutMs: 10,
      deps: { waitForTask: async () => { throw uncertain("still generating", "t-w"); } },
    });
    assert.equal(w.outcome, "pending");
    assert.equal(w.job.state, "submitted");
  });

  test("an uncertain job with no upstream id cannot be waited on; it needs the user", async () => {
    const s = store();
    await assert.rejects(
      submitJob(catalog, request({ only: "kie" }), {
        store: s,
        limits: LIMITS,
        deps: { preflight, createTask: async () => { throw uncertain("timed out", null); } },
      }),
    );
    const [job] = s.list();
    let polled = false;
    await assert.rejects(
      waitJob(catalog, s, job.id, { deps: { waitForTask: async () => { polled = true; } } }),
      (e) => e.code === EXIT.UNCERTAIN && /--not-created/.test(e.message),
    );
    assert.equal(polled, false);
  });

  test("a settled job is returned as it is, without polling", async () => {
    const s = store();
    const job = await submitted(s);
    const deps = {
      waitForTask: async () => ({ urls: ["https://cdn.test/b.mp4"], data: { creditsConsumed: 10 }, elapsedS: 1 }),
      download,
      creditsAfter: async () => null,
    };
    await waitJob(catalog, s, job.id, { deps });
    const again = await waitJob(catalog, s, job.id, { deps: { waitForTask: async () => assert.fail("polled a settled job") } });
    assert.equal(again.outcome, "succeeded");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test tests/generate.test.mjs`
Expected: FAIL, cannot find module `../cli/core/generate.mjs`.

- [ ] **Step 3: Implement `cli/core/generate.mjs`**

```js
import { routesFor, buildInput, effectiveRoute } from "../lib/models.mjs";
import { getProvider, providerKey, canFailOver, taskCost } from "../lib/providers.mjs";
import { preflight as realPreflight, creditsAfter as realCreditsAfter } from "../lib/budget.mjs";
import { createTask as realCreateTask } from "../lib/client.mjs";
import { waitForTask as realWaitForTask, download as realDownload } from "../lib/poll.mjs";
import { runDir, nextArtifact, extFromUrl, writeRecord } from "../lib/run.mjs";
import * as ledger from "../lib/ledger.mjs";
import { redact } from "../lib/redact.mjs";
import { EXIT, unknown, usage, uncertain } from "../lib/errors.mjs";
import { UNSETTLED, uncertainMessage } from "./jobs.mjs";
import { reserve } from "./spend.mjs";

const REAL = {
  preflight: realPreflight,
  createTask: realCreateTask,
  waitForTask: realWaitForTask,
  download: realDownload,
  creditsAfter: realCreditsAfter,
};

const ledgerEntry = (job, status) => ({
  run: job.run,
  localJobId: job.id,
  taskId: job.upstreamTaskId,
  capability: job.capability,
  model: job.model,
  provider: job.provider,
  providerModel: job.providerModel,
  estimatedUsd: job.estimateUsd,
  actualUsd: job.actualUsd,
  costSource: job.costSource,
  status,
  creditsBefore: job.creditsBefore ?? null,
  creditsAfter: job.creditsAfter ?? null,
  failedOver: job.failedOver ?? false,
  ...(job.error ? { error: job.error } : {}),
});

/**
 * Plan, reserve and submit one job, returning as soon as the provider has
 * accepted it. Waiting is waitJob's business, so a caller that cannot block
 * for minutes (an MCP tool) gets its local job id back at once.
 *
 * Routes are tried in order. Falling over to the next reseller happens only
 * on a clean rejection at create time (code 4); see canFailOver. Every attempt
 * that reaches the network has its own job record.
 */
export async function submitJob(catalog, req, { store, limits, deps = {}, onEvent = () => {} }) {
  const d = { ...REAL, ...deps };
  const { capability, model, values, run, artifactBase, budgetUsd, only, exclude = [], dryRun = false } = req;
  runDir(run); // validates the slug before anything else happens

  const routes = routesFor(catalog, model, { only });
  const usable = routes.filter((r) => r.usable && !exclude.includes(r.provider));
  if (!usable.length) {
    throw usage(
      `No usable route for ${model.id}:\n` +
        routes
          .map((r) => `  · ${r.provider}: ${exclude.includes(r.provider) ? "already tried" : r.skipReason}`)
          .join("\n"),
    );
  }
  for (const r of routes.filter((r) => !r.usable)) {
    onEvent({ type: "skip", message: `skipping ${r.provider}: ${r.skipReason}` });
  }

  const { _useI2v, ...inputValues } = values;
  const attempts = [];
  let lastError = null;

  for (const [i, route] of usable.entries()) {
    const callRoute = effectiveRoute(route, _useI2v);
    const label = `${route.prov.label} · ${callRoute.model}`;
    if (i > 0) {
      onEvent({
        type: "fallback",
        message:
          `${lastError?.message?.split("\n")[0] ?? "previous route failed"}\n` +
          `  Falling back to ${label}, a different reseller of the same model; output may differ slightly.`,
      });
    }
    if (!route.verified) {
      onEvent({
        type: "unverified",
        message: `${model.id} via ${route.prov.label} is unverified: no job has succeeded on this route, so its price is unconfirmed.`,
      });
    }

    const built = buildInput(callRoute, inputValues);
    if (built.problems.length) {
      // Wrong for this route's contract. Not a provider fault, but a sibling
      // route may have a contract that accepts it, so try the next one.
      lastError = unknown(
        `${label} refused before submitting — nothing was spent:\n` + built.problems.map((p) => `  · ${p}`).join("\n"),
      );
      attempts.push({ provider: route.provider, outcome: "invalid-request" });
      continue;
    }
    if (built.unverified) {
      onEvent({
        type: "contract-unverified",
        message: `${label}'s request contract was never captured from its doc page; the body being sent is a guess and may be rejected.`,
      });
    }

    const key = providerKey(route.prov);
    const pre = await d.preflight(catalog, callRoute, {
      budgetUsd,
      key,
      modelId: model.id,
      capability,
      durationS: built.input.duration,
      resolution: built.input.resolution,
    });
    const plan = {
      route: { provider: route.provider, family: route.family, model: callRoute.model },
      label,
      input: built.input,
      estimateUsd: pre.estimatedUsd,
      basis: pre.basis,
      budgetUsd: pre.cap,
    };
    if (dryRun) {
      return {
        dryRun: true,
        ...plan,
        routes: routes.map((r) => ({ provider: r.provider, usable: r.usable, skipReason: r.skipReason })),
      };
    }

    let job = await reserve(
      store,
      {
        run,
        capability,
        model: model.id,
        provider: route.provider,
        family: route.family,
        providerModel: callRoute.model,
        artifactBase,
        estimateUsd: pre.estimatedUsd,
        basis: pre.basis,
        creditsBefore: pre.creditsBefore ?? null,
        failedOver: i > 0,
        input: built.input,
      },
      { limits },
    );
    job = store.transition(job.id, "sending");

    try {
      const created = await d.createTask(route.prov, route.family, callRoute.model, built.input, { key });
      job = store.transition(job.id, "submitted", { upstreamTaskId: created.taskId });
      attempts.push({ provider: route.provider, outcome: "submitted", localJobId: job.id });
      onEvent({ type: "submitted", message: `submitted ${created.taskId} (${label}) as ${job.id}` });
      return { dryRun: false, job, ...plan, attempts };
    } catch (err) {
      if (err.code === EXIT.PROVIDER && canFailOver(err)) {
        job = store.transition(job.id, "failed-confirmed-free", {
          actualUsd: 0,
          costSource: "create-rejected",
          error: redact(err.message),
          note: "the provider rejected the create; no task exists",
        });
        ledger.append(ledgerEntry(job, "provider-error"));
        attempts.push({ provider: route.provider, outcome: "provider-error", localJobId: job.id });
        lastError = err;
        continue;
      }
      // A timeout, a dropped connection, a missing task id, or a bug: the job
      // may exist upstream. Never retried, never failed over.
      job = store.transition(job.id, "uncertain", {
        upstreamTaskId: err.taskId ?? null,
        error: redact(err.message ?? String(err)),
      });
      ledger.append(ledgerEntry(job, "uncertain"));
      throw uncertain(`${redact(err.message ?? String(err))}\n${uncertainMessage(job)}`, job.upstreamTaskId, {
        localJobId: job.id,
      });
    }
  }
  throw lastError ?? usage(`No route produced a result for ${model.id}.`);
}

const OUTCOME = {
  succeeded: "succeeded",
  "failed-charged": "failed",
  "failed-unconfirmed": "failed",
  "failed-confirmed-free": "failed",
  refused: "failed",
};

/**
 * Poll a job to a final state, download its results into the run and settle
 * its cost. Running out of time is a normal result ("pending"), never an
 * error: the job stays submitted and can be waited on again.
 */
export async function waitJob(catalog, store, id, { timeoutMs = 20 * 60_000, onTick, deps = {} } = {}) {
  const d = { ...REAL, ...deps };
  let job = store.get(id);
  if (!UNSETTLED.has(job.state)) return { outcome: OUTCOME[job.state], job, artifacts: job.artifacts ?? [] };
  if (!job.upstreamTaskId) {
    throw uncertain(uncertainMessage(job), null, { localJobId: job.id });
  }

  const prov = getProvider(catalog, job.provider);
  const key = providerKey(prov);
  const dir = runDir(job.run);

  let result;
  try {
    result = await d.waitForTask(prov, job.family, job.upstreamTaskId, { key, timeoutMs, onTick });
  } catch (err) {
    if (err.code === EXIT.UNCERTAIN) return { outcome: "pending", job, message: redact(err.message) };
    if (err.code !== EXIT.PROVIDER) throw err;
    const cost = taskCost(prov, err.data);
    const state = cost == null ? "failed-unconfirmed" : cost.usd === 0 ? "failed-confirmed-free" : "failed-charged";
    job = store.transition(job.id, state, {
      actualUsd: cost?.usd ?? null,
      costSource: cost ? "task-record" : "estimate",
      error: redact(err.message),
    });
    ledger.append(ledgerEntry(job, "provider-error"));
    await writeRecord(dir, "job.json", { ...job, raw: err.data ?? null });
    return { outcome: "failed", job, error: err };
  }

  const artifacts = [];
  for (const url of result.urls) {
    const { path } = nextArtifact(dir, job.artifactBase ?? "out", extFromUrl(url, ".bin"));
    await d.download(url, path);
    artifacts.push(path);
  }
  const cost = taskCost(prov, result.data);
  const after = await d.creditsAfter(prov, key);
  job = store.transition(job.id, "succeeded", {
    actualUsd: cost?.usd ?? null,
    costSource: cost ? "task-record" : "estimate",
    creditsAfter: after,
    artifacts,
    urls: result.urls,
    elapsedS: result.elapsedS,
  });
  ledger.append(ledgerEntry(job, "success"));
  await writeRecord(dir, "job.json", { ...job, raw: result.data });
  await writeRecord(dir, "cost.json", {
    localJobId: job.id,
    estimateUsd: job.estimateUsd,
    actualUsd: job.actualUsd,
    costSource: job.costSource,
    credits: cost?.credits ?? null,
    creditsBefore: job.creditsBefore,
    creditsAfter: after,
    note:
      job.costSource === "task-record"
        ? "actualUsd is the provider's own figure for this task."
        : "This provider reports no per-task cost; the estimate from cli/models.json stands.",
  });
  return { outcome: "succeeded", job, artifacts };
}
```

- [ ] **Step 4: Run the tests, then everything**

Run: `node --test tests/generate.test.mjs && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: PASS; `pass 199`, `fail 0` (12 new).

- [ ] **Step 5: Commit**

```bash
git add cli/core/generate.mjs tests/generate.test.mjs
git commit -m "Add submitJob and waitJob: reserve, submit and settle with a local id"
```

---

### Task 5: The CLI calls the core

**Files:**
- Modify: `cli/kie.mjs`, `cli/lib/ledger.mjs`

No new unit tests: the behaviour is covered by Task 4's tests. This task is wiring, checked by the existing suite plus the dry-run commands below (free).

- [ ] **Step 1: Imports and options**

Add to the imports in `cli/kie.mjs`:

```js
import { openJobs, resolveUncertain, uncertainMessage } from "./core/jobs.mjs";
import { readLimits, setDailyLimit, limitsPath, dailyPosition } from "./core/spend.mjs";
import { submitJob, waitJob } from "./core/generate.mjs";
```

Add `uncertain` and `provider as providerError` to the `./lib/errors.mjs` import if not already present.

In `OPTS`, add:

```js
  daily: { type: "string" },
  task: { type: "string" },
  "not-created": { type: "boolean", default: false },
```

- [ ] **Step 2: Replace `generate`**

Replace the whole `generate` function (from its doc comment `Shared submit -> poll -> download -> record path` to its closing brace) with:

```js
const onTick = (state, sec) => process.stderr.write(`\r  ${state} ${sec}s   `);

function costLine(job) {
  return job.costSource === "task-record"
    ? `cost: $${job.actualUsd.toFixed(2)} from the provider's task record (estimated $${job.estimateUsd.toFixed(2)})`
    : `cost: not reported by ${job.provider}; counted at the $${job.estimateUsd.toFixed(2)} estimate`;
}

/** Print a waitJob result, or throw the error its outcome calls for. */
function finishWait(w) {
  if (w.outcome === "succeeded") {
    for (const p of w.artifacts) say(`  → ${p}`);
    say(costLine(w.job));
    return EXIT.OK;
  }
  if (w.outcome === "pending") {
    throw uncertain(`${w.message}\n${uncertainMessage(w.job)}`, w.job.upstreamTaskId, { localJobId: w.job.id });
  }
  throw w.error ?? providerError(`Job ${w.job.id} ended ${w.job.state}: ${w.job.error ?? "no message"}`);
}

/**
 * Submit through the core, then wait unless --no-wait. A job that FAILS
 * upstream may fall over to the same model at the next reseller, as before;
 * an uncertain one never does.
 */
async function generate(catalog, { capability, model, values, args, artifactBase }) {
  warnIfStale(catalog);
  const store = openJobs();
  const limits = readLimits();
  const onEvent = (e) => (e.type === "submitted" ? say(e.message) : warn(`! ${e.message}`));
  const tried = [];

  for (;;) {
    const sub = await submitJob(
      catalog,
      {
        capability,
        model,
        values,
        run: args.run,
        artifactBase,
        budgetUsd: num(args.budget),
        only: args.provider,
        exclude: tried,
        dryRun: args["dry-run"],
      },
      { store, limits, onEvent },
    );

    if (sub.dryRun) {
      const pos = dailyPosition(store, limits);
      say(`dry run — nothing submitted.`);
      say(`  route:    ${sub.label}`);
      say(`  estimate: $${sub.estimateUsd.toFixed(2)} (${sub.basis}; job budget $${Number(sub.budgetUsd).toFixed(2)})`);
      say(`  today:    $${pos.availableUsd.toFixed(2)} of $${pos.capUsd.toFixed(2)} available`);
      say(`  body:     ${JSON.stringify(sub.input).slice(0, 600)}`);
      await writeRecord(runDir(args.run), "planned.json", {
        model: model.id,
        route: sub.route,
        input: sub.input,
        estimatedUsd: sub.estimateUsd,
        basis: sub.basis,
        allRoutes: sub.routes,
      });
      return EXIT.OK;
    }

    tried.push(...sub.attempts.map((a) => a.provider));
    if (args["no-wait"]) {
      say(`not waiting. Rejoin: kie job ${sub.job.id}`);
      return EXIT.OK;
    }

    const w = await waitJob(catalog, store, sub.job.id, { onTick });
    process.stderr.write("\n");
    if (w.outcome !== "failed") return finishWait(w);

    const more = routesFor(catalog, model, { only: args.provider }).some((r) => r.usable && !tried.includes(r.provider));
    if (!more || !canFailOver(w.error)) return finishWait(w);
    warn(`! ${w.job.error}`);
  }
}
```

Remove `warnIfUnverified` (its message is now an `onEvent` from the core) if nothing else uses it: `grep -n warnIfUnverified cli/kie.mjs` should print only its definition, which you delete.

- [ ] **Step 3: `kie job` takes a local id, and gains `resolve`**

Change the `case "job":` line in `main` to:

```js
    case "job":
      return cmdJob(catalog, args, positionals);
```

Replace the start of `cmdJob`:

```js
async function cmdJob(catalog, args, taskId) {
  if (!taskId) throw usage("kie job <taskId>");
```

with:

```js
async function cmdJob(catalog, args, positionals) {
  const [first, second] = positionals;
  if (first === "resolve") return cmdJobResolve(args, second);
  if (!first) throw usage("kie job <local job id>   (or a provider task id with --provider and --run)");
  if (first.startsWith("j-")) {
    const w = await waitJob(catalog, openJobs(), first, { onTick });
    process.stderr.write("\n");
    return finishWait(w);
  }
  // A provider task id from before local job ids existed, or from elsewhere.
  const taskId = first;
```

Leave the rest of `cmdJob` as it is, except replace its `onTick: (state, s) => process.stderr.write(...)` argument with `onTick`.

Add after `cmdJob`:

```js
function cmdJobResolve(args, id) {
  if (!id || Boolean(args.task) === Boolean(args["not-created"])) {
    throw usage("kie job resolve <local job id> (--task <provider task id> | --not-created)");
  }
  const job = resolveUncertain(openJobs(), id, { task: args.task, notCreated: args["not-created"] });
  say(
    job.state === "submitted"
      ? `${job.id} rejoined as task ${job.upstreamTaskId}. Wait for it with: kie job ${job.id}`
      : `${job.id} recorded as never created. Its $${job.estimateUsd.toFixed(2)} hold is released.`,
  );
  return EXIT.OK;
}
```

- [ ] **Step 4: `kie limits`**

Add after `cmdSpend`:

```js
function cmdLimits(args) {
  if (args.daily != null) {
    const next = setDailyLimit(args.daily);
    say(`daily cap set to $${next.dailyUsd.toFixed(2)}  (${limitsPath()})`);
  }
  const store = openJobs();
  store.sweep();
  const pos = dailyPosition(store, readLimits());
  if (args.json) return say(JSON.stringify(pos, null, 2));

  say(`daily cap:  $${pos.capUsd.toFixed(2)}`);
  say(`today:      $${pos.spentUsd.toFixed(2)} spent or held, $${pos.availableUsd.toFixed(2)} available`);
  if (pos.unsettled.length) {
    say(`\nunsettled jobs (each holds its estimate until settled)`);
    for (const j of pos.unsettled) {
      say(
        `  ${j.id}  ${j.state.padEnd(10)} ${j.model} via ${j.provider}  ` +
          `$${(j.estimateUsd ?? 0).toFixed(2)}  ${j.upstreamTaskId ?? "(no task id: kie job resolve)"}`,
      );
    }
  }
}
```

In `main`'s switch add:

```js
    case "limits":
      return cmdLimits(args) ?? EXIT.OK;
```

- [ ] **Step 5: Exit-5 hint, help text, preflight and spend**

In the final `.catch` of `main`, replace:

```js
      if (err.taskId) warn(`\nTask id: ${err.taskId}  →  kie job ${err.taskId}`);
```

with:

```js
      if (!err.localJobId && err.taskId) warn(`\nTask id: ${err.taskId}  →  kie job ${err.taskId}`);
```

(The core's own message already names the local id and the right next step.)

In `HELP`, replace the `kie job` line with:

```
  kie job        <local job id>            wait for a job and download it
  kie job resolve <local job id> (--task ID | --not-created)
                                           settle an uncertain job after checking the provider's log
  kie limits     [--daily USD] [--json]    the daily cap, today's spend and unsettled jobs
```

In `cmdPreflight`, after the `say(\`budget:  ...\`)` line add:

```js
  const pos = dailyPosition(openJobs(), readLimits());
  say(`today:   $${pos.availableUsd.toFixed(2)} of the $${pos.capUsd.toFixed(2)} daily cap available`);
```

and change its `affordable` filter so that it also respects the daily cap:

```js
  const affordable = priced.filter((r) => r.usable && r.estimate.usd <= cap && r.estimate.usd <= pos.availableUsd);
```

- [ ] **Step 6: `kie spend` shows measured cost (`cli/lib/ledger.mjs`)**

In `summarise`, before the `return`, add:

```js
  // Per-task figures from the provider's own record (kie's creditsConsumed).
  // Unlike balance deltas, these stay right when jobs overlap.
  const measured = entries.filter((e) => e.costSource === "task-record" && typeof e.actualUsd === "number");
  const actualUsd = Math.round(measured.reduce((s, e) => s + e.actualUsd, 0) * 100) / 100;
```

and add to the returned object:

```js
    actualUsd: measured.length ? actualUsd : null,
    actualSamples: measured.length,
```

In `cmdSpend` in `cli/kie.mjs`, after the `estimated:` line add:

```js
  if (s.actualUsd != null) say(`actual:         $${s.actualUsd.toFixed(2)}   (from ${s.actualSamples} task record(s) — a fact)`);
```

- [ ] **Step 7: Check by hand, spending nothing**

Run each and compare:

```bash
node --check cli/kie.mjs
KIE_LIMITS_FILE=/tmp/kie-limits-check.json node cli/kie.mjs limits
KIE_LIMITS_FILE=/tmp/kie-limits-check.json node cli/kie.mjs limits --daily 4
node cli/kie.mjs video --run plan2-check --model seedance-2-5 --prompt-file README.md --duration 4 --resolution 480p --provider kie --dry-run
node cli/kie.mjs job resolve j-20261030-abcdef; echo "exit $?"
node cli/kie.mjs job resolve j-20261030-abcdef --task x; echo "exit $?"
```

Expected:
1. no output (syntax ok);
2. `daily cap:  $10.00` and `today:` lines;
3. `daily cap set to $4.00`;
4. `dry run — nothing submitted.`, an estimate of `$0.56 (4s × $0.14/s at 480p ...)` and a `today:` line;
5. the resolve usage line and `exit 1`;
6. `No local job j-20261030-abcdef` and `exit 3`.

Then: `rm -rf runs/plan2-check /tmp/kie-limits-check.json`

- [ ] **Step 8: Run everything**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `pass 199`, `fail 0`.

- [ ] **Step 9: Commit**

```bash
git add cli/kie.mjs cli/lib/ledger.mjs
git commit -m "Route kie video/image/audio through the core; add kie limits and kie job resolve"
```

---

### Task 6: Documentation

**Files:**
- Modify: `cli/README.md`, `skills/motion-design/references/tool-routing.md`, and any other file under `skills/` that tells the reader to rejoin with `kie job <taskId>`

- [ ] **Step 1: Find every rejoin instruction**

Run: `grep -rn "kie job" skills/ cli/README.md README.md`
Each instruction to rejoin with a provider task id becomes `kie job <local job id>` (the `j-...` id the CLI prints). Keep any text that explains *why* an uncertain job must not be resubmitted; it still holds.

- [ ] **Step 2: `cli/README.md`**: add a section after the exit-code table:

```markdown
### Job records and the daily cap

Every paid job gets a local id (`j-20261030-a1b2c3`) written to
`runs/.jobs/` before anything is sent. `kie job <id>` waits for it and
downloads the result; `--no-wait` prints the id to come back with.

A daily cap in dollars (default $10) is checked before each submission:
`kie limits` shows the cap, today's spend and any unsettled jobs, and
`kie limits --daily 25` changes it. Jobs in flight hold their estimate
against the cap until they settle. A job that fails with kie reporting 0
credits releases its hold; one with no cost report keeps it.

Cost is read from kie's task record (`creditsConsumed`), so `kie spend`
reports an actual figure per job. WaveSpeed reports none, so its jobs
count at the estimate.

When a submission ends uncertain without a task id, the job may exist.
Do not resubmit. Check the provider's task log, then record what you found:
`kie job resolve <id> --task <task id>` or `kie job resolve <id> --not-created`.
```

- [ ] **Step 3: `tool-routing.md`**: add rows to the task table:

```markdown
| See today's spend against the cap, and unsettled jobs | `kie limits` |
| Wait for a job submitted with `--no-wait`, or rejoin after exit 5 | `kie job <local job id>` |
```

- [ ] **Step 4: Validate and test**

Run: `npm run validate 2>&1 | tail -3 && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: validator success; `pass 199`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add cli/README.md skills/ README.md
git commit -m "Document job ids, the daily cap and kie job resolve"
```

---

### Task 7: Record the spec deviation

**Files:** Modify `docs/superpowers/specs/2026-10-30-mcp-server-design.md`

- [ ] **Step 1:** In the jobs table, add after the `failed-unconfirmed` row:

```markdown
| `failed-charged` | failed, and the task record reports a charge | actual cost |
```

- [ ] **Step 2:** Append to the revision log:

```markdown
- 2026-10-30, while planning step 3: added `failed-charged`, because a failed task whose record reports credits consumed is neither free nor unconfirmed. A create the provider rejects outright is `failed-confirmed-free`, matching the existing failover rule. A budget or cap refusal writes no job record. Finishing functions stay in `cli/lib/` rather than moving to `core/finish.mjs`; the MCP server calls them directly.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-30-mcp-server-design.md
git commit -m "Record plan 2's refinements in the MCP server spec"
```

---

## Done when

- `npm test` passes: 199 tests, 47 of them new.
- `kie limits` shows the cap and today's position; `kie limits --daily N` changes it.
- A dry run shows the per-second estimate and today's available amount.
- Nothing was spent: every provider call in the new tests is a stub, and the hand checks are dry runs or local reads.
