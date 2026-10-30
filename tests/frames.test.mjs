import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EXIT } from "../cli/lib/errors.mjs";
import { frameTimes, extractFrames } from "../cli/lib/frames.mjs";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe("frames are sampled where they say they are", () => {
  test("the middle of each equal slice, never the very start or end", () => {
    assert.deepEqual(frameTimes(8, 8), [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]);
  });

  test("odd durations round to the millisecond", () => {
    assert.deepEqual(frameTimes(5, 3), [0.833, 2.5, 4.167]);
  });

  test("a zero-length file is refused", () => {
    assert.throws(() => frameTimes(0), { code: EXIT.USAGE });
  });
});

describe("extractFrames on a real clip", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  test("writes a 4×2 sheet of 480px tiles plus full-size first and last frames", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kie-frames-"));
    const clip = join(dir, "clip.mp4");
    const made = spawnSync("ffmpeg", [
      "-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=24",
      "-pix_fmt", "yuv420p", clip,
    ]);
    assert.equal(made.status, 0, String(made.stderr));

    const r = await extractFrames(clip);
    assert.equal(r.dir, join(dir, "clip-frames"));
    for (const p of [r.sheet, r.first, r.last]) assert.ok(existsSync(p), p);
    assert.equal(r.times.length, 8);

    const dims = (p) =>
      String(spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", p]).stdout).trim();
    assert.equal(dims(r.sheet), "1920,720", "4 tiles × 480 wide, 2 rows × 360 high");
    assert.equal(dims(r.first), "320,240", "first frame keeps the source size");
    assert.equal(dims(r.last), "320,240");
  });
});
