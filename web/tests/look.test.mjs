import { RUNS, KEY, deps, req, tmp } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { createApp } = await import("../server/app.mjs");
const { openJobs } = await import("../../cli/core/jobs.mjs");

mkdirSync(join(RUNS, "zed"), { recursive: true });
writeFileSync(join(RUNS, "zed", "prompt.txt"), "Slow push-in");
writeFileSync(join(RUNS, "zed", "out.mp4"), "x");
const store = openJobs(join(RUNS, ".jobs"));
const job = store.create({
  run: "zed",
  capability: "video",
  model: "seedance-2",
  provider: "kie",
  estimateUsd: 1.03,
  input: { prompt: "Slow push-in", duration: 5, resolution: "720p" },
});

let app, port;
before(async () => {
  app = createApp({ key: KEY, deps, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());

describe("read-only API", () => {
  test("status uses the injected balance reader", async () => {
    const r = await req(port, "/api/status");
    assert.equal(r.status, 200);
    assert.equal(r.json.providers.find((p) => p.name === "kie").balance, 100);
    assert.equal(r.json.today.capUsd, 10);
  });

  test("models filter by capability", async () => {
    const r = await req(port, "/api/models?capability=video");
    assert.ok(r.json.length > 0);
    assert.ok(r.json.every((m) => m.capability === "video"));
  });

  test("presets list", async () => {
    assert.ok(Array.isArray((await req(port, "/api/presets")).json));
  });

  test("runs and one run, with media URLs and job views", async () => {
    assert.ok((await req(port, "/api/runs")).json.some((r) => r.run === "zed"));
    const r = await req(port, "/api/runs/zed");
    assert.deepEqual(r.json.media, ["/media/runs/zed/out.mp4"]);
    assert.equal(r.json.jobs[0].durationS, 5);
    assert.ok(!("artifacts" in r.json), "absolute paths are not sent to the page");
  });

  test("an unknown run is 400 with code 3", async () => {
    const r = await req(port, "/api/runs/nope");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 3);
  });

  test("jobs newest first, filtered by run", async () => {
    const r = await req(port, "/api/jobs?run=zed");
    assert.equal(r.json[0].id, job.id);
    assert.equal((await req(port, "/api/jobs?run=other")).json.length, 0);
  });

  test("spend has 14 days", async () => {
    assert.equal((await req(port, "/api/spend")).json.days.length, 14);
  });

  test("library list and an unknown asset", async () => {
    assert.deepEqual((await req(port, "/api/library")).json, []);
    assert.equal((await req(port, "/api/library/nope")).json.error.code, 3);
  });

  test("estimate prices a job and reserves nothing", async () => {
    const before = store.list().length;
    const r = await req(port, "/api/estimate", {
      method: "POST",
      body: { model: "seedance-2-5", durationS: 4, resolution: "480p", provider: "kie" },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.estimateUsd, 0.56);
    assert.equal(store.list().length, before);
  });

  test("no response contains the provider key", async () => {
    for (const p of ["/api/status", "/api/models", "/api/jobs", "/api/spend"]) {
      assert.doesNotMatch((await req(port, p)).text, /test-key-not-real/, p);
    }
  });
});
