import { RUNS, KEY, deps, req, tmp } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const { createApp } = await import("../server/app.mjs");
const { RENDER_DIR } = await import("../../cli/lib/render.mjs");

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const hasRender = existsSync(join(RENDER_DIR, "node_modules", "remotion"));
mkdirSync(join(RUNS, "finish-demo"), { recursive: true });

let app, port;
before(async () => {
  app = createApp({ key: KEY, deps, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());

describe("GET /api/finish", () => {
  test("says whether ffmpeg and the render engine are installed, and lists what the tools take", async () => {
    const r = await req(port, "/api/finish");
    assert.equal(r.status, 200);
    assert.equal(r.json.tools.ffmpeg.ok, hasFfmpeg);
    assert.equal(r.json.tools.render.ok, hasRender);
    if (!hasRender) assert.match(r.json.tools.render.install, /npm install/);
    assert.deepEqual(r.json.ratios, ["16:9", "9:16", "1:1", "4:5", "4:3", "21:9"]);
    assert.deepEqual(r.json.variantModes, ["blur", "crop", "pad"]);
    assert.deepEqual(r.json.captionStyles, ["social", "subtle"]);
    assert.ok(r.json.transitions.includes("fade"));
    assert.deepEqual(r.json.templates.find((t) => t.id === "kinetic-type").fields.map((f) => f.name), ["lines", "kicker", "footer", "granularity", "align"]);
  });

  test("a missing tool comes with core's install instructions", async () => {
    const missing = createApp({
      key: KEY,
      deps,
      distDir: join(tmp, "nodist"),
      pollMs: 60_000,
      finish: { check: () => ({ ffmpeg: { ok: false, install: "ffmpeg not found on PATH. Finishing commands need it:\n  brew install ffmpeg" }, render: { ok: true, install: null } }) },
    });
    await new Promise((r) => missing.listen(0, "127.0.0.1", r));
    try {
      const r = await req(missing.address().port, "/api/finish");
      assert.equal(r.json.tools.ffmpeg.ok, false);
      assert.match(r.json.tools.ffmpeg.install, /brew install ffmpeg/);
    } finally {
      await missing.closeAll();
    }
  });
});
