import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { VIDEO_PICKS, cleanVideoPicks, picksBlock, applyVideoPicks } from "../cli/director/video-picks.mjs";
import { loadMenu } from "../cli/director/menu.mjs";

const all = { move: "push-in", speed: "slow", size: "close-up", angle: "low", lens: "85mm", light: "golden-hour" };

describe("video picks", () => {
  test("the ten keys: a stage's, a scene's, the camera setup and the colour palette", () => {
    assert.deepEqual(Object.keys(VIDEO_PICKS), ["move", "speed", "size", "angle", "lens", "light", "camera", "lensLook", "depth", "palette"]);
  });

  test("clean: drops empties, null when nothing", () => {
    assert.equal(cleanVideoPicks(undefined), null);
    assert.equal(cleanVideoPicks({ lens: "" }), null);
    assert.deepEqual(cleanVideoPicks({ ...all, angle: "" }), { move: "push-in", speed: "slow", size: "close-up", lens: "85mm", light: "golden-hour" });
  });

  test("clean: refuses bad picks with field picks", () => {
    const fails = (input, re) => assert.throws(() => cleanVideoPicks(input), (e) => re.test(e.message) && e.field === "picks");
    fails({ zoom: "x" }, /The video has no "zoom" pick\. It takes: move, speed, size, angle, lens, light, camera, lensLook, depth, palette\./);
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
    assert.deepEqual(applyVideoPicks("a fox runs  ", undefined, { promptProfile: { family: "seedance", maxChars: 5 } }), { prompt: "a fox runs  ", picks: null, look: null, typedPrompt: null });
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

const { loadLooks, findLook } = await import("../cli/director/looks.mjs");
const { loadMenu: menuOf, entry } = await import("../cli/director/menu.mjs");

describe("looks", () => {
  test("every look's picks are on the menu, and its words fit a 2000-character model with room for a prompt", () => {
    const menu = menuOf();
    const groups = { move: "moves", speed: "speeds", size: "sizes", angle: "angles", lens: "lenses", light: "lights" };
    const { categories, looks } = loadLooks();
    assert.ok(looks.length >= 12);
    for (const l of looks) {
      assert.ok(categories.includes(l.category), `${l.id}: unknown category ${l.category}`);
      for (const [k, id] of Object.entries(l.picks)) entry(menu, groups[k], id);
      assert.equal(l.swatch.length, 3);
      const r = applyVideoPicks("x", undefined, { id: "m", promptProfile: { family: "seedance", maxChars: 2000 } }, { look: l.id });
      assert.ok(r.prompt.length < 700, `${l.id} adds ${r.prompt.length} characters`);
    }
  });

  test("a look's picks stand in only when no picks are sent; sent picks, even none, are used instead", () => {
    const m = { id: "m", promptProfile: { family: "seedance", maxChars: 6000 } };
    const withLook = applyVideoPicks("A fox.", undefined, m, { look: "neo-noir" });
    assert.deepEqual(withLook.picks, findLook("neo-noir").picks);
    assert.equal(withLook.look, "neo-noir");
    assert.match(withLook.prompt, /^A fox\.\n\nCamera: .*\nLook: Inky blacks/s);
    assert.match(withLook.prompt, /Sound: /);
    const none = applyVideoPicks("A fox.", {}, m, { look: "neo-noir" });
    assert.equal(none.picks, null);
    assert.doesNotMatch(none.prompt, /Camera:/);
    assert.match(none.prompt, /Look: /);
    const mine = applyVideoPicks("A fox.", { move: "static" }, m, { look: "neo-noir" });
    assert.deepEqual(mine.picks, { move: "static" });
  });

  test("a silent model family gets no sound line; an unknown look is refused by name", () => {
    const r = applyVideoPicks("A fox.", undefined, { id: "h", promptProfile: { family: "hailuo", maxChars: 2000 } }, { look: "neo-noir" });
    assert.doesNotMatch(r.prompt, /Sound:/);
    assert.throws(() => applyVideoPicks("A fox.", undefined, {}, { look: "nope" }), /No look "nope"\. Looks: golden-hour-drama/);
  });
});

describe("video picks: the camera setup", () => {
  test("camera body, lens look and aperture become one sentence after the camera line", () => {
    const block = picksBlock({ move: "push-in", camera: "35mm-film", lensLook: "warm-vintage", depth: "shallow" }, "seedance");
    assert.equal(block, "Camera: The camera pushes in.\nShot on 35mm film with fine grain and rich, natural colour, warm, soft-contrast vintage lenses, shallow depth of field.");
  });
});

describe("video picks: the colour palette", () => {
  test("a built-in palette is its own line after the light; an unknown one is refused", () => {
    const block = picksBlock({ move: "static", palette: "blue-hour" }, "seedance");
    assert.match(block, /\nColour palette: cold dusk blues and steel greys with a few warm window lights, quiet and melancholic\.$/);
    assert.throws(() => picksBlock({ palette: "nope" }, "seedance"), /"nope" is not a colour palette/);
  });
});
