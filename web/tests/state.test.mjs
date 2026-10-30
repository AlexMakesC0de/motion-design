import { RUNS } from "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

const { context, jobView, spendView } = await import("../server/state.mjs");
const { openJobs } = await import("../../cli/core/jobs.mjs");

describe("context", () => {
  test("reads limits, opens the job store and library per call", () => {
    const c = context();
    assert.equal(c.limits.dailyUsd, 10);
    assert.deepEqual(c.store.list(), []);
    assert.deepEqual(c.library.list(), []);
    assert.ok(c.roots.length >= 2);
  });
});

describe("jobView", () => {
  test("adds what a take tile shows, and media URLs for artifacts", () => {
    const store = openJobs(join(RUNS, ".jobs"));
    const job = store.create({
      run: "zed",
      capability: "video",
      model: "seedance-2",
      provider: "kie",
      providerModel: "bytedance/seedance-2",
      estimateUsd: 1.03,
      input: { prompt: "Slow push-in", duration: 5, resolution: "720p", aspect_ratio: "16:9" },
      failedOver: false,
    });
    const v = jobView({ ...job, artifacts: [join(RUNS, "zed", "out.mp4")] });
    assert.equal(v.id, job.id);
    assert.equal(v.prompt, "Slow push-in");
    assert.equal(v.durationS, 5);
    assert.equal(v.resolution, "720p");
    assert.equal(v.aspectRatio, "16:9");
    assert.deepEqual(v.media, ["/media/runs/zed/out.mp4"]);
    assert.equal(v.countedUsd, 1.03);
    assert.ok(!("input" in v), "the raw provider input is not sent to the page");
  });
});

describe("spendView", () => {
  test("today's position, the ceiling and 14 days of totals", () => {
    const store = openJobs(join(RUNS, ".jobs"));
    const v = spendView(store, { dailyUsd: 10, allowRoots: [], perJobUsd: 2 });
    assert.equal(v.capUsd, 10);
    assert.equal(v.perJobUsd, 2);
    assert.equal(v.days.length, 14);
    assert.equal(v.days.at(-1).usd, v.spentUsd);
    assert.ok(v.days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day)));
  });
});
