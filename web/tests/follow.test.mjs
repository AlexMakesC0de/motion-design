import { KEY, RUNS, tmp, req, generateStubs } from "./helpers.mjs";
import { after, test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// The studio's timers are unref()ed so they never keep it running. Node 22's test
// runner then ends a test that is waiting on one; this interval holds the file open.
const keepAlive = setInterval(() => {}, 60_000);
after(() => clearInterval(keepAlive));

const { createFollower } = await import("../server/follow.mjs");
const { createApp } = await import("../server/app.mjs");
const { openJobs } = await import("../../cli/core/jobs.mjs");
const { loadCatalog } = await import("../../cli/lib/models.mjs");
const { uncertain } = await import("../../cli/lib/errors.mjs");

const catalog = loadCatalog();
const store = openJobs(join(RUNS, ".jobs"));

/** A job record as submitJob leaves it: submitted, with an upstream id. */
function submittedJob(run = "follow-demo", extra = {}) {
  mkdirSync(join(RUNS, run), { recursive: true });
  let j = store.create({
    ...extra,
    run,
    capability: "video",
    model: "seedance-2-5",
    provider: "kie",
    family: "jobs",
    providerModel: "bytedance/seedance-2-5",
    artifactBase: "out",
    estimateUsd: 0.56,
    input: { prompt: "A fox", duration: 4, resolution: "480p" },
  });
  j = store.transition(j.id, "sending");
  return store.transition(j.id, "submitted", { upstreamTaskId: "task-9" });
}

describe("createFollower", () => {
  test("a followed job settles in the background, then is let go", async () => {
    const { calls, deps } = generateStubs();
    const f = createFollower({ catalog, deps });
    const job = submittedJob();
    f.follow(job.id);
    assert.equal(f.has(job.id), true);
    await f.idle();
    const done = store.get(job.id);
    assert.equal(done.state, "succeeded");
    assert.equal(done.artifacts.length, 1);
    assert.equal(calls.download, 1);
    assert.equal(f.has(job.id), false);
  });

  test("following the same job twice waits on it once", async () => {
    const { calls, deps } = generateStubs();
    const f = createFollower({ catalog, deps });
    const job = submittedJob();
    f.follow(job.id);
    f.follow(job.id);
    await f.idle();
    assert.equal(calls.wait, 1);
  });

  test("a job still running is waited on again, up to the round limit, and stays submitted", async () => {
    const { deps } = generateStubs();
    let waits = 0;
    deps.generate.waitForTask = async () => {
      waits += 1;
      throw uncertain("still running", "task-9", { timedOut: true });
    };
    const f = createFollower({ catalog, deps, rounds: 2 });
    const job = submittedJob();
    assert.equal(await f.follow(job.id), "pending");
    assert.equal(waits, 2);
    assert.equal(store.get(job.id).state, "submitted");
  });

  test("an unexpected error is logged with secrets redacted, and the job is let go unchanged", async () => {
    const { deps } = generateStubs();
    deps.generate.waitForTask = async () => {
      throw new Error("boom sk-abcdefghijklmnopqrstuvwxyz0123");
    };
    const lines = [];
    const f = createFollower({ catalog, deps, log: (m) => lines.push(m) });
    const job = submittedJob();
    assert.equal(await f.follow(job.id), "error");
    assert.match(lines.join(""), /boom/);
    assert.doesNotMatch(lines.join(""), /sk-abcdefghijklmnopqrstuvwxyz0123/);
    assert.equal(f.has(job.id), false);
    assert.equal(store.get(job.id).state, "submitted");
  });

  test("rounds that end at once (a failed download) are spaced out by a growing backoff", async () => {
    const { deps } = generateStubs();
    deps.generate.download = async () => {
      throw new Error("Download failed (503)");
    };
    const slept = [];
    const f = createFollower({ catalog, deps, rounds: 3, backoffMs: 1000, sleep: async (ms) => slept.push(ms) });
    const job = submittedJob();
    assert.equal(await f.follow(job.id), "pending");
    assert.deepEqual(slept, [1000, 2000], "a pause between rounds, none after the last");
    assert.equal(store.get(job.id).state, "submitted");
  });

  test("tells its listener when a job starts and stops being followed", async () => {
    const { deps } = generateStubs();
    const seen = [];
    const f = createFollower({ catalog, deps, onChange: (id) => seen.push([id, f.has(id)]) });
    const job = submittedJob();
    await f.follow(job.id);
    assert.deepEqual(seen, [[job.id, true], [job.id, false]]);
  });

  test("resume follows the unsettled jobs this studio submitted, and nothing else", async () => {
    const { deps } = generateStubs();
    const make = (extra, state = "submitted") => {
      let j = store.create({ run: "follow-resume", capability: "video", model: "seedance-2-5", provider: "kie", family: "jobs", providerModel: "bytedance/seedance-2-5", artifactBase: "out", estimateUsd: 0.56, input: { prompt: "x", duration: 4 }, ...extra });
      j = store.transition(j.id, "sending");
      return store.transition(j.id, state, { upstreamTaskId: state === "uncertain" ? null : "task-r" });
    };
    const ours = make({ via: "studio" });
    const cli = make({});
    const noTask = make({ via: "studio" }, "uncertain");
    const f = createFollower({ catalog, deps, sleep: async () => {} });
    const resumed = f.resume(store);
    assert.deepEqual(resumed, [ours.id]);
    assert.equal(f.has(ours.id), true);
    assert.equal(f.has(cli.id), false);
    assert.equal(f.has(noTask.id), false);
    await f.idle();
    assert.equal(store.get(ours.id).state, "succeeded");
    assert.equal(store.get(cli.id).state, "submitted");
  });
});

describe("the studio at start", () => {
  test("createApp({ resume: true }) picks up a studio job left submitted by a previous run, and the page sees it followed", async () => {
    const { deps } = generateStubs();
    const job = submittedJob("follow-restart", { via: "studio" });
    const app = createApp({ key: KEY, deps, distDir: join(tmp, "nodist"), pollMs: 60_000, resume: true });
    await new Promise((r) => app.listen(0, "127.0.0.1", r));
    try {
      assert.equal(app.follower.has(job.id), true);
      const seen = (await req(app.address().port, "/api/jobs?run=follow-restart")).json[0];
      assert.equal(seen.following, true);
      await app.follower.idle();
      assert.equal(store.get(job.id).state, "succeeded");
      const after = (await req(app.address().port, "/api/jobs?run=follow-restart")).json[0];
      assert.equal(after.following, false);
    } finally {
      await app.closeAll();
    }
  });
});
