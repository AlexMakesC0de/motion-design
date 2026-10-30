import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { RUNS, hasFfmpeg, stubs, connect, call, errorOf } from "./helpers.mjs";
import { png } from "../../tests/fixtures/images.mjs";

const { calls, deps } = stubs();
const client = await connect(deps);
const realCreate = deps.generate.createTask;
const jobsDir = join(RUNS, ".jobs");
const jobCount = () => (existsSync(jobsDir) ? readdirSync(jobsDir).filter((f) => f.startsWith("j-")).length : 0);
const video = { run: "gen-demo", prompt: "Shot 1: Zed waves at the camera.", model: "seedance-2-5", duration_s: 4, resolution: "480p", provider: "kie" };

mkdirSync(join(RUNS, "gen-demo"), { recursive: true });
writeFileSync(join(RUNS, "gen-demo", "zed.png"), png(1024, 1024));
await call(client, "save_asset", { name: "zed", kind: "character", description: "Zed.", images: ["gen-demo/zed.png"] });

let firstJob;

describe("generate", () => {
  test("generate_video reserves, submits once and returns a local id with the ref mapping", async () => {
    const r = await call(client, "generate_video", { ...video, refs: [{ source: "zed", role: "identity" }] });
    const s = r.structuredContent;
    assert.match(s.localJobId, /^j-\d{8}-[0-9a-f]{6}$/);
    assert.equal(s.state, "submitted");
    assert.equal(s.upstreamTaskId, "task-1");
    assert.deepEqual(s.refMapping, ["@Image1 = zed#1"]);
    assert.equal(calls.create.length, 1);
    assert.equal(calls.upload, 1);
    const inputs = JSON.parse(readFileSync(join(RUNS, "gen-demo", "inputs.json"), "utf8"));
    assert.deepEqual(inputs.refMapping, ["@Image1 = zed#1"]);
    firstJob = s.localJobId;
  });

  test("wait_job downloads into the run, reads the cost from the task record and shows a preview", async () => {
    const r = await call(client, "wait_job", { job_id: firstJob, max_wait_s: 5 });
    const s = r.structuredContent;
    assert.equal(s.outcome, "succeeded");
    assert.ok(s.artifacts[0].startsWith(join(RUNS, "gen-demo")));
    assert.equal(s.actualUsd, 0.03);
    assert.equal(s.costSource, "task-record");
    if (hasFfmpeg) assert.equal(r.content.filter((c) => c.type === "image").length, 1);
  });

  test("waiting on a settled job asks the provider nothing", async () => {
    const before = calls.wait;
    const r = await call(client, "wait_job", { job_id: firstJob });
    assert.equal(r.structuredContent.outcome, "succeeded");
    assert.equal(calls.wait, before);
  });

  test("generate_image uses the default image model and writes its prompt", async () => {
    const r = await call(client, "generate_image", { run: "gen-image", prompt: "A red robot, studio light.", provider: "kie" });
    assert.equal(r.structuredContent.state, "submitted");
    assert.ok(existsSync(join(RUNS, "gen-image", "image-prompt.txt")));
  });

  test("no model and no preset is a usage error", async () => {
    const { model, ...noModel } = video;
    const r = await call(client, "generate_video", noModel);
    assert.equal(errorOf(r).code, 1);
  });
});

describe("refusals and uncertainty", () => {
  test("over the daily cap: code 2, nothing sent, no job record", async () => {
    writeFileSync(process.env.KIE_LIMITS_FILE, JSON.stringify({ dailyUsd: 0.1 }));
    const sent = calls.create.length;
    const jobs = jobCount();
    const r = await call(client, "generate_video", video);
    rmSync(process.env.KIE_LIMITS_FILE);
    assert.equal(errorOf(r).code, 2);
    assert.match(errorOf(r).nextAction, /Ask the user/);
    assert.equal(calls.create.length, sent);
    assert.equal(jobCount(), jobs);
  });

  test("a create that dies without an id: code 5, resolve instructions, never resubmitted", async () => {
    const sent = calls.create.length;
    deps.generate.createTask = async (...a) => {
      await realCreate(...a);
      throw new Error("socket hang up");
    };
    const { provider, ...anyProvider } = video; // fallbacks available: still must not resubmit
    const r = await call(client, "generate_video", anyProvider);
    deps.generate.createTask = realCreate;
    assert.equal(errorOf(r).code, 5);
    assert.equal(errorOf(r).upstreamTaskId, null);
    assert.match(r.content[0].text, /kie job resolve j-/);
    assert.match(r.content[0].text, /Do not resubmit/);
    assert.equal(calls.create.length, sent + 1);
  });

  test("a create that times out after the provider gave an id: code 5, wait_job", async () => {
    deps.generate.createTask = async () => {
      throw Object.assign(new Error("read timed out"), { taskId: "task-77" });
    };
    const r = await call(client, "generate_video", video);
    deps.generate.createTask = realCreate;
    assert.equal(errorOf(r).code, 5);
    assert.equal(errorOf(r).upstreamTaskId, "task-77");
    assert.match(errorOf(r).nextAction, /wait_job with job_id "j-/);
  });

  test("a library record that cannot be updated after submit never costs the job id", async () => {
    writeFileSync(join(RUNS, "gen-demo", "gone.png"), png(1024, 1024));
    const saved = await call(client, "save_asset", { name: "gone", kind: "product", description: "A product.", images: ["gen-demo/gone.png"] });
    assert.notEqual(saved.isError, true, saved.content[0].text);
    // The provider call happens after the refs are expanded and before recordUse, so
    // removing the record here makes recordUse throw once the job is submitted.
    deps.generate.createTask = async (...a) => {
      rmSync(join(process.env.KIE_LIBRARY_DIR, "gone", "asset.json"));
      return realCreate(...a);
    };
    const jobs = jobCount();
    const r = await call(client, "generate_video", { ...video, refs: [{ source: "gone", role: "identity" }] });
    deps.generate.createTask = realCreate;
    assert.notEqual(r.isError, true, r.content[0].text);
    assert.match(r.structuredContent.localJobId, /^j-\d{8}-[0-9a-f]{6}$/);
    assert.equal(r.structuredContent.state, "submitted");
    assert.equal(typeof r.structuredContent.upstreamTaskId, "string");
    assert.match(r.content[0].text, /warning: .*gone/i);
    assert.equal(jobCount(), jobs + 1);
  });
});
