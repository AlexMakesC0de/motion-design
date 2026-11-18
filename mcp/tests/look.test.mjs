import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RUNS, hasFfmpeg, realPng, stubs, connect, call, errorOf } from "./helpers.mjs";
import { png } from "../../tests/fixtures/images.mjs";

const { deps } = stubs();
const client = await connect(deps);

const TOOLS = [
  "status", "list_models", "list_presets", "list_looks", "estimate", "list_runs", "get_run",
  "save_asset", "list_assets", "get_asset", "update_asset", "remove_asset",
  "generate_image", "generate_video", "wait_job",
  "frames", "probe", "assemble", "variants", "caption", "render",
  "get_menu", "get_brief", "save_brief", "get_plan", "save_plan", "update_shot", "check_plan", "suggest_model", "shot_wording",
  "get_shots", "make_sheet", "adopt_sheet", "make_still", "film_shot", "film_all", "review_shot", "save_review", "cut_film",
  "list_scenes", "get_scene_prompt", "save_scene", "add_scene_image", "delete_scene", "choose_version", "draft_scene", "final_scene", "save_idea", "copy_scene",
  "list_skills", "get_skill",
];

describe("the tool list", () => {
  test("all 51 tools; spending tools say so first and are marked open-world, not destructive", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOLS].sort());
    assert.ok(!tools.some((t) => t.name === "set_auto_redo"), "auto-redo is the user's switch: studio and CLI only");
    const filmAll = tools.find((t) => t.name === "film_all");
    assert.match(filmAll.description, /the total the user stated/);
    assert.match(filmAll.inputSchema.properties.max_usd.description, /never one you worked out/);
    for (const name of ["generate_image", "generate_video", "make_sheet", "make_still", "film_shot", "film_all", "draft_scene", "final_scene"]) {
      const t = tools.find((x) => x.name === name);
      assert.match(t.description, /^Spends kie credits\./);
      assert.equal(t.annotations.openWorldHint, true);
      assert.equal(t.annotations.destructiveHint, false);
    }
    for (const name of ["list_models", "list_presets", "list_looks", "estimate", "list_runs", "get_run", "list_assets", "get_asset", "list_scenes", "get_scene_prompt", "list_skills", "get_skill"]) {
      assert.equal(tools.find((x) => x.name === name).annotations.readOnlyHint, true, name);
    }
    assert.ok(tools.every((t) => t.outputSchema), "every tool declares an output schema");
  });
});

describe("instructions", () => {
  test("tell the client to call status after a timeout before generating again", () => {
    assert.match(client.getInstructions(), /If a call times out or its result is lost, call status before generating again/);
  });
});

describe("look", () => {
  test("status: cap, balance through the stub, no unsettled jobs", async () => {
    const r = await call(client, "status");
    assert.equal(r.structuredContent.today.capUsd, 10);
    assert.equal(r.structuredContent.providers.find((p) => p.name === "kie").balance, 100);
    assert.deepEqual(r.structuredContent.unsettled, []);
  });

  test("list_looks: short styles with their picks and lines", async () => {
    const r = await call(client, "list_looks");
    const noir = r.structuredContent.looks.find((l) => l.id === "neo-noir");
    assert.equal(noir.title, "Neo-noir night");
    assert.equal(noir.picks.light, "night-practicals");
    assert.match(noir.look, /Inky blacks/);
  });

  test("list_models and list_presets", async () => {
    const m = await call(client, "list_models", { capability: "video" });
    assert.ok(m.structuredContent.models.some((x) => x.id === "seedance-2-5"));
    const p = await call(client, "list_presets");
    assert.ok(p.structuredContent.presets.length > 0);
  });

  test("estimate: allowed, and a refused combination with its reason", async () => {
    const base = { model: "seedance-2-5", duration_s: 4, resolution: "480p", provider: "kie" };
    const okR = await call(client, "estimate", base);
    assert.equal(okR.structuredContent.estimateUsd, 0.56);
    assert.equal(okR.structuredContent.allowed, true);
    const refs = [{ source: "https://x.test/a.png", role: "first_frame" }, { source: "https://x.test/b.png", role: "identity" }];
    const bad = await call(client, "estimate", { ...base, refs });
    assert.equal(bad.structuredContent.allowed, false);
    assert.match(bad.structuredContent.problems.join("\n"), /cannot combine/);
  });

  test("arguments of the wrong type are refused by the schema", async () => {
    const r = await call(client, "estimate", { model: "seedance-2-5", duration_s: "4" });
    assert.equal(r.isError, true);
  });

  test("list_runs and get_run; an unknown run is code 3", async () => {
    mkdirSync(join(RUNS, "look-demo"), { recursive: true });
    writeFileSync(join(RUNS, "look-demo", "prompt.txt"), "Shot 1: Zed waves.");
    const runs = await call(client, "list_runs");
    assert.ok(runs.structuredContent.runs.some((r) => r.run === "look-demo"));
    const run = await call(client, "get_run", { run: "look-demo" });
    assert.equal(run.structuredContent.prompt, "Shot 1: Zed waves.");
    const none = await call(client, "get_run", { run: "nope" });
    assert.equal(none.isError, true);
    assert.equal(errorOf(none).code, 3);
  });
});

describe("assets", () => {
  test("save_asset from a run folder, by relative path; list_assets shows it", async () => {
    mkdirSync(join(RUNS, "look-demo"), { recursive: true });
    writeFileSync(join(RUNS, "look-demo", "zed.png"), png(1024, 1024));
    const r = await call(client, "save_asset", {
      name: "zed", kind: "character", description: "Zed, a small round robot.", images: ["look-demo/zed.png"],
    });
    assert.equal(r.structuredContent.images.length, 1);
    const list = await call(client, "list_assets");
    assert.deepEqual(list.structuredContent.assets.map((a) => [a.name, a.hasSheet]), [["zed", false]]);
  });

  test("an image outside the allowed folders is refused with code 3, naming them", async () => {
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "kie-elsewhere-")));
    writeFileSync(join(elsewhere, "secret.png"), png(1024, 1024));
    const r = await call(client, "save_asset", {
      name: "secret", kind: "product", description: "x", images: [join(elsewhere, "secret.png")],
    });
    assert.equal(errorOf(r).code, 3);
    assert.ok(r.content[0].text.includes(RUNS), "the message names the allowed folders");
  });

  test("get_asset returns one preview image per stored image", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    realPng(join(RUNS, "look-demo", "real.png"));
    await call(client, "save_asset", {
      name: "real", kind: "style", description: "Red.", images: ["look-demo/real.png"],
    });
    const r = await call(client, "get_asset", { name: "real" });
    assert.equal(r.content.filter((c) => c.type === "image").length, 1);
    assert.equal(r.structuredContent.images[0].n, 1);
  });

  test("get_asset for a missing name is code 3", async () => {
    const r = await call(client, "get_asset", { name: "nobody" });
    assert.equal(errorOf(r).code, 3);
  });
});
