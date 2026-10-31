import { RUNS, hasFfmpeg, stubs, connect } from "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

const { openJobs } = await import("../../cli/core/jobs.mjs");

// A provider check slow enough for the client to cancel the call while it runs.
const { deps, calls } = stubs();
const preflight = deps.generate.preflight;
let checks = 0;
deps.generate.preflight = async (...a) => {
  checks += 1;
  await new Promise((r) => setTimeout(r, 150));
  return preflight(...a);
};
const client = await connect(deps);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jobsFor = (run) => openJobs(join(RUNS, ".jobs")).list().filter((j) => j.run === run);

/** Call `name`, cancel it (the chat's Stop) while the provider check runs, then let the server finish. */
async function cancelled(name, args) {
  const ctrl = new AbortController();
  const before = checks;
  const pending = client.callTool({ name, arguments: args }, undefined, { signal: ctrl.signal });
  while (checks === before) await sleep(5);
  ctrl.abort();
  await assert.rejects(pending);
  await sleep(300);
}

describe("a spending tool cancelled before it submits", () => {
  test("generate_video reserves and submits nothing once its call is cancelled", async () => {
    await cancelled("generate_video", { run: "stop-gen", prompt: "A paper fox.", model: "seedance-2-5", duration_s: 4, resolution: "480p", provider: "kie" });
    assert.equal(calls.create.length, 0, "nothing reached the provider");
    assert.deepEqual(jobsFor("stop-gen"), [], "nothing was reserved");
  });

  test("an uncancelled call still submits", async () => {
    const sent = calls.create.length;
    const r = await client.callTool({ name: "generate_video", arguments: { run: "stop-ok", prompt: "A paper fox.", model: "seedance-2-5", duration_s: 4, resolution: "480p", provider: "kie" } }, undefined, { signal: new AbortController().signal });
    assert.equal(r.isError, undefined, JSON.stringify(r.content));
    assert.equal(calls.create.length, sent + 1);
  });

  test("make_still (the director's making tools) reserves and submits nothing once cancelled", { skip: !hasFfmpeg && "needs ffmpeg" }, async () => {
    const brief = { takeaway: "Mornings by the sea are calm", durationS: 2, aspectRatio: "16:9", filmType: "live-action" };
    const look = { palette: "teal and amber", grade: "soft contrast", filmLook: "35mm film grain", lensFamily: "anamorphic", keyLightSide: "left" };
    const shot = {
      id: "s1", durationS: 2, purpose: "p", subject: "the pier", action: "Waves roll under the wet pier", why: "w",
      size: "wide", angle: "eye-level", lens: "35mm", depth: "deep", move: { type: "truck-left", speed: "slow" },
      light: "overcast", cut: "hard", job: "cinematic", screenDirection: "none", checks: ["the pier reads"],
    };
    for (const [name, args] of [["save_brief", { run: "stop-pier", brief }], ["save_plan", { run: "stop-pier", plan: { look, shots: [shot] } }]]) {
      const r = await client.callTool({ name, arguments: args });
      assert.equal(r.isError, undefined, JSON.stringify(r.content));
    }
    const sent = calls.create.length;
    await cancelled("make_still", { run: "stop-pier", shot: "s1" });
    assert.equal(calls.create.length, sent);
    assert.deepEqual(jobsFor("stop-pier"), []);
  });
});
