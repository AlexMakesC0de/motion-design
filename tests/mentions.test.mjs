import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_REFS, normalizeMentions, toDisplay, toStored, mentionSpans, removeRef, attachLibraryMentions, cardTexts, mapCardTexts, refLabel,
} from "../cli/director/mentions.mjs";

const refs = [{ id: "r1", source: "library:alexandros" }, { id: "r2", source: "file:refs/door.png" }];
const items = new Map([["alexandros", { hasSheet: true }], ["maya", { hasSheet: false }]]);

describe("pasted forms", () => {
  test("every pasted form becomes @imageN or @library:name", () => {
    assert.equal(
      normalizeMentions("[@image2] then @Image 3, <<<image_1>>>, [Image 4], @image5 and [@library:maya]"),
      "@image2 then @image3, @image1, @image4, @image5 and @library:maya",
    );
  });
  test("words that only look close are left alone", () => {
    assert.equal(normalizeMentions("email@image2x.com and imageN"), "email@image2x.com and imageN");
  });
});

describe("binding", () => {
  test("stored text binds by id and shows by position", () => {
    assert.equal(toDisplay("@{r2} beside @{r1}", refs), "@image2 beside @image1");
    const { text, refs: same } = toStored("@image2 beside @image1", refs);
    assert.equal(text, "@{r2} beside @{r1}");
    assert.equal(same, refs);
  });
  test("reordering refs renumbers what is shown", () => {
    assert.equal(toDisplay("@{r2}", [refs[1], refs[0]]), "@image1");
  });
  test("while typing, an image number past the list stays as typed", () => {
    const { text, refs: out } = toStored("@image7", refs);
    assert.equal(text, "@image7");
    assert.equal(out.length, 2);
  });
  test("settling (paste or leaving the field) normalises and adds empty slots up to the highest number", () => {
    const { text, refs: out } = toStored("[@image4] and @image1", refs, { settle: true });
    assert.deepEqual(out.map((r) => [r.id, r.source]), [["r1", "library:alexandros"], ["r2", "file:refs/door.png"], ["r3", null], ["r4", null]]);
    assert.equal(text, "@{r4} and @{r1}");
  });
  test("slots stop at MAX_REFS", () => {
    const { text, refs: out } = toStored("@image12", [], { settle: true });
    assert.equal(MAX_REFS, 9);
    assert.equal(out.length, 0);
    assert.equal(text, "@image12");
  });
});

describe("spans", () => {
  test("linked mentions are green, missing ones say why", () => {
    const slots = [...refs, { id: "r3", source: null }];
    const display = "@image1 @image3 @image8 @library:alexandros @library:maya @library:ghost";
    const spans = mentionSpans(display, slots, items);
    assert.deepEqual(
      spans.map((s) => [display.slice(s.start, s.end), s.state, s.reason]),
      [
        ["@image1", "linked", null],
        ["@image3", "missing", "no picture yet"],
        ["@image8", "missing", "there is no image 8 in this scene"],
        ["@library:alexandros", "linked", null],
        ["@library:maya", "missing", "no sheet yet"],
        ["@library:ghost", "missing", "not in the Library"],
      ],
    );
    assert.equal(spans[0].label, "image 1, alexandros");
    assert.equal(spans[1].label, "image 3, no picture yet, choose one");
  });
  test("an image slot holding an item with no sheet is missing", () => {
    const [s] = mentionSpans("@image1", [{ id: "r1", source: "library:maya" }], items);
    assert.deepEqual([s.state, s.reason], ["missing", "maya has no sheet yet"]);
  });
});

describe("cards", () => {
  const scene = {
    refs,
    cards: { goal: "@{r1} jumps", scene: "", stages: [{ title: "Exit", seconds: 4, camera: "behind @{r1}", action: "", end: "" }], style: "", audio: "" },
  };
  test("cardTexts lists every text; mapCardTexts rewrites them all", () => {
    assert.deepEqual(cardTexts(scene.cards), ["@{r1} jumps", "", "behind @{r1}", "", "", "", ""]);
    const up = mapCardTexts(scene.cards, (t) => t.toUpperCase());
    assert.equal(up.stages[0].camera, "BEHIND @{R1}");
  });
  test("removing a mentioned ref turns its mentions into plain words", () => {
    const out = removeRef(scene, "r1");
    assert.deepEqual(out.refs.map((r) => r.id), ["r2"]);
    assert.equal(out.cards.goal, "alexandros jumps");
    assert.equal(out.cards.stages[0].camera, "behind alexandros");
  });
  test("library mentions attach their item once, up to MAX_REFS", () => {
    const s = { refs: [], cards: { goal: "@library:maya and @library:maya", scene: "", stages: [], style: "", audio: "" } };
    assert.deepEqual(attachLibraryMentions(s).refs, [{ id: "r1", source: "library:maya" }]);
  });
  test("refLabel names a ref", () => {
    assert.deepEqual([refLabel(refs[0]), refLabel(refs[1]), refLabel({ id: "r9", source: null })], ["alexandros", "door.png", "empty"]);
  });
});
