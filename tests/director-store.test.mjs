import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "kie-director-store-")));
const RUNS = join(tmp, "runs");
process.env.KIE_RUNS_DIR = RUNS;
mkdirSync(RUNS, { recursive: true });

const { EXIT } = await import("../cli/lib/errors.mjs");
const { filmFile, readFilmJson, writeFilmJson } = await import("../cli/director/files.mjs");
const { validateBrief, readBrief, saveBrief } = await import("../cli/director/brief.mjs");

const brief = { takeaway: "Calm mornings", durationS: 10, aspectRatio: "16:9", filmType: "live-action" };
let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 31, 12, 0, clock++));

describe("film files", () => {
  test("only brief.json and shots.json, and a missing film reads as null", () => {
    assert.throws(() => filmFile("f1", "chat.jsonl"), { code: EXIT.USAGE });
    assert.equal(readFilmJson("nope", "brief.json"), null);
    assert.equal(existsSync(join(RUNS, "nope")), false, "reading makes no folder");
  });

  test("writes atomically and keeps the replaced version in .history", () => {
    writeFilmJson("f1", "brief.json", { v: 1 }, { now });
    writeFilmJson("f1", "brief.json", { v: 2 }, { now });
    assert.deepEqual(readFilmJson("f1", "brief.json"), { v: 2 });
    const hist = readdirSync(join(RUNS, "f1", ".history"));
    assert.equal(hist.length, 1);
    assert.deepEqual(JSON.parse(readFileSync(join(RUNS, "f1", ".history", hist[0], "brief.json"), "utf8")), { v: 1 });
    assert.equal(existsSync(join(RUNS, "f1", "brief.json.tmp")), false);
  });

  test("two saves in the same instant keep both old versions", () => {
    const fixed = () => new Date(Date.UTC(2026, 0, 1));
    writeFilmJson("f2", "brief.json", { v: 1 }, { now: fixed });
    writeFilmJson("f2", "brief.json", { v: 2 }, { now: fixed });
    writeFilmJson("f2", "brief.json", { v: 3 }, { now: fixed });
    assert.equal(readdirSync(join(RUNS, "f2", ".history")).length, 2);
  });

  test("refuses a film folder or a file that is a link", () => {
    mkdirSync(join(tmp, "elsewhere"));
    symlinkSync(join(tmp, "elsewhere"), join(RUNS, "linked"));
    assert.throws(() => writeFilmJson("linked", "brief.json", {}), { code: EXIT.UNKNOWN, message: /runs\/linked is a link/ });
    mkdirSync(join(RUNS, "f3"));
    symlinkSync(join(tmp, "missing.json"), join(RUNS, "f3", "shots.json"));
    assert.throws(() => writeFilmJson("f3", "shots.json", {}), { message: /runs\/f3\/shots\.json is a link/ });
    assert.equal(existsSync(join(tmp, "missing.json")), false, "nothing written through the dangling link");
  });

  test("a file that is not JSON is reported, not swallowed", () => {
    mkdirSync(join(RUNS, "f4"));
    writeFileSync(join(RUNS, "f4", "shots.json"), "{ nope");
    assert.throws(() => readFilmJson("f4", "shots.json"), /runs\/f4\/shots\.json is not valid JSON/);
  });
});

describe("the brief", () => {
  test("a sound brief has no problems; every bad field is named", () => {
    assert.deepEqual(validateBrief(brief), []);
    assert.deepEqual(validateBrief({ durationS: 200, aspectRatio: "2:1", filmType: "vlog", tone: "", mustShow: "x", sound: { bass: "y" }, extra: 1 }), [
      'The brief has no field "extra". Fields: takeaway, audience, durationS, aspectRatio, tone, mustShow, copy, sound, filmType.',
      "takeaway is missing: the one thing the viewer should leave with.",
      "durationS must be whole seconds from 1 to 120.",
      "aspectRatio must be one of: 16:9, 9:16, 1:1, 4:5, 21:9.",
      "filmType must be one of: product-ui, live-action, character, product-hero.",
      "tone must be a sentence, or left out.",
      "mustShow must be a list of short lines.",
      'sound has no field "bass". Fields: music, voice, sfx.',
    ]);
  });

  test("saveBrief refuses a bad brief with code 1 and writes nothing", () => {
    assert.throws(() => saveBrief("b1", { takeaway: "x" }), { code: EXIT.USAGE, message: /^The brief was not saved:/ });
    assert.equal(readBrief("b1"), null);
    saveBrief("b1", brief, { now });
    assert.deepEqual(readBrief("b1"), brief);
  });
});
