import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../cli/lib/models.mjs";
import { shotWording } from "../cli/director/wording.mjs";

const catalog = loadCatalog();
const assets = [{ name: "mara", kind: "character", description: "A woman in her thirties, short black hair, olive raincoat." }];
const plan = {
  look: { palette: "teal and amber", grade: "soft contrast, lifted blacks", filmLook: "35mm film grain", lensFamily: "anamorphic", keyLightSide: "left" },
  shots: [],
};
const shot = {
  id: "s2", durationS: 6, purpose: "Her calm", subject: "mara", action: "Mara stops and looks out to sea", why: "The payoff",
  size: "close-up", angle: "eye-level", lens: "85mm", depth: "shallow", move: { type: "push-in", speed: "slow" },
  light: "golden-hour", cut: "on-action", job: "cinematic", screenDirection: "none", cast: ["mara"], copy: ["Find your coast"], checks: ["ok"],
};
const word = (model, extra = {}) => shotWording(catalog, plan, { ...shot, model, ...extra }, { assets });

const SUBJECT = "Subject: A woman in her thirties, short black hair, olive raincoat.";
const LOOK = "Look: 35mm film grain, teal and amber, soft contrast, lifted blacks, anamorphic lenses, key light from the left.";
const FRAMING = "close-up, eye-level angle, 85mm portrait lens, shallow depth of field";

describe("golden wording per family", () => {
  test("seedance: Shot 1 label, camera first, audio off", () => {
    const w = word("seedance-2-5");
    assert.equal(w.family, "seedance");
    assert.equal(w.prompt, [SUBJECT, LOOK, `Shot 1: The camera slowly pushes in, ${FRAMING}.`, "Mara stops and looks out to sea.", "Warm, low golden-hour sunlight.", "No on-screen text.", "No subtitles, no logo or watermark."].join("\n"));
    assert.deepEqual(w.params, { generate_audio: false });
    assert.deepEqual(w.problems, []);
  });

  test("hailuo: look line, then the bracket command", () => {
    const w = word("minimax-h3");
    assert.equal(w.prompt, [LOOK, "[Push in] Close-up, eye-level angle, 85mm portrait lens, shallow depth of field.", SUBJECT, "Mara stops and looks out to sea.", "Warm, low golden-hour sunlight.", "No on-screen text."].join("\n"));
    assert.deepEqual(w.params, {});
  });

  test("wan: one continuous shot, no dialogue or music", () => {
    assert.equal(word("wan-3-0").prompt, ["One continuous shot.", `Close-up, eye-level angle, 85mm portrait lens, shallow depth of field; the camera slowly pushes in.`, SUBJECT, "Mara stops and looks out to sea.", "Warm, low golden-hour sunlight.", LOOK, "No on-screen text.", "No dialogue. No background music."].join("\n"));
  });

  test("kling: subject and look first, then the shot line", () => {
    assert.equal(word("kling-3-0").prompt, [SUBJECT, LOOK, `Shot: ${FRAMING}; the camera slowly pushes in.`, "Mara stops and looks out to sea.", "Warm, low golden-hour sunlight.", "No on-screen text."].join("\n"));
  });

  test("veo: cinematography, subject, action, context, style", () => {
    assert.equal(word("veo-3-1").prompt, [`Close-up, eye-level angle, 85mm portrait lens, shallow depth of field, the camera slowly pushes in.`, SUBJECT, "Mara stops and looks out to sea.", "Warm, low golden-hour sunlight.", LOOK, "No on-screen text."].join("\n"));
  });
});

describe("wording rules", () => {
  test("a static camera holds still, and screen direction joins the action", () => {
    const w = word("seedance-2-5", { move: { type: "static" }, screenDirection: "left-to-right", copy: [] });
    assert.match(w.prompt, /^Shot 1: The camera holds still, /m);
    assert.match(w.prompt, /^Mara stops and looks out to sea, moving left to right\.$/m);
    assert.doesNotMatch(w.prompt, /No on-screen text/);
  });

  test("a lip-sync shot keeps its audio and drops the no-dialogue line", () => {
    assert.deepEqual(word("seedance-2-5", { job: "lip-sync" }).params, {});
    assert.doesNotMatch(word("wan-3-0", { job: "lip-sync" }).prompt, /No dialogue/);
  });

  test("a shot's own key light side overrides the look's", () => {
    assert.match(word("seedance-2-5", { keyLightSide: "right" }).prompt, /key light from the right\./);
  });

  test("the same plan always gives the same text", () => {
    assert.equal(word("seedance-2-5").prompt, word("seedance-2-5").prompt);
  });

  test("wording past the model's limit is a problem, with both numbers", () => {
    const w = word("wan-2-6", { action: "Mara walks ".repeat(200) });
    assert.equal(w.maxChars, 1500);
    assert.match(w.problems[0], /^The wording is \d+ characters; wan-2-6 follows at most 1500\./);
  });
});
