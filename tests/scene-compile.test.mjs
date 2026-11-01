import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { png } from "./fixtures/images.mjs";
import { openLibrary } from "../cli/core/assets.mjs";
import { compileScene } from "../cli/director/scene.mjs";

const dir = mkdtempSync(join(tmpdir(), "kie-compile-"));
const img = (name, w = 600, h = 400) => { const p = join(dir, name); writeFileSync(p, png(w, h)); return p; };
const library = openLibrary(join(dir, "library"));
library.save({ name: "alexandros", kind: "character", description: "A man with a beard.", keep: "exact face and glasses", images: [img("a.png"), { path: img("sheet.png", 900, 300), role: "sheet" }] });
library.save({ name: "jumpsuit", kind: "product", description: "A neon green jumpsuit.", images: [{ path: img("j.png"), role: "sheet" }] });
library.save({ name: "maya", kind: "character", description: "Maya.", images: [img("m.png")] });

const scene = (over = {}) => ({
  id: "s1", title: "Freefall", durationS: 8, ratio: "9:16",
  refs: [{ id: "r1", source: "library:alexandros" }, { id: "r2", source: "file:refs/door.png", keep: "the door frame" }],
  cards: {
    goal: "@{r1} leaves the plane.",
    scene: "Over the Alps.",
    stages: [
      { title: "Exit", seconds: 4, camera: "Behind him, framed like @{r2}", action: "He drops.", end: "Hard cut." },
      { title: "Freefall", seconds: 4, camera: "Facing him.", action: "@library:jumpsuit flaps.", end: "" },
    ],
    style: "Film grain.", audio: "<wind>",
  },
  ...over,
});

describe("compileScene", () => {
  test("Dan's sections, in order, with every mention as the model's token", () => {
    const { prompt, refs, problems } = compileScene(scene(), { film: "sky", library });
    assert.deepEqual(problems, []);
    assert.equal(prompt, [
      "[GOAL]", "[Image 1] leaves the plane.", "",
      "[REFERENCES]",
      "[Image 1] — alexandros, character. Preserve exact face and glasses.",
      "[Image 2] — door.png. Preserve the door frame.",
      "[Image 3] — jumpsuit, prop. Preserve A neon green jumpsuit.",
      "Do not reproduce reference-sheet panels, grey studio backgrounds or labels.", "",
      "[SCENE]", "Over the Alps.", "",
      "[STAGE 1 | 0–4 SECONDS | EXIT]", "Camera: Behind him, framed like [Image 2]", "Action: He drops.", "End: Hard cut.", "",
      "[STAGE 2 | 4–8 SECONDS | FREEFALL]", "Camera: Facing him.", "Action: [Image 3] flaps.", "",
      "[VISUAL STYLE]", "Film grain.", "",
      "[AUDIO]", "<wind>", "",
      "[MAINTAIN CONSISTENCY]", "Keep every person, product and place exactly as in their reference images in every stage.",
    ].join("\n"));
    assert.deepEqual(refs, [
      { source: "alexandros#2", role: "identity" },
      { source: join("sky", "refs/door.png"), role: "identity" },
      { source: "jumpsuit#1", role: "identity" },
    ]);
  });

  test("reordering refs renumbers the prompt", () => {
    const s = scene();
    const { prompt } = compileScene({ ...s, refs: [s.refs[1], s.refs[0]] }, { film: "sky", library });
    assert.match(prompt, /^\[GOAL\]\n\[Image 2\] leaves the plane\./);
  });

  test("the token comes from the model's profile", () => {
    const { prompt } = compileScene(scene(), { film: "sky", library, refToken: "@Image {n}" });
    assert.match(prompt, /@Image 1 leaves the plane/);
  });

  test("empty sections are left out", () => {
    const s = scene();
    const { prompt } = compileScene({ ...s, cards: { ...s.cards, style: "", audio: " " } }, { film: "sky", library });
    assert.doesNotMatch(prompt, /VISUAL STYLE|\[AUDIO\]/);
  });

  test("refusals name the item and what to do, and send no refs", () => {
    const s = scene({ refs: [{ id: "r1", source: null }, { id: "r2", source: "library:maya" }, { id: "r3", source: "library:ghost" }] });
    const { refs, problems } = compileScene({ ...s, cards: { ...s.cards, goal: "@image7 and @{r1}" } }, { film: "sky", library });
    assert.deepEqual(refs, []);
    assert.deepEqual(problems, [
      "image 1 is empty. Choose a picture or remove it.",
      "@library:maya has no sheet yet. Make one in the Library.",
      "@library:ghost is not in the Library. Make it in the Library first.",
      "@image7: there is no image 7 in this scene.",
    ]);
  });
});
