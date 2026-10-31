// web/tests/progress.test.mjs
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { progressOf } from "../server/progress.mjs";

const brief = { takeaway: "Rain and coffee", durationS: 8, aspectRatio: "16:9", filmType: "live-action" };
const shot = (id, over = {}) => ({ id, continuesFrom: null, still: null, take: null, filming: [], ...over });
const facts = (over = {}) => ({ outputs: 0, hasFilm: false, spentUsd: 0, legacy: false, ...over });

describe("progressOf", () => {
  test("no brief: the Brief step is current and the rest are locked", () => {
    const p = progressOf({ brief: null, plan: null, shots: [] }, facts());
    assert.equal(p.step, "brief");
    assert.deepEqual(p.steps, { brief: "current", references: "locked", shots: "locked", finish: "locked" });
    assert.deepEqual(p.next, { text: "Write the brief", step: "brief" });
  });

  test("a brief without a plan asks for the shots to be planned", () => {
    const p = progressOf({ brief, plan: null, shots: [] }, facts());
    assert.equal(p.step, "brief");
    assert.deepEqual(p.next, { text: "Plan the shots", step: "brief" });
  });

  test("a plan with shots missing stills: Shots is current and names how many stills", () => {
    const b = { brief, plan: { shots: [{}, {}, {}] }, shots: [shot("s1", { still: "s1-still.png" }), shot("s2"), shot("s3", { continuesFrom: "s2" })] };
    const p = progressOf(b, facts());
    assert.deepEqual(p.steps, { brief: "done", references: "done", shots: "current", finish: "locked" });
    assert.deepEqual(p.next, { text: "Make 1 still", step: "shots" });
    assert.deepEqual(p.counts, { shots: 3, stills: 1, takes: 0, outputs: 0 });
  });

  test("every still made: names the shots left to film", () => {
    const b = { brief, plan: { shots: [{}, {}, {}] }, shots: [shot("s1", { still: "a", take: "s1-take.mp4" }), shot("s2", { still: "b" }), shot("s3", { still: "c" })] };
    assert.deepEqual(progressOf(b, facts()).next, { text: "Film s2 and s3", step: "shots" });
  });

  test("shots being filmed say so", () => {
    const b = { brief, plan: { shots: [{}] }, shots: [shot("s1", { still: "a", filming: ["j1"] })] };
    assert.deepEqual(progressOf(b, facts()).next, { text: "Filming 1 shot", step: "shots" });
  });

  test("every shot has a take and no film yet: Finish is current", () => {
    const b = { brief, plan: { shots: [{}] }, shots: [shot("s1", { still: "a", take: "t.mp4" })] };
    const p = progressOf(b, facts());
    assert.equal(p.step, "finish");
    assert.deepEqual(p.steps, { brief: "done", references: "done", shots: "done", finish: "current" });
    assert.deepEqual(p.next, { text: "Assemble the film", step: "finish" });
  });

  test("a film.mp4 marks Finish done", () => {
    const b = { brief, plan: { shots: [{}] }, shots: [shot("s1", { still: "a", take: "t.mp4" })] };
    const p = progressOf(b, facts({ hasFilm: true, outputs: 1, spentUsd: 0.6449 }));
    assert.equal(p.steps.finish, "done");
    assert.deepEqual(p.next, { text: "Watch the film", step: "finish" });
    assert.equal(p.spentUsd, 0.64);
  });

  test("a folder made before the studio opens on Finish as takes only", () => {
    const p = progressOf({ brief: null, plan: null, shots: [] }, facts({ legacy: true, outputs: 2 }));
    assert.equal(p.step, "finish");
    assert.equal(p.legacy, true);
    assert.deepEqual(p.next, { text: "Made before the studio: takes only", step: "finish" });
    assert.deepEqual(p.steps, { brief: "todo", references: "todo", shots: "todo", finish: "current" });
  });
  test("a saved plan with no shots keeps Brief current and asks for a shot", () => {
    const p = progressOf({ brief, plan: { shots: [] }, shots: [] }, facts());
    assert.equal(p.step, "brief");
    assert.deepEqual(p.steps, { brief: "current", references: "locked", shots: "locked", finish: "locked" });
    assert.deepEqual(p.next, { text: "Add a shot", step: "brief" });
  });

  test("a shot with a take but no still is not counted as needing a still", () => {
    const b = { brief, plan: { shots: [{}, {}] }, shots: [shot("s1", { take: "s1-take.mp4" }), shot("s2", { still: "b" })] };
    assert.deepEqual(progressOf(b, facts()).next, { text: "Film s2", step: "shots" });
  });
});
