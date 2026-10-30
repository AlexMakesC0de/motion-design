import { KEY, RUNS, tmp, req } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const { createApp } = await import("../server/app.mjs");

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
mkdirSync(join(RUNS, "frames-demo"), { recursive: true });
mkdirSync(join(RUNS, "frames-other"), { recursive: true });
mkdirSync(join(tmp, "elsewhere"), { recursive: true });
const clip = (path) =>
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=2", "-pix_fmt", "yuv420p", path]);
if (hasFfmpeg) {
  clip(join(RUNS, "frames-demo", "out.mp4"));
  clip(join(RUNS, "frames-other", "out.mp4"));
  clip(join(tmp, "elsewhere", "out.mp4"));
}
writeFileSync(join(tmp, "limits.json"), JSON.stringify({ dailyUsd: 10, allowRoots: [join(tmp, "elsewhere")] }));
writeFileSync(join(tmp, "outside.mp4"), "not inside any allowed root");

let app, port;
before(async () => {
  app = createApp({ key: KEY, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());

const frames = (body) => req(port, "/api/frames", { method: "POST", body });

describe("POST /api/frames", () => {
  test("writes the sheet, first and last frame into the run and returns media URLs", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const r = await frames({ run: "frames-demo", video: "out.mp4" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.sheet, "/media/runs/frames-demo/out-frames/sheet.jpg");
    assert.equal(r.json.firstPath, "frames-demo/out-frames/first.png");
    assert.equal(r.json.times.length, 8);
    assert.ok(existsSync(join(RUNS, "frames-demo", "out-frames", "last.png")));
  });

  test("a video from another run gets its frames beside it, not over this run's", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const r = await frames({ run: "frames-demo", video: "frames-other/out.mp4" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.firstPath, "frames-other/out-frames/first.png");
    assert.ok(existsSync(join(RUNS, "frames-other", "out-frames", "sheet.jpg")));
  });

  test("a video outside runs/ gets a frames folder in the run named for its path, so two out.mp4 never share one", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const r = await frames({ run: "frames-demo", video: join(tmp, "elsewhere", "out.mp4") });
    assert.equal(r.status, 200, r.text);
    assert.match(r.json.firstPath, /^frames-demo\/out-[0-9a-f]{8}-frames\/first\.png$/);
    const again = await frames({ run: "frames-demo", video: join(tmp, "elsewhere", "out.mp4") });
    assert.equal(again.json.firstPath, r.json.firstPath, "the same source reuses its folder");
  });

  test("a video outside the allowed folders is refused: 400, code 3, nothing read", async () => {
    const r = await frames({ run: "frames-demo", video: "../outside.mp4" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 3);
    assert.equal(r.json.error.field, "video");
    assert.match(r.json.error.message, /outside the folders files may be read from/);
  });

  test("a hidden folder inside runs/ is refused too", async () => {
    mkdirSync(join(RUNS, ".jobs"), { recursive: true });
    writeFileSync(join(RUNS, ".jobs", "x.mp4"), "x");
    const r = await frames({ run: "frames-demo", video: ".jobs/x.mp4" });
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /hidden folder/);
  });

  test("an unknown run and a missing video are 400 on their fields", async () => {
    assert.equal((await frames({ run: "Bad Run", video: "out.mp4" })).json.error.field, "run");
    assert.equal((await frames({ run: "frames-demo" })).json.error.field, "video");
  });
});
