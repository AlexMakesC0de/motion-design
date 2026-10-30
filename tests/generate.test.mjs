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
const { submitJob, waitJob, shouldFailOver } = await import("../cli/core/generate.mjs");

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

  test("a task that succeeded with no artifact URL is charged and recorded, never failed or resubmitted", async () => {
    const s = store();
    let creates = 0;
    const sub = await submitJob(catalog, request({ only: "kie" }), {
      store: s,
      limits: LIMITS,
      deps: { preflight, createTask: async () => (creates++, { taskId: "t-nourl" }) },
    });
    const data = { state: "success", creditsConsumed: 112 };
    const w = await waitJob(catalog, s, sub.job.id, {
      deps: { waitForTask: async () => { throw provider("task succeeded but no artifact URL was found", { data, succeededWithoutUrl: true }); } },
    });
    assert.equal(w.outcome, "no-artifact");
    assert.equal(w.job.state, "succeeded");
    assert.deepEqual(w.job.artifacts, []);
    assert.equal(w.job.actualUsd, 0.56);
    assert.match(w.message, /charged/);
    assert.match(w.message, /must not be resubmitted|not resubmit|Do not resubmit/i);
    assert.equal(creates, 1);
    const recorded = JSON.parse(readFileSync(join(RUNS, "gen-test", "job.json"), "utf8"));
    assert.deepEqual(recorded.raw, data);
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

describe("shouldFailOver", () => {
  const w = (outcome, state) => ({ outcome, job: { state } });

  test("only a failure confirmed free may be retried on another reseller", () => {
    assert.equal(shouldFailOver(w("failed", "failed-confirmed-free")), true);
  });

  test("a failure that may have been charged, or any other result, is never failed over", () => {
    assert.equal(shouldFailOver(w("failed", "failed-charged")), false);
    assert.equal(shouldFailOver(w("failed", "failed-unconfirmed")), false);
    assert.equal(shouldFailOver(w("succeeded", "succeeded")), false);
    assert.equal(shouldFailOver(w("pending", "submitted")), false);
  });
});
