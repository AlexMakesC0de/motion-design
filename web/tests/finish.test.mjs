import { RUNS, KEY, deps, req, tmp } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const { createApp } = await import("../server/app.mjs");
const { RENDER_DIR } = await import("../../cli/lib/render.mjs");
const { CORE_TOOLS } = await import("../server/api/finish.mjs");

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const hasRender = existsSync(join(RENDER_DIR, "node_modules", "remotion"));
const FILM = join(RUNS, "finish-demo");
mkdirSync(FILM, { recursive: true });
mkdirSync(join(RUNS, "finish-gated"), { recursive: true });
const ffmpeg = (...args) => spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
if (hasFfmpeg) {
  // One-second clips with a tone, and a short music bed: tiny, so a real assemble takes a moment.
  for (const [name, hz] of [["a.mp4", 440], ["b.mp4", 660]]) {
    ffmpeg("-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=1", "-f", "lavfi", "-i", `sine=frequency=${hz}:duration=1`, "-pix_fmt", "yuv420p", "-shortest", join(FILM, name));
  }
  ffmpeg("-f", "lavfi", "-i", "sine=frequency=220:duration=2", join(FILM, "bed.wav"));
}
// Not media, whatever the names say: refused by their content.
writeFileSync(join(RUNS, "finish-gated", "a.mp4"), "\x00\x00\x00\x18ftypisom");
writeFileSync(join(RUNS, "finish-gated", "notes.wav"), "plain text");
mkdirSync(join(RUNS, "finish-gated", ".hidden"), { recursive: true });
writeFileSync(join(RUNS, "finish-gated", ".hidden", "x.mp4"), "\x00\x00\x00\x18ftypisom");
writeFileSync(join(tmp, "outside.mp4"), "\x00\x00\x00\x18ftypisom");

const allOk = () => ({ ffmpeg: { ok: true, install: null }, render: { ok: true, install: null } });

/** A finishing tool that waits until the test lets it finish, and records what it was asked. */
function gated() {
  const calls = [];
  let release = () => {};
  const done = new Promise((r) => (release = r));
  const tool = async (args) => {
    calls.push(args);
    await done;
    writeFileSync(args.out ?? join(args.outDir, "x.mp4"), "made");
    return { out: args.out, variants: [] };
  };
  return { calls, tool, release };
}

let app, port, slow, slowApp, slowPort;
before(async () => {
  app = createApp({ key: KEY, deps, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
  slow = gated();
  slowApp = createApp({ key: KEY, deps, distDir: join(tmp, "nodist"), pollMs: 60_000, finish: { tools: { ...CORE_TOOLS, assemble: slow.tool }, check: allOk } });
  await new Promise((r) => slowApp.listen(0, "127.0.0.1", r));
  slowPort = slowApp.address().port;
});
after(async () => {
  slow.release();
  await slowApp.tasks.idle();
  await Promise.all([app.closeAll(), slowApp.closeAll()]);
});

const post = (p, path, body) => req(p, path, { method: "POST", body });

describe("GET /api/finish", () => {
  test("says whether ffmpeg and the render engine are installed, and lists what the tools take", async () => {
    const r = await req(port, "/api/finish");
    assert.equal(r.status, 200);
    assert.equal(r.json.tools.ffmpeg.ok, hasFfmpeg);
    assert.equal(r.json.tools.render.ok, hasRender);
    if (!hasRender) assert.match(r.json.tools.render.install, /npm install/);
    assert.deepEqual(r.json.ratios, ["16:9", "9:16", "1:1", "4:5", "4:3", "21:9"]);
    assert.deepEqual(r.json.variantModes, ["blur", "crop", "pad"]);
    assert.deepEqual(r.json.captionStyles, ["social", "subtle"]);
    assert.ok(r.json.transitions.includes("fade"));
    assert.deepEqual(r.json.templates.find((t) => t.id === "kinetic-type").fields.map((f) => f.name), ["lines", "kicker", "footer", "granularity", "align"]);
  });

  test("a missing tool comes with core's install instructions", async () => {
    const missing = createApp({
      key: KEY,
      deps,
      distDir: join(tmp, "nodist"),
      pollMs: 60_000,
      finish: { check: () => ({ ffmpeg: { ok: false, install: "ffmpeg not found on PATH. Finishing commands need it:\n  brew install ffmpeg" }, render: { ok: true, install: null } }) },
    });
    await new Promise((r) => missing.listen(0, "127.0.0.1", r));
    try {
      const r = await req(missing.address().port, "/api/finish");
      assert.equal(r.json.tools.ffmpeg.ok, false);
      assert.match(r.json.tools.ffmpeg.install, /brew install ffmpeg/);
    } finally {
      await missing.closeAll();
    }
  });
});

describe("POST /api/films/:slug/assemble", () => {
  test("joins the chosen shots with a crossfade and music into film.mp4 in the film, then numbers the next one", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const body = { shots: ["b.mp4", "a.mp4"], music: "bed.wav", transition: "fade", transition_s: 0.25, aspect_ratio: "1:1" };
    const r = await post(port, "/api/films/finish-demo/assemble", body);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.task.state, "running");
    assert.equal(r.json.task.tool, "assemble");
    await app.tasks.idle();
    const task = app.tasks.get(r.json.task.id);
    assert.equal(task.state, "done", task.error);
    assert.deepEqual(task.outputs, [{ name: "film.mp4", url: "/media/runs/finish-demo/film.mp4" }]);
    const record = JSON.parse(readFileSync(join(FILM, "assembly.json"), "utf8"));
    assert.deepEqual(record.shots.map((s) => s.path), [join(FILM, "b.mp4"), join(FILM, "a.mp4")]);
    assert.equal(record.totalS, 1.75);
    assert.equal(record.audio.loudnessTarget, "-16 LUFS / -1.5 dBTP (EBU R128), two-pass linear");

    const again = await post(port, "/api/films/finish-demo/assemble", { shots: ["a.mp4"], aspect_ratio: "1:1" });
    await app.tasks.idle();
    assert.equal(app.tasks.get(again.json.task.id).outputs[0].name, "film-2.mp4", "never over the first film");
  });

  test("a second finishing task in the same film is refused while the first runs", async () => {
    const first = await post(slowPort, "/api/films/finish-gated/assemble", { shots: ["a.mp4"] });
    assert.equal(first.status, 200, first.text);
    const second = await post(slowPort, "/api/films/finish-gated/assemble", { shots: ["a.mp4"] });
    assert.equal(second.status, 409);
    assert.match(second.json.error.message, /Assemble is still running in finish-gated/);
    const args = slow.calls[0];
    assert.equal(args.out, join(RUNS, "finish-gated", "film.mp4"), "the output is core's default name inside the film");
    assert.deepEqual([args.ratio, args.width, args.height, args.transitionS, args.shotAudio], ["16:9", 1920, 1080, 0, "auto"]);
    slow.release();
    await slowApp.tasks.idle();
  });

  test("a shot outside the allowed folders, or in a hidden folder, is refused on its field before any task starts", async () => {
    const before = slowApp.tasks.list().length;
    const outside = await post(slowPort, "/api/films/finish-gated/assemble", { shots: [join(tmp, "outside.mp4")] });
    assert.equal(outside.status, 400);
    assert.equal(outside.json.error.code, 3);
    assert.equal(outside.json.error.field, "shots");
    assert.match(outside.json.error.message, /outside the folders files may be read from/);
    const hidden = await post(slowPort, "/api/films/finish-gated/assemble", { shots: [".hidden/x.mp4"] });
    assert.equal(hidden.status, 400);
    assert.equal(slowApp.tasks.list().length, before);
  });

  test("music that is not audio is refused by its content", async () => {
    const r = await post(slowPort, "/api/films/finish-gated/assemble", { shots: ["a.mp4"], music: "notes.wav" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.field, "music");
    assert.match(r.json.error.message, /is not an audio file/);
  });

  test("a transition outside the fixed list never reaches ffmpeg", async () => {
    const r = await post(slowPort, "/api/films/finish-gated/assemble", { shots: ["a.mp4", "a.mp4"], transition: "fade:duration=1,movie=/etc/hosts", transition_s: 0.5 });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.field, "transition");
  });

  test("no shots, an unknown ratio and an unknown film are refused", async () => {
    assert.equal((await post(slowPort, "/api/films/finish-gated/assemble", { shots: [] })).json.error.field, "shots");
    assert.equal((await post(slowPort, "/api/films/finish-gated/assemble", { shots: ["a.mp4"], aspect_ratio: "2:1" })).json.error.field, "aspect_ratio");
    const unknownFilm = await post(slowPort, "/api/films/no-such-film/assemble", { shots: ["a.mp4"] });
    assert.equal(unknownFilm.status, 400);
    assert.equal(unknownFilm.json.error.code, 3);
  });

  test("without ffmpeg it is refused with core's install message, and no task starts", async () => {
    const noFfmpeg = createApp({
      key: KEY,
      deps,
      distDir: join(tmp, "nodist"),
      pollMs: 60_000,
      finish: { check: () => ({ ffmpeg: { ok: false, install: "ffmpeg not found on PATH. Finishing commands need it:\n  brew install ffmpeg" }, render: { ok: true, install: null } }) },
    });
    await new Promise((r) => noFfmpeg.listen(0, "127.0.0.1", r));
    try {
      const r = await post(noFfmpeg.address().port, "/api/films/finish-gated/assemble", { shots: ["a.mp4"] });
      assert.equal(r.status, 400);
      assert.equal(r.json.error.code, 1);
      assert.equal(r.json.error.tool, "ffmpeg");
      assert.match(r.json.error.message, /brew install ffmpeg/);
      assert.deepEqual(noFfmpeg.tasks.list(), []);
    } finally {
      await noFfmpeg.closeAll();
    }
  });
});
