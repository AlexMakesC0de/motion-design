import { mkdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { ffmpeg, probe, requireFfmpeg } from "./ffmpeg.mjs";
import { usage } from "./errors.mjs";

const COUNT = 8;
const COLS = 4;
const TILE_WIDTH = 480;

/**
 * Sample times at the middle of n equal slices. Never t=0 or the final frame:
 * those are first.png and last.png, and a fade-in or fade-out would make the
 * sheet open or close on black.
 */
export function frameTimes(durationS, n = COUNT) {
  if (!(durationS > 0)) throw usage(`Cannot sample frames from a ${durationS}s file.`);
  return Array.from({ length: n }, (_, i) => Math.round((((i + 0.5) * durationS) / n) * 1000) / 1000);
}

/**
 * A contact sheet (8 frames, 4×2, 480px tiles) plus full-size first and last
 * frames. The sheet is for looking at a clip without playing it; last.png is
 * what the next shot's first_frame would be when shots must join.
 */
export async function extractFrames(videoPath, { outDir } = {}) {
  requireFfmpeg();
  const info = await probe(videoPath);
  const times = frameTimes(info.durationS);
  const dir = outDir ?? join(dirname(videoPath), `${basename(videoPath, extname(videoPath))}-frames`);
  mkdirSync(dir, { recursive: true });

  const tiles = [];
  for (const [i, t] of times.entries()) {
    const tile = join(dir, `t${String(i + 1).padStart(2, "0")}.png`);
    await ffmpeg(["-ss", String(t), "-i", videoPath, "-frames:v", "1", "-vf", `scale=${TILE_WIDTH}:-2`, tile]);
    tiles.push(tile);
  }

  const sheet = join(dir, "sheet.jpg");
  await ffmpeg([
    "-framerate", "1", "-i", join(dir, "t%02d.png"),
    "-vf", `tile=${COLS}x${COUNT / COLS}`, "-frames:v", "1", "-q:v", "3", sheet,
  ]);

  const first = join(dir, "first.png");
  await ffmpeg(["-i", videoPath, "-frames:v", "1", first]);

  // -update keeps overwriting one image, so what remains is the true last frame.
  const last = join(dir, "last.png");
  await ffmpeg(["-sseof", "-0.5", "-i", videoPath, "-update", "1", last]);

  return { dir, sheet, first, last, tiles, times, durationS: info.durationS };
}
