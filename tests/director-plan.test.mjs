import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "kie-director-")));
const RUNS = join(tmp, "runs");
process.env.KIE_RUNS_DIR = RUNS;
mkdirSync(RUNS, { recursive: true });

const { EXIT } = await import("../cli/lib/errors.mjs");
const { loadCatalog } = await import("../cli/lib/models.mjs");
const { saveBrief } = await import("../cli/director/brief.mjs");
const { readPlan, savePlan, updateShot, fillSuggestions, findShot } = await import("../cli/director/plan.mjs");
const { costPlan } = await import("../cli/director/cost.mjs");

const catalog = loadCatalog();
const brief = { takeaway: "Calm mornings", durationS: 10, aspectRatio: "16:9", filmType: "live-action" };
const look = { palette: "teal", grade: "soft", filmLook: "35mm grain", lensFamily: "spherical", keyLightSide: "left" };
const shot = (id, durationS, extra = {}) => ({
  id, durationS, purpose: "p", subject: "mara", action: "Mara walks along the pier", why: "w",
  size: "wide", angle: "eye-level", lens: "35mm", depth: "deep", move: { type: "truck-left", speed: "slow" },
  light: "overcast", cut: "hard", job: "cinematic", screenDirection: "left-to-right", checks: ["ok"], ...extra,
});
const plan = () => ({ look, shots: [shot("s1", 4), shot("s2", 6, { size: "close-up", lens: "85mm", screenDirection: "none" })] });
let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 31, 12, 0, clock++));

describe("the plan", () => {
  test("needs a brief first", () => {
    assert.throws(() => savePlan(catalog, "p0", plan()), { code: EXIT.USAGE, message: /runs\/p0 has no brief yet/ });
  });

  test("fillSuggestions adds the picker's model and still model, and never replaces a chosen one", () => {
    const p = plan();
    p.shots[1].model = "seedance-2";
    const filled = fillSuggestions(catalog, p, { brief });
    assert.equal(filled.shots[0].model, "seedance-2-5");
    assert.equal(filled.shots[0].modelReason, "S tier for cinematic.");
    assert.equal(filled.shots[0].stillModel, "nano-banana-2");
    assert.equal(filled.shots[1].model, "seedance-2");
    assert.equal(filled.shots[1].modelReason, undefined);
    assert.equal(p.shots[0].model, undefined, "the input is not changed");
  });

  test("savePlan checks, numbers the version and keeps the old one", () => {
    saveBrief("p1", brief, { now });
    const a = savePlan(catalog, "p1", plan(), { now });
    assert.equal(a.plan.version, 1);
    assert.deepEqual(a.check.errors, []);
    const b = savePlan(catalog, "p1", { ...plan(), version: 99 }, { now });
    assert.equal(b.plan.version, 2, "the version is ours, not the caller's");
    assert.equal(readPlan("p1").version, 2);
    assert.equal(readdirSync(join(RUNS, "p1", ".history")).length, 1);
  });

  test("a plan with errors is refused with every reason and the saved plan is untouched", () => {
    const bad = plan();
    bad.shots[0].size = "huge";
    bad.shots[1].cut = "continuous";
    try {
      savePlan(catalog, "p1", bad, { now });
      assert.fail("should refuse");
    } catch (e) {
      assert.equal(e.code, EXIT.USAGE);
      assert.deepEqual(e.errors.map((x) => x.rule), ["menu", "last-continuous"]);
      assert.match(e.message, /^The plan was not saved:\n- s1: size "huge"/);
    }
    assert.equal(readPlan("p1").version, 2);
  });

  test("updateShot changes one shot; a new job asks the picker again", () => {
    const r = updateShot(catalog, "p1", "s2", { job: "motion-graphics" }, { now });
    const s2 = findShot(r.plan, "s2");
    assert.equal(s2.model, "minimax-h3");
    assert.equal(s2.stillModel, "gpt-image-2-5", "the picked still model follows the job");
    assert.equal(r.plan.version, 3);
  });

  test("updateShot keeps a model somebody named, refuses an id change and a breaking edit", () => {
    const r = updateShot(catalog, "p1", "s1", { model: "seedance-2", durationS: 5, action: "Mara runs" }, { now });
    assert.equal(findShot(r.plan, "s1").model, "seedance-2");
    assert.throws(() => updateShot(catalog, "p1", "s1", { id: "x" }), { code: EXIT.USAGE });
    assert.throws(() => updateShot(catalog, "p1", "s1", { durationS: 20 }), { message: /add up to 26s/ });
    assert.throws(() => updateShot(catalog, "p1", "s9", { durationS: 3 }), { code: EXIT.UNKNOWN, message: /No shot "s9". Shots: s1, s2/ });
  });

  test("a hand-picked model stays when the length changes, and the picker's old reasons go", () => {
    const s1 = findShot(readPlan("p1"), "s1");
    assert.equal(s1.modelReason, undefined, "a named model carries no picker reason");
    const r = updateShot(catalog, "p1", "s1", { durationS: 4, stillModel: "seedream-5-pro" }, { now });
    const next = findShot(r.plan, "s1");
    assert.equal(next.model, "seedance-2");
    assert.equal(next.stillModel, "seedream-5-pro");
    assert.equal(next.stillReason, undefined);
  });

  test("a shots.json that is not JSON can be replaced by saving again", () => {
    saveBrief("p2", brief, { now });
    writeFileSync(join(RUNS, "p2", "shots.json"), "{ not json");
    assert.equal(savePlan(catalog, "p2", plan(), { now }).plan.version, 1);
  });
});

describe("the cost", () => {
  test("one still and one take per shot, at the generated length, with today's room", () => {
    const p = fillSuggestions(catalog, plan(), { brief });
    const c = costPlan(catalog, p, { brief, store: { list: () => [], now: () => new Date() }, limits: { dailyUsd: 10 } });
    assert.deepEqual(c.shots.map((s) => [s.id, s.model, s.generatedS, s.stillModel]), [
      ["s1", "seedance-2-5", 5, "nano-banana-2"],
      ["s2", "seedance-2-5", 7, "nano-banana-2"],
    ]);
    assert.ok(c.shots.every((s) => s.stillUsd > 0 && s.takeUsd > 0));
    assert.equal(c.totalUsd, Math.round((c.stillsUsd + c.filmUsd) * 1000) / 1000);
    assert.equal(c.complete, true);
    assert.equal(c.availableTodayUsd, 10);
  });

  test("a shot without a model is not priced, and the total says so", () => {
    const c = costPlan(catalog, plan(), { brief });
    assert.equal(c.complete, false);
    assert.equal(c.availableTodayUsd, null);
    assert.equal(c.filmUsd, 0);
  });
});
