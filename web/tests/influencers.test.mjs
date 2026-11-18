import { KEY, RUNS, tmp, req, generateStubs } from "./helpers.mjs";
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { createApp } = await import("../server/app.mjs");
const { listRuns } = await import("../../cli/core/views.mjs");
const { openJobs } = await import("../../cli/core/jobs.mjs");
const { openLibrary } = await import("../../cli/core/assets.mjs");
const { describe: words } = await import("../../cli/core/influencers.mjs");

const { calls, deps } = generateStubs();
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.alloc(32)]);
const LIMITS = process.env.KIE_LIMITS_FILE;

let app, port;
before(async () => {
  app = createApp({ key: KEY, deps, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());
beforeEach(() => rmSync(LIMITS, { force: true }));

const post = (path, body) => req(port, path, { method: "POST", body });
const MIRA = { traits: { gender: "woman", age: "late-20s", skin: "olive", hairLength: "long", hairTexture: "wavy", hairColour: "dark-brown", style: "streetwear" }, extra: "freckles" };

/** A finished job in runs/influencers with one picture, as the follower would leave it. */
function finished(fields, file) {
  const store = openJobs(join(RUNS, ".jobs"));
  mkdirSync(join(RUNS, "influencers"), { recursive: true });
  const pic = join(RUNS, "influencers", file);
  writeFileSync(pic, png);
  let job = store.create({ run: "influencers", capability: "image", model: "nano-banana-2", provider: "kie", estimateUsd: 0.04, input: { prompt: "x" }, ...fields });
  for (const s of ["sending", "submitted"]) job = store.transition(job.id, s, s === "submitted" ? { upstreamTaskId: `t-${file}` } : {});
  return store.transition(job.id, "succeeded", { artifacts: [pic], actualUsd: 0.04, costSource: "task-record" });
}

describe("the words", () => {
  test("chips become one description, reused word for word", () => {
    assert.equal(words(MIRA.traits, MIRA.extra), "a 28-year-old woman with olive skin and long wavy dark brown hair, freckles, dressed in relaxed streetwear");
    assert.equal(words({ gender: "man" }), "a man");
    assert.throws(() => words({ hair: "long" }), /Unknown trait/);
    assert.throws(() => words({ gender: "robot" }), /Gender must be one of/);
  });
});

describe("GET /api/influencers", () => {
  test("lists the chips and prices four faces at 1K and the sheet; the run is not a film", async () => {
    const r = await req(port, "/api/influencers");
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.traits.some((t) => t.id === "gender" && t.options.some((o) => o.id === "woman")));
    assert.equal(r.json.faceModel, "nano-banana-2");
    assert.equal(r.json.faceUsd, 0.04);
    assert.equal(r.json.facesUsd, 0.16);
    assert.ok(r.json.sheetUsd > 0);
    finished({ stage: "face", batch: "b0" }, "stray.png");
    assert.ok(!listRuns().some((x) => x.run === "influencers"));
  });
});

describe("POST /api/influencers/faces", () => {
  test("sends four 1K portrait jobs from the description, filed as one batch", async () => {
    const before = calls.create.length;
    const r = await post("/api/influencers/faces", MIRA);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.jobs.length, 4);
    const sent = calls.create.slice(before);
    assert.equal(sent.length, 4);
    for (const s of sent) {
      assert.equal(s.model, "nano-banana-2");
      assert.equal(s.input.resolution, "1K");
      assert.equal(s.input.aspect_ratio, "3:4");
      assert.match(s.input.prompt, /portrait of a 28-year-old woman with olive skin/);
    }
    const list = await req(port, "/api/influencers");
    const batch = list.json.batches.find((b) => b.batch === r.json.batch);
    assert.deepEqual(batch.jobIds, r.json.jobs);
    assert.match(batch.description, /freckles/);
  });

  test("no gender, or an unknown chip, is refused before anything is sent", async () => {
    const before = calls.create.length;
    assert.equal((await post("/api/influencers/faces", { traits: { age: "30s" } })).json.error.field, "traits");
    assert.equal((await post("/api/influencers/faces", { traits: { gender: "woman", eyes: "green" } })).json.error.field, "traits");
    assert.equal(calls.create.length, before);
  });
});

describe("keeping a face", () => {
  let face;
  test("saves a Library character with its persona, then makes its sheet from that face", async () => {
    face = finished({ stage: "face", batch: "b1", persona: { traits: MIRA.traits, extra: "freckles", description: words(MIRA.traits, "freckles") } }, "face-b1-1.png");
    const before = calls.create.length;
    const r = await post("/api/influencers", { name: "Mira Lopez", face: face.id });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.influencer.name, "mira-lopez");
    assert.equal(r.json.influencer.displayName, "Mira Lopez");
    assert.ok(r.json.sheetJobId, r.text);
    const a = openLibrary().get("mira-lopez");
    assert.equal(a.kind, "character");
    assert.match(a.description, /olive skin/);
    assert.equal(a.persona.displayName, "Mira Lopez");
    const sheet = calls.create.slice(before);
    assert.equal(sheet.length, 1);
    assert.ok(sheet[0].input.image_input?.length, "the face goes in as the identity reference");
  });

  test("the same name twice, or a job that is not a face, is refused", async () => {
    assert.equal((await post("/api/influencers", { name: "mira lopez", face: face.id })).json.error.field, "name");
    const other = finished({ stage: "still" }, "other.png");
    assert.equal((await post("/api/influencers", { name: "Zoe", face: other.id })).json.error.field, "face");
  });

  test("adopting the finished sheet marks it as the sheet and keeps the face and the persona", async () => {
    const sheet = finished({ stage: "sheet", sheetFor: "mira-lopez" }, "sheet-mira-lopez.png");
    const r = await post("/api/influencers/mira-lopez/adopt", { job: sheet.id });
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.sheet);
    assert.equal(r.json.sheetJobKept, true, "the adopted sheet is the latest sheet job: nothing new to keep");
    const a = openLibrary().get("mira-lopez");
    assert.deepEqual(a.images.map((im) => im.role), ["sheet", "source"]);
    assert.equal(a.persona.displayName, "Mira Lopez");
    assert.equal((await post("/api/influencers/mira-lopez/adopt", { job: face.id })).json.error.field, "job");
  });

  test("Openjutsu's picker sees the influencer", async () => {
    const r = await req(port, "/api/jutsu");
    assert.ok(r.json.library.some((p) => p.asset === "mira-lopez" && p.influencer === "Mira Lopez"));
  });
});
