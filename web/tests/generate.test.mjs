import { KEY, RUNS, tmp, req, generateStubs } from "./helpers.mjs";
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// WaveSpeed routes are usable only with a key; this one is fake, and every provider call is a stub.
process.env.WAVESPEED_API_KEY = "test-ws-key-not-real";

const { createApp } = await import("../server/app.mjs");
const { openJobs } = await import("../../cli/core/jobs.mjs");
const { provider } = await import("../../cli/lib/errors.mjs");

const { calls, generate, deps } = generateStubs();
const realCreate = generate.createTask;
const store = openJobs(join(RUNS, ".jobs"));
const LIMITS = process.env.KIE_LIMITS_FILE;
const video = { run: "gen-web", prompt: "A fox runs through snow.", model: "seedance-2-5", duration_s: 4, resolution: "480p", aspect_ratio: "16:9" };
const post = (path, body) => req(port, path, { method: "POST", body });

let app, port;
before(async () => {
  app = createApp({ key: KEY, deps, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());
beforeEach(() => {
  generate.createTask = realCreate;
  rmSync(LIMITS, { force: true });
});

describe("POST /api/generate/video", () => {
  test("submits once through core, answers at once with the local job id, then the follower finishes the take", async () => {
    const sent = calls.create.length;
    const r = await post("/api/generate/video", { ...video, provider: "kie" });
    assert.equal(r.status, 200, r.text);
    assert.match(r.json.localJobId, /^j-\d{8}-[0-9a-f]{6}$/);
    assert.equal(r.json.state, "submitted");
    assert.equal(r.json.provider, "kie");
    assert.equal(r.json.job.durationS, 4);
    assert.equal(calls.create.length, sent + 1);
    assert.equal(readFileSync(join(RUNS, "gen-web", "prompt.txt"), "utf8"), video.prompt);
    assert.equal(JSON.parse(readFileSync(join(RUNS, "gen-web", "inputs.json"), "utf8")).via, "studio");

    await app.follower.idle();
    const job = (await req(port, "/api/jobs?run=gen-web")).json.find((j) => j.id === r.json.localJobId);
    assert.equal(job.state, "succeeded");
    assert.equal(job.media.length, 1);
    assert.match(job.media[0], /^\/media\/runs\/gen-web\/out/);
  });

  test("picks are worded after the typed prompt, sent, and recorded with what was typed", async () => {
    const picks = { move: "push-in", speed: "slow", lens: "85mm" };
    const r = await post("/api/generate/video", { ...video, run: "gen-picks", provider: "kie", picks });
    assert.equal(r.status, 200, r.text);
    const sent = `${video.prompt}\n\nCamera: The camera slowly pushes in.\n85mm portrait lens.`;
    assert.equal(calls.create.at(-1).input.prompt, sent);
    assert.equal(readFileSync(join(RUNS, "gen-picks", "prompt.txt"), "utf8"), sent);
    const inputs = JSON.parse(readFileSync(join(RUNS, "gen-picks", "inputs.json"), "utf8"));
    assert.deepEqual(inputs.picks, picks);
    assert.equal(inputs.typedPrompt, video.prompt);
    assert.deepEqual(r.json.job.picks, picks);
    assert.equal(r.json.job.typedPrompt, video.prompt);
    assert.equal(r.json.job.prompt, sent);
    await app.follower.idle();
    const plain = await post("/api/generate/video", { ...video, run: "gen-nopicks", provider: "kie" });
    assert.equal(plain.json.job.picks, null);
    assert.equal(plain.json.job.typedPrompt, null);
    assert.equal(JSON.parse(readFileSync(join(RUNS, "gen-nopicks", "inputs.json"), "utf8")).picks, undefined);
    await app.follower.idle();
  });

  test("an unknown pick id is refused with nothing sent or written", async () => {
    const sent = calls.create.length;
    const jobs = store.list().length;
    const r = await post("/api/generate/video", { ...video, run: "gen-badpick", picks: { light: "moonbeam" } });
    assert.equal(r.status, 400, r.text);
    assert.match(r.json.error.message, /not on the director's lights menu/);
    assert.equal(calls.create.length, sent);
    assert.equal(store.list().length, jobs);
    assert.equal(existsSync(join(RUNS, "gen-badpick", "prompt.txt")), false);
  });

  test("picks that push the prompt past the model's limit are refused before anything is spent", async () => {
    const sent = calls.create.length;
    const r = await post("/api/generate/video", { ...video, run: "gen-long", prompt: "x".repeat(5990), picks: { lens: "85mm" } });
    assert.equal(r.status, 400, r.text);
    assert.match(r.json.error.message, /^Refused before submitting, nothing was spent\. With the picks the prompt is \d+ characters; seedance-2-5 follows at most 6000\./);
    assert.equal(r.json.error.field, "prompt");
    assert.equal(calls.create.length, sent);
  });

  test("the answer marks the new job as followed; once settled it is not", async () => {
    const r = await post("/api/generate/video", { ...video, run: "gen-follow", provider: "kie" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.job.following, true);
    await app.follower.idle();
    const [job] = (await req(port, "/api/jobs?run=gen-follow")).json;
    assert.equal(job.following, false);
  });

  test("a refused attempt leaves the earlier take's prompt and inputs alone", async () => {
    const first = await post("/api/generate/video", { ...video, run: "gen-keep", provider: "kie", prompt: "Take one." });
    assert.equal(first.status, 200, first.text);
    await app.follower.idle();
    writeFileSync(LIMITS, JSON.stringify({ dailyUsd: 0.1 }));
    const r = await post("/api/generate/video", { ...video, run: "gen-keep", provider: "kie", prompt: "Take two.", duration_s: 8 });
    assert.equal(r.status, 402);
    assert.equal(readFileSync(join(RUNS, "gen-keep", "prompt.txt"), "utf8"), "Take one.");
    assert.equal(JSON.parse(readFileSync(join(RUNS, "gen-keep", "inputs.json"), "utf8")).durationS, 4);
  });

  test("an ambiguous create still records the prompt it sent, since a take may yet arrive", async () => {
    generate.createTask = async () => {
      throw new Error("socket hang up");
    };
    const r = await post("/api/generate/video", { ...video, run: "gen-maybe", prompt: "Maybe a take." });
    assert.equal(r.status, 409);
    assert.equal(readFileSync(join(RUNS, "gen-maybe", "prompt.txt"), "utf8"), "Maybe a take.");
  });

  test("over the per-job limit: 402, code 2, nothing sent, no job written", async () => {
    writeFileSync(LIMITS, JSON.stringify({ dailyUsd: 10, perJobUsd: 0.5 }));
    const sent = calls.create.length;
    const jobs = store.list().length;
    const r = await post("/api/generate/video", video);
    assert.equal(r.status, 402);
    assert.equal(r.json.error.code, 2);
    assert.match(r.json.error.message, /per-job limit/);
    assert.equal(r.json.error.perJobUsd, 0.5);
    assert.equal(calls.create.length, sent);
    assert.equal(store.list().length, jobs);
  });

  test("over today's cap: 402, code 2, nothing sent, no job written", async () => {
    writeFileSync(LIMITS, JSON.stringify({ dailyUsd: 0.1 }));
    const sent = calls.create.length;
    const jobs = store.list().length;
    const r = await post("/api/generate/video", video);
    assert.equal(r.status, 402);
    assert.equal(r.json.error.code, 2);
    assert.match(r.json.error.message, /today's \$0\.10 cap/);
    assert.equal(calls.create.length, sent);
    assert.equal(store.list().length, jobs);
  });

  test("a duration the model does not take: 400, code 3, the field named, nothing sent", async () => {
    const sent = calls.create.length;
    const r = await post("/api/generate/video", { ...video, duration_s: 2 });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 3);
    assert.equal(r.json.error.field, "duration_s");
    assert.match(r.json.error.message, /seedance-2-5 generates .*not 2s/);
    assert.equal(calls.create.length, sent);
  });

  test("a missing prompt, a bad run name and a non-integer duration are each 400 with code 3 and their field", async () => {
    const cases = [
      [{ ...video, prompt: "  " }, "prompt"],
      [{ ...video, run: "Not A Slug" }, "run"],
      [{ ...video, duration_s: 4.5 }, "duration_s"],
      [{ ...video, refs: "zed" }, "refs"],
    ];
    for (const [body, field] of cases) {
      const r = await post("/api/generate/video", body);
      assert.equal(r.status, 400, field);
      assert.equal(r.json.error.code, 3, field);
      assert.equal(r.json.error.field, field);
    }
    assert.equal(existsSync(join(RUNS, "Not A Slug")), false);
  });
});

describe("POST /api/generate/image", () => {
  test("defaults to gpt-image-2 and writes the image prompt", async () => {
    const r = await post("/api/generate/image", { run: "gen-image", prompt: "A red robot, studio light.", provider: "kie" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.job.model, "gpt-image-2");
    assert.ok(existsSync(join(RUNS, "gen-image", "image-prompt.txt")));
    await app.follower.idle();
  });

  test("a resolution the model does not offer is 400 with code 3 on that field", async () => {
    const r = await post("/api/generate/image", { run: "gen-image", prompt: "x", model: "gpt-image-2-5", resolution: "8K" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.field, "resolution");
  });
});

describe("when a provider has trouble", () => {
  test("a create kie rejects outright falls over to WaveSpeed, and both jobs show their provider", async () => {
    generate.createTask = async (prov, ...rest) => {
      if (prov.name === "kie") throw provider("kie.ai rejected the request (code 500: busy)");
      return realCreate(prov, ...rest);
    };
    const r = await post("/api/generate/video", { ...video, run: "gen-fallback" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.provider, "wavespeed");
    assert.equal(r.json.failedOver, true);
    await app.follower.idle();
    const jobs = (await req(port, "/api/jobs?run=gen-fallback")).json;
    const kie = jobs.find((j) => j.provider === "kie");
    const ws = jobs.find((j) => j.provider === "wavespeed");
    assert.equal(kie.state, "failed-confirmed-free");
    assert.equal(kie.countedUsd, 0);
    assert.equal(ws.failedOver, true);
  });

  test("a create that dies without an id: 409, code 5 with the local id; the job is kept as uncertain, never resubmitted", async () => {
    let sent = 0;
    generate.createTask = async () => {
      sent += 1;
      throw new Error("socket hang up");
    };
    const r = await post("/api/generate/video", { ...video, run: "gen-uncertain" });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, 5);
    assert.match(r.json.error.localJobId, /^j-/);
    assert.match(r.json.error.message, /Do not resubmit/);
    assert.equal(sent, 1, "no fallback after an ambiguous create");
    const [job] = (await req(port, "/api/jobs?run=gen-uncertain")).json;
    assert.equal(job.id, r.json.error.localJobId);
    assert.equal(job.state, "uncertain");
    assert.equal(job.countedUsd, 0.56, "an uncertain job keeps holding its estimate");
  });
});

describe("POST /api/jobs/:id/check", () => {
  test("an uncertain job with no upstream id: 409, code 5, core's resolve instruction; the job stays uncertain", async () => {
    const [job] = (await req(port, "/api/jobs?run=gen-uncertain")).json;
    const waits = calls.wait;
    const r = await post(`/api/jobs/${job.id}/check`);
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, 5);
    assert.match(r.json.error.message, /kie job resolve/);
    assert.equal(calls.wait, waits, "nothing to poll without an upstream id");
    assert.equal(store.get(job.id).state, "uncertain");
  });

  test("an uncertain job that has an upstream id is read once and settles", async () => {
    let j = store.create({ run: "gen-check", capability: "video", model: "seedance-2-5", provider: "kie", family: "jobs", providerModel: "bytedance/seedance-2-5", artifactBase: "out", estimateUsd: 0.56, input: { prompt: "x", duration: 4 } });
    j = store.transition(j.id, "sending");
    j = store.transition(j.id, "uncertain", { upstreamTaskId: "task-late" });
    const r = await post(`/api/jobs/${j.id}/check`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.outcome, "succeeded");
    assert.equal(r.json.job.state, "succeeded");
  });

  test("a submitted job still running is reported as pending and left submitted", async () => {
    let j = store.create({ run: "gen-check", capability: "video", model: "seedance-2-5", provider: "kie", family: "jobs", providerModel: "bytedance/seedance-2-5", artifactBase: "out", estimateUsd: 0.56, input: { prompt: "x", duration: 4 } });
    j = store.transition(j.id, "sending");
    j = store.transition(j.id, "submitted", { upstreamTaskId: "task-slow" });
    const realWait = generate.waitForTask;
    const { uncertain } = await import("../../cli/lib/errors.mjs");
    generate.waitForTask = async () => {
      throw uncertain("still running", "task-slow", { timedOut: true });
    };
    const r = await post(`/api/jobs/${j.id}/check`);
    generate.waitForTask = realWait;
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.outcome, "pending");
    assert.match(r.json.message, /Still running at kie/);
    assert.equal(store.get(j.id).state, "submitted");
  });

  test("a refused job is reported as refused and not charged, never as maybe charged", async () => {
    const j = store.create({ run: "gen-check", capability: "video", model: "seedance-2-5", provider: "kie", family: "jobs", providerModel: "bytedance/seedance-2-5", artifactBase: "out", estimateUsd: 0.56, input: { prompt: "x", duration: 4 } });
    store.transition(j.id, "refused", { reason: "abandoned" });
    const r = await post(`/api/jobs/${j.id}/check`);
    assert.equal(r.status, 200, r.text);
    assert.match(r.json.message, /^Refused before sending, not charged/);
    assert.doesNotMatch(r.json.message, /may have been charged/);
  });

  test("a failed job whose record shows a charge says it was charged", async () => {
    let j = store.create({ run: "gen-check", capability: "video", model: "seedance-2-5", provider: "kie", family: "jobs", providerModel: "bytedance/seedance-2-5", artifactBase: "out", estimateUsd: 0.56, input: { prompt: "x", duration: 4 } });
    j = store.transition(j.id, "sending");
    j = store.transition(j.id, "submitted", { upstreamTaskId: "task-x" });
    store.transition(j.id, "failed-charged", { actualUsd: 0.5, error: "content policy" });
    const r = await post(`/api/jobs/${j.id}/check`);
    assert.equal(r.json.message, "Failed and charged: content policy");
  });

  test("a job id that is not one is 400", async () => {
    assert.equal((await post("/api/jobs/nope/check")).status, 400);
  });
});
