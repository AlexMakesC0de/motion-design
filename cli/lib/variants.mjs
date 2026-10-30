import { basename, extname, join } from "node:path";
import { ffmpegWriting, probe, requireFfmpeg, dimsFor } from "./ffmpeg.mjs";
import { usage } from "./errors.mjs";

/**
 * Reframing a 16:9 film to 9:16 always loses something. There is no mode that
 * doesn't, so the choice is which loss you accept, and it must be explicit:
 *
 *   crop  -- fills the frame, throws away the sides. Right when the subject is
 *            centred; wrong the moment anything important lives at an edge, and
 *            it will silently decapitate a logo lockup.
 *   pad   -- keeps every pixel, adds black bars. Honest, and reads as a
 *            letterboxed 16:9 video posted to a vertical feed, because it is.
 *   blur  -- keeps every pixel over a blurred blow-up of itself. The social
 *            default: fills the frame without discarding content.
 *
 * blur is the default because it is the only one that neither crops content nor
 * looks like an accident. Anything better needs subject tracking, which is a
 * different tool.
 */
export const MODES = ["blur", "crop", "pad"];

function filterFor(mode, w, h, padColor) {
  switch (mode) {
    case "crop":
      return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;
    case "pad":
      return (
        `scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
        `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${padColor},setsar=1`
      );
    case "blur":
      return (
        `split=2[bg][fg];` +
        `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},` +
        `gblur=sigma=28,eq=brightness=-0.12:saturation=1.1[bgb];` +
        `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease[fgs];` +
        `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1`
      );
    default:
      throw usage(`Unknown reframe mode "${mode}". Modes: ${MODES.join(", ")}`);
  }
}

/**
 * Reframe BEFORE captioning, never after.
 *
 * A caption burned into a 16:9 film and then reframed to 9:16 lands in the
 * middle of the frame rather than the vertical safe area, and in `blur` mode
 * the background blow-up reproduces the caption as a ghost in the letterbox
 * band. It looks broken, and it is only visible once you watch the output --
 * which is why this check exists rather than a line in a README.
 */
export function captionOrderWarning(video, runDir, readJson) {
  const record = readJson(join(runDir, "captions.json"));
  if (!record?.out) return null;
  if (basename(record.out) !== basename(video)) return null;

  return (
    `${basename(video)} already has captions burned in. Reframing it will move them out of ` +
    `the vertical safe area, and blur mode will ghost them into the letterbox band.\n` +
    `  Correct order: kie variants on the UNcaptioned film, then kie caption each variant ` +
    `(each ratio needs its own safe area anyway).`
  );
}

export async function makeVariants({
  video,
  ratios,
  outDir,
  mode = "blur",
  padColor = "black",
  onLine,
  signal,
}) {
  requireFfmpeg();
  if (!MODES.includes(mode)) {
    throw usage(`Unknown reframe mode "${mode}". Modes: ${MODES.join(", ")}`);
  }

  const src = await probe(video, { signal });
  const stem = basename(video, extname(video));
  const made = [];

  for (const ratio of ratios) {
    const [w, h] = dimsFor(ratio);
    const out = join(outDir, `${stem}-${ratio.replace(":", "x")}.mp4`);

    const sameShape =
      src.width && src.height && Math.abs(src.width / src.height - w / h) < 0.01;

    const args = ["-i", video, "-vf", filterFor(mode, w, h, padColor)];
    if (src.hasAudio) args.push("-c:a", "copy");
    args.push(
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "19",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      out,
    );

    await ffmpegWriting(out, args, { onLine, signal });
    made.push({
      ratio,
      out,
      width: w,
      height: h,
      // A same-shape "conversion" is a re-encode for nothing; say so rather
      // than reporting it as a reframe that did work.
      mode: sameShape ? `${mode} (source already ${ratio} — rescale only)` : mode,
    });
  }

  return { source: { path: video, width: src.width, height: src.height }, variants: made };
}
