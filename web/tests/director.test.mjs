import { KEY, RUNS, tmp, req, generateStubs } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";

const { createApp } = await import("../server/app.mjs");

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const ff = (args) => spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

// Stills come back as real PNGs and takes as real MP4s, by what each task was created for.
const { calls, generate, deps } = generateStubs();
const kinds = new Map();
const create = generate.createTask;
generate.createTask = async (prov, family, model, input) => {
  const r = await create(prov, family, model, input);
  kinds.set(r.taskId, /seedance/.test(model) ? "video" : "image");
  return r;
};
generate.waitForTask = async (_prov, _family, taskId) => {
  const video = kinds.get(taskId) === "video";
  return { state: "success", urls: [video ? "https://cdn.test/take.mp4" : "https://cdn.test/still.png"], data: { state: "success", creditsConsumed: 6 }, elapsedS: 2 };
};
generate.download = async (url, path) => {
  if (url.endsWith(".mp4")) ff(["-f", "lavfi", "-i", "testsrc=size=1280x720:rate=24:duration=3", "-pix_fmt", "yuv420p", `${path}.mp4`]);
  else ff(["-f", "lavfi", "-i", "color=c=teal:s=1280x720", "-frames:v", "1", `${path}.png`]);
  renameSync(`${path}${url.endsWith(".mp4") ? ".mp4" : ".png"}`, path);
  return path;
};

const brief = { takeaway: "Mornings by the sea are calm", durationS: 5, aspectRatio: "16:9", filmType: "live-action" };
const look = { palette: "teal and amber", grade: "soft contrast", filmLook: "35mm film grain", lensFamily: "anamorphic", keyLightSide: "left" };
const shot = (id, durationS, extra = {}) => ({
  id, durationS, purpose: "p", subject: "the pier", action: "Waves roll under the wet pier", why: "w",
  size: "wide", angle: "eye-level", lens: "35mm", depth: "deep", move: { type: "truck-left", speed: "slow" },
  light: "overcast", cut: "hard", job: "cinematic", screenDirection: "none", checks: ["the pier reads"], ...extra,
});
// s1 hard-cuts to s2, which runs straight into s3: s3 needs no still and waits for s2's take.
const plan = { look, shots: [shot("s1", 2), shot("s2", 1.5, { size: "medium", cut: "continuous" }), shot("s3", 1.5, { size: "close-up", lens: "85mm" })] };

let app, port;
const get = (path) => req(port, path);
const send = (method, path, body) => req(port, path, { method, body });
/** Wait until no job is followed and no queue step is running. */
async function settle() {
  for (let i = 0; i < 20; i++) {
    await app.follower.idle();
    await app.director.idle();
    await new Promise((r) => setTimeout(r, 20));
    if (!(await get("/api/jobs?run=pier")).json.some((j) => j.following)) return;
  }
}

before(async () => {
  app = createApp({ key: KEY, deps, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());

describe("the storyboard API", { skip: !hasFfmpeg && "needs ffmpeg" }, () => {
  test("menu lists the groups and the models for the inspector", async () => {
    const r = await get("/api/director/menu");
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.menu.sizes.some((s) => s.id === "close-up"));
    assert.ok(r.json.videoModels.some((m) => m.id === "seedance-2-5"));
    assert.ok(r.json.imageModels.some((m) => m.id === "nano-banana-2"));
  });

  test("brief and plan are saved through the director; a bad plan is refused with its reasons", async () => {
    let r = await send("PUT", "/api/films/pier/brief", { brief });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.brief.takeaway, brief.takeaway);
    r = await send("PUT", "/api/films/pier/plan", { plan: { look, shots: [shot("s1", 2)] } });
    assert.equal(r.status, 400);
    assert.match(r.text, /add up to 2s; the brief asks for 5s/);
    r = await send("PUT", "/api/films/pier/plan", { plan });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.plan.version, 1);
    assert.deepEqual(r.json.left.stills, ["s1", "s2"]);
    assert.deepEqual(r.json.left.takes, ["s1", "s2", "s3"]);
    assert.ok(r.json.left.takesUsd > 0);
    assert.deepEqual(r.json.check.errors, []);
  });

  test("the inspector changes one shot; a change that breaks a rule is refused", async () => {
    let r = await send("PUT", "/api/films/pier/shots/s1", { changes: { lens: "50mm" } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.plan.shots[0].lens, "50mm");
    r = await send("PUT", "/api/films/pier/shots/s1", { changes: { size: "huge" } });
    assert.equal(r.status, 400);
  });

  test("Film all before the stills names them; Make stills makes the style still first, then the rest", async () => {
    let r = await send("POST", "/api/films/pier/film", { max_usd: 50 });
    assert.equal(r.status, 400);
    assert.match(r.text, /Every shot needs its still before filming: s1, s2/);

    const before = calls.create.length;
    r = await send("POST", "/api/films/pier/stills", {});
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.submitted.length, 1, "only the style still at first");
    assert.equal(r.json.board.queue.kind, "stills");
    await settle();
    assert.equal(calls.create.length, before + 2);
    assert.equal(calls.create.at(-1).input.image_input.length, 1, "s2's still has s1's as its style reference");
    const b = (await get("/api/films/pier/board")).json;
    assert.deepEqual(b.shots.map((s) => s.still), ["s1-still.png", "s2-still.png", null]);
    assert.match(b.shots[0].stillUrl, /^\/media\/runs\/pier\/s1-still\.png/);
    assert.equal(b.queue, null);
  });

  test("Film all refuses a total above the agreed one, then films s1 and s2 and s3 after s2", async () => {
    let r = await send("POST", "/api/films/pier/film", { max_usd: 0.01 });
    assert.equal(r.status, 402);
    r = await send("POST", "/api/films/pier/film", {});
    assert.equal(r.status, 400);

    const before = calls.create.length;
    r = await send("POST", "/api/films/pier/film", { max_usd: 50 });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.submitted.map((s) => s.shot), ["s1", "s2"]);
    assert.deepEqual(r.json.waiting, ["s3"]);
    await settle();
    assert.equal(calls.create.length, before + 3, `s3 was filmed once s2's take landed: ${JSON.stringify((await get("/api/films/pier/board")).json.queue)}`);
    const b = (await get("/api/films/pier/board")).json;
    assert.deepEqual(b.shots.map((s) => s.take), ["s1-take.mp4", "s2-take.mp4", "s3-take.mp4"]);
    assert.equal(b.shots[2].takes[0].from, "s2-take-last.png");
    assert.equal(b.queue, null);
    assert.deepEqual(b.left.takes, []);
  });

  test("review frames, a verdict, and the cut as a task", async () => {
    let r = await send("POST", "/api/films/pier/shots/s1/review", {});
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.take, "s1-take.mp4");
    assert.match(r.json.sheetUrl, /^\/media\/runs\/pier\//);
    r = await send("PUT", "/api/films/pier/shots/s1/review", { review: { take: "s1-take.mp4", verdict: "redo", checks: [{ check: "the pier reads", ok: false, note: "the pier melts" }] } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.shots[0].review.verdict, "redo");

    r = await send("POST", "/api/films/pier/cut", {});
    assert.equal(r.status, 200, r.text);
    await app.tasks.idle();
    const [task] = app.tasks.list("pier");
    assert.equal(task.state, "done", task.error);
    assert.equal(task.outputs[0].name, "film.mp4");
    assert.ok(existsSync(join(RUNS, "pier", "film.mp4")));
    assert.equal((await get("/api/films/pier/board")).json.cut.out, "film.mp4");
  });

  test("choosing a still by hand, and going back to the newest", async () => {
    let r = await send("POST", "/api/films/pier/shots/s1/use", { still: "s2-still.png" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.shots[0].still, "s2-still.png");
    r = await send("POST", "/api/films/pier/shots/s1/use", { still: null });
    assert.equal(r.json.shots[0].still, "s1-still.png");
  });

  test("with auto-redo on, a redo verdict films the shot again and the new take is followed in", async () => {
    let r = await send("PUT", "/api/films/pier/production", { auto_redo: true });
    assert.equal(r.status, 400);
    assert.match(r.text, /Auto-redo needs max_usd/);
    r = await send("PUT", "/api/films/pier/production", { auto_redo: true, max_usd: 50 });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.production.autoRedo, true);
    assert.ok(r.json.production.takesSpentUsd > 0);

    const before = calls.create.length;
    r = await send("PUT", "/api/films/pier/shots/s1/review", { review: { take: "s1-take.mp4", verdict: "redo", checks: [{ check: "the pier reads", ok: false, note: "still melts" }] } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.redo.submitted, true);
    assert.equal(r.json.redo.redo, 1);
    await settle();
    assert.equal(calls.create.length, before + 1);
    const b = (await get("/api/films/pier/board")).json;
    assert.equal(b.shots[0].take, "s1-take-2.mp4");
    assert.equal(b.shots[0].tries, 2);
    assert.equal(b.shots[0].review, null);

    r = await send("PUT", "/api/films/pier/production", { auto_redo: false });
    assert.equal(r.json.production.autoRedo, false);
    r = await send("PUT", "/api/films/pier/shots/s1/review", { review: { take: "s1-take-2.mp4", verdict: "redo", checks: [{ check: "the pier reads", ok: false }] } });
    assert.equal(r.json.redo, null, "off: the redo waits for Alex");
  });
});
