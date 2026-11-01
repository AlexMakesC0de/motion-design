import { RUNS, LIBRARY, KEY, generateStubs, req, tmp } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { png } from "../../tests/fixtures/images.mjs";

const { createApp } = await import("../server/app.mjs");
const { openLibrary } = await import("../../cli/core/assets.mjs");
let app, port, calls;

before(async () => {
  const lib = openLibrary(LIBRARY);
  const p = join(tmp, "sheet.png");
  writeFileSync(p, png(900, 600));
  lib.save({ name: "alexandros", kind: "character", description: "A man.", keep: "exact face", images: [{ path: p, role: "sheet" }] }, { roots: [tmp] });
  const stubs = generateStubs({ estimateUsd: 0.56 });
  calls = stubs.calls;
  app = createApp({ key: KEY, deps: stubs.deps, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());

const scene = { title: "Freefall", durationS: 4, ratio: "9:16", refs: [{ id: "r1", source: "library:alexandros" }], cards: { goal: "@{r1} jumps.", scene: "", stages: [], style: "", audio: "" } };

describe("scenes api", () => {
  test("create, read, edit, order, delete", async () => {
    const a = await req(port, "/api/films/create/scenes", { method: "POST", body: scene });
    assert.equal(a.status, 200, a.text);
    assert.equal(a.json.id, "s1");
    await req(port, "/api/films/create/scenes", { method: "POST", body: scene });
    const e = await req(port, "/api/films/create/scenes/s1", { method: "PUT", body: { ...scene, title: "Exit" } });
    assert.equal(e.json.title, "Exit");
    await req(port, "/api/films/create/scenes/order", { method: "PUT", body: { ids: ["s2", "s1"] } });
    assert.deepEqual((await req(port, "/api/films/create/scenes")).json.scenes.map((s) => s.id), ["s2", "s1"]);
    await req(port, "/api/films/create/scenes/s2", { method: "DELETE" });
    assert.deepEqual((await req(port, "/api/films/create/scenes")).json.scenes.map((s) => s.id), ["s1"]);
  });

  test("a bad scene is refused with its field", async () => {
    const r = await req(port, "/api/films/create/scenes", { method: "POST", body: { ...scene, ratio: "5:4" } });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.field, "ratio");
  });

  test("the prompt preview compiles with [Image N] and prices the draft and finals", async () => {
    const r = await req(port, "/api/films/create/scenes/s1/prompt");
    assert.equal(r.status, 200, r.text);
    assert.match(r.json.prompt, /^\[GOAL\]\n\[Image 1\] jumps\./);
    assert.deepEqual(r.json.problems, []);
    assert.equal(r.json.prices.draft.usd, 0.56);
    assert.ok(r.json.prices.final1080.usd > r.json.prices.final720.usd);
  });

  test("a draft sends draft=true at 480p with the sheet as reference, and records a version", async () => {
    const r = await req(port, "/api/films/create/scenes/s1/draft", { method: "POST", body: {} });
    assert.equal(r.status, 200, r.text);
    const sent = calls.create.at(-1).input;
    assert.equal(sent.draft, true);
    assert.equal(sent.resolution, "480p");
    assert.equal(sent.aspect_ratio, "9:16");
    assert.equal(sent.reference_image_urls.length, 1);
    assert.match(sent.prompt, /\[Image 1\] jumps\./);
    assert.deepEqual(r.json.scene.versions.map((v) => [v.kind, v.resolution]), [["draft", "480p"]]);
    await app.follower.idle();
    const v = (await req(port, "/api/films/create/scenes")).json.scenes[0].versions[0];
    assert.equal(v.state, "succeeded");
    assert.match(v.media, /^\/media\/runs\/create\/s1-draft/);
  });

  test("a final re-runs at the chosen resolution without draft", async () => {
    const r = await req(port, "/api/films/create/scenes/s1/final", { method: "POST", body: { resolution: "1080p" } });
    assert.equal(r.status, 200, r.text);
    const sent = calls.create.at(-1).input;
    assert.equal(sent.resolution, "1080p");
    assert.notEqual(sent.draft, true);
    assert.equal(r.json.scene.versions.at(-1).kind, "final");
  });

  test("choose marks a version", async () => {
    const s = (await req(port, "/api/films/create/scenes")).json.scenes[0];
    const r = await req(port, "/api/films/create/scenes/s1/choose", { method: "POST", body: { job: s.versions[0].job } });
    assert.equal(r.json.chosen, s.versions[0].job);
  });

  test("a scene with an empty slot is refused before anything is reserved", async () => {
    const before = calls.create.length;
    await req(port, "/api/films/create/scenes/s1", { method: "PUT", body: { ...scene, refs: [...scene.refs, { id: "r2", source: null }] } });
    const r = await req(port, "/api/films/create/scenes/s1/draft", { method: "POST", body: {} });
    assert.equal(r.status, 400);
    assert.deepEqual(r.json.error.problems, ["image 2 is empty. Choose a picture or remove it."]);
    assert.equal(calls.create.length, before);
  });

  test("an uploaded ref lands in the film's refs folder", async () => {
    const r = await req(port, "/api/films/create/refs?name=Door%20View.png", { method: "POST", body: png(400, 400), headers: { "content-type": "image/png" } });
    assert.equal(r.status, 200, r.text);
    assert.match(r.json.source, /^file:refs\/door-view(-\d+)?\.png$/);
    assert.ok(existsSync(join(RUNS, "create", r.json.source.slice(5))));
  });

  test("the preview names a picture Seedance would refuse", async () => {
    const up = await req(port, "/api/films/create/refs?name=tiny.png", { method: "POST", body: png(200, 200), headers: { "content-type": "image/png" } });
    await req(port, "/api/films/create/scenes/s1", { method: "PUT", body: { ...scene, refs: [...scene.refs, { id: "r2", source: up.json.source }] } });
    const r = await req(port, "/api/films/create/scenes/s1/prompt");
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.problems, ["tiny.png is 200×200; Seedance needs 300 to 6000px on each side. Use a bigger picture."]);
  });
});
