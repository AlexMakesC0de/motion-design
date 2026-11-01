import { RUNS, tmp, hasFfmpeg, realPng, realMp4, stubs, connect, call, errorOf } from "./helpers.mjs";
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";

const { deps, calls } = stubs();
deps.generate.waitForTask = async () => ({ state: "success", urls: ["https://cdn.test/take.mp4"], data: { state: "success", creditsConsumed: 6 }, elapsedS: 2 });
deps.generate.download = async (url, path) => (renameSync(realMp4(`${path}.mp4`), path), path);
const client = await connect(deps);
const { openLibrary } = await import("../../cli/core/assets.mjs");
const ok = (r) => assert.equal(r.isError, undefined, JSON.stringify(r.content));
const data = (r) => r.structuredContent;

const cards = {
  goal: "@{r1} answers the door to @library:courier.",
  scene: "A flat at night.",
  stages: [
    { title: "Door", seconds: 3, camera: "wide", action: '@{r1} says {"Not mine."}', end: "" },
    { title: "Shrug", seconds: 2, camera: "close", action: "@library:courier shrugs.", end: "hard cut to black" },
  ],
  style: "Cinematic realism.",
  audio: "Dialogue only.",
};

describe("scenes through the tools", { skip: !hasFfmpeg && "needs ffmpeg" }, () => {
  before(() => {
    const sheet = realPng(join(tmp, "courier.png"), "1200x900");
    openLibrary().save({ name: "courier", kind: "character", description: "A courier.", keep: "his cap", images: [{ path: sheet, role: "sheet" }] }, { roots: [tmp] });
  });

  test("an image is copied into the film's refs, never over another", async () => {
    realPng(join(RUNS, "man.png"), "854x480");
    const a = await call(client, "add_scene_image", { run: "film", path: "man.png" });
    ok(a);
    assert.equal(data(a).source, "file:refs/man.png");
    const b = await call(client, "add_scene_image", { run: "film", path: "man.png" });
    assert.equal(data(b).source, "file:refs/man-2.png");
    assert.ok(existsSync(join(RUNS, "film", "refs", "man-2.png")));
  });

  test("save_scene creates a scene; its length is the stages' sum", async () => {
    const r = await call(client, "save_scene", { run: "film", title: "Door", refs: [{ id: "r1", source: "file:refs/man.png", keep: "his face" }], cards });
    ok(r);
    assert.equal(data(r).id, "s1");
    assert.equal(data(r).durationS, 5);
  });

  test("changing one card leaves every other field as it was", async () => {
    const before = data(await call(client, "list_scenes", { run: "film" })).scenes[0];
    const r = await call(client, "save_scene", { run: "film", id: "s1", cards: { style: "Warm film grain." } });
    ok(r);
    const after = data(r);
    assert.equal(after.cards.style, "Warm film grain.");
    assert.deepEqual({ ...after.cards, style: before.cards.style }, before.cards);
    assert.deepEqual([after.title, after.ratio, after.refs], [before.title, before.ratio, before.refs]);
  });

  test("the prompt preview shows the tokens, the Library item added, and prices", async () => {
    const r = await call(client, "get_scene_prompt", { run: "film", id: "s1" });
    ok(r);
    assert.deepEqual(data(r).problems, []);
    assert.match(data(r).prompt, /^\[GOAL\]\n\[Image 1\] answers the door to \[Image 2\]\./);
    assert.match(data(r).prompt, /\[Image 2\] — courier, character\. Preserve his cap\./);
    assert.equal(data(r).prices.draft.usd, 0.7); // 5s × $0.14 at 480p, from the catalog
    assert.equal(calls.create.length, 0);
  });

  test("a draft is refused with nothing spent while the preview has problems", async () => {
    ok(await call(client, "save_scene", { run: "film", id: "s1", refs: [{ id: "r1", source: "file:refs/man.png" }, { id: "r9", source: null }] }));
    const r = await call(client, "draft_scene", { run: "film", id: "s1" });
    assert.equal(r.isError, true);
    assert.equal(errorOf(r).code, 3);
    assert.match(r.content[0].text, /nothing was spent\. image 2 is empty/);
    assert.equal(calls.create.length, 0);
    ok(await call(client, "save_scene", { run: "film", id: "s1", refs: [{ id: "r1", source: "file:refs/man.png", keep: "his face" }] }));
  });

  test("a draft sends draft=true at 480p, records a version, and wait_job brings the video", async () => {
    const r = await call(client, "draft_scene", { run: "film", id: "s1" });
    ok(r);
    const sent = calls.create.at(-1).input;
    assert.equal(sent.draft, true);
    assert.equal(sent.resolution, "480p");
    assert.equal(sent.reference_image_urls.length, 2);
    const job = data(r).localJobId;
    ok(await call(client, "wait_job", { job_id: job }));
    const v = data(await call(client, "list_scenes", { run: "film" })).scenes[0].versions[0];
    assert.deepEqual([v.job, v.kind, v.state], [job, "draft", "succeeded"]);
    assert.match(v.file, /film\/s1-draft/);
    assert.equal(JSON.parse(readFileSync(join(RUNS, "film", "s1-inputs.json"), "utf8")).via, "mcp");
  });

  test("a final re-runs at the chosen resolution without draft; choose marks it", async () => {
    const r = await call(client, "final_scene", { run: "film", id: "s1", resolution: "720p" });
    ok(r);
    assert.equal(calls.create.at(-1).input.resolution, "720p");
    assert.notEqual(calls.create.at(-1).input.draft, true);
    const c = await call(client, "choose_version", { run: "film", id: "s1", job: data(r).localJobId });
    ok(c);
    assert.equal(data(c).chosen, data(r).localJobId);
  });

  test("update_asset changes keep; remove_asset moves it to the trash", async () => {
    const u = await call(client, "update_asset", { name: "courier", keep: "his red cap" });
    ok(u);
    assert.equal(data(u).keep, "his red cap");
    assert.equal(data(u).images[0].role, "sheet");
    const r = await call(client, "remove_asset", { name: "courier" });
    ok(r);
    assert.match(data(r).trashed, /^\.trash\/courier-/);
    assert.equal((await call(client, "get_asset", { name: "courier" })).isError, true);
  });

  test("delete_scene removes it", async () => {
    ok(await call(client, "delete_scene", { run: "film", id: "s1" }));
    assert.deepEqual(data(await call(client, "list_scenes", { run: "film" })).scenes, []);
  });
});
