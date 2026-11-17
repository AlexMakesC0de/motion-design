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
    assert.equal(v.following, false, "nobody follows a job unless a predicate says so");
  });

  test("picks and the typed prompt come from the job record; null when there are none", () => {
    const store = openJobs(join(RUNS, ".jobs"));
    const base = { run: "zed", capability: "video", model: "seedance-2", provider: "kie", estimateUsd: 1 };
    const withPicks = store.create({ ...base, picks: { lens: "85mm" }, typedPrompt: "A fox." });
    const v = jobView(withPicks);
    assert.deepEqual(v.picks, { lens: "85mm" });
    assert.equal(v.typedPrompt, "A fox.");
    const plain = jobView(store.create(base));
    assert.equal(plain.picks, null);
    assert.equal(plain.typedPrompt, null);
  });

  test("following comes from the predicate it is given", () => {
    const store = openJobs(join(RUNS, ".jobs"));
    const job = store.create({ run: "zed", capability: "video", model: "seedance-2", provider: "kie", estimateUsd: 1 });
    assert.equal(jobView(job, (id) => id === job.id).following, true);
    assert.equal(jobView(job, () => false).following, false);
  });

  test("carries the job's local day, and core's uncertain message only for an uncertain job", () => {
    const store = openJobs(join(RUNS, ".jobs"));
    const job = store.create({ run: "zed", capability: "video", model: "seedance-2", provider: "kie", estimateUsd: 1 });
    assert.equal(jobView(job).day, job.day);
    assert.equal(jobView(job).uncertainMessage, null);
    const lost = { ...job, state: "uncertain", upstreamTaskId: null };
    assert.match(jobView(lost).uncertainMessage, new RegExp(`kie job resolve ${job.id} --not-created`));
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

  test("14 distinct consecutive calendar days ending today, across the fall-back change", () => {
    const store = openJobs(join(RUNS, ".jobs"));
    // 23:30 on 2026-10-31 in Amsterdam; the window crosses the 2026-10-25 clock change.
    const now = new Date("2026-10-31T22:30:00Z");
    const v = spendView(store, { dailyUsd: 10, allowRoots: [] }, now, "Europe/Amsterdam");
    const days = v.days.map((d) => d.day);
    assert.equal(new Set(days).size, 14);
    assert.equal(days.at(-1), "2026-10-31");
    assert.equal(days[0], "2026-10-18");
    for (let i = 1; i < days.length; i++) {
      assert.equal(Date.parse(`${days[i]}T00:00:00Z`) - Date.parse(`${days[i - 1]}T00:00:00Z`), 86_400_000, `${days[i - 1]} then ${days[i]}`);
    }
  });

  test("the same holds across the spring-forward change", () => {
    const store = openJobs(join(RUNS, ".jobs"));
    const now = new Date("2026-04-02T00:30:00Z"); // 02:30 on 2026-04-02 in Amsterdam
    const days = spendView(store, { dailyUsd: 10, allowRoots: [] }, now, "Europe/Amsterdam").days.map((d) => d.day);
    assert.equal(new Set(days).size, 14);
    assert.equal(days.at(-1), "2026-04-02");
    assert.equal(days[0], "2026-03-20");
  });
});
