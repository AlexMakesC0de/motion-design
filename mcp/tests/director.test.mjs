import { RUNS, stubs, connect, call, errorOf } from "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { deps, calls } = stubs();
const client = await connect(deps);

const brief = { takeaway: "Mornings by the sea are calm", durationS: 10, aspectRatio: "16:9", filmType: "live-action" };
const look = { palette: "teal and amber", grade: "soft contrast", filmLook: "35mm film grain", lensFamily: "anamorphic", keyLightSide: "left" };
const shot = (id, durationS, extra = {}) => ({
  id, durationS, purpose: "p", subject: "mara", action: "Mara walks along the wet pier", why: "w",
  size: "wide", angle: "eye-level", lens: "35mm", depth: "deep", move: { type: "truck-left", speed: "slow" },
  light: "overcast", cut: "hard", job: "cinematic", screenDirection: "left-to-right", checks: ["Mara stays on the pier"], ...extra,
});
const plan = { look, shots: [shot("s1", 4), shot("s2", 6, { size: "close-up", lens: "85mm", screenDirection: "none" })] };

describe("director tools", () => {
  test("get_menu lists every group with its ids", async () => {
    const r = await call(client, "get_menu");
    assert.equal(r.isError, undefined, JSON.stringify(r));
    assert.ok(r.structuredContent.menu.moves.some((m) => m.id === "push-in"));
    assert.match(r.content[0].text, /^sizes: extreme-wide/);
  });

  test("save_plan before a brief is refused with code 1", async () => {
    const r = await call(client, "save_plan", { run: "sea", plan });
    assert.equal(r.isError, true);
    assert.equal(errorOf(r).code, 1);
    assert.match(r.content[0].text, /no brief yet/);
  });

  test("save_brief then get_brief round-trips", async () => {
    const saved = await call(client, "save_brief", { run: "sea", brief });
    assert.equal(saved.isError, undefined, JSON.stringify(saved));
    const r = await call(client, "get_brief", { run: "sea" });
    assert.deepEqual(r.structuredContent.brief, brief);
  });

  test("save_plan fills models, checks, prices and writes shots.json", async () => {
    const r = await call(client, "save_plan", { run: "sea", plan });
    assert.equal(r.isError, undefined, JSON.stringify(r));
    const sc = r.structuredContent;
    assert.equal(sc.plan.version, 1);
    assert.deepEqual(sc.plan.shots.map((s) => s.model), ["seedance-2-5", "seedance-2-5"]);
    assert.deepEqual(sc.check.errors, []);
    assert.ok(sc.cost.totalUsd > 0);
    assert.ok(existsSync(join(RUNS, "sea", "shots.json")));
    assert.equal(calls.create.length, 0, "nothing was generated");
  });

  test("a plan that breaks a rule is refused with every reason", async () => {
    const bad = { look, shots: [shot("s1", 4)] };
    const r = await call(client, "save_plan", { run: "sea", plan: bad });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /add up to 4s; the brief asks for 10s/);
    assert.equal(JSON.parse(readFileSync(join(RUNS, "sea", "shots.json"), "utf8")).version, 1, "the saved plan is untouched");
  });

  test("a value off the menu is refused before the checker", async () => {
    const r = await call(client, "save_plan", { run: "sea", plan: { look, shots: [shot("s1", 10, { size: "huge" })] } });
    assert.equal(r.isError, true);
  });

  test("update_shot changes one field and saves a new version", async () => {
    const r = await call(client, "update_shot", { run: "sea", shot: "s2", changes: { job: "motion-graphics" } });
    assert.equal(r.isError, undefined, JSON.stringify(r));
    const s2 = r.structuredContent.plan.shots[1];
    assert.equal(s2.model, "minimax-h3");
    assert.equal(r.structuredContent.plan.version, 2);
  });

  test("check_plan checks an unsaved plan without writing it", async () => {
    const r = await call(client, "check_plan", { run: "sea", plan: { look, shots: [shot("s1", 4), shot("s2", 6, { screenDirection: "right-to-left" })] } });
    assert.equal(r.isError, undefined, JSON.stringify(r));
    assert.ok(r.structuredContent.errors.some((e) => e.rule === "screen-direction"));
    assert.deepEqual(r.structuredContent.errors.filter((e) => e.rule === "model-fit"), [], "models are picked before checking");
  });

  test("suggest_model gives the pick, its reason and the still model", async () => {
    const r = await call(client, "suggest_model", { run: "sea", shot: "s1" });
    assert.equal(r.isError, undefined, JSON.stringify(r));
    assert.equal(r.structuredContent.model, "seedance-2-5");
    assert.equal(r.structuredContent.stillModel, "nano-banana-2");
  });

  test("shot_wording words the shot for its model with audio off", async () => {
    const r = await call(client, "shot_wording", { run: "sea", shot: "s1" });
    assert.equal(r.isError, undefined, JSON.stringify(r));
    assert.equal(r.structuredContent.family, "seedance");
    assert.deepEqual(r.structuredContent.params, { generate_audio: false });
    assert.match(r.structuredContent.prompt, /^Look: 35mm film grain/);
  });

  test("an unknown shot names the shots there are", async () => {
    const r = await call(client, "shot_wording", { run: "sea", shot: "s9" });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /Shots: s1, s2/);
  });
});
