import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync, symlinkSync, lstatSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RUNS = mkdtempSync(join(tmpdir(), "kie-spend-"));
process.env.KIE_RUNS_DIR = RUNS;
process.env.KIE_LIMITS_FILE = join(RUNS, "limits.json");
// Only makes the route usable; the provider call below is a stub.
process.env.KIE_API_KEY = "test-kie";

const { EXIT } = await import("../cli/lib/errors.mjs");
const { openJobs } = await import("../cli/core/jobs.mjs");
const { readLimits, setDailyLimit, setPerJobLimit, setLimits, spentToday, dailyPosition, withSpendLock, reserve, LOCK_PATH } =
  await import("../cli/core/spend.mjs");

const { loadCatalog, resolveModel } = await import("../cli/lib/models.mjs");
const { submitJob } = await import("../cli/core/generate.mjs");

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

  test("a write replaces limits.json by rename, so a crash mid-write never leaves half a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "kie-lim-"));
    const path = join(dir, "limits.json");
    writeFileSync(path, JSON.stringify({ dailyUsd: 10, allowRoots: [] }));
    const kept = join(dir, "old-copy.json");
    linkSync(path, kept); // a second name for the file as it was: an in-place write would change it too
    const inode = statSync(path).ino;
    setDailyLimit("4", path);
    assert.notEqual(statSync(path).ino, inode, "the new content is a new file renamed into place");
    assert.deepEqual(JSON.parse(readFileSync(kept, "utf8")), { dailyUsd: 10, allowRoots: [] }, "the old file was never written into");
    setPerJobLimit("2", path);
    setLimits({ dailyUsd: 3, perJobUsd: 1 }, path);
    assert.deepEqual(readdirSync(dir).sort(), ["limits.json", "old-copy.json"], "no temp file is left beside it");
  });

  test("a limits.json that is a symlink stays one, and its target is what changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "kie-lim-"));
    const target = join(dir, "dotfiles-limits.json");
    const path = join(dir, "limits.json");
    writeFileSync(target, JSON.stringify({ dailyUsd: 10, allowRoots: [] }));
    symlinkSync(target, path);
    setDailyLimit("6", path);
    assert.ok(lstatSync(path).isSymbolicLink());
    assert.equal(readLimits(target).dailyUsd, 6);
  });

  test("setLimits writes both limits in one write and keeps the other settings", () => {
    const dir = mkdtempSync(join(tmpdir(), "kie-lim-"));
    const path = join(dir, "limits.json");
    writeFileSync(path, JSON.stringify({ dailyUsd: 10, allowRoots: ["/Users/a/brand"], perJobUsd: 3 }));
    const first = statSync(path).ino;
    const next = setLimits({ dailyUsd: 4.5, perJobUsd: 1.25 }, path);
    assert.deepEqual(next, { dailyUsd: 4.5, allowRoots: ["/Users/a/brand"], perJobUsd: 1.25 });
    assert.deepEqual(readLimits(path), next);
    const afterOne = statSync(path).ino;
    assert.notEqual(afterOne, first);
    assert.deepEqual(setLimits({ dailyUsd: 0, perJobUsd: null }, path), { dailyUsd: 0, allowRoots: ["/Users/a/brand"] }, "null removes the per-job limit; a cap of 0 is allowed");
    assert.deepEqual(readLimits(path), { dailyUsd: 0, allowRoots: ["/Users/a/brand"] });
    assert.deepEqual(setLimits({ dailyUsd: 2, perJobUsd: "off" }, path), { dailyUsd: 2, allowRoots: ["/Users/a/brand"] }, "off means none, as for setPerJobLimit");
  });

  test("setLimits refuses what the two setters refuse, with their messages, and writes nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "kie-lim-"));
    const path = join(dir, "limits.json");
    writeFileSync(path, JSON.stringify({ dailyUsd: 7, allowRoots: [] }));
    const before = readFileSync(path, "utf8");
    for (const bad of ["-1", "lots", "", "  ", NaN, undefined]) {
      const viaSetter = (() => { try { setDailyLimit(bad, path); } catch (e) { return e; } })();
      assert.throws(() => setLimits({ dailyUsd: bad, perJobUsd: null }, path), { code: EXIT.USAGE, message: viaSetter.message }, String(bad));
    }
    for (const bad of ["0", "-1", "", "  ", "lots", NaN]) {
      const viaSetter = (() => { try { setPerJobLimit(bad, path); } catch (e) { return e; } })();
      assert.throws(() => setLimits({ dailyUsd: 5, perJobUsd: bad }, path), { code: EXIT.USAGE, message: viaSetter.message }, String(bad));
    }
    assert.equal(readFileSync(path, "utf8"), before, "a refused value leaves the file as it was, even when the other value was fine");
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

  test("a claim runs under the lock, sees the records before it, and can refuse; a refusal writes nothing", async () => {
    const store = fresh();
    const limits = { dailyUsd: 10, allowRoots: [] };
    const claim = (s) => {
      assert.ok(existsSync(LOCK_PATH), "the spend lock is held");
      if (s.list().some((j) => j.shot === "s1")) throw new Error("s1 is taken");
    };
    await reserve(store, { shot: "s1", estimateUsd: 1 }, { limits, claim });
    await assert.rejects(reserve(store, { shot: "s1", estimateUsd: 1 }, { limits, claim }), /s1 is taken/);
    assert.equal(store.list().length, 1);
    assert.equal(existsSync(LOCK_PATH), false, "released after a refusal");
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

  test("reserve refuses a job above the ceiling and writes nothing", async () => {
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

  test("submitJob refuses above the ceiling even when the caller passes a bigger budgetUsd, and never calls the provider", async () => {
    const catalog = loadCatalog();
    const store = fresh();
    const created = [];
    await assert.rejects(
      submitJob(
        catalog,
        {
          capability: "video",
          model: resolveModel(catalog, "seedance-2-5", "video"),
          values: { prompt: "a fox", duration: 4, resolution: "480p", aspect_ratio: "16:9" },
          run: "spend-test",
          artifactBase: "out",
          budgetUsd: 100,
          only: "kie",
        },
        {
          store,
          limits: { dailyUsd: 10, allowRoots: [], perJobUsd: 0.1 },
          deps: {
            preflight: async () => ({ estimatedUsd: 0.5, basis: "stub", cap: 100, creditsBefore: null }),
            createTask: async (...args) => (created.push(args), { taskId: "t-never" }),
          },
        },
      ),
      (e) => e.code === EXIT.BUDGET && /per-job limit/.test(e.message),
    );
    assert.equal(created.length, 0, "createTask was never called");
    assert.deepEqual(store.list(), []);
  });
});
