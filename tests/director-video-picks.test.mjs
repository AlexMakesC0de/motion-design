import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { VIDEO_PICKS, cleanVideoPicks, picksBlock, applyVideoPicks } from "../cli/director/video-picks.mjs";
import { loadMenu } from "../cli/director/menu.mjs";

const all = { move: "push-in", speed: "slow", size: "close-up", angle: "low", lens: "85mm", light: "golden-hour" };

describe("video picks", () => {
  test("the six keys", () => {
    assert.deepEqual(Object.keys(VIDEO_PICKS), ["move", "speed", "size", "angle", "lens", "light"]);
  });

  test("clean: drops empties, null when nothing", () => {
    assert.equal(cleanVideoPicks(undefined), null);
    assert.equal(cleanVideoPicks({ lens: "" }), null);
    assert.deepEqual(cleanVideoPicks({ ...all, angle: "" }), { move: "push-in", speed: "slow", size: "close-up", lens: "85mm", light: "golden-hour" });
  });

  test("clean: refuses bad picks with field picks", () => {
    const fails = (input, re) => assert.throws(() => cleanVideoPicks(input), (e) => re.test(e.message) && e.field === "picks");
    fails({ zoom: "x" }, /The video has no "zoom" pick\. It takes: move, speed, size, angle, lens, light\./);
    assert.throws(() => cleanVideoPicks({ light: "moonbeam" }), /not on the director's lights menu/);
    fails({ speed: "slow" }, /The video: a speed needs a move other than static\./);
    fails({ move: "static", speed: "slow" }, /a speed needs a move other than static/);
    fails("golden-hour", /The video's picks must be an object\./);
  });

  test("block for a Seedance-style model: camera line, lens, light", () => {
    assert.equal(picksBlock(all, "seedance"), "Camera: Close-up, low angle; the camera slowly pushes in.\n85mm portrait lens.\nWarm, low golden-hour sunlight.");
    assert.equal(picksBlock({ lens: "85mm" }, "seedance"), "85mm portrait lens.");
    assert.equal(picksBlock({}, "seedance"), "");
    assert.equal(picksBlock(null, "seedance"), "");
  });

  test("block for Hailuo: bracket then speed sentence, framing, lens, light", () => {
    assert.equal(picksBlock(all, "hailuo"), "[Push in] Slowly.\nClose-up, low angle.\n85mm portrait lens.\nWarm, low golden-hour sunlight.");
    assert.equal(picksBlock({ move: "push-in" }, "hailuo"), "[Push in]");
  });

  test("block for Hailuo without a bracket on the menu uses the camera sentence", () => {
    const menu = structuredClone(loadMenu());
    for (const m of menu.moves) delete m.hailuo;
    assert.equal(picksBlock({ move: "push-in", speed: "slow", size: "close-up" }, "hailuo", { menu }), "Close-up; the camera slowly pushes in.");
    assert.equal(picksBlock({ move: "push-in" }, "hailuo", { menu }), "The camera pushes in.");
  });

  test("apply: no picks leaves the prompt untouched", () => {
    assert.deepEqual(applyVideoPicks("a fox runs  ", undefined, { promptProfile: { family: "seedance", maxChars: 5 } }), { prompt: "a fox runs  ", picks: null, typedPrompt: null });
    assert.equal(applyVideoPicks("x", {}, {}).picks, null);
  });

  test("apply: adds the block after the typed prompt", () => {
    const r = applyVideoPicks("a fox runs  ", { lens: "85mm" }, { promptProfile: { family: "seedance", maxChars: 500 } });
    assert.equal(r.prompt, "a fox runs\n\n85mm portrait lens.");
    assert.deepEqual(r.picks, { lens: "85mm" });
    assert.equal(r.typedPrompt, "a fox runs  ");
  });

  test("apply: refuses when the block pushes past maxChars, only then", () => {
    const model = { id: "seedance-2", promptProfile: { family: "seedance", maxChars: 20 } };
    assert.throws(() => applyVideoPicks("a fox runs", { lens: "85mm" }, model), (e) => e.code === 3 && e.field === "prompt" &&
      /^Refused before submitting, nothing was spent\. With the picks the prompt is 31 characters; seedance-2 follows at most 20\. Shorten the prompt or remove a pick\.$/.test(e.message));
    assert.doesNotThrow(() => applyVideoPicks("a fox runs", { lens: "85mm" }, { promptProfile: { family: "x" } }));
  });

  test("apply: bad picks are refused", () => {
    assert.throws(() => applyVideoPicks("x", { light: "nope" }, {}), /not on the director's lights menu/);
  });
});
