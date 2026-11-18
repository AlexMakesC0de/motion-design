import { KEY, tmp, req } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { createApp } = await import("../server/app.mjs");
const { presetStills, stillUrl, lookStill } = await import("../server/stills.mjs");

let app, port;
before(async () => {
  app = createApp({ key: KEY, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());

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
