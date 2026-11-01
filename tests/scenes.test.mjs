import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
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
