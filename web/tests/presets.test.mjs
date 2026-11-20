import { KEY, tmp, req } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { createApp } = await import("../server/app.mjs");
const { presetStills, stillUrl, lookStill } = await import("../server/stills.mjs");

// The repository ships no template stills (see web/server/stills.mjs), so the
// endpoint tests serve a fixture folder through SHARD_PRESET_STILLS_DIR.
const fixtureStills = join(tmp, "fixture-stills");
mkdirSync(fixtureStills, { recursive: true });
writeFileSync(join(fixtureStills, "kinetic-typography.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
writeFileSync(join(fixtureStills, "sources.json"), JSON.stringify({ stills: [{ preset: "kinetic-typography", file: "kinetic-typography.png" }] }));
process.env.SHARD_PRESET_STILLS_DIR = fixtureStills;
// Agreed camera-move clips: one real move, one file that is not a move.
const fixtureMoves = join(tmp, "fixture-moves");
mkdirSync(fixtureMoves, { recursive: true });
writeFileSync(join(fixtureMoves, "snorricam.mp4"), "0123456789");
writeFileSync(join(fixtureMoves, "not-a-move.mp4"), "mp4");
process.env.SHARD_MOVE_CLIPS_DIR = fixtureMoves;

let app, port;
before(async () => {
  app = createApp({ key: KEY, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => {
  app.closeAll();
  delete process.env.SHARD_PRESET_STILLS_DIR;
  delete process.env.SHARD_MOVE_CLIPS_DIR;
});

describe("presetStills", () => {
  test("lists only files named in sources.json that exist, with safe names", () => {
    const dir = join(tmp, "stills");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.png"), "png");
    writeFileSync(
      join(dir, "sources.json"),
      JSON.stringify({ stills: [{ preset: "a", file: "a.png" }, { preset: "b", file: "missing.png" }, { preset: "c", file: "../secret.png" }] }),
    );
    const stills = presetStills(dir);
    assert.deepEqual([...stills.keys()], ["a"]);
    assert.equal(stillUrl("a", stills), "/media/presets/a.png");
    assert.equal(stillUrl("b", stills), null);
  });

  test("the repository itself ships no template stills", () => {
    assert.equal(presetStills(join(import.meta.dirname, "..", "..", "docs", "images")).size, 0);
  });

  test("no sources.json means no stills, not an error", () => {
    assert.equal(presetStills(join(tmp, "nowhere")).size, 0);
  });
});

describe("preset endpoints", () => {
  test("the gallery lists every preset with its still URL and no server paths", async () => {
    const r = await req(port, "/api/presets");
    assert.equal(r.status, 200);
    const kt = r.json.find((p) => p.id === "kinetic-typography");
    assert.equal(kt.still, "/media/presets/kinetic-typography.png");
    assert.equal(kt.hasPrompt, true);
    assert.equal(kt.model, "minimax-h3");
    assert.ok(r.json.every((p) => !("sourcePromptPath" in p)));
  });

  test("one preset carries its source prompt text", async () => {
    const r = await req(port, "/api/presets/kinetic-typography");
    assert.equal(r.status, 200);
    assert.ok(r.json.prompt.length > 1000);
    assert.equal(r.json.durationS, 15);
  });

  test("an unknown preset is 400 with code 3", async () => {
    const r = await req(port, "/api/presets/nope");
    assert.equal(r.json.error.code, 3);
  });

  test("a still is served as a PNG with the media cookie; anything else under /media/presets is 404", async () => {
    const cookie = { cookie: `studio=${KEY}` };
    const r = await req(port, "/media/presets/kinetic-typography.png", { key: null, headers: cookie });
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "image/png");
    assert.equal(r.buf.subarray(1, 4).toString("latin1"), "PNG");
    assert.equal((await req(port, "/media/presets/nope.png", { key: null, headers: cookie })).status, 404);
    assert.equal((await req(port, "/media/presets/sources.json", { key: null, headers: cookie })).status, 404);
    assert.equal((await req(port, "/media/presets/kinetic-typography.png", { key: null })).status, 403);
  });
});

describe("model resolution choices", () => {
  test("a video model gets its first usable route's resolutions and default", async () => {
    const r = await req(port, "/api/models?capability=video");
    const s = r.json.find((m) => m.id === "seedance-2-5");
    assert.deepEqual(s.resolutionOptions, ["480p", "720p", "1080p"]);
    assert.equal(s.defaultResolution, "720p");
  });

  test("an image model keeps the resolutions listModels gives", async () => {
    const r = await req(port, "/api/models?capability=image");
    assert.deepEqual(r.json.find((m) => m.id === "gpt-image-2-5").resolutionOptions, ["1K", "2K", "4K"]);
  });
});

describe("looks", () => {
  test("GET /api/looks lists the looks by category, each with its picks, lines and a preview URL or null", async () => {
    const r = await req(port, "/api/looks");
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.categories.includes("Cinematic"));
    const noir = r.json.looks.find((l) => l.id === "neo-noir");
    assert.equal(noir.picks.light, "night-practicals");
    assert.ok(noir.still === null || noir.still === "/media/looks/neo-noir.jpg");
  });

  test("a look's preview is found by id only, and the media route serves look ids only", async () => {
    const dir = join(tmp, "look-stills");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "neo-noir.jpg"), "jpg");
    assert.equal(lookStill("neo-noir", dir), join(dir, "neo-noir.jpg"));
    assert.equal(lookStill("missing", dir), null);
    assert.equal(lookStill("../secret", dir), null);
    assert.equal((await req(port, "/media/looks/not-a-look.jpg")).status, 404);
  });
});

describe("camera move clips", () => {
  test("GET /api/camera-moves lists only menu moves that have a clip", async () => {
    const r = await req(port, "/api/camera-moves");
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { clips: { snorricam: "/media/moves/snorricam.mp4" } });
  });

  test("the media route serves a move's clip, with ranges, and nothing that is not a move", async () => {
    const whole = await req(port, "/media/moves/snorricam.mp4");
    assert.equal(whole.status, 200);
    assert.equal(whole.text, "0123456789");
    const part = await req(port, "/media/moves/snorricam.mp4", { headers: { range: "bytes=2-4" } });
    assert.equal(part.status, 206);
    assert.equal(part.text, "234");
    assert.equal((await req(port, "/media/moves/not-a-move.mp4")).status, 404);
    assert.equal((await req(port, "/media/moves/whip-pan.mp4")).status, 404);
  });
});

describe("colour palettes", () => {
  const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64")}`;

  test("GET /api/palettes lists built-in stills and your own palettes (none yet)", async () => {
    const r = await req(port, "/api/palettes");
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { stills: {}, own: [] });
  });

  test("a new palette is kept with its picture and words, is listed, can be picked for a video, and can be removed", async () => {
    const made = await req(port, "/api/palettes", { method: "POST", body: { name: "  Rainy  window ", colors: ["#0A0A0A", "#1f7a7a", "#f1e6c8"], picture: jpeg } });
    assert.equal(made.status, 200, made.text);
    assert.equal(made.json.id, "own-rainy-window");
    assert.equal(made.json.label, "Rainy window");
    assert.deepEqual(made.json.colors, ["#0a0a0a", "#1f7a7a", "#f1e6c8"]);
    assert.equal(made.json.words, "black, teal, cream");
    assert.equal(made.json.still, "/media/library/palettes/own-rainy-window.jpg");
    const pic = await req(port, made.json.still);
    assert.equal(pic.status, 200);

    // The same name again gets its own id.
    const again = await req(port, "/api/palettes", { method: "POST", body: { name: "Rainy window", colors: ["#000000", "#ffffff"] } });
    assert.equal(again.json.id, "own-rainy-window-2");
    assert.equal(again.json.still, null);
    const list = await req(port, "/api/palettes");
    assert.deepEqual(list.json.own.map((p) => p.id), ["own-rainy-window-2", "own-rainy-window"]);

    const { applyVideoPicks } = await import("../../cli/director/video-picks.mjs");
    const r = applyVideoPicks("A fox.", { palette: "own-rainy-window" }, { id: "m", promptProfile: { family: "seedance" } });
    assert.equal(r.prompt, "A fox.\n\nColour palette: black, teal, cream.");

    assert.equal((await req(port, "/api/palettes/own-rainy-window", { method: "DELETE" })).status, 200);
    assert.equal((await req(port, "/media/library/palettes/own-rainy-window.jpg")).status, 404);
    await req(port, "/api/palettes/own-rainy-window-2", { method: "DELETE" });
    assert.deepEqual((await req(port, "/api/palettes")).json.own, []);
    assert.throws(() => applyVideoPicks("A fox.", { palette: "own-rainy-window" }, {}), /"own-rainy-window" is not a colour palette/);
  });

  test("a palette needs a name, 2 to 12 #rrggbb colours and at most a small JPEG", async () => {
    for (const body of [
      { name: "", colors: ["#000000", "#ffffff"] },
      { name: "x", colors: ["#000000"] },
      { name: "x", colors: ["#000000", "red"] },
      { name: "x", colors: Array(13).fill("#000000") },
      { name: "x", colors: ["#000000", "#ffffff"], picture: "data:image/png;base64,AAAA" },
    ]) {
      const r = await req(port, "/api/palettes", { method: "POST", body });
      assert.equal(r.status, 400, `${JSON.stringify(body)} → ${r.text}`);
    }
    assert.equal((await req(port, "/api/palettes/own-nope", { method: "DELETE" })).status, 400);
  });

  test("a built-in palette's still is served from runs/palettes/ when it has one", async () => {
    const dir = join(tmp, "fixture-palettes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "blue-hour.jpg"), "jpg");
    writeFileSync(join(dir, "not-a-palette.jpg"), "jpg");
    process.env.SHARD_PALETTE_STILLS_DIR = dir;
    try {
      assert.deepEqual((await req(port, "/api/palettes")).json.stills, { "blue-hour": "/media/palettes/blue-hour.jpg" });
      assert.equal((await req(port, "/media/palettes/blue-hour.jpg")).text, "jpg");
      assert.equal((await req(port, "/media/palettes/not-a-palette.jpg")).status, 404);
    } finally {
      delete process.env.SHARD_PALETTE_STILLS_DIR;
    }
  });
});
