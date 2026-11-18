import { KEY, RUNS, tmp, req, generateStubs } from "./helpers.mjs";
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { createApp } = await import("../server/app.mjs");
const { listRuns } = await import("../../cli/core/views.mjs");

const { calls, generate, deps } = generateStubs();
const priced = [];
const realPreflight = generate.preflight;
generate.preflight = async (catalog, route, o) => (priced.push(o), realPreflight(catalog, route, o));
let probeS = 6.4;
const probes = { ...deps, probe: async () => ({ durationS: probeS, width: 720, height: 1280 }) };

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.alloc(32)]);
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(64)]);
const LIMITS = process.env.KIE_LIMITS_FILE;

let app, port;
before(async () => {
  app = createApp({ key: KEY, deps: probes, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());
beforeEach(() => rmSync(LIMITS, { force: true }));

const upload = (kind, name, body) =>
  req(port, `/api/jutsu/upload?kind=${kind}&name=${encodeURIComponent(name)}`, { method: "POST", body, headers: { "content-type": "application/octet-stream" } });
const post = (path, body) => req(port, path, { method: "POST", body });

describe("Openjutsu uploads", () => {
  test("a reference video is saved under runs/jutsu/clips and probed for its length", async () => {
    const r = await upload("video", "Dance Move.mp4", mp4);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.name, "dance-move.mp4");
    assert.equal(r.json.durationS, 6.4);
    assert.ok(existsSync(join(RUNS, "jutsu/clips/dance-move.mp4")));
    assert.equal(JSON.parse(readFileSync(join(RUNS, "jutsu/clips/dance-move.mp4.json"), "utf8")).durationS, 6.4);
  });

  test("a character picture goes to cast/; a picture sent as a video is refused", async () => {
    const r = await upload("image", "zed.png", png);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.name, "zed.png");
    const wrong = await upload("video", "zed.png", png);
    assert.equal(wrong.status, 400);
    assert.equal(wrong.json.error.field, "file");
  });

  test("GET lists the models, the clips and the cast; the jutsu run is not a film", async () => {
    const r = await req(port, "/api/jutsu");
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.models.map((m) => m.id).sort(), ["kling-2-6-motion-control", "kling-3-0-motion-control", "wan-2-2-animate-replace"]);
    const pro = r.json.models.find((m) => m.id === "kling-3-0-motion-control");
    assert.deepEqual(pro.resolutions, ["720p", "1080p"]);
    assert.equal(pro.mode, "motion");
    assert.equal(r.json.clips[0].name, "dance-move.mp4");
    assert.equal(r.json.clips[0].uses, 0);
    assert.equal(r.json.cast[0].name, "zed.png");
    assert.ok(!listRuns().some((x) => x.run === "jutsu"));
  });
});

describe("POST /api/jutsu/estimate", () => {
  test("prices the clip's seconds at the picked resolution, free", async () => {
    const before = calls.create.length;
    const r = await post("/api/jutsu/estimate", { model: "kling-2-6-motion-control", resolution: "1080p", video: "dance-move.mp4", image: "zed.png" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.usd, Math.round(6.4 * 0.101 * 10_000) / 10_000);
    assert.match(r.json.basis, /6\.4s × \$0\.101\/s at 1080p/);
    assert.deepEqual(r.json.problems, []);
    assert.equal(calls.create.length, before);
  });

  test("swap is priced at the picked resolution, not the route's default", async () => {
    const r = await post("/api/jutsu/estimate", { model: "wan-2-2-animate-replace", resolution: "720p", video: "dance-move.mp4", image: "zed.png" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.usd, Math.round(6.4 * 0.0625 * 10_000) / 10_000);
    assert.match(r.json.basis, /at 720p/);
  });

  test("names what the provider would refuse: facing the picture over 10s, a clip over 30s", async () => {
    probeS = 12;
    await upload("video", "long.mp4", mp4);
    const facing = await post("/api/jutsu/estimate", { model: "kling-3-0-motion-control", orientation: "image", video: "long.mp4" });
    assert.match(facing.json.problems.join(" "), /up to 10s/);
    probeS = 40;
    await upload("video", "huge.mp4", mp4);
    const over = await post("/api/jutsu/estimate", { model: "kling-3-0-motion-control", video: "huge.mp4" });
    assert.match(over.json.problems.join(" "), /3 to 30 seconds/);
    probeS = 6.4;
  });

  test("a path in a file name is refused", async () => {
    const r = await post("/api/jutsu/estimate", { model: "kling-2-6-motion-control", video: "../.jobs/x.mp4" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.field, "video");
  });
});

describe("POST /api/jutsu/generate", () => {
  test("motion transfer sends Kling's contract: picture and video as lists, mode and facing, priced on the clip's length", async () => {
    const r = await post("/api/jutsu/generate", { model: "kling-3-0-motion-control", resolution: "1080p", orientation: "video", video: "dance-move.mp4", image: "zed.png", prompt: "on a rooftop at dusk" });
    assert.equal(r.status, 200, r.text);
    const sent = calls.create.at(-1);
    assert.equal(sent.model, "kling-3.0/motion-control");
    assert.equal(sent.input.mode, "1080p");
    assert.equal(sent.input.character_orientation, "video");
    assert.equal(sent.input.prompt, "on a rooftop at dusk");
    assert.equal(sent.input.input_urls.length, 1);
    assert.equal(sent.input.video_urls.length, 1);
    assert.ok(!("_durationS" in sent.input) && !("duration" in sent.input) && !("resolution" in sent.input));
    assert.equal(priced.at(-1).durationS, 6.4);
    const list = await req(port, "/api/jutsu");
    assert.equal(list.json.clips.find((c) => c.name === "dance-move.mp4").uses, 1);
    const jobs = await req(port, "/api/jobs?run=jutsu");
    assert.equal(jobs.json[0].resolution, "1080p");
    assert.equal(jobs.json[0].durationS, 6.4);
  });

  test("swap sends Wan's contract: single urls and a resolution, no prompt", async () => {
    const r = await post("/api/jutsu/generate", { model: "wan-2-2-animate-replace", resolution: "580p", video: "dance-move.mp4", image: "zed.png", prompt: "ignored" });
    assert.equal(r.status, 200, r.text);
    const sent = calls.create.at(-1);
    assert.equal(sent.model, "wan/2-2-animate-replace");
    assert.equal(typeof sent.input.video_url, "string");
    assert.equal(typeof sent.input.image_url, "string");
    assert.equal(sent.input.resolution, "580p");
    assert.ok(!("prompt" in sent.input));
  });

  test("a clip the provider would refuse is refused here, before anything is reserved", async () => {
    const before = calls.create.length;
    const r = await post("/api/jutsu/generate", { model: "kling-2-6-motion-control", video: "huge.mp4", image: "zed.png" });
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /nothing was spent/);
    assert.equal(calls.create.length, before);
  });

  test("an unknown model or resolution is refused on its field", async () => {
    assert.equal((await post("/api/jutsu/generate", { model: "seedance-2-5", video: "dance-move.mp4", image: "zed.png" })).json.error.field, "model");
    assert.equal((await post("/api/jutsu/generate", { model: "wan-2-2-animate-replace", resolution: "1080p", video: "dance-move.mp4", image: "zed.png" })).json.error.field, "resolution");
  });
});

describe("a character from the Library", () => {
  test("GET lists each Library picture once, as @asset#n; generate sends that one picture", async () => {
    const { openLibrary } = await import("../../cli/core/assets.mjs");
    const pic = join(tmp, "zed-face.png");
    writeFileSync(pic, png);
    openLibrary().save({ name: "zed", kind: "character", description: "Zed", images: [{ path: pic, role: "sheet" }, { path: pic, role: "source" }] }, { roots: [tmp] });
    const r = await req(port, "/api/jutsu");
    const zed = r.json.library.filter((x) => x.asset === "zed");
    assert.equal(zed.length, 1, "an identical second picture is shown once");
    assert.equal(zed[0].ref, "@zed#1");
    const sent = await post("/api/jutsu/generate", { model: "kling-2-6-motion-control", video: "dance-move.mp4", image: "@zed#1" });
    assert.equal(sent.status, 200, sent.text);
    assert.equal(calls.create.at(-1).input.input_urls.length, 1);
  });

  test("a picture number the item does not have, or a bad ref, is refused on image", async () => {
    assert.equal((await post("/api/jutsu/estimate", { model: "kling-2-6-motion-control", video: "dance-move.mp4", image: "@zed#9" })).json.error.field, "image");
    assert.equal((await post("/api/jutsu/estimate", { model: "kling-2-6-motion-control", video: "dance-move.mp4", image: "@../x#1" })).json.error.field, "image");
  });
});

describe("a character from a generated picture", () => {
  test("GET lists finished image takes as gen:<job>; generate sends that picture; a video job is refused", async () => {
    const { openJobs } = await import("../../cli/core/jobs.mjs");
    const store = openJobs(join(RUNS, ".jobs"));
    const pic = join(RUNS, "jutsu", "made.png");
    writeFileSync(pic, png);
    let job = store.create({ run: "jutsu", capability: "image", model: "gpt-image-2", provider: "kie", estimateUsd: 0.04, input: { prompt: "a face" } });
    for (const s of ["sending", "submitted"]) job = store.transition(job.id, s, s === "submitted" ? { upstreamTaskId: "t-made" } : {});
    store.transition(job.id, "succeeded", { artifacts: [pic], actualUsd: 0.04, costSource: "task-record" });
    const r = await req(port, "/api/jutsu");
    const made = r.json.generations.find((g) => g.ref === `gen:${job.id}`);
    assert.ok(made, r.text);
    assert.equal(made.prompt, "a face");
    const sent = await post("/api/jutsu/generate", { model: "wan-2-2-animate-replace", video: "dance-move.mp4", image: `gen:${job.id}` });
    assert.equal(sent.status, 200, sent.text);
    const videoJob = (await req(port, "/api/jobs?run=jutsu")).json.find((j) => j.capability === "jutsu");
    assert.equal((await post("/api/jutsu/estimate", { model: "wan-2-2-animate-replace", image: `gen:${videoJob.id}` })).json.error.field, "image");
  });
});

describe("DELETE /api/jutsu/files", () => {
  test("removes a clip and its probe record", async () => {
    const r = await req(port, "/api/jutsu/files/video/long.mp4", { method: "DELETE" });
    assert.equal(r.status, 200, r.text);
    assert.ok(!existsSync(join(RUNS, "jutsu/clips/long.mp4")));
    assert.ok(!existsSync(join(RUNS, "jutsu/clips/long.mp4.json")));
  });
});
