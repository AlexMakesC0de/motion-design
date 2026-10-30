// Frames: the free 8-frame contact sheet, first and last frame of a take,
// written into its run folder. Same arguments and confinement as the MCP
// frames tool: a bare name is a file in the run; anything with a slash is a
// path inside runs/ (or an absolute path), and it must sit in an allowed root.
import { createHash } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import { RUNS_DIR, runDir, isInside } from "../../../cli/lib/run.mjs";
import { confinePath } from "../../../cli/core/inputs.mjs";
import { extractFrames } from "../../../cli/lib/frames.mjs";
import { context } from "../state.mjs";
import { mediaUrl } from "../media.mjs";
import * as f from "./fields.mjs";

/**
 * Where a video's frames go. A video inside runs/ keeps them beside itself,
 * so a take named out.mp4 in another run never overwrites this run's
 * out-frames/. A video from elsewhere (an allowed root) gets a folder in the
 * run named for its full path, the same one each time it is asked for.
 */
export function framesDir(video, runFolder) {
  const stem = basename(video, extname(video));
  if (isInside(video, realpathSync(RUNS_DIR))) return join(dirname(video), `${stem}-frames`);
  const tag = createHash("sha256").update(video).digest("hex").slice(0, 8);
  mkdirSync(runFolder, { recursive: true });
  return join(realpathSync(runFolder), `${stem}-${tag}-frames`);
}

export function registerFrames(router) {
  router.post("/api/frames", async ({ body = {} }) => {
    const run = f.run(body);
    const video = f.text(body, "video", { required: true });
    const dir = runDir(run, { create: false });
    const { roots } = context();
    const named = video.includes("/") || isAbsolute(video) ? (isAbsolute(video) ? video : join(RUNS_DIR, video)) : join(dir, video);
    let path;
    try {
      path = confinePath(named, roots);
    } catch (err) {
      throw f.invalid("video", err.message);
    }
    const r = await extractFrames(path, { outDir: framesDir(path, dir) });
    return {
      sheet: mediaUrl(r.sheet),
      first: mediaUrl(r.first),
      last: mediaUrl(r.last),
      // Paths inside runs/, the form POST /api/library takes to save a frame as an asset.
      firstPath: relative(realpathSync(RUNS_DIR), r.first),
      lastPath: relative(realpathSync(RUNS_DIR), r.last),
      times: r.times,
      durationS: r.durationS,
    };
  });
}
