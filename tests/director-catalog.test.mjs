import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCatalog } from "../cli/lib/models.mjs";

const catalog = loadCatalog();
const routing = readFileSync(new URL("../skills/motion-design/references/tool-routing.md", import.meta.url), "utf8");
// The table's job labels and the goodFor keys they become.
const JOB_KEYS = {
  "Motion graphics": "motion-graphics",
  Cinematic: "cinematic",
  "Working from reference images": "reference-images",
  "UGC-style footage": "ugc",
  "Lip sync": "lip-sync",
  "Text to video": "text-to-video",
  "Video edit": "video-edit",
  Animation: "animation",
};

/** { modelId: { jobKey: tier } } from the "Which model for which job" table; names without a catalog id are skipped. */
function tableRatings() {
  const out = {};
  const section = routing.slice(routing.indexOf("## Which model for which job"));
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 5 || !(cells[1] in JOB_KEYS)) continue;
    for (const [tier, cell] of [["S", cells[2]], ["A", cells[3]]]) {
      for (const [, id] of cell.matchAll(/`([a-z0-9-]+)`/g)) (out[id] ??= {})[JOB_KEYS[cells[1]]] = tier;
    }
  }
  return out;
}

describe("Alex's ratings in models.json", () => {
  test("goodFor matches the table in tool-routing.md exactly", () => {
    const fromData = Object.fromEntries(catalog.list.filter((m) => m.goodFor).map((m) => [m.id, m.goodFor]));
    assert.deepEqual(fromData, tableRatings());
  });

  test("every tier is S or A and every rated model is a video model", () => {
    for (const m of catalog.list.filter((x) => x.goodFor)) {
      assert.equal(m.capability, "video", m.id);
      for (const t of Object.values(m.goodFor)) assert.ok(t === "S" || t === "A", `${m.id}: ${t}`);
    }
  });
});

describe("prompt profiles", () => {
  test("every video model has one, with a known family", () => {
    for (const m of catalog.list.filter((x) => x.capability === "video")) {
      assert.ok(m.promptProfile, `${m.id} has a promptProfile`);
      assert.ok(["seedance", "hailuo", "kling", "wan", "veo"].includes(m.promptProfile.family), m.id);
      assert.ok(m.promptProfile.maxChars === null || m.promptProfile.maxChars > 0, m.id);
    }
  });

  test("Seedance 2.5 names its references [Image N]", () => {
    assert.equal(catalog.models["seedance-2-5"].promptProfile.refToken, "[Image {n}]");
  });

  test("an audio-off switch names a param the route declares", () => {
    for (const m of catalog.list.filter((x) => x.promptProfile?.audioOff)) {
      const { param } = m.promptProfile.audioOff;
      assert.ok(m.routes.some((r) => r.input?.params?.[param]), `${m.id} declares ${param}`);
    }
  });
});
