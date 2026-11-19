import { RUNS, KEY, deps, req, tmp } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const { createApp } = await import("../server/app.mjs");
const { CORE_TOOLS } = await import("../server/api/finish.mjs");

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const FILM = join(RUNS, "edit-demo");
mkdirSync(FILM, { recursive: true });
if (hasFfmpeg) {
  for (const [name, hz] of [["s1-draft.mp4", 440], ["s2-draft.mp4", 660]]) {
    spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24:duration=2", "-f", "lavfi", "-i", `sine=frequency=${hz}:duration=2`, "-pix_fmt", "yuv420p", "-shortest", join(FILM, name)]);
  }
}
const version = (job, file) => ({ job, kind: "draft", resolution: "480p", prompt: "p", createdAt: "2026-11-19T00:00:00Z", file: join(FILM, file), state: "succeeded", media: null, estimateUsd: 0.56, actualUsd: 0.56 });
const scene = (id, title, versions) => ({ id, title, durationS: 4, ratio: "16:9", refs: [], cards: { goal: "", scene: "", stages: [], style: "", audio: "" }, versions, chosen: null });
writeFileSync(join(FILM, "scenes.json"), JSON.stringify({ version: 1, idea: { text: "Two shots", ratio: "16:9", lengthS: 4 }, scenes: [scene("s1", "Painter", [version("j1", "s1-draft.mp4")]), scene("s2", "Pilot", [version("j2", "s2-draft.mp4")]), scene("s3", "Spare", [])] }));

const allOk = () => ({ ffmpeg: { ok: true, install: null }, render: { ok: true, install: null } });
let app, port;
before(async () => {
  app = createApp({ key: KEY, deps, distDir: join(tmp, "nodist"), pollMs: 60_000, finish: { tools: { ...CORE_TOOLS, render: async () => assert.fail("no titles in this edit") }, check: allOk } });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());

describe("a film's edit", { skip: !hasFfmpeg }, () => {
  test("with nothing saved, the edit plays each shot that has a take, whole, with its place in the film", async () => {
    const r = await req(port, "/api/films/edit-demo/edit");
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.saved, false);
    assert.deepEqual(r.json.clips.map((c) => [c.scene, c.sceneTitle, c.startS]), [["s1", "Painter", 0], ["s2", "Pilot", 2]]);
    assert.equal(r.json.lengthS, 4);
    assert.match(r.json.clips[0].url, /^\/media\/runs\/edit-demo\/s1-draft\.mp4$/);
    assert.equal(r.json.clips[0].file, undefined, "no paths on the page");
    assert.deepEqual(r.json.choices.into, ["cut", "fade"]);
  });

  test("saving checks the edit and answers with it resolved; a bad clip names its field", async () => {
    const bad = await req(port, "/api/films/edit-demo/edit", { method: "PUT", body: { clips: [{ scene: "s1", inS: 1.5, outS: 1 }] } });
    assert.equal(bad.status, 400);
    assert.match(bad.text, /end after it starts/);
    const r = await req(port, "/api/films/edit-demo/edit", { method: "PUT", body: { clips: [{ scene: "s2", inS: 0.5 }, { scene: "s1", outS: 1, speed: 0.5, into: "fade" }], titles: [] } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.saved, true);
    assert.deepEqual(r.json.clips.map((c) => [c.scene, c.lengthS]), [["s2", 1.5], ["s1", 2]]);
    const p = await req(port, "/api/films/edit-demo/progress");
    assert.deepEqual(p.json.next, { text: "Export the film", step: "finish" }, "the spare shot with no take asks for nothing");
  });

  test("export renders the edit to film.mp4 as a task, and the film is then up to date", async () => {
    const r = await req(port, "/api/films/edit-demo/export", { method: "POST", body: {} });
    assert.equal(r.status, 200, r.text);
    await app.tasks.idle();
    assert.ok(readdirSync(FILM).includes("film.mp4"));
    const p = await req(port, "/api/films/edit-demo/progress");
    assert.deepEqual(p.json.next, { text: "Watch the film", step: "finish" });
    assert.equal(p.json.cover.url, "/media/runs/edit-demo/film.mp4");
  });

  test("an unknown film is refused as code 3 and no folder is made", async () => {
    const r = await req(port, "/api/films/nope-film/edit");
    assert.equal(r.json.error.code, 3);
    assert.ok(!existsSync(join(RUNS, "nope-film")));
  });
});
