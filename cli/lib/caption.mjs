import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpeg, probe, requireFfmpeg } from "./ffmpeg.mjs";
import { render, requireRemotion } from "./render.mjs";
import { usage } from "./errors.mjs";

/**
 * Captions are burned in, not muxed as a soft track. Social platforms do not
 * render a soft subtitle track on autoplay, and autoplay-with-sound-off is the
 * condition every one of these films is actually watched under.
 *
 * They are drawn by the render engine and composited with ffmpeg's `overlay`,
 * NOT by ffmpeg's `subtitles` filter. That filter requires libass, which is
 * missing from common ffmpeg builds -- Homebrew's 8.1.1 has neither `subtitles`
 * nor `drawtext`, and the failure surfaces as a filter-syntax error that looks
 * like a bug in the caller. `overlay` is present in every build.
 *
 * The SRT is authored, never inferred. Even timing is worse than no captions --
 * it desynchronises against the first pause. The agent writes the cues from the
 * script it already has, against the real duration `kie probe` reports.
 */

const CUE = /^\s*(\d+)\s*$/;
const TIME =
  /^\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;

const toS = (h, m, s, ms) => +h * 3600 + +m * 60 + +s + +ms / 1000;

/** Parsed rather than trusted: a malformed SRT silently loses cues. */
export function parseSrt(text) {
  const blocks = text.replace(/\r/g, "").split(/\n\n+/).filter((b) => b.trim());
  const cues = [];
  const problems = [];

  for (const [i, block] of blocks.entries()) {
    const lines = block.split("\n");
    const timeLine = lines.find((l) => TIME.test(l));
    if (!timeLine) {
      problems.push(`Block ${i + 1} has no timecode line.`);
      continue;
    }
    const m = timeLine.match(TIME);
    const start = toS(m[1], m[2], m[3], m[4]);
    const end = toS(m[5], m[6], m[7], m[8]);
    const textLines = lines.slice(lines.indexOf(timeLine) + 1).filter((l) => !CUE.test(l));

    if (end <= start) problems.push(`Cue at ${timeLine.trim()} ends before it starts.`);
    if (!textLines.join("").trim()) problems.push(`Cue at ${timeLine.trim()} has no text.`);

    cues.push({ start, end, text: textLines.join("\n") });
  }

  for (let i = 1; i < cues.length; i++) {
    if (cues[i].start < cues[i - 1].end - 0.001) {
      problems.push(
        `Cue ${i + 1} starts at ${cues[i].start}s before cue ${i} ends at ${cues[i - 1].end}s.`,
      );
    }
  }

  return { cues, problems, lastEnd: cues.length ? cues[cues.length - 1].end : 0 };
}

const RATIO_FOR = (w, h) => {
  const r = w / h;
  const table = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5, "4:3": 4 / 3, "21:9": 21 / 9 };
  let best = "16:9";
  let diff = Infinity;
  for (const [name, value] of Object.entries(table)) {
    const d = Math.abs(value - r);
    if (d < diff) {
      diff = d;
      best = name;
    }
  }
  return best;
};

export async function burnCaptions({
  video,
  srt,
  out,
  style = "social",
  brand,
  safeArea,
  onLine,
}) {
  requireFfmpeg();
  requireRemotion();

  if (!["social", "subtle"].includes(style)) {
    throw usage(`Unknown caption style "${style}". Styles: social, subtle`);
  }

  const parsed = parseSrt(readFileSync(srt, "utf8"));
  if (!parsed.cues.length) throw usage(`${srt} contains no readable cues.`);

  const info = await probe(video);
  if (!info.durationS) throw usage(`Could not read a duration from ${video}.`);

  const warnings = [...parsed.problems];
  // Cues past the end are dropped rather than silently extending the film --
  // a caption nobody can see is a defect in the script, worth naming.
  const kept = parsed.cues.filter((c) => c.start < info.durationS);
  const dropped = parsed.cues.length - kept.length;
  if (dropped) {
    warnings.push(
      `${dropped} cue(s) start after the film ends (${info.durationS.toFixed(2)}s) and were dropped.`,
    );
  }
  const clamped = kept.map((c) => ({ ...c, end: Math.min(c.end, info.durationS) }));
  if (parsed.lastEnd > info.durationS + 0.25) {
    warnings.push(
      `Last cue ran to ${parsed.lastEnd.toFixed(2)}s; trimmed to the film's ${info.durationS.toFixed(2)}s.`,
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "kie-cap-"));
  const overlay = join(dir, "captions.mov");
  const propsFile = join(dir, "props.json");

  try {
    await writeFile(
      propsFile,
      JSON.stringify({ cues: clamped, style, ...(safeArea ? { safeArea } : {}) }, null, 2),
    );

    // Match the film exactly, or the overlay lands at the wrong scale.
    await render({
      template: "captions",
      propsPath: propsFile,
      out: overlay,
      ratio: RATIO_FOR(info.width, info.height),
      fps: info.fps ?? 30,
      durationS: info.durationS,
      brand,
      alpha: true,
      onLine,
    });

    await ffmpeg(
      [
        "-i", video,
        "-i", overlay,
        "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto[vout]",
        "-map", "[vout]",
        ...(info.hasAudio ? ["-map", "0:a", "-c:a", "copy"] : []),
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "19",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        out,
      ],
      { onLine },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  return {
    out,
    cues: clamped.length,
    cuesDropped: dropped,
    style,
    warnings,
    filmDurationS: info.durationS,
    renderedBy: "remotion alpha overlay + ffmpeg overlay (libass not required)",
  };
}
