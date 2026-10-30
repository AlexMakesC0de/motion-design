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
