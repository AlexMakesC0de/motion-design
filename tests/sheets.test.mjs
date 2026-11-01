import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sheetPrompt } from "../cli/core/sheets.mjs";

describe("sheetPrompt", () => {
  test("a character is Dan's three-panel sheet on 18% grey, filled from the fields", () => {
    const p = sheetPrompt({ kind: "character", description: "A man with dark curly hair and a full beard", outfit: "neon green jumpsuit, black boots" });
    assert.match(p, /^A three-panel character reference sheet composed as one horizontal image/);
    assert.match(p, /CHARACTER: A man with dark curly hair and a full beard/);
    assert.match(p, /OUTFIT: neon green jumpsuit, black boots/);
    assert.match(p, /LEFT PANEL — full body front view\. The figure stands squared to the camera, framed from above the head down to the shoes, arms relaxed at the sides, weight even on both feet\. The full outfit is clearly readable\./);
    assert.match(p, /CENTER PANEL — full body back view\. .* Hair, back of the outfit and shoes are clearly readable\./);
    assert.match(p, /RIGHT PANEL — tight chest-up face close-up\. .* neutral relaxed expression, lips closed\. Maximum facial detail\./);
    assert.match(p, /Skin tone is identical in every panel, never darker or tanned on the back view\./);
    assert.match(p, /one flat 18% neutral gray field, identical in all three panels, with no gradient, no floor, no wall and no vignette\./);
    assert.match(p, /Realistic skin with fine soft pore texture and a matte finish, real hair strands, real fabric texture, never plastic, never CGI\./);
    assert.match(p, /Even sharpness everywhere, no blur\. Photographed on a 50mm prime, soft natural film grain\. Photographed not generated\.$/);
    assert.match(p, /No text, no labels, no numbering anywhere in the image\./);
    assert.doesNotMatch(p, /attached reference/);
  });

  test("with source photos the prompt starts from them and the face must match", () => {
    const p = sheetPrompt({ kind: "character", description: "Alex", photos: 3 });
    assert.match(p, /^Generate the final image based on my attached reference photos\./);
    assert.match(p, /The face comes from the attached reference and must match it exactly in every panel: same face shape, bone structure, eyes, brows, nose, lips, skin tone and hair\./);
    assert.match(sheetPrompt({ kind: "character", description: "Alex", photos: 1 }), /^Generate the final image based on my attached reference photo\./);
  });

  test("an outfit left empty says to keep the one described", () => {
    assert.match(sheetPrompt({ kind: "character", description: "Alex" }), /OUTFIT: as described above/);
  });

  test("a location is a view with no people, 3/4 wide by default", () => {
    const p = sheetPrompt({ kind: "location", description: "an empty back alley with colourful graffiti" });
    assert.equal(p, "3/4 wide-angle view of an empty back alley with colourful graffiti. No people. No text.");
    assert.match(sheetPrompt({ kind: "location", description: "a beach", view: "Low eye-level" }), /^Low eye-level view of a beach\./);
  });

  test("a prop (product) is a front and top-down view on mid-grey", () => {
    const p = sheetPrompt({ kind: "product", description: "a neon green skydiving jumpsuit" });
    assert.match(p, /^Two views of the same object: FRONT view on the left of the frame, and top-down view on the right\. Both centered, same scale\. Flat seamless mid-grey background\./);
    assert.match(p, /The object: a neon green skydiving jumpsuit\./);
  });

  test("a style is its description as a mood image", () => {
    assert.equal(sheetPrompt({ kind: "style", description: "Warm dusk light, soft film grain" }), "Warm dusk light, soft film grain. No text.");
  });

  test("a description is required and the kind must be known", () => {
    assert.throws(() => sheetPrompt({ kind: "character", description: " " }), /description/);
    assert.throws(() => sheetPrompt({ kind: "vibe", description: "x" }), /kind must be one of/);
  });
});
