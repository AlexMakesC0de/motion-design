import { RUNS, hasFfmpeg, realPng, realMp4, stubs, connect, call, errorOf } from "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";

// Stills come back as PNGs and takes as MP4s, by what each task was created for.
const { deps, calls } = stubs();
const kinds = new Map();
const create = deps.generate.createTask;
deps.generate.createTask = async (prov, family, model, input) => {
  const r = await create(prov, family, model, input);
  kinds.set(r.taskId, /seedance/.test(model) ? "video" : "image");
  return r;
};
deps.generate.waitForTask = async (prov, family, taskId) => {
  const video = kinds.get(taskId) === "video";
  return { state: "success", urls: [video ? "https://cdn.test/take.mp4" : "https://cdn.test/still.png"], data: { state: "success", creditsConsumed: 6 }, elapsedS: 2 };
};
deps.generate.download = async (url, path) => {
  const ext = url.endsWith(".mp4") ? ".mp4" : ".png";
  renameSync(ext === ".mp4" ? realMp4(`${path}${ext}`) : realPng(`${path}${ext}`, "1280x720"), path);
  return path;
};
const client = await connect(deps);

const brief = { takeaway: "Mornings by the sea are calm", durationS: 3, aspectRatio: "16:9", filmType: "live-action" };
const look = { palette: "teal and amber", grade: "soft contrast", filmLook: "35mm film grain", lensFamily: "anamorphic", keyLightSide: "left" };
const shot = (id, durationS, extra = {}) => ({
  id, durationS, purpose: "p", subject: "the pier", action: "Waves roll under the wet pier", why: "w",
  size: "wide", angle: "eye-level", lens: "35mm", depth: "deep", move: { type: "truck-left", speed: "slow" },
  light: "overcast", cut: "hard", job: "cinematic", screenDirection: "none", checks: ["the pier reads"], ...extra,
});
const ok = (r) => assert.equal(r.isError, undefined, JSON.stringify(r.content));

describe("making a film through the tools", { skip: !hasFfmpeg && "needs ffmpeg" }, () => {
  test("a still before a plan is refused; a dry run spends nothing", async () => {
    ok(await call(client, "save_brief", { run: "pier", brief }));
    const none = await call(client, "make_still", { run: "pier", shot: "s1" });
    assert.equal(errorOf(none).code, 1);
    ok(await call(client, "save_plan", { run: "pier", plan: { look, shots: [shot("s1", 1.5, { cut: "dissolve" }), shot("s2", 2, { size: "close-up", lens: "85mm" })] } }));
    const dry = await call(client, "make_still", { run: "pier", shot: "s1", dry_run: true });
    ok(dry);
    assert.equal(dry.structuredContent.dryRun, true);
    assert.equal(dry.structuredContent.localJobId, null);
    assert.equal(calls.create.length, 0);
  });

  test("stills in order: the first sets the style for the second", async () => {
    const a = await call(client, "make_still", { run: "pier", shot: "s1" });
    ok(a);
    assert.equal(a.structuredContent.model, "nano-banana-2");
    ok(await call(client, "wait_job", { job_id: a.structuredContent.localJobId }));
    assert.ok(existsSync(join(RUNS, "pier", "s1-still.png")));
    const b = await call(client, "make_still", { run: "pier", shot: "s2" });
    ok(b);
    assert.equal(b.structuredContent.detail.style, "s1-still.png");
    assert.deepEqual(calls.create.at(-1).input.image_input, [`https://files.test/${calls.upload}.png`]);
    ok(await call(client, "wait_job", { job_id: b.structuredContent.localJobId }));
    const board = await call(client, "get_shots", { run: "pier" });
    assert.match(board.content[0].text, /s1 {2}1\.5s {2}still s1-still\.png · no take\ns2 {2}2s {2}still s2-still\.png · no take/);
  });

  test("film all needs the agreed total and refuses a smaller one", async () => {
    const r = await call(client, "film_all", { run: "pier", max_usd: 0.01 });
    assert.equal(errorOf(r).code, 2);
    assert.match(r.content[0].text, /more than the \$0\.01 agreed/);
  });

  test("film all submits both takes; wait, review and cut", async () => {
    const before = calls.create.length;
    const r = await call(client, "film_all", { run: "pier", max_usd: 100 });
    ok(r);
    assert.deepEqual(r.structuredContent.submitted.map((s) => s.shot), ["s1", "s2"]);
    assert.equal(calls.create.length, before + 2);
    assert.equal(calls.create.at(-2).input.first_frame_url, `https://files.test/${calls.upload - 1}.png`);
    for (const s of r.structuredContent.submitted) ok(await call(client, "wait_job", { job_id: s.jobId }));
    const again = await call(client, "film_all", { run: "pier", max_usd: 100 });
    assert.deepEqual(again.structuredContent.done, ["s1", "s2"]);
    assert.equal(calls.create.length, before + 2, "nothing is filmed twice");

    const rv = await call(client, "review_shot", { run: "pier", shot: "s1" });
    ok(rv);
    assert.equal(rv.structuredContent.take, "s1-take.mp4");
    assert.equal(rv.content[1]?.type, "image", "the contact sheet is shown");
    ok(await call(client, "save_review", { run: "pier", shot: "s1", take: "s1-take.mp4", verdict: "pass", checks: [{ check: "the pier reads", ok: true }], best_window_start_s: 0.2 }));

    const cut = await call(client, "cut_film", { run: "pier" });
    ok(cut);
    assert.equal(cut.structuredContent.out, join(RUNS, "pier", "film.mp4"));
    assert.deepEqual(cut.structuredContent.segments.map((s) => [s.shot, s.startS]), [["s1", 0.2], ["s2", 0]]);
    assert.ok(existsSync(join(RUNS, "pier", "cut.json")));
  });
});
