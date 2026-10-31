import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "kie-film-")));
const RUNS = join(tmp, "runs");
process.env.KIE_RUNS_DIR = RUNS;
process.env.KIE_LIBRARY_DIR = join(tmp, "library");
process.env.KIE_LIMITS_FILE = join(tmp, "limits.json");
process.env.KIE_API_KEY = "test-kie"; // makes routes usable; every provider call below is a stub
mkdirSync(RUNS, { recursive: true });

const { png } = await import("./fixtures/images.mjs");
const { EXIT, uncertain } = await import("../cli/lib/errors.mjs");
const { loadCatalog } = await import("../cli/lib/models.mjs");
const { openJobs } = await import("../cli/core/jobs.mjs");
const { openLibrary } = await import("../cli/core/assets.mjs");
const { saveBrief } = await import("../cli/director/brief.mjs");
const { savePlan, readPlan, updateShot } = await import("../cli/director/plan.mjs");
const { preflight: realPreflight } = await import("../cli/lib/budget.mjs");
const { filmShot, filmReady } = await import("../cli/director/film.mjs");
const { shotWording } = await import("../cli/director/wording.mjs");

const catalog = loadCatalog();
const PNG = png(1280, 720);
const brief = { takeaway: "Calm mornings", durationS: 14, aspectRatio: "16:9", filmType: "live-action" };
const look = { palette: "teal and amber", grade: "soft contrast", filmLook: "35mm film grain", lensFamily: "anamorphic", keyLightSide: "left" };
const shot = (id, durationS, extra = {}) => ({
  id, durationS, purpose: "p", subject: id, action: "Waves roll under the pier", why: "w",
  size: "wide", angle: "eye-level", lens: "35mm", depth: "deep", move: { type: "truck-left", speed: "slow" },
  light: "golden-hour", cut: "hard", job: "cinematic", screenDirection: "none", checks: ["ok"], ...extra,
});
// s1 hard-cuts to s2, which runs continuously into s3.
const plan = () => ({
  look,
  shots: [shot("s1", 4), shot("s2", 5, { size: "medium", cut: "continuous" }), shot("s3", 5, { size: "close-up", lens: "85mm" })],
});
const library = openLibrary();
const LIMITS = { dailyUsd: 20, perJobUsd: 5, allowRoots: [] };
const preflight = async (_c, _r, o) => ({ estimatedUsd: 1.5, basis: "stub", cap: o.budgetUsd ?? 5, creditsBefore: null });

function ctx(film, extra = {}) {
  const calls = [];
  const frames = [];
  return {
    calls,
    frames,
    store: openJobs(mkdtempSync(join(tmpdir(), "kie-film-store-"))),
    limits: LIMITS,
    library,
    upload: async (path) => ({ url: `https://files.test/${path.split("/").pop()}` }),
    deps: { preflight, createTask: async (prov, fam, m, input) => (calls.push({ m, input }), { taskId: `t-${calls.length}` }) },
    lastFrame: async (video, out) => (frames.push([video, out]), writeFileSync(out, PNG), out),
    via: "test",
    ...extra,
  };
}

/** A finished still or take for `shot`, as waitJob would leave it. */
function finished(c, film, shotId, stage, file, extra = {}) {
  const job = c.store.create({ run: film, shot: shotId, stage, capability: stage === "take" ? "video" : "image", model: "x", provider: "kie", estimateUsd: 0.1, ...extra });
  writeFileSync(join(RUNS, film, file), PNG);
  c.store.transition(job.id, "sending");
  c.store.transition(job.id, "submitted", { upstreamTaskId: "t" });
  return c.store.transition(job.id, "succeeded", { artifacts: [join(RUNS, film, file)], actualUsd: 0.1, costSource: "task-record" });
}

function film(name) {
  saveBrief(name, brief);
  savePlan(catalog, name, plan());
  return name;
}

describe("filming one shot", () => {
  test("refuses a shot with no still", async () => {
    const f = film("one");
    await assert.rejects(filmShot(catalog, f, "s1", ctx(f)), (e) => e.code === EXIT.USAGE && /s1 has no still yet/.test(e.message));
  });

  test("animates the still at the padded length with the shot's wording and audio off", async () => {
    const f = "one";
    const c = ctx(f);
    finished(c, f, "s1", "still", "s1-still.png");
    const r = await filmShot(catalog, f, "s1", c);
    const p = readPlan(f);
    assert.equal(r.job.stage, "take");
    assert.equal(r.job.shot, "s1");
    assert.equal(r.job.artifactBase, "s1-take");
    assert.equal(r.job.plannedS, 4);
    assert.equal(r.job.generatedS, 5);
    assert.equal(r.job.firstFrame, "s1-still.png");
    assert.equal(c.calls[0].m, "bytedance/seedance-2-5");
    assert.equal(c.calls[0].input.duration, 5);
    assert.equal(c.calls[0].input.generate_audio, false);
    assert.equal(c.calls[0].input.first_frame_url, "https://files.test/s1-still.png");
    assert.equal(c.calls[0].input.prompt, shotWording(catalog, p, p.shots[0], { assets: [] }).prompt);
  });

  test("a continuous shot waits for the shot before it, then starts on its real last frame", async () => {
    const f = "one";
    const c = ctx(f);
    finished(c, f, "s3", "still", "s3-still.png");
    await assert.rejects(filmShot(catalog, f, "s3", c), /s3 continues from s2, which has no take yet/);
    finished(c, f, "s2", "take", "s2-take.mp4");
    const r = await filmShot(catalog, f, "s3", c);
    assert.deepEqual(c.frames, [[join(RUNS, f, "s2-take.mp4"), join(RUNS, f, "s2-take-last.png")]]);
    assert.equal(r.job.firstFrame, "s2-take-last.png");
    assert.equal(c.calls[0].input.first_frame_url, "https://files.test/s2-take-last.png");
  });
});

describe("one take in flight per shot", () => {
  test("filming a shot again while its take is submitted is refused, naming the job", async () => {
    const f = film("busy");
    const c = ctx(f);
    finished(c, f, "s1", "still", "s1-still.png");
    const first = await filmShot(catalog, f, "s1", c);
    await assert.rejects(filmShot(catalog, f, "s1", c), (e) => e.code === EXIT.USAGE && /s1 is already being filmed/.test(e.message) && e.message.includes(first.job.id));
    assert.equal(c.calls.length, 1);
  });

  test("two calls at once submit one take; the other is refused", async () => {
    const f = film("race");
    const c = ctx(f);
    finished(c, f, "s1", "still", "s1-still.png");
    const results = await Promise.allSettled([filmShot(catalog, f, "s1", c), filmShot(catalog, f, "s1", c)]);
    assert.equal(c.calls.length, 1, "one create call");
    assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
    assert.match(results.find((r) => r.status === "rejected").reason.message, /s1 is already being filmed/);
    assert.equal(c.store.list().filter((j) => j.stage === "take").length, 1, "one take record");
  });

  test("a take whose submit ended uncertain is never resubmitted; the refusal says how to resolve it", async () => {
    const f = film("unsure");
    const c = ctx(f);
    finished(c, f, "s1", "still", "s1-still.png");
    const job = c.store.create({ run: f, shot: "s1", stage: "take", capability: "video", model: "seedance-2-5", provider: "kie", estimateUsd: 1 });
    c.store.transition(job.id, "sending");
    c.store.transition(job.id, "uncertain", { error: "timed out" });
    await assert.rejects(filmShot(catalog, f, "s1", c), (e) => e.code === EXIT.USAGE && e.message.includes(job.id) && /Do not resubmit/.test(e.message) && /kie job resolve/.test(e.message));
    assert.equal(c.calls.length, 0);
  });
});

describe("film all", () => {
  test("needs a spending limit and every still first; plans the total", async () => {
    const f = film("all");
    const c = ctx(f);
    await assert.rejects(filmReady(catalog, f, c), /max_usd/);
    await assert.rejects(filmReady(catalog, f, { ...c, maxUsd: 100 }), (e) => e.code === EXIT.USAGE && /Every shot needs its still before filming: s1, s2/.test(e.message));
    assert.equal(c.calls.length, 0);
  });

  test("refuses a total above max_usd, submitting nothing", async () => {
    const f = "all";
    const c = ctx(f);
    finished(c, f, "s1", "still", "s1-still.png");
    finished(c, f, "s2", "still", "s2-still.png");
    await assert.rejects(filmReady(catalog, f, { ...c, maxUsd: 0.5 }), (e) => e.code === EXIT.BUDGET && /more than the \$0\.50 agreed/.test(e.message));
    assert.equal(c.calls.length, 0);
  });

  test("submits what is ready in order; the continuous shot waits; calling again moves on; nothing is filmed twice", async () => {
    const f = "all";
    const c = ctx(f);
    finished(c, f, "s1", "still", "s1-still.png");
    finished(c, f, "s2", "still", "s2-still.png");
    const a = await filmReady(catalog, f, { ...c, maxUsd: 100 });
    assert.deepEqual(a.submitted.map((s) => s.shot), ["s1", "s2"]);
    assert.deepEqual(a.waiting, ["s3"]);
    assert.equal(a.stopped, null);
    assert.ok(a.remainingUsd > 0);

    const b = await filmReady(catalog, f, { ...c, maxUsd: 100 });
    assert.deepEqual(b.submitted, [], "s1 and s2 are filming");
    assert.deepEqual(b.filming, ["s1", "s2"]);
    assert.deepEqual(b.waiting, ["s3"]);

    const [s1job, s2job] = c.store.list().filter((j) => j.stage === "take");
    c.store.transition(s1job.id, "succeeded", { artifacts: [join(RUNS, f, "s1-take.mp4")] });
    writeFileSync(join(RUNS, f, "s1-take.mp4"), PNG);
    c.store.transition(s2job.id, "succeeded", { artifacts: [join(RUNS, f, "s2-take.mp4")] });
    writeFileSync(join(RUNS, f, "s2-take.mp4"), PNG);
    const d = await filmReady(catalog, f, { ...c, maxUsd: 100 });
    assert.deepEqual(d.submitted.map((s) => s.shot), ["s3"]);
    assert.deepEqual(d.done, ["s1", "s2"]);
  });

  test("a dry run plans every ready shot and submits nothing", async () => {
    const f = film("dry");
    const c = ctx(f);
    for (const id of ["s1", "s2"]) finished(c, f, id, "still", `${id}-still.png`);
    const r = await filmReady(catalog, f, { ...c, maxUsd: 100, dryRun: true });
    assert.equal(r.dryRun, true);
    assert.deepEqual(r.submitted.map((s) => [s.shot, s.jobId, s.dryRun]), [["s1", null, true], ["s2", null, true]]);
    assert.deepEqual(r.waiting, ["s3"]);
    assert.equal(c.calls.length, 0);
    assert.equal(c.store.list().filter((j) => j.stage === "take").length, 0);
  });

  test("a failed take is never refilmed by film all; it is reported for Alex to decide", async () => {
    const f = film("fail");
    const c = ctx(f);
    for (const id of ["s1", "s2"]) finished(c, f, id, "still", `${id}-still.png`);
    const job = c.store.create({ run: f, shot: "s1", stage: "take", capability: "video", model: "x", provider: "kie", estimateUsd: 1 });
    c.store.transition(job.id, "sending");
    c.store.transition(job.id, "submitted", { upstreamTaskId: "t" });
    c.store.transition(job.id, "failed-charged", { error: "content flagged", actualUsd: 1 });
    const r = await filmReady(catalog, f, { ...c, maxUsd: 100 });
    assert.deepEqual(r.failed, [{ shot: "s1", state: "failed-charged", error: "content flagged" }]);
    assert.deepEqual(r.submitted.map((s) => s.shot), ["s2"]);
  });

  test("a refusal or an ambiguous create stops the queue and names the shot", async () => {
    const f = film("stop");
    const c = ctx(f, {
      deps: {
        preflight,
        createTask: async () => {
          throw uncertain("timed out", null);
        },
      },
    });
    for (const id of ["s1", "s2"]) finished(c, f, id, "still", `${id}-still.png`);
    const r = await filmReady(catalog, f, { ...c, maxUsd: 100 });
    assert.deepEqual(r.submitted, []);
    assert.equal(r.stopped.shot, "s1");
    assert.equal(r.stopped.code, EXIT.UNCERTAIN);
    assert.match(r.stopped.localJobId, /^j-/);
    const again = await filmReady(catalog, f, { ...c, maxUsd: 100 });
    assert.equal(again.filming[0], "s1", "the uncertain take is never resubmitted");
    assert.equal(again.stopped.shot, "s2");
  });
});

describe("Film all films only what was agreed", () => {
  // s1 hard-cuts to s2, which runs into s3: s3 waits for s2's take, so it is filmed on a later call.
  const agreedPlan = () => ({
    look,
    shots: [
      shot("s1", 4, { model: "seedance-2" }),
      shot("s2", 4, { size: "medium", cut: "continuous", model: "seedance-2" }),
      shot("s3", 4, { size: "close-up", lens: "85mm", model: "seedance-2-fast" }),
    ],
  });
  const agreedFilm = (name) => {
    saveBrief(name, { ...brief, durationS: 12 });
    savePlan(catalog, name, agreedPlan());
    return name;
  };
  const land = (c, f, id) => {
    const job = c.store.list().find((j) => j.stage === "take" && j.shot === id);
    writeFileSync(join(RUNS, f, `${id}-take.mp4`), PNG);
    c.store.transition(job.id, "succeeded", { artifacts: [join(RUNS, f, `${id}-take.mp4`)] });
  };

  test("a shot switched to a pricier model after the agreement stops the queue and asks to agree again", async () => {
    const f = agreedFilm("agreed");
    const c = ctx(f);
    for (const id of ["s1", "s2"]) finished(c, f, id, "still", `${id}-still.png`);
    const a = await filmReady(catalog, f, { ...c, maxUsd: 3.02 });
    assert.deepEqual(a.submitted.map((s) => s.shot), ["s1", "s2"]);
    assert.deepEqual(a.agreement.shots.map((s) => [s.id, s.estimateUsd]), [["s1", 1.2], ["s2", 1.2], ["s3", 0.62]]);

    updateShot(catalog, f, "s3", { model: "seedance-2-5" }); // $1.58 now, under the $3.02 total but over the $0.62 agreed for it
    land(c, f, "s2");
    for (const again of [{ agreement: a.agreement }, { maxUsd: 3.02 }]) {
      await assert.rejects(
        filmReady(catalog, f, { ...c, ...again }),
        (e) => e.code === EXIT.BUDGET && /s3 now costs about \$1\.58, more than the \$0\.62 agreed for it/.test(e.message) && /agree/.test(e.message),
      );
    }
    assert.equal(c.calls.length, 2, "s3 was not submitted");
  });

  test("a shot added to the plan mid-queue is not filmed without a new agreement", async () => {
    const f = agreedFilm("added");
    const c = ctx(f);
    for (const id of ["s1", "s2"]) finished(c, f, id, "still", `${id}-still.png`);
    const a = await filmReady(catalog, f, { ...c, maxUsd: 3.02 });
    const p = readPlan(f);
    savePlan(catalog, f, { look: p.look, shots: [...p.shots, shot("s4", 1, { size: "wide", model: "seedance-2-fast" })] });
    finished(c, f, "s4", "still", "s4-still.png");
    land(c, f, "s2");
    for (const again of [{ agreement: a.agreement }, { maxUsd: 3.02 }]) {
      await assert.rejects(filmReady(catalog, f, { ...c, ...again }), (e) => e.code === EXIT.BUDGET && /s4 is not in it/.test(e.message));
    }
    assert.equal(c.calls.length, 2);
    const fresh = await filmReady(catalog, f, { ...c, maxUsd: 1.12 });
    assert.deepEqual(fresh.submitted.map((s) => s.shot), ["s3", "s4"], "a new total is a new agreement");
  });

  test("each take is capped at the price agreed for it", async () => {
    const f = agreedFilm("capped");
    const c = ctx(f);
    for (const id of ["s1", "s2"]) finished(c, f, id, "still", `${id}-still.png`);
    const caps = [];
    c.deps.preflight = async (_c, _r, o) => (caps.push(o.budgetUsd), { estimatedUsd: 1, basis: "stub", cap: o.budgetUsd, creditsBefore: null });
    await filmReady(catalog, f, { ...c, maxUsd: 3.02 });
    assert.deepEqual(caps, [1.21, 1.21]);
  });
});

describe("a shot above the default $3 video budget", () => {
  test("a 10s Seedance 2.5 shot submits and reserves its estimate", async () => {
    const f = "long";
    saveBrief(f, { ...brief, durationS: 10 });
    savePlan(catalog, f, { look, shots: [shot("s1", 10, { model: "seedance-2-5" })] });
    // The real budget check, without the balance call.
    const offline = (cat, route, o) => realPreflight(cat, { ...route, prov: { ...route.prov, credits: null } }, o);
    const c = ctx(f);
    c.deps.preflight = offline;
    finished(c, f, "s1", "still", "s1-still.png");
    const r = await filmShot(catalog, f, "s1", c);
    assert.equal(c.calls.length, 1);
    assert.equal(c.calls[0].input.duration, 11);
    assert.ok(r.job.estimateUsd > 3, `reserved ${r.job.estimateUsd}`);
    assert.equal(r.job.estimateUsd, r.estimateUsd);
  });
});

describe("a request every route refuses", () => {
  test("names each route's reason, not only the last one's", async () => {
    const f = film("tiny");
    const c = ctx(f);
    const job = c.store.create({ run: f, shot: "s1", stage: "still", capability: "image", model: "x", provider: "kie", estimateUsd: 0.1 });
    writeFileSync(join(RUNS, f, "s1-still.png"), Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex"));
    c.store.transition(job.id, "sending");
    c.store.transition(job.id, "submitted", { upstreamTaskId: "t" });
    c.store.transition(job.id, "succeeded", { artifacts: [join(RUNS, f, "s1-still.png")] });
    await assert.rejects(filmShot(catalog, f, "s1", c), (e) => /kie\.ai · bytedance\/seedance-2-5 refused[\s\S]*300/.test(e.message));
  });
});
