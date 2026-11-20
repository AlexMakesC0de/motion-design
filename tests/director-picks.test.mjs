import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadMenu, entry } from "../cli/director/menu.mjs";
import { STAGE_PICKS, SCENE_PICKS, cameraWords, framingWords, stageWords, pickSentence, setPick, hasPicks, findMoveTags, expandMoveTags } from "../cli/director/picks.mjs";

const menu = loadMenu();
const pick = (group, id) => entry(menu, group, id);

describe("picks", () => {
  test("every pick names a group the menu has", () => {
    for (const group of [...Object.values(STAGE_PICKS), ...Object.values(SCENE_PICKS)]) assert.ok(Array.isArray(menu[group]), group);
  });

  test("camera words: static holds still, speed is optional", () => {
    assert.equal(cameraWords(pick("moves", "static"), pick("speeds", "slow")), "the camera holds still");
    assert.equal(cameraWords(pick("moves", "push-in")), "the camera pushes in");
    assert.equal(cameraWords(pick("moves", "push-in"), pick("speeds", "slow")), "the camera slowly pushes in");
    assert.equal(cameraWords(null), "");
  });

  test("framing words join what is there", () => {
    assert.equal(framingWords([pick("sizes", "close-up"), null, pick("angles", "low")]), "close-up, low angle");
    assert.equal(framingWords([]), "");
  });

  test("a stage's line: framing, then camera, as one sentence", () => {
    assert.equal(stageWords({ move: "push-in", speed: "slow", size: "close-up", angle: "low" }, pick), "Close-up, low angle; the camera slowly pushes in.");
    assert.equal(stageWords({ size: "close-up" }, pick), "Close-up.");
    assert.equal(stageWords({ move: "static" }, pick), "The camera holds still.");
    assert.equal(stageWords({}, pick), "");
    assert.equal(stageWords(undefined, pick), "");
  });

  test("a lens or light as a sentence", () => {
    assert.equal(pickSentence(pick("lights", "golden-hour")), "Warm, low golden-hour sunlight.");
    assert.equal(pickSentence(pick("lenses", "85mm")), "85mm portrait lens.");
    assert.equal(pickSentence(null), "");
  });

  test("setPick adds, swaps and removes; losing the move loses the speed", () => {
    assert.deepEqual(setPick(undefined, "move", "push-in"), { move: "push-in" });
    assert.deepEqual(setPick({ move: "push-in", speed: "slow" }, "move", "orbit-left"), { move: "orbit-left", speed: "slow" });
    assert.deepEqual(setPick({ move: "push-in", speed: "slow", size: "wide" }, "move", "static"), { move: "static", size: "wide" });
    assert.deepEqual(setPick({ move: "push-in", speed: "slow", size: "wide" }, "move", undefined), { size: "wide" });
    assert.equal(setPick({ size: "wide" }, "size", undefined), undefined);
  });

  test("hasPicks sees a pick on the cards or on any stage", () => {
    const cards = { goal: "", scene: "", stages: [{ title: "", seconds: 4, camera: "", action: "", end: "" }], style: "", audio: "" };
    assert.equal(hasPicks(cards), false);
    assert.equal(hasPicks({ ...cards, picks: { light: "neon" } }), true);
    assert.equal(hasPicks({ ...cards, stages: [{ ...cards.stages[0], picks: { move: "static" } }] }), true);
  });
});

describe("#move tags", () => {
  const moves = [
    { id: "push-in", label: "Dolly in", tag: "dolly-in", words: "pushes in", when: "" },
    { id: "static", label: "Static", words: "holds still", when: "" },
    { id: "whip-pan", label: "Whip pan", words: "whips sideways in a fast blurred pan", when: "" },
  ];
  test("finds the tags that name a move, longest id first, never inside a word", () => {
    assert.deepEqual(findMoveTags("#push-in-slow then C# and #nope, #whip-pan.", moves.map((m) => m.id)), [
      { start: 0, end: 8, id: "push-in" },
      { start: 33, end: 42, id: "whip-pan" },
    ]);
  });
  test("a move answers to its tag and, for older prompts, its id; the hit gives the id", () => {
    assert.deepEqual(findMoveTags("#dolly-in-slow, then #push-in.", moves), [
      { start: 0, end: 9, id: "push-in" },
      { start: 21, end: 29, id: "push-in" },
    ]);
    assert.equal(expandMoveTags("#dolly-in on her.", moves), "The camera pushes in on her.");
  });
  test("every move tag on the menu is unique and never another move's id", () => {
    const menu = loadMenu();
    const names = menu.moves.flatMap((m) => (m.tag ? [m.id, m.tag] : [m.id]));
    assert.equal(new Set(names).size, names.length);
  });
  test("writes each tag out in order, capitalised at a sentence start", () => {
    assert.equal(expandMoveTags("She turns, #whip-pan to the door. #push-in on the handle, then #static.", moves), "She turns, the camera whips sideways in a fast blurred pan to the door. The camera pushes in on the handle, then the camera holds still.");
  });
});
