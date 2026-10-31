import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../cli/lib/models.mjs";
import { suggestModel, suggestStillModel } from "../cli/director/pick.mjs";
import { generatedLength, shotFit, PAD_S } from "../cli/director/fit.mjs";

const catalog = loadCatalog();
const brief = { takeaway: "x", durationS: 10, aspectRatio: "16:9", filmType: "live-action" };
const shot = (job, durationS = 4) => ({ id: "s1", job, durationS });

/** A copy of the catalog with some models' fields replaced, for picker cases the real ratings do not cover. */
function withModels(patch) {
  const models = { ...catalog.models };
  for (const [id, fields] of Object.entries(patch)) models[id] = { ...models[id], ...fields };
  return { ...catalog, models, list: Object.entries(models).map(([id, m]) => ({ id, ...m })) };
}

describe("generated length", () => {
  test("the shortest length the model makes that covers the shot plus the pad", () => {
    assert.equal(PAD_S, 1);
    assert.equal(generatedLength({ durationsS: [4, 5, 6, 8] }, 4), 5);
    assert.equal(generatedLength({ durationsS: [8] }, 4), 8);
    assert.equal(generatedLength({ durationsS: [5, 10] }, 10), null);
  });

  test("shotFit prices the generated length from the still", () => {
    const f = shotFit(catalog, "minimax-h3", { plannedS: 14, aspectRatio: "16:9" });
    assert.equal(f.generatedS, 15);
    assert.deepEqual(f.problems, []);
    assert.equal(typeof f.estimateUsd, "number");
  });
});

describe("suggestModel", () => {
  test("the S-tier model for the job", () => {
    const s = suggestModel(catalog, shot("motion-graphics"), { brief });
    assert.equal(s.model, "minimax-h3");
    assert.equal(s.tier, "S");
    assert.equal(s.reason, "S tier for motion graphics.");
    assert.equal(s.generatedS, 5);
  });

  test("product hero reads the cinematic ratings", () => {
    assert.equal(suggestModel(catalog, shot("product-hero"), { brief }).model, "seedance-2-5");
  });

  test("a rated model that cannot start from a still is ruled out in plain words, and cinematic is the fallback", () => {
    const s = suggestModel(catalog, shot("ugc"), { brief });
    assert.equal(s.model, "seedance-2-5");
    assert.equal(s.ratings, "cinematic");
    assert.equal(s.reason, "Nothing rated for UGC-style footage can take this shot, so the best cinematic model: seedance-2-5 (S tier).");
    assert.deepEqual(s.ruledOut, [{ model: "wan-3-0", tier: "S", why: "wan-3-0 cannot start from a still yet: its image-to-video input has not been captured." }]);
  });

  test("a shot too long for the S model goes to the A model", () => {
    const cat = withModels({ "seedance-2": { goodFor: { animation: "S" } } });
    const s = suggestModel(cat, shot("animation", 15), { brief });
    assert.equal(s.model, "seedance-2-5");
    assert.equal(s.tier, "A");
    assert.match(s.ruledOut[0].why, /^seedance-2 makes at most \d+s; this shot needs 16s/);
  });

  test("within a tier, the cheaper model for this shot comes first", () => {
    const cat = withModels({ "seedance-2-fast": { goodFor: { cinematic: "S" } } });
    const a = suggestModel(cat, shot("cinematic"), { brief });
    const fast = shotFit(cat, "seedance-2-fast", { plannedS: 4, aspectRatio: "16:9" }).estimateUsd;
    const full = shotFit(cat, "seedance-2-5", { plannedS: 4, aspectRatio: "16:9" }).estimateUsd;
    assert.equal(a.model, fast < full ? "seedance-2-fast" : "seedance-2-5");
  });

  test("nothing fits: model null with every reason", () => {
    const s = suggestModel(catalog, shot("cinematic", 40), { brief });
    assert.equal(s.model, null);
    assert.equal(s.reason, "No rated model can take this shot.");
    assert.ok(s.ruledOut.length >= 1);
  });

  test("an unknown job is refused with the menu's jobs", () => {
    assert.throws(() => suggestModel(catalog, shot("vlog"), { brief }), /Choose one of: motion-graphics, cinematic/);
  });
});

describe("suggestStillModel", () => {
  test("by film type, and graphics always get the exact-text model", () => {
    assert.equal(suggestStillModel(shot("cinematic"), { brief }).model, "nano-banana-2");
    assert.equal(suggestStillModel(shot("cinematic"), { brief: { ...brief, filmType: "character" } }).model, "seedream-5-pro");
    assert.equal(suggestStillModel(shot("cinematic"), { brief: { ...brief, filmType: "product-hero" } }).model, "gpt-image-2-5");
    assert.equal(suggestStillModel(shot("motion-graphics"), { brief }).model, "gpt-image-2-5");
    assert.equal(suggestStillModel(shot("cinematic"), {}).model, "gpt-image-2-5");
  });
});

describe("fit beyond length and ratio", () => {
  const full = { id: "s1", durationS: 4, purpose: "p", subject: "x", action: "A phone turns", why: "w", size: "close-up", angle: "eye-level",
    lens: "50mm", depth: "shallow", move: { type: "push-in", speed: "slow" }, light: "soft-high-key", cut: "hard", job: "motion-graphics",
    screenDirection: "none", checks: ["ok"] };
  const plan = { look: { palette: "white", grade: "clean", filmLook: "digital", lensFamily: "spherical", keyLightSide: "left" }, shots: [full] };

  test("a model whose prompt limit the wording passes is ruled out", () => {
    const cat = withModels({ "minimax-h3": { promptProfile: { family: "hailuo", maxChars: 50, audioOff: null } } });
    const s = suggestModel(cat, full, { brief, plan });
    assert.notEqual(s.model, "minimax-h3");
    assert.match(s.ruledOut.find((r) => r.model === "minimax-h3").why, /^The wording is \d+ characters; minimax-h3 follows at most 50/);
  });

  test("the still model falls back when the film type's model lacks the ratio", () => {
    const wide = { ...brief, aspectRatio: "21:9" };
    const cat = withModels({ "nano-banana-2": { aspectRatios: ["16:9", "9:16", "1:1", "4:3"] } });
    assert.deepEqual(suggestStillModel(shot("cinematic"), { brief: wide, catalog: cat }), {
      model: "gpt-image-2-5",
      reason: "Nano Banana 2 makes no 21:9 stills, so GPT Image 2.5, which does.",
    });
    assert.equal(suggestStillModel(shot("cinematic"), { brief, catalog }).model, "nano-banana-2");
  });
});

describe("stills for a cast", () => {
  test("a stylised film with a cast moves to a model that takes reference sheets", () => {
    const character = { ...brief, filmType: "character" };
    assert.equal(suggestStillModel({ ...shot("cinematic"), cast: [] }, { brief: character, catalog }).model, "seedream-5-pro");
    assert.deepEqual(suggestStillModel({ ...shot("cinematic"), cast: ["zed"] }, { brief: character, catalog }), {
      model: "nano-banana-2",
      reason: "Seedream 5 Pro takes no reference images, so Nano Banana 2, which keeps the cast from their sheets.",
    });
  });
});
