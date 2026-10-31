import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "kie-still-")));
const RUNS = join(tmp, "runs");
process.env.KIE_RUNS_DIR = RUNS;
process.env.KIE_LIBRARY_DIR = join(tmp, "library");
process.env.KIE_LIMITS_FILE = join(tmp, "limits.json");
process.env.KIE_API_KEY = "test-kie"; // makes routes usable; every provider call below is a stub
mkdirSync(RUNS, { recursive: true });

const { EXIT } = await import("../cli/lib/errors.mjs");
const { loadCatalog } = await import("../cli/lib/models.mjs");
const { openJobs } = await import("../cli/core/jobs.mjs");
const { openLibrary } = await import("../cli/core/assets.mjs");
const { saveBrief } = await import("../cli/director/brief.mjs");
const { savePlan, readPlan } = await import("../cli/director/plan.mjs");
const { stillWording, makeStill, styleStillFor, needsStyleFirst, makeSheet, adoptSheet, sheetWording } = await import("../cli/director/still.mjs");
const { shotMedia } = await import("../cli/director/media.mjs");
const { stillFit } = await import("../cli/director/fit.mjs");

const catalog = loadCatalog();
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4f30000000049454e44ae426082", "hex");
const brief = { takeaway: "Calm mornings", durationS: 10, aspectRatio: "16:9", filmType: "live-action" };
const look = { palette: "teal and amber", grade: "soft contrast", filmLook: "35mm film grain", lensFamily: "anamorphic", keyLightSide: "left" };
const shot = (id, durationS, extra = {}) => ({
  id, durationS, purpose: "p", subject: "mara", action: "Mara walks along the pier", why: "w",
  size: "wide", angle: "eye-level", lens: "35mm", depth: "deep", move: { type: "truck-left", speed: "slow" },
  light: "golden-hour", cut: "hard", job: "cinematic", screenDirection: "left-to-right", checks: ["ok"], ...extra,
});
const plan = () => ({ look, shots: [shot("s1", 4, { cast: ["mara"] }), shot("s2", 6, { size: "close-up", lens: "85mm", screenDirection: "none" })] });

const library = openLibrary();
writeFileSync(join(tmp, "mara.png"), PNG);
library.save({ name: "mara", kind: "character", description: "A woman in her thirties in an olive raincoat.", images: [join(tmp, "mara.png")] });
const assets = library.list();

const LIMITS = { dailyUsd: 10, perJobUsd: 5, allowRoots: [] };
const preflight = async (_c, _r, o) => ({ estimatedUsd: 0.06, basis: "stub", cap: o.budgetUsd ?? 3, creditsBefore: null });
function ctx(extra = {}) {
  const calls = [];
  const uploads = [];
  return {
    calls,
    uploads,
    store: openJobs(mkdtempSync(join(tmpdir(), "kie-still-store-"))),
    limits: LIMITS,
    library,
    upload: async (path) => (uploads.push(path), { url: `https://files.test/${uploads.length}.png` }),
    deps: { preflight, createTask: async (prov, fam, m, input) => (calls.push({ m, input }), { taskId: `t-${calls.length}` }) },
    via: "test",
    ...extra,
  };
}

describe("still wording", () => {
  test("the first frame of the shot, in the look's words, with the cast word for word", () => {
    const p = plan();
    const w = stillWording(p, p.shots[0], { assets, brief });
    assert.equal(
      w.prompt,
      [
        "A single frame from a live-action film: the first frame of this shot.",
        "Look: 35mm film grain, teal and amber, soft contrast, anamorphic lenses.",
        "Frame: wide shot, eye-level angle, 35mm lens, deep focus.",
        "Subject: A woman in her thirties in an olive raincoat.",
        "Moment: the start of this action: Mara walks along the pier.",
        "Light: warm, low golden-hour sunlight, key light from the left.",
        "No text, captions, logos or watermarks.",
      ].join("\n"),
    );
    assert.match(w.sha, /^[0-9a-f]{12}$/);
  });

  test("the hash changes with the film's aspect ratio and the shot's still model", () => {
    const p = plan();
    const base = stillWording(p, p.shots[0], { assets, brief }).sha;
    assert.notEqual(stillWording(p, p.shots[0], { assets, brief: { ...brief, aspectRatio: "9:16" } }).sha, base);
    assert.notEqual(stillWording(p, { ...p.shots[0], stillModel: "gpt-image-2-5" }, { assets, brief }).sha, base);
  });

  test("references add one line and leave the hash alone", () => {
    const p = plan();
    const a = stillWording(p, p.shots[0], { assets, brief });
    const b = stillWording(p, p.shots[0], { assets, brief, withRefs: true });
    assert.match(b.prompt, /\nKeep every person and product exactly as in the reference images, and match the style reference's colour, light and grain\.\nNo text/);
    assert.equal(a.sha, b.sha);
    const c = stillWording(p, { ...p.shots[0], lens: "50mm" }, { assets, brief });
    assert.notEqual(a.sha, c.sha, "a change to the shot changes the hash");
  });
});

describe("making a still", () => {
  test("refuses a plan with errors, and an unknown shot", async () => {
    saveBrief("bad", brief);
    writeFileSync(join(RUNS, "bad", "shots.json"), JSON.stringify({ version: 1, look, shots: [shot("s1", 10, { size: "huge", model: "seedance-2-5", stillModel: "nano-banana-2" })] }));
    await assert.rejects(makeStill(catalog, "bad", "s1", ctx()), (e) => e.code === EXIT.USAGE && /Fix the plan first/.test(e.message) && e.errors.length === 1);
    saveBrief("sea", brief);
    savePlan(catalog, "sea", plan(), { assets });
    await assert.rejects(makeStill(catalog, "sea", "s9", ctx()), { code: EXIT.UNKNOWN });
  });

  test("submits an image job tagged with its shot, at the film's ratio, with the cast as identity", async () => {
    const c = ctx();
    const r = await makeStill(catalog, "sea", "s1", c);
    assert.equal(r.model, "nano-banana-2");
    assert.equal(r.job.shot, "s1");
    assert.equal(r.job.stage, "still");
    assert.equal(r.job.artifactBase, "s1-still");
    assert.equal(r.job.stillSha, stillWording(readPlan("sea"), readPlan("sea").shots[0], { assets, brief }).sha);
    assert.deepEqual(r.refMapping, ["@Image1 = mara#1"]);
    assert.equal(c.calls[0].m, "nano-banana-2");
    assert.equal(c.calls[0].input.aspect_ratio, "16:9");
    assert.deepEqual(c.calls[0].input.image_input, ["https://files.test/1.png"]);
    assert.match(c.calls[0].input.prompt, /^A single frame from a live-action film/);
    assert.equal(r.style, null, "no still exists yet, so no style reference");
  });

  test("the still's budget is its priced estimate, not the catalog's flat default", async () => {
    const caps = [];
    const c = ctx();
    c.deps.preflight = async (_c, _r, o) => (caps.push(o.budgetUsd), { estimatedUsd: 0.06, basis: "stub", cap: o.budgetUsd, creditsBefore: null });
    await makeStill(catalog, "sea", "s2", { ...c, dryRun: true });
    const est = stillFit(catalog, "nano-banana-2", { aspectRatio: "16:9" }).estimateUsd;
    assert.deepEqual(caps, [Math.round((est + 0.01) * 100) / 100]);
  });

  test("dry run plans the job and spends nothing", async () => {
    const c = ctx();
    const r = await makeStill(catalog, "sea", "s2", { ...c, dryRun: true });
    assert.equal(r.dryRun, true);
    assert.equal(c.calls.length, 0);
    assert.equal(c.store.list().length, 0);
  });
});

describe("the media view and the style still", () => {
  const settle = (store, id, file) => {
    store.transition(id, "succeeded", { artifacts: [join(RUNS, "sea", file)], actualUsd: 0.06, costSource: "task-record" });
    writeFileSync(join(RUNS, "sea", file), PNG);
  };

  test("stills by shot, newest used unless one is chosen, stale once the shot changes", async () => {
    const c = ctx();
    const a = await makeStill(catalog, "sea", "s1", c);
    settle(c.store, a.job.id, "s1-still.png");
    const b = await makeStill(catalog, "sea", "s1", c);
    assert.equal(b.style, null, "a shot is never its own style reference");
    settle(c.store, b.job.id, "s1-still-2.png");

    let m = shotMedia(c.store, "sea", readPlan("sea"), { assets, brief });
    assert.deepEqual(m.s1.stills.map((s) => [s.file, s.stale]), [["s1-still.png", false], ["s1-still-2.png", false]]);
    assert.equal(m.s1.still, "s1-still-2.png");
    assert.deepEqual(m.s2.stills, []);
    assert.equal(m.s2.still, null);

    const p = readPlan("sea");
    p.shots[0].still = "s1-still.png";
    p.shots[0].lens = "50mm";
    const { version, ...rest } = p;
    savePlan(catalog, "sea", rest, { assets });
    m = shotMedia(c.store, "sea", readPlan("sea"), { assets, brief });
    assert.equal(m.s1.still, "s1-still.png", "a chosen still wins");
    assert.ok(m.s1.stills.every((s) => s.stale), "the lens changed after both were made");
  });

  test("the style still is the first shot's still for every other shot, with a style reference", async () => {
    const c = ctx();
    const p = readPlan("sea");
    assert.equal(styleStillFor(p, "s2", shotMedia(c.store, "sea", p)), "s1-still.png", "a chosen still on disk counts in any store");
    const m = shotMedia(openJobs(join(RUNS, ".jobs")), "sea", p);
    assert.equal(m.s1.stills.length, 0, "jobs from other stores are not mixed in");

    const first = await makeStill(catalog, "sea", "s1", c);
    settle(c.store, first.job.id, "s1-still-3.png");
    const r = await makeStill(catalog, "sea", "s2", c);
    assert.equal(r.style, "s1-still.png", "the still s1 uses: the one chosen earlier, not its newest");
    assert.deepEqual(r.refMapping, ["@Image1 = s1-still.png"]);
    assert.equal(c.calls.at(-1).input.image_input.length, 1);
    assert.match(c.calls.at(-1).input.prompt, /match the style reference's colour/);
  });

  test("the style still must be made first when no shot has one and the look names none", () => {
    const p = { look, shots: [{ id: "s1" }, { id: "s2" }] };
    assert.equal(needsStyleFirst(p, { s1: { still: null }, s2: { still: null } }), true);
    assert.equal(needsStyleFirst(p, { s1: { still: null }, s2: { still: "s2-still.png" } }), false);
    assert.equal(needsStyleFirst({ ...p, look: { ...look, styleStill: "x.png" } }, { s1: { still: null }, s2: { still: null } }), false);
  });

  test("look.styleStill wins when set", () => {
    const p = { ...readPlan("sea"), look: { ...look, styleStill: "s1-still.png" } };
    assert.equal(styleStillFor(p, "s2", {}), "s1-still.png");
    assert.equal(styleStillFor(p, "s1", {}), null);
  });
});

describe("casting sheets", () => {

  test("worded by kind; a style asset has none", () => {
    assert.match(sheetWording({ name: "mara", kind: "character", description: "A woman in an olive raincoat." }).prompt, /^Character reference sheet of A woman in an olive raincoat\. Two views side by side/);
    assert.equal(sheetWording({ name: "cup", kind: "product", description: "A white cup" }).model, "gpt-image-2-5");
    assert.equal(sheetWording({ name: "pier", kind: "location", description: "A pier" }).aspectRatio, "16:9");
    assert.throws(() => sheetWording({ name: "s", kind: "style", description: "x" }), /only characters, products and locations/);
  });

  test("made from the item's own images, then adopted as its first image with the old kept after it", async () => {
    const c = ctx();
    const r = await makeSheet(catalog, "sea", "mara", c);
    assert.equal(r.job.stage, "sheet");
    assert.equal(r.job.sheetFor, "mara");
    assert.equal(c.calls[0].input.aspect_ratio, "3:2");
    assert.deepEqual(c.calls[0].input.image_input, ["https://files.test/1.png"]);
    await assert.rejects(async () => adoptSheet(library, c.store, r.job.id), /has not finished \(submitted\)/);

    const sheet = join(RUNS, "sea", "sheet-mara.png");
    writeFileSync(sheet, PNG);
    c.store.transition(r.job.id, "succeeded", { artifacts: [sheet], actualUsd: 0.06, costSource: "task-record" });
    const a = adoptSheet(library, c.store, r.job.id);
    assert.equal(a.images.length, 2);
    assert.equal(a.description, "A woman in her thirties in an olive raincoat.");
  });
});
