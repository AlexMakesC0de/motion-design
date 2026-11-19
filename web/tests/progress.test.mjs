// web/tests/progress.test.mjs
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { progressOf } from "../server/progress.mjs";

const scene = (id, over = {}) => ({ id, title: id, durationS: 5, ratio: "16:9", refs: [], cards: { goal: "", scene: "", stages: [], style: "", audio: "" }, versions: [], chosen: null, ...over });
const version = (job, state = "succeeded") => ({ job, kind: "draft", resolution: "480p", createdAt: "2026-11-01T00:00:00Z", state });
const facts = (over = {}) => ({ outputs: 0, hasFilm: false, spentUsd: 0, legacy: false, ...over });
const film = (over = {}) => ({ idea: null, scenes: [], sheets: {}, ...over });

describe("progressOf", () => {
  test("nothing written: Idea is current, the other steps are open but not done", () => {
    const p = progressOf(film(), facts());
    assert.equal(p.step, "idea");
    assert.deepEqual(p.steps, { idea: "current", references: "todo", scenes: "todo", finish: "todo" });
    assert.deepEqual(p.next, { text: "Write the idea", step: "idea" });
  });

  test("an idea with no scenes asks for the scenes to be planned", () => {
    const p = progressOf(film({ idea: { text: "A boat" } }), facts());
    assert.deepEqual(p.next, { text: "Plan the scenes", step: "idea" });
  });

  test("a mentioned Library item with no sheet makes References current, naming it", () => {
    const p = progressOf(film({ scenes: [scene("s1")], sheets: { courier: false, alex: true } }), facts());
    assert.deepEqual(p.steps, { idea: "done", references: "current", scenes: "todo", finish: "todo" });
    assert.deepEqual(p.next, { text: "Make the sheet for courier", step: "references" });
  });

  test("no Library item mentioned: References is done", () => {
    const p = progressOf(film({ scenes: [scene("s1")] }), facts());
    assert.equal(p.steps.references, "done");
    assert.equal(p.step, "scenes");
  });

  test("shots with no take are named to make", () => {
    const p = progressOf(film({ scenes: [scene("s1", { versions: [version("j1")], chosen: "j1" }), scene("s2", { title: "Painter" }), scene("s3", { title: "Pilot" })] }), facts());
    assert.deepEqual(p.next, { text: "Make Painter and Pilot", step: "scenes" });
    assert.deepEqual(p.counts, { scenes: 3, versions: 1, chosen: 1, outputs: 0 });
  });

  test("a finished take is enough without a star; a take still making is waited for", () => {
    assert.equal(progressOf(film({ scenes: [scene("s1", { versions: [version("j1")] })] }), facts()).step, "finish");
    const p = progressOf(film({ scenes: [scene("s1", { title: "Ninja", versions: [version("j1", "submitted")] })] }), facts());
    assert.deepEqual(p.next, { text: "Wait for Ninja", step: "scenes" });
  });

  test("a saved edit leaves out spare scenes: a shot with no take that is not in the edit asks for nothing", () => {
    const f = film({ scenes: [scene("s1", { versions: [version("j1")] }), scene("s4", { title: "Pilot to open sky" })], edit: { scenes: ["s1"] } });
    assert.equal(progressOf(f, facts()).step, "finish");
    assert.deepEqual(progressOf(f, facts()).next, { text: "Export the film", step: "finish" });
  });

  test("an edit changed after the last export asks for a new export", () => {
    const f = film({ scenes: [scene("s1", { versions: [version("j1")] })], edit: { scenes: ["s1"] } });
    const p = progressOf(f, facts({ hasFilm: true, filmStale: true }));
    assert.equal(p.steps.finish, "current");
    assert.deepEqual(p.next, { text: "Export the new edit", step: "finish" });
  });

  test("every scene chosen: Finish is current; a film.mp4 marks it done", () => {
    const f = film({ scenes: [scene("s1", { versions: [version("j1")], chosen: "j1" })] });
    assert.equal(progressOf(f, facts()).step, "finish");
    assert.deepEqual(progressOf(f, facts()).next, { text: "Export the film", step: "finish" });
    const done = progressOf(f, facts({ hasFilm: true }));
    assert.equal(done.steps.finish, "done");
    assert.deepEqual(done.next, { text: "Watch the film", step: "finish" });
  });

  test("a folder made before Shard opens on Finish as takes only", () => {
    const p = progressOf(film(), facts({ legacy: true, outputs: 2 }));
    assert.equal(p.legacy, true);
    assert.equal(p.step, "finish");
    assert.deepEqual(p.steps, { idea: "todo", references: "todo", scenes: "todo", finish: "current" });
    assert.deepEqual(p.next, { text: "Made before Shard: takes only", step: "finish" });
    assert.equal(p.counts.outputs, 2);
  });
});
