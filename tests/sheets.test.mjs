import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sheetPrompt } from "../cli/core/sheets.mjs";

describe("sheetPrompt", () => {
  test("a character is Dan's three-panel sheet on 18% grey, filled from the fields", () => {
    const p = sheetPrompt({ kind: "character", description: "A man with dark curly hair and a full beard", outfit: "neon green jumpsuit, black boots" });
    assert.match(p, /^A three-panel character reference sheet composed as one horizontal image/);
    assert.match(p, /CHARACTER: A man with dark curly hair and a full beard/);
    assert.match(p, /OUTFIT: neon green jumpsuit, black boots/);
    assert.match(p, /LEFT PANEL: full-body front view/);
    assert.match(p, /CENTER PANEL: full-body back view/);
    assert.match(p, /RIGHT PANEL: tight chest-up close-up of the face/);
    assert.match(p, /18% neutral gray/);
    assert.match(p, /No text, no labels, no numbering/);
    assert.doesNotMatch(p, /attached reference/);
  });

  test("with source photos the prompt starts from them and the face must match", () => {
    const p = sheetPrompt({ kind: "character", description: "Alex", photos: 3 });
    assert.match(p, /^Generate the final image based on my attached reference photos\./);
    assert.match(p, /The face comes from the attached reference and must match it exactly in every panel\./);
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
