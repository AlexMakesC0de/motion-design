import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "kie-scenes-"));
process.env.KIE_RUNS_DIR = join(tmp, "runs");
mkdirSync(process.env.KIE_RUNS_DIR);
const { readScenes, saveScene, deleteScene, orderScenes, addVersion, chooseVersion, stageTimes, parseDanPrompt, emptyScene } = await import("../cli/director/scenes.mjs");

const base = () => ({ ...emptyScene(), title: "Freefall", durationS: 8 });

describe("scenes.json", () => {
  test("a film with no scenes reads as empty", () => {
    assert.deepEqual(readScenes("none-yet"), { version: 1, idea: null, scenes: [] });
  });
  test("save gives a new scene the next id and keeps versions out of the caller's hands", () => {
    const s = saveScene("f1", { ...base(), versions: [{ job: "fake" }] });
    assert.equal(s.id, "s1");
    assert.deepEqual(s.versions, []);
    assert.equal(saveScene("f1", base()).id, "s2");
    assert.deepEqual(readScenes("f1").scenes.map((x) => x.id), ["s1", "s2"]);
  });
  test("saving an existing id replaces it and keeps its versions and chosen", () => {
    saveScene("f2", base());
    addVersion("f2", "s1", { job: "j-1", kind: "draft", resolution: "480p", prompt: "p", createdAt: "t" });
    chooseVersion("f2", "s1", "j-1");
    const s = saveScene("f2", { ...base(), id: "s1", title: "New title" });
    assert.equal(s.title, "New title");
    assert.equal(s.versions.length, 1);
    assert.equal(s.chosen, "j-1");
  });
  test("stages set the length; times are derived", () => {
    const s = saveScene("f3", { ...base(), durationS: 99, cards: { ...base().cards, stages: [{ title: "Exit", seconds: 4, camera: "", action: "", end: "" }, { title: "Fall", seconds: 6, camera: "", action: "", end: "" }] } });
    assert.equal(s.durationS, 10);
    assert.deepEqual(stageTimes(s), [{ fromS: 0, toS: 4 }, { fromS: 4, toS: 10 }]);
  });
  test("a scene's length range is exactly what Seedance 2.5 accepts", async () => {
    const { DURATION } = await import("../cli/director/scenes.mjs");
    const catalog = JSON.parse(readFileSync(new URL("../cli/models.json", import.meta.url), "utf8"));
    const seedance = catalog.models["seedance-2-5"];
    assert.deepEqual([DURATION.min, DURATION.max], [Math.min(...seedance.durationsS), Math.max(...seedance.durationsS)]);
  });
  test("bad scenes are refused with the field named", () => {
    assert.throws(() => saveScene("f4", { ...base(), durationS: 2 }), /4 to 30 seconds/);
    assert.throws(() => saveScene("f4", { ...base(), durationS: 31 }), /4 to 30 seconds, got 31/);
    assert.throws(() => saveScene("f4", { ...base(), ratio: "5:4" }), /ratio/);
    assert.throws(() => saveScene("f4", { ...base(), refs: Array.from({ length: 10 }, (_, i) => ({ id: `r${i + 1}`, source: null })) }), /at most 9/);
    assert.throws(() => saveScene("f4", { ...base(), refs: [{ id: "r1", source: "https://x" }] }), /library:<name> or file:refs/);
    assert.throws(() => saveScene("f4", { ...base(), cards: { ...base().cards, stages: [{ title: "", seconds: 0, camera: "", action: "", end: "" }] } }), /at least 1 second/);
  });
  test("delete and order", () => {
    saveScene("f5", base()); saveScene("f5", base()); saveScene("f5", base());
    orderScenes("f5", ["s3", "s1", "s2"]);
    assert.deepEqual(readScenes("f5").scenes.map((x) => x.id), ["s3", "s1", "s2"]);
    deleteScene("f5", "s1");
    assert.deepEqual(readScenes("f5").scenes.map((x) => x.id), ["s3", "s2"]);
    assert.throws(() => orderScenes("f5", ["s2"]), /every scene once/);
  });
  test("chosen must be one of the scene's versions", () => {
    saveScene("f6", base());
    assert.throws(() => chooseVersion("f6", "s1", "j-nope"), /not a version/);
  });
});

describe("parseDanPrompt", () => {
  test("a whole sectioned prompt splits into cards and stages", () => {
    const cards = parseDanPrompt(`[GOAL]
He jumps.

[REFERENCES]
@image1 — him.

[SCENE]
Over the Alps.

[STAGE 1 | 0–4 SECONDS | EXIT]
Camera: behind him
Action: he drops
End: Hard cut.

[STAGE 2 | 4-10 SECONDS | FREEFALL]
Camera: facing him
Action: arms spread

[VISUAL STYLE]
Film grain.

[AUDIO]
<wind>`);
    assert.equal(cards.goal, "He jumps.");
    assert.equal(cards.scene, "Over the Alps.");
    assert.deepEqual(cards.stages.map((s) => [s.title, s.seconds, s.camera, s.action, s.end]), [
      ["Exit", 4, "behind him", "he drops", "Hard cut."],
      ["Freefall", 6, "facing him", "arms spread", ""],
    ]);
    assert.equal(cards.style, "Film grain.");
    assert.equal(cards.audio, "<wind>");
  });
  test("plain text is not a sectioned prompt", () => {
    assert.equal(parseDanPrompt("A fox runs through snow."), null);
  });
});

describe("ideas, Library names and copying a scene", () => {
  test("an idea is saved with a scene list; listed ids are renamed, new entries added at the idea's ratio", async () => {
    const { saveIdea } = await import("../cli/director/scenes.mjs");
    saveScene("i1", base());
    const data = saveIdea("i1", { text: " A boat at dawn ", ratio: "9:16", lengthS: 20 }, { scenes: [{ id: "s1", title: "Harbour", durationS: 6 }, { title: "Sail", durationS: 8 }] });
    assert.deepEqual(data.idea, { text: "A boat at dawn", ratio: "9:16", lengthS: 20 });
    assert.deepEqual(data.scenes.map((s) => [s.id, s.title, s.durationS, s.ratio]), [["s1", "Harbour", 6, "16:9"], ["s2", "Sail", 8, "9:16"]]);
    assert.throws(() => saveIdea("i1", { text: "" }), /Say what the film is about/);
    assert.throws(() => saveIdea("i1", { text: "x" }, { scenes: [{ title: "Too long", durationS: 40 }] }), /4 to 30 seconds/);
  });

  test("create refuses a film that is already there, and leaves no folder when the idea is refused", async () => {
    const { saveIdea } = await import("../cli/director/scenes.mjs");
    saveIdea("i2", { text: "A fox" }, { create: true });
    assert.throws(() => saveIdea("i2", { text: "Again" }, { create: true }), (e) => e.exists === true);
    assert.throws(() => saveIdea("i3", { text: "x" }, { create: true, scenes: [{ title: "bad", durationS: 1 }] }), /4 to 30/);
    assert.equal(existsSync(join(process.env.KIE_RUNS_DIR, "i3")), false);
  });

  test("libraryNames lists attached items first, then mentioned ones, each once", async () => {
    const { libraryNames } = await import("../cli/director/mentions.mjs");
    const s = { ...base(), refs: [{ id: "r1", source: "library:alex" }, { id: "r2", source: "file:refs/a.png" }], cards: { ...base().cards, goal: "@library:courier meets @library:alex" } };
    assert.deepEqual(libraryNames(s), ["alex", "courier"]);
  });

  test("a scene copies into another film with its pictures and version videos; the original stays", async () => {
    const { copyScene } = await import("../cli/director/scene-copy.mjs");
    const runs = process.env.KIE_RUNS_DIR;
    mkdirSync(join(runs, "scratch", "refs"), { recursive: true });
    writeFileSync(join(runs, "scratch", "refs", "man.png"), "png");
    writeFileSync(join(runs, "scratch", "s1-draft.mp4"), "video");
    const s = saveScene("scratch", { ...base(), refs: [{ id: "r1", source: "file:refs/man.png", keep: "his face" }, { id: "r2", source: "file:refs/gone.png" }, { id: "r3", source: "library:alex" }] });
    addVersion("scratch", s.id, { job: "j-a", kind: "draft", resolution: "480p", prompt: "p", createdAt: "t" });
    addVersion("scratch", s.id, { job: "j-gone", kind: "final", resolution: "720p", prompt: "p", createdAt: "t" });
    chooseVersion("scratch", s.id, "j-a");
    // The target already has a scene and a file named like the copy's video.
    saveScene("target", base());
    writeFileSync(join(runs, "target", "s2-draft.mp4"), "older");
    const store = { get: (id) => (id === "j-a" ? { artifacts: [join(runs, "scratch", "s1-draft.mp4")] } : null) };

    const copy = copyScene("scratch", s.id, "target", { store });
    assert.equal(copy.id, "s2");
    assert.deepEqual(copy.refs, [{ id: "r1", source: "file:refs/man.png", keep: "his face" }, { id: "r2", source: null }, { id: "r3", source: "library:alex" }]);
    assert.equal(readFileSync(join(runs, "target", "refs", "man.png"), "utf8"), "png");
    assert.deepEqual(copy.versions.map((v) => [v.job, v.file ?? null]), [["j-a", "s2-draft-2.mp4"], ["j-gone", null]]);
    assert.equal(readFileSync(join(runs, "target", "s2-draft-2.mp4"), "utf8"), "video");
    assert.equal(readFileSync(join(runs, "target", "s2-draft.mp4"), "utf8"), "older", "never over a file already there");
    assert.equal(copy.chosen, "j-a");
    assert.equal(readScenes("scratch").scenes.length, 1, "the original is left");
    assert.throws(() => copyScene("scratch", s.id, "scratch", { store }), /already in that film/);
  });
});
