// Making a Library item's sheet from its popup: priced before anything is
// spent, one image job made from its photos, kept only on request.
import { KEY, RUNS, tmp, req, generateStubs } from "./helpers.mjs";
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { createApp } = await import("../server/app.mjs");
const { listRuns } = await import("../../cli/core/views.mjs");
const { openJobs } = await import("../../cli/core/jobs.mjs");
const { openLibrary } = await import("../../cli/core/assets.mjs");

const { calls, deps } = generateStubs();
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.alloc(32)]);
const LIMITS = process.env.KIE_LIMITS_FILE;

let app, port;
before(async () => {
  app = createApp({ key: KEY, deps, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
  const photo = join(tmp, "lena-face.png");
  writeFileSync(photo, png);
  openLibrary().save({ name: "lena", kind: "character", description: "a tall woman with short silver hair", images: [{ path: photo, role: "source" }] }, { roots: [tmp] });
});
after(() => app.closeAll());
beforeEach(() => rmSync(LIMITS, { force: true }));

const post = (path, body) => req(port, path, { method: "POST", body });

/** A finished sheet job in runs/library, as the follower would leave it. */
function finished(fields, file) {
  const store = openJobs(join(RUNS, ".jobs"));
  mkdirSync(join(RUNS, "library"), { recursive: true });
  const pic = join(RUNS, "library", file);
  writeFileSync(pic, png);
  let job = store.create({ run: "library", capability: "image", model: "nano-banana-2", provider: "kie", estimateUsd: 0.06, input: { prompt: "x" }, ...fields });
  for (const s of ["sending", "submitted"]) job = store.transition(job.id, s, s === "submitted" ? { upstreamTaskId: `t-${file}` } : {});
  return store.transition(job.id, "succeeded", { artifacts: [pic], actualUsd: 0.06, costSource: "task-record" });
}

describe("a Library item's sheet", () => {
  test("the item carries the price of making its sheet here; a style has none", async () => {
    const r = await req(port, "/api/library/lena");
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.makeSheet.model, "nano-banana-2");
    assert.ok(r.json.makeSheet.usd > 0);
    assert.equal(r.json.sheetJob, null);
    const q = await req(port, "/api/library/sheet-prompt?kind=style&description=grainy%20film");
    assert.equal(q.json.makeSheet, null);
  });

  test("make-sheet submits one job from the item's photo, with the outfit in the prompt, under a run that is not a film", async () => {
    const before = calls.create.length;
    const r = await post("/api/library/lena/make-sheet", { outfit: "a long black coat" });
    assert.equal(r.status, 200, r.text);
    const made = calls.create.slice(before);
    assert.equal(made.length, 1);
    assert.ok(made[0].input.image_input?.length, "the photo goes in as the identity reference");
    assert.match(made[0].input.prompt, /a long black coat/);
    assert.ok(r.json.sheetJob, r.text);
    assert.equal(r.json.sheetJob.run, "library");
    assert.equal(r.json.sheetJobKept, false);
    assert.ok(!listRuns().some((x) => x.run === "library"));
  });

  test("adopt makes the finished sheet the item's sheet and keeps its photo; another item's job is refused", async () => {
    const sheet = finished({ stage: "sheet", sheetFor: "lena" }, "sheet-lena.png");
    const r = await post("/api/library/lena/adopt", { job: sheet.id });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(openLibrary().get("lena").images.map((im) => im.role), ["sheet", "source"]);
    assert.equal(r.json.sheetJobKept, true);
    const other = finished({ stage: "sheet", sheetFor: "someone-else" }, "sheet-other.png");
    assert.equal((await post("/api/library/lena/adopt", { job: other.id })).json.error.field, "job");
  });
});
