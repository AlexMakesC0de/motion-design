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
const { readLimits, setDailyLimit, setPerJobLimit, spentToday, dailyPosition, withSpendLock, reserve, LOCK_PATH } =
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

  test("an empty or blank cap is refused, not read as 0", () => {
    const path = join(mkdtempSync(join(tmpdir(), "kie-lim-")), "limits.json");
    assert.throws(() => setDailyLimit("", path), { code: EXIT.USAGE });
    assert.throws(() => setDailyLimit("   ", path), { code: EXIT.USAGE });
    assert.deepEqual(readLimits(path), { dailyUsd: 10, allowRoots: [] }, "nothing was written");
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

describe("per-job ceiling", () => {
  const limitsFile = () => join(mkdtempSync(join(tmpdir(), "kie-lim-")), "limits.json");

  test("absent by default, so existing limits files keep their meaning", () => {
    assert.equal(readLimits(join(RUNS, "absent.json")).perJobUsd, undefined);
  });

  test("setPerJobLimit writes a ceiling and keeps the other settings; off removes it", () => {
    const path = limitsFile();
    writeFileSync(path, JSON.stringify({ dailyUsd: 7, allowRoots: [] }));
    assert.equal(setPerJobLimit("2", path).perJobUsd, 2);
    assert.deepEqual(readLimits(path), { dailyUsd: 7, allowRoots: [], perJobUsd: 2 });
    setPerJobLimit("off", path);
    assert.deepEqual(readLimits(path), { dailyUsd: 7, allowRoots: [] });
  });

  test("a zero, negative, blank or non-numeric ceiling is refused", () => {
    for (const bad of ["0", "-1", "", "  ", "lots"]) {
      assert.throws(() => setPerJobLimit(bad, limitsFile()), { code: EXIT.USAGE }, bad);
    }
  });

  test("a limits file with a bad perJobUsd is an error", () => {
    const path = limitsFile();
    writeFileSync(path, JSON.stringify({ perJobUsd: "two" }));
    assert.throws(() => readLimits(path), /perJobUsd/);
  });

  test("reserve refuses a job above the ceiling whatever budget the caller chose, and writes nothing", async () => {
    const store = fresh();
    await assert.rejects(
      reserve(store, { run: "demo", estimateUsd: 2.5 }, { limits: { dailyUsd: 10, allowRoots: [], perJobUsd: 2 } }),
      (e) => e.code === EXIT.BUDGET && /per-job limit/.test(e.message) && /kie limits --per-job/.test(e.message),
    );
    assert.deepEqual(store.list(), []);
  });

  test("reserve allows a job at or under the ceiling", async () => {
    const store = fresh();
    const job = await reserve(store, { run: "demo", estimateUsd: 2 }, { limits: { dailyUsd: 10, allowRoots: [], perJobUsd: 2 } });
    assert.equal(job.state, "reserved");
  });
});
