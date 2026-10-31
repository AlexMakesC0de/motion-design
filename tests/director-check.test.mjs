import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../cli/lib/models.mjs";
import { checkPlan } from "../cli/director/check.mjs";

const catalog = loadCatalog();
const brief = { takeaway: "x", durationS: 10, aspectRatio: "16:9", filmType: "live-action" };
const assets = [{ name: "mara", kind: "character", description: "A woman in an olive raincoat." }];
const look = { palette: "teal", grade: "soft", filmLook: "35mm grain", lensFamily: "spherical", keyLightSide: "left" };
const shot = (id, durationS, extra = {}) => ({
  id, durationS, purpose: "p", subject: "mara", action: "Mara walks along the pier", why: "w",
  size: "wide", angle: "eye-level", lens: "35mm", depth: "deep", move: { type: "truck-left", speed: "slow" },
  light: "overcast", cut: "hard", job: "cinematic", screenDirection: "left-to-right", checks: ["ok"],
  model: "seedance-2-5", stillModel: "nano-banana-2", ...extra,
});
// A sound 10s plan: a wide then a close-up.
const good = () => ({ look: { ...look }, shots: [shot("s1", 4), shot("s2", 6, { size: "close-up", lens: "85mm", screenDirection: "none" })] });
const check = (plan, b = brief) => checkPlan(plan, { catalog, brief: b, assets });
const rules = (findings) => findings.map((f) => f.rule);

describe("a sound plan", () => {
  test("has no errors and no warnings", () => {
    assert.deepEqual(check(good()), { errors: [], warnings: [] });
  });
});

describe("errors", () => {
  const errs = (plan, b) => check(plan, b).errors;

  test("shape: no shots, missing fields, a bad or repeated id, bad checks", () => {
    assert.deepEqual(rules(errs({ look, shots: [] })), ["shape"]);
    const p = good();
    delete p.shots[0].why;
    p.shots[1].id = "s1";
    p.shots[1].checks = [];
    const e = errs(p);
    assert.ok(e.some((x) => x.message === "s1: why is missing."));
    assert.ok(e.some((x) => x.message === "Two shots are called s1."));
    assert.ok(e.some((x) => /checks must be 1 to 3/.test(x.message)));
    assert.match(errs({ look, shots: [shot("S 1", 10)] })[0].message, /Shot id "S 1" must be short lowercase/);
  });

  test("look: words for palette, grade and film look; lens family and key side from the menu", () => {
    const e = errs({ look: { lensFamily: "fisheye" }, shots: [shot("s1", 10, { size: "medium" })] });
    assert.deepEqual(e.map((x) => x.message), [
      "look.palette is missing; say it in words.",
      "look.grade is missing; say it in words.",
      "look.filmLook is missing; say it in words.",
      "look.lensFamily must be one of: spherical, anamorphic.",
      "look.keyLightSide must be one of: left, right, front, back, top.",
    ]);
  });

  test("menu: a value not on the menu names the valid ones", () => {
    const p = good();
    p.shots[0].size = "huge";
    assert.equal(errs(p)[0].message, 's1: size "huge" is not on the menu. Choose one of: extreme-wide, wide, full, medium-wide, medium, medium-close-up, close-up, extreme-close-up, insert.');
  });

  test("one-move: a list of moves is refused", () => {
    const p = good();
    p.shots[0].move = [{ type: "push-in", speed: "slow" }, { type: "pan-left", speed: "slow" }];
    assert.deepEqual(rules(errs(p)), ["one-move"]);
  });

  test("a moving camera needs a speed; a static one does not", () => {
    const p = good();
    p.shots[0].move = { type: "push-in" };
    assert.match(errs(p)[0].message, /move speed must be one of: slow, medium, fast/);
    p.shots[0].move = { type: "static" };
    assert.deepEqual(errs(p), []);
  });

  test("model-fit: a shot longer than the model makes, counting the trim margin", () => {
    const p = { look, shots: [shot("s1", 10, { model: "kling-3-0", size: "medium" })] };
    assert.deepEqual(errs(p).map((x) => x.message), ["s1: kling-3-0 makes at most 10s; this shot needs 11s including the 1s trim margin."]);
  });

  test("model-fit: a model that cannot start from a still", () => {
    const p = { look, shots: [shot("s1", 4, { model: "wan-3-0", size: "medium" }), shot("s2", 6, { size: "close-up" })] };
    assert.match(errs(p)[0].message, /^s1: No captured contract/);
  });

  test("model-fit: no model at all, and an unknown still model", () => {
    const p = good();
    delete p.shots[0].model;
    p.shots[1].stillModel = "paint-3";
    const e = errs(p);
    assert.equal(e[0].message, "s1: no model fits this shot.");
    assert.match(e[1].message, /^s2: still: Unknown model "paint-3"/);
  });

  test("last-continuous: the last shot cannot continue into nothing", () => {
    const p = good();
    p.shots[1].cut = "continuous";
    assert.deepEqual(rules(errs(p)), ["last-continuous"]);
  });

  test("text-in-action: quoted words, prices and percentages belong in copy", () => {
    for (const action of ['A sign reads "Open now"', "The price drops to $49", "Battery fills to 80%", "Price falls to €12"]) {
      const p = good();
      p.shots[0].action = action;
      assert.deepEqual(rules(errs(p)), ["text-in-action"], action);
    }
    const p = good();
    p.shots[0].action = "Mara walks 20 steps along the pier";
    assert.deepEqual(errs(p), [], "a plain number is fine");
  });

  test("unknown-cast: in a shot and in the look", () => {
    const p = good();
    p.shots[0].cast = ["ghost"];
    p.look.cast = [{ asset: "phantom", role: "character" }];
    assert.deepEqual(errs(p).map((x) => x.message), [
      'look.cast names "phantom", which is not in the Library. Save it first or remove it.',
      's1: cast names "ghost", which is not in the Library. Save it first or remove it.',
    ]);
    p.shots[0].cast = ["mara"];
    p.look.cast = [{ asset: "mara", role: "character" }];
    assert.deepEqual(errs(p), []);
  });

  test("total-length: within one second of the brief", () => {
    const p = good();
    p.shots[1].durationS = 7;
    assert.deepEqual(errs(p), [], "11s against 10s is fine");
    p.shots[1].durationS = 8;
    assert.equal(errs(p)[0].message, "The shots add up to 12s; the brief asks for 10s.");
    assert.deepEqual(errs(p, null), [], "no brief, no length rule");
  });

  test("screen-direction: the same subject flipping direction crosses the line", () => {
    const p = good();
    p.shots[1].screenDirection = "right-to-left";
    assert.equal(errs(p)[0].message, "s2: mara travels right to left after left to right in s1, which crosses the line. Keep the direction, or say why in crossesLine.");
    p.shots[1].crossesLine = "She turns back toward home.";
    assert.deepEqual(errs(p), []);
    p.shots[1].subject = "the gull";
    delete p.shots[1].crossesLine;
    assert.deepEqual(errs(p), [], "another subject may travel the other way");
  });

  test("wording-length: a shot worded past its model's limit", () => {
    const p = { look, shots: [shot("s1", 4, { model: "minimax-h3", action: "Mara walks along the pier ".repeat(90) }), shot("s2", 6, { size: "close-up" })] };
    assert.deepEqual(rules(errs(p)), ["wording-length"]);
  });

  test("errors do not stop at the first: every reason is reported", () => {
    const p = good();
    p.shots[0].size = "huge";
    p.shots[1].cut = "continuous";
    assert.deepEqual(rules(errs(p)), ["menu", "last-continuous"]);
  });
});

describe("warnings", () => {
  const warns = (plan, b) => check(plan, b).warnings;

  test("same-size-run: three of one size in a row", () => {
    const p = { look, shots: [shot("a", 3, { size: "medium" }), shot("b", 3, { size: "medium", angle: "low" }), shot("c", 4, { size: "medium" })] };
    assert.deepEqual(rules(warns(p)), ["same-size-run", "no-wide"]);
  });

  test("jump-cut: same subject, size and angle, unless the cut is continuous", () => {
    const p = { look, shots: [shot("a", 4), shot("b", 6)] };
    assert.equal(warns(p)[0].message, "b: same subject, size and angle as a, which reads as a jump cut. Change the size or the angle.");
    p.shots[0].cut = "continuous";
    assert.deepEqual(warns(p), []);
  });

  test("wide-lens-close: a wide lens close on a face, but not on a product or graphics", () => {
    const p = good();
    p.shots[1].lens = "24mm";
    assert.equal(warns(p)[0].message, "s2: a 24mm lens this close distorts a face. An 85mm flatters it.");
    p.shots[1].job = "product-hero";
    assert.deepEqual(warns(p), []);
  });

  test("fast-move-short: a fast move in four seconds or less", () => {
    const p = good();
    p.shots[0].move = { type: "push-in", speed: "fast" };
    assert.deepEqual(rules(warns(p)), ["fast-move-short"]);
  });

  test("light-side: the key light changes side without a reason", () => {
    const p = good();
    p.shots[1].keyLightSide = "right";
    assert.deepEqual(rules(warns(p)), ["light-side"]);
    p.shots[1].lightReason = "She turns to the window.";
    assert.deepEqual(warns(p), []);
  });

  test("seedance-long: a Seedance shot past eight seconds", () => {
    const p = { look, shots: [shot("s1", 10)] };
    assert.deepEqual(rules(warns(p)), ["seedance-long"]);
  });

  test("no-wide: a live-action film with no wide, but not other film types", () => {
    const p = good();
    p.shots[0].size = "medium";
    assert.deepEqual(rules(warns(p)), ["no-wide"]);
    assert.deepEqual(warns(p, { ...brief, filmType: "product-ui" }), []);
  });

  test("wan-orbit: an orbit on Wan", () => {
    const p = good();
    p.shots[1].model = "wan-2-6";
    p.shots[1].move = { type: "orbit-left", speed: "slow" };
    assert.ok(rules(warns(p)).includes("wan-orbit"));
  });

  test("warnings never block: a plan with warnings has no errors", () => {
    const p = { look, shots: [shot("s1", 10)] };
    assert.deepEqual(check(p).errors, []);
  });
});
