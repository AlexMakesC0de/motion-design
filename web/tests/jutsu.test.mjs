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
const trims = [];
let trimFails = null;
const probes = {
  ...deps,
  probe: async () => ({ durationS: probeS, width: 720, height: 1280 }),
  trim: async (src, out, startS, lengthS) => {
    if (trimFails) throw trimFails;
    trims.push({ src, out, startS, lengthS });
    writeFileSync(out, mp4);
  },
};

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
    assert.deepEqual(r.json.models.map((m) => m.id).sort(), ["kling-2-6-motion-control", "kling-3-0-motion-control", "minimax-h3-swap", "wan-2-2-animate-replace"]);
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

  test("H3 swaps by instruction: video and picture as reference lists, a written edit, a video as long as the clip", async () => {
    const r = await post("/api/jutsu/generate", { model: "minimax-h3-swap", resolution: "768P", video: "dance-move.mp4", image: "zed.png" });
    assert.equal(r.status, 200, r.text);
    const sent = calls.create.at(-1);
    assert.equal(sent.model, "minimax-h3/reference-to-video");
    assert.equal(sent.input.reference_video_urls.length, 1);
    assert.equal(sent.input.reference_image_urls.length, 1);
    assert.match(sent.input.prompt, /^Video edit\./);
    assert.equal(sent.input.duration, 6);
    assert.equal(sent.input.resolution, "768P");
    // The clip is 720x1280, so the swap stays portrait rather than following the picture's shape.
    assert.equal(sent.input.aspect_ratio, "9:16");
    assert.ok(!("_inputS" in sent.input));
    // Billed on the 6s it makes plus the clip's 7 whole seconds.
    assert.equal(priced.at(-1).inputS, 6.4);
  });

  test("H3's price counts the clip's seconds on top of the output; a typed edit replaces the default", async () => {
    const est = await post("/api/jutsu/estimate", { model: "minimax-h3-swap", resolution: "768P", video: "dance-move.mp4", image: "zed.png" });
    assert.equal(est.json.usd, 0.52);
    assert.match(est.json.basis, /6s \+ 7s of reference video/);
    assert.equal((await post("/api/jutsu/estimate", { model: "minimax-h3-swap", resolution: "2K", video: "dance-move.mp4" })).json.usd, 0.845);
    await post("/api/jutsu/generate", { model: "minimax-h3-swap", resolution: "768P", video: "dance-move.mp4", image: "zed.png", prompt: "Swap the dancer for the character; keep the gold jacket." });
    assert.equal(calls.create.at(-1).input.prompt, "Swap the dancer for the character; keep the gold jacket.");
    const long = await post("/api/jutsu/generate", { model: "minimax-h3-swap", video: "dance-move.mp4", image: "zed.png", prompt: "x".repeat(7001) });
    assert.equal(long.json.error.field, "prompt");
  });

  test("H3 changes only what is picked: an outfit from words alone, an object with its picture, the place from words", async () => {
    const outfit = await post("/api/jutsu/generate", { model: "minimax-h3-swap", video: "dance-move.mp4", target: "outfit", detail: "a black leather jacket and jeans" });
    assert.equal(outfit.status, 200, outfit.text);
    let sent = calls.create.at(-1).input;
    assert.ok(!("reference_image_urls" in sent));
    assert.match(sent.prompt, /Change only the clothes of the main person, to a black leather jacket and jeans\. /);
    assert.match(sent.prompt, /face, hair and body/);
    await post("/api/jutsu/generate", { model: "minimax-h3-swap", video: "dance-move.mp4", image: "zed.png", target: "object", detail: "the mug into a glass bottle" });
    sent = calls.create.at(-1).input;
    assert.equal(sent.reference_image_urls.length, 1);
    assert.match(sent.prompt, /the reference picture shows the new object.*Change only this: the mug into a glass bottle, looking like the reference picture/);
    const est = await post("/api/jutsu/estimate", { model: "minimax-h3-swap", video: "dance-move.mp4", target: "background", detail: "a rooftop at night." });
    assert.match(est.json.instruction, /Change only the background and surroundings, to a rooftop at night\. Keep the people exactly as they are/);
    assert.equal((await post("/api/jutsu/estimate", { model: "wan-2-2-animate-replace", video: "dance-move.mp4" })).json.instruction, null);
  });

  test("an outfit with neither words nor a picture, an unknown target, or a person with no picture is refused before spending", async () => {
    const before = calls.create.length;
    assert.equal((await post("/api/jutsu/generate", { model: "minimax-h3-swap", video: "dance-move.mp4", target: "outfit" })).json.error.field, "detail");
    assert.equal((await post("/api/jutsu/generate", { model: "minimax-h3-swap", video: "dance-move.mp4", image: "zed.png", target: "hat" })).json.error.field, "target");
    assert.equal((await post("/api/jutsu/generate", { model: "minimax-h3-swap", video: "dance-move.mp4", target: "person" })).json.error.field, "image");
    assert.equal((await post("/api/jutsu/generate", { model: "minimax-h3-swap", video: "dance-move.mp4", target: "object", detail: "x".repeat(501) })).json.error.field, "detail");
    assert.equal(calls.create.length, before);
  });

  test("a person to replace can be named; a written prompt still wins over the picked edit", async () => {
    const est = await post("/api/jutsu/estimate", { model: "minimax-h3-swap", video: "dance-move.mp4", image: "zed.png", target: "person", detail: "the drummer" });
    assert.match(est.json.instruction, /Replace the drummer in the video with the character from the picture/);
    await post("/api/jutsu/generate", { model: "minimax-h3-swap", video: "dance-move.mp4", target: "outfit", detail: "a red coat", prompt: "My own words." });
    assert.equal(calls.create.at(-1).input.prompt, "My own words.");
  });

  test("H3 refuses a clip over 15 seconds, free, and says to trim it", async () => {
    const est = await post("/api/jutsu/estimate", { model: "minimax-h3-swap", video: "huge.mp4" });
    assert.match(est.json.problems.join(" "), /takes 2 to 15 seconds\. Trim it first/);
    const before = calls.create.length;
    const r = await post("/api/jutsu/generate", { model: "minimax-h3-swap", video: "huge.mp4", image: "zed.png" });
    assert.equal(r.status, 400);
    assert.equal(calls.create.length, before);
  });

  test("the listing tells the page H3 takes a long prompt, has a default, and bills the clip too", async () => {
    const h3 = (await req(port, "/api/jutsu")).json.models.find((m) => m.id === "minimax-h3-swap");
    assert.deepEqual([h3.mode, h3.tier, h3.prompt, h3.promptMax, h3.billsInput], ["swap", "pro", true, 7000, true]);
    assert.match(h3.defaultPrompt, /Keep the original sound/);
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

describe("Motion Library categories", () => {
  test("a clip uploaded with a category is filed there; it can be refiled or taken off the shelves", async () => {
    const r = await req(port, "/api/jutsu/upload?kind=video&category=Dance&name=tiktok-1.mp4", { method: "POST", body: mp4, headers: { "content-type": "application/octet-stream" } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.category, "Dance");
    let view = (await req(port, "/api/jutsu")).json;
    assert.deepEqual(view.categories, ["Dance", "Action", "Sports", "Comedy", "Fashion", "Lifestyle"]);
    assert.equal(view.clips.find((c) => c.name === "tiktok-1.mp4").category, "Dance");
    const moved = await req(port, "/api/jutsu/files/video/tiktok-1.mp4", { method: "PATCH", body: { category: "Comedy" } });
    assert.equal(moved.json.category, "Comedy");
    await req(port, "/api/jutsu/files/video/tiktok-1.mp4", { method: "PATCH", body: { category: null } });
    view = (await req(port, "/api/jutsu")).json;
    const clip = view.clips.find((c) => c.name === "tiktok-1.mp4");
    assert.equal(clip.category, null);
    assert.equal(clip.durationS, 6.4);
  });

  test("an unknown category is refused, on upload and on refiling", async () => {
    const r = await req(port, "/api/jutsu/upload?kind=video&category=Cats&name=cat.mp4", { method: "POST", body: mp4, headers: { "content-type": "application/octet-stream" } });
    assert.equal(r.json.error.field, "category");
    assert.equal((await req(port, "/api/jutsu/files/video/dance-move.mp4", { method: "PATCH", body: { category: "Cats" } })).json.error.field, "category");
  });
});

describe("POST /api/jutsu/trim", () => {
  test("cuts part of a clip into a new clip beside it, free, and keeps the original", async () => {
    probeS = 40;
    await upload("video", "long-dance.mp4", mp4);
    probeS = 12;
    const r = await post("/api/jutsu/trim", { video: "long-dance.mp4", startS: 4.25, lengthS: 12 });
    probeS = 6.4;
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.name, "long-dance-4-3s-12s.mp4");
    assert.equal(r.json.durationS, 12);
    assert.equal(r.json.trimmedFrom, "long-dance.mp4");
    assert.deepEqual([trims.at(-1).startS, trims.at(-1).lengthS], [4.3, 12]);
    assert.ok(existsSync(join(RUNS, "jutsu/clips/long-dance.mp4")));
    const listed = (await req(port, "/api/jutsu")).json.clips.find((c) => c.name === "long-dance-4-3s-12s.mp4");
    assert.equal(listed.durationS, 12);
    const est = await post("/api/jutsu/estimate", { model: "minimax-h3-swap", resolution: "768P", video: "long-dance-4-3s-12s.mp4" });
    assert.deepEqual(est.json.problems, []);
    assert.equal(est.json.usd, 0.96);
  });

  test("a part outside the clip is refused on its field", async () => {
    assert.equal((await post("/api/jutsu/trim", { video: "long-dance.mp4", startS: 41, lengthS: 5 })).json.error.field, "startS");
    assert.equal((await post("/api/jutsu/trim", { video: "long-dance.mp4", startS: 0, lengthS: 0.5 })).json.error.field, "lengthS");
    const past = await post("/api/jutsu/trim", { video: "long-dance.mp4", startS: 30, lengthS: 15 });
    assert.equal(past.json.error.field, "lengthS");
    assert.match(past.json.error.message, /leaves 10s/);
  });

  test("a broken ffmpeg is named with its fix, and no half-written clip is left", async () => {
    trimFails = new Error("dyld: Library not loaded: libx265.216.dylib");
    const r = await post("/api/jutsu/trim", { video: "long-dance.mp4", startS: 0, lengthS: 5 });
    trimFails = null;
    assert.equal(r.status, 500);
    assert.match(r.json.error.message, /brew reinstall ffmpeg/);
    assert.equal(existsSync(join(RUNS, "jutsu/clips/long-dance-0s-5s.mp4")), false);
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

  test("a Library sheet sent to H3 is explained: one person, the face from the close-up, never the grey oval", async () => {
    const est = await post("/api/jutsu/estimate", { model: "minimax-h3-swap", video: "dance-move.mp4", image: "@zed#1", target: "person" });
    assert.match(est.json.instruction, /character sheet of one single person in three panels/);
    assert.match(est.json.instruction, /grey oval in the middle panel only hides the face/);
    const upload = await post("/api/jutsu/estimate", { model: "minimax-h3-swap", video: "dance-move.mp4", image: "zed.png", target: "person" });
    assert.doesNotMatch(upload.json.instruction, /character sheet/);
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
