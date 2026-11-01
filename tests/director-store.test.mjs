import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
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

  test("a hardlinked temp file is never written through; a hardlinked film file is refused", () => {
    writeFilmJson("f5", "brief.json", { v: 1 }, { now });
    const outside = join(tmp, "outside.json");
    writeFileSync(outside, "keep me");
    linkSync(outside, join(RUNS, "f5", "brief.json.tmp"));
    writeFilmJson("f5", "brief.json", { v: 2 }, { now });
    assert.equal(readFileSync(outside, "utf8"), "keep me", "the outside file is untouched");
    assert.deepEqual(readFilmJson("f5", "brief.json"), { v: 2 });
    assert.equal(readdirSync(join(RUNS, "f5")).filter((f) => f.endsWith(".tmp") && f !== "brief.json.tmp").length, 0, "no temp file left behind");

    const shared = join(tmp, "shared.json");
    writeFileSync(shared, "{}");
    linkSync(shared, join(RUNS, "f5", "shots.json"));
    assert.throws(() => writeFilmJson("f5", "shots.json", { v: 1 }), { code: EXIT.UNKNOWN, message: /runs\/f5\/shots\.json has other hard links/ });
    assert.equal(readFileSync(shared, "utf8"), "{}");
  });

  test("history keeps the newest 50 versions of each file", () => {
    for (let v = 1; v <= 60; v += 1) writeFilmJson("f6", "brief.json", { v }, { now });
    writeFilmJson("f6", "shots.json", { v: 1 }, { now });
    writeFilmJson("f6", "shots.json", { v: 2 }, { now });
    const dir = join(RUNS, "f6", ".history");
    const kept = readdirSync(dir).filter((d) => existsSync(join(dir, d, "brief.json")));
    assert.equal(kept.length, 50);
    const versions = kept.map((d) => JSON.parse(readFileSync(join(dir, d, "brief.json"), "utf8")).v).sort((a, b) => a - b);
    assert.deepEqual([versions[0], versions.at(-1)], [10, 59], "the oldest went first");
    assert.equal(readdirSync(dir).filter((d) => existsSync(join(dir, d, "shots.json"))).length, 1, "another file's history is its own");
  });

  test("two processes saving reviews at once lose neither", async () => {
    writeFilmJson("f7", "shots.json", { shots: [{ id: "a" }, { id: "b" }] }, { now });
    const review = new URL("../cli/director/review.mjs", import.meta.url).href;
    const child = (shot) =>
      new Promise((resolve, reject) => {
        const code = `const { saveReview } = await import(${JSON.stringify(review)});
for (let i = 0; i < 40; i += 1) saveReview("f7", "${shot}", { verdict: "pass", checks: [{ check: "c", ok: true }] }, { take: "${shot}-" + i });`;
        const p = spawn(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, KIE_RUNS_DIR: RUNS }, stdio: ["ignore", "ignore", "pipe"] });
        let err = "";
        p.stderr.on("data", (d) => (err += d));
        p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(err))));
      });
    await Promise.all([child("a"), child("b")]);
    const saved = readFilmJson("f7", "reviews.json");
    assert.deepEqual([saved.a?.take, saved.b?.take], ["a-39", "b-39"]);
  });

  test("a file that is not JSON is reported, not swallowed", () => {
    mkdirSync(join(RUNS, "f4"));
    writeFileSync(join(RUNS, "f4", "shots.json"), "{ nope");
    assert.throws(() => readFilmJson("f4", "shots.json"), /runs\/f4\/shots\.json is not valid JSON/);
  });
});

describe("scenes.json", () => {
  test("scenes.json is a film file", () => {
    writeFilmJson("scene-film", "scenes.json", { version: 1, idea: null, scenes: [] });
    assert.deepEqual(readFilmJson("scene-film", "scenes.json").scenes, []);
  });
});

describe("the brief", () => {
  test("a sound brief has no problems; every bad field is named", () => {
    assert.deepEqual(validateBrief(brief), []);
    assert.deepEqual(validateBrief({ durationS: 200, aspectRatio: "2:1", filmType: "vlog", tone: "", mustShow: "x", sound: { bass: "y" }, extra: 1 }), [
      'The brief has no field "extra". Fields: takeaway, audience, durationS, aspectRatio, tone, mustShow, copy, sound, filmType.',
      "takeaway is missing: the one thing the viewer should leave with.",
      "durationS must be whole seconds from 1 to 120.",
      "aspectRatio must be one of: 16:9, 9:16, 1:1, 21:9.",
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
