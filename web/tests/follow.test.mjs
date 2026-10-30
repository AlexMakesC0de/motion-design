import { RUNS, generateStubs } from "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const { createFollower } = await import("../server/follow.mjs");
const { openJobs } = await import("../../cli/core/jobs.mjs");
const { loadCatalog } = await import("../../cli/lib/models.mjs");
const { uncertain } = await import("../../cli/lib/errors.mjs");

const catalog = loadCatalog();
const store = openJobs(join(RUNS, ".jobs"));

/** A job record as submitJob leaves it: submitted, with an upstream id. */
function submittedJob(run = "follow-demo") {
  mkdirSync(join(RUNS, run), { recursive: true });
  let j = store.create({
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
});
