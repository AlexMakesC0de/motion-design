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

  test("a record another process settles mid-sweep is skipped, not an error", () => {
    let now = old;
    const dir = mkdtempSync(join(tmpdir(), "kie-store-"));
    const store = openJobs(dir, { now: () => now, pid: deadPid() });
    const other = openJobs(dir, { now: () => now });
    const { id } = store.create({ estimateUsd: 1 });
    now = later;
    // sweep has already listed the stale record when it asks whether its owner
    // is alive, so settling it from here lands between the list and the move.
    const changed = store.sweep({
      isAlive: () => (other.transition(id, "refused", { reason: "settled elsewhere" }), false),
    });
    assert.deepEqual(changed, []);
    assert.equal(store.get(id).state, "refused");
    assert.equal(store.get(id).reason, "settled elsewhere");
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
