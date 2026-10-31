import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "kie-redo-")));
const RUNS = join(tmp, "runs");
process.env.KIE_RUNS_DIR = RUNS;
process.env.KIE_LIBRARY_DIR = join(tmp, "library");
process.env.KIE_LIMITS_FILE = join(tmp, "limits.json");
process.env.KIE_API_KEY = "test-kie"; // makes routes usable; every provider call below is a stub
mkdirSync(RUNS, { recursive: true });

const { png } = await import("./fixtures/images.mjs");
const { EXIT } = await import("../cli/lib/errors.mjs");
const { loadCatalog } = await import("../cli/lib/models.mjs");
const { openJobs } = await import("../cli/core/jobs.mjs");
const { openLibrary } = await import("../cli/core/assets.mjs");
const { saveBrief } = await import("../cli/director/brief.mjs");
const { savePlan, readPlan, updateShot } = await import("../cli/director/plan.mjs");
const { filmShot } = await import("../cli/director/film.mjs");
const { saveReview } = await import("../cli/director/review.mjs");
const { board } = await import("../cli/director/board.mjs");
const { afterReview, readProduction, saveProduction, takesSpentUsd } = await import("../cli/director/redo.mjs");

const catalog = loadCatalog();
const PNG = png(1280, 720);
const brief = { takeaway: "Calm mornings", durationS: 8, aspectRatio: "16:9", filmType: "live-action" };
const look = { palette: "teal", grade: "soft", filmLook: "35mm grain", lensFamily: "anamorphic", keyLightSide: "left" };
const shot = (id, extra = {}) => ({
  id, durationS: 4, purpose: "p", subject: id, action: "Waves roll under the pier", why: "w",
  size: "wide", angle: "eye-level", lens: "35mm", depth: "deep", move: { type: "truck-left", speed: "slow" },
  light: "golden-hour", cut: "hard", job: "cinematic", screenDirection: "none", checks: ["the pier reads"], ...extra,
});
const library = openLibrary();
const LIMITS = { dailyUsd: 50, perJobUsd: 5, allowRoots: [] };
const preflight = async (_c, _r, o) => ({ estimatedUsd: 1.5, basis: "stub", cap: o.budgetUsd ?? 5, creditsBefore: null });

function ctx() {
  const calls = [];
  return {
    calls,
    store: openJobs(mkdtempSync(join(tmpdir(), "kie-redo-store-"))),
    limits: LIMITS,
    library,
    upload: async (path) => ({ url: `https://files.test/${path.split("/").pop()}` }),
    deps: { preflight, createTask: async (prov, fam, m, input) => (calls.push({ m, input }), { taskId: `t-${calls.length}` }) },
    via: "test",
  };
}

/** A still or take that finished, as waitJob leaves it; an existing job id lands that job instead. */
function land(c, film, shotId, stage, file, jobId = null) {
  const job = jobId ? c.store.get(jobId) : c.store.create({ run: film, shot: shotId, stage, capability: stage === "take" ? "video" : "image", model: "x", provider: "kie", estimateUsd: 0.5 });
  writeFileSync(join(RUNS, film, file), PNG);
  if (!jobId) {
    c.store.transition(job.id, "sending");
    c.store.transition(job.id, "submitted", { upstreamTaskId: "t" });
  }
  return c.store.transition(job.id, "succeeded", { artifacts: [join(RUNS, film, file)], actualUsd: 0.5, costSource: "task-record" });
}

function film(name) {
  saveBrief(name, brief);
  savePlan(catalog, name, { look, shots: [shot("s1"), shot("s2", { size: "medium" })] });
  return name;
}
const redo = (f, take) => saveReview(f, "s1", { take, verdict: "redo", checks: [{ check: "the pier reads", ok: false, note: "the pier melts" }] });

describe("production settings", () => {
  test("off by default; on needs the total; off forgets it", () => {
    const f = film("prod");
    assert.deepEqual(readProduction(f), { autoRedo: false, maxUsd: null });
    assert.throws(() => saveProduction(f, { autoRedo: true }), (e) => e.code === EXIT.USAGE && /Auto-redo needs max_usd/.test(e.message));
    assert.deepEqual(saveProduction(f, { autoRedo: true, maxUsd: 6.004 }), { autoRedo: true, maxUsd: 6 });
    assert.deepEqual(readProduction(f), { autoRedo: true, maxUsd: 6 });
    assert.deepEqual(saveProduction(f, { autoRedo: false, maxUsd: 9 }), { autoRedo: false, maxUsd: null });
  });
});

describe("auto-redo", () => {
  test("off, or a pass: nothing is filmed", async () => {
    const f = film("calm");
    const c = ctx();
    land(c, f, "s1", "still", "s1-still.png");
    land(c, f, "s1", "take", "s1-take.mp4");
    assert.equal(await afterReview(catalog, f, "s1", redo(f, "s1-take.mp4"), c), null);
    saveProduction(f, { autoRedo: true, maxUsd: 20 });
    const pass = saveReview(f, "s1", { take: "s1-take.mp4", verdict: "pass", checks: [{ check: "the pier reads", ok: true }] });
    assert.equal(await afterReview(catalog, f, "s1", pass, c), null);
    assert.equal(c.calls.length, 0);
  });

  test("a redo verdict refilms the shot, twice at most; the third is held back for Alex", async () => {
    const f = film("pier");
    const c = ctx();
    saveProduction(f, { autoRedo: true, maxUsd: 20 });
    land(c, f, "s1", "still", "s1-still.png");
    land(c, f, "s1", "take", "s1-take.mp4");

    const first = await afterReview(catalog, f, "s1", redo(f, "s1-take.mp4"), c);
    assert.equal(first.submitted, true);
    assert.equal(first.redo, 1);
    assert.equal(c.store.get(first.jobId).stage, "take");
    assert.equal(c.calls.length, 1);

    const again = await afterReview(catalog, f, "s1", redo(f, "s1-take.mp4"), c);
    assert.equal(again.submitted, false, "the redo already filming is not doubled");
    assert.match(again.reason, /already being filmed/);

    land(c, f, "s1", "take", "s1-take-2.mp4", first.jobId);
    const second = await afterReview(catalog, f, "s1", redo(f, "s1-take-2.mp4"), c);
    assert.equal(second.redo, 2);
    land(c, f, "s1", "take", "s1-take-3.mp4", second.jobId);
    const third = await afterReview(catalog, f, "s1", redo(f, "s1-take-3.mp4"), c);
    assert.equal(third.submitted, false);
    assert.match(third.reason, /filmed 3 times; auto-redo stops at 2 redos/);
    assert.equal(c.calls.length, 2);
    assert.equal(board(c.store, f).shots[0].tries, 3);
  });

  test("a redo that would take the film's takes over the total is held back", async () => {
    const f = film("cap");
    const c = ctx();
    land(c, f, "s1", "still", "s1-still.png");
    land(c, f, "s1", "take", "s1-take.mp4");
    assert.equal(takesSpentUsd(c.store, f), 0.5);
    saveProduction(f, { autoRedo: true, maxUsd: 0.6 });
    const r = await afterReview(catalog, f, "s1", redo(f, "s1-take.mp4"), c);
    assert.equal(r.submitted, false);
    assert.match(r.reason, /over the \$0\.60 set for auto-redo/);
    assert.equal(c.calls.length, 0);
  });

  test("a verdict on an older take does not refilm the newer one", async () => {
    const f = film("old");
    const c = ctx();
    saveProduction(f, { autoRedo: true, maxUsd: 20 });
    land(c, f, "s1", "still", "s1-still.png");
    land(c, f, "s1", "take", "s1-take.mp4");
    await new Promise((r) => setTimeout(r, 5)); // the store orders takes by when they were made
    land(c, f, "s1", "take", "s1-take-2.mp4");
    const r = await afterReview(catalog, f, "s1", redo(f, "s1-take.mp4"), c);
    assert.equal(r.submitted, false);
    assert.match(r.reason, /has no redo verdict/);
  });
});

describe("filming again", () => {
  test("lets go of a take somebody chose, so the new one is used when it lands", async () => {
    const f = film("chosen");
    const c = ctx();
    land(c, f, "s1", "still", "s1-still.png");
    land(c, f, "s1", "take", "s1-take.mp4");
    updateShot(catalog, f, "s1", { take: "s1-take.mp4" });
    assert.equal(readPlan(f).shots[0].take, "s1-take.mp4");
    const r = await filmShot(catalog, f, "s1", c);
    assert.equal(readPlan(f).shots[0].take, undefined);
    land(c, f, "s1", "take", "s1-take-2.mp4", r.job.id);
    assert.equal(board(c.store, f).shots[0].take, "s1-take-2.mp4");
  });
});
