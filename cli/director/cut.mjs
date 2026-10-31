import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { ffmpeg, ffmpegWriting, probe, dimsFor, requireFfmpeg } from "../lib/ffmpeg.mjs";
import { assemble } from "../lib/assemble.mjs";
import { nextArtifact, runDir } from "../lib/run.mjs";
import { usage } from "../lib/errors.mjs";
import { readBrief } from "./brief.mjs";
import { readPlan } from "./plan.mjs";
import { writeFilmJson } from "./files.mjs";
import { shotMedia } from "./media.mjs";
import { readReviews } from "./review.mjs";

/** Seconds dropped from the start of each take: the trim margin filmed on purpose. */
export const LEAD_S = 0.5;
const JOINS = { dissolve: { transition: "fade", durationS: 0.5 }, whip: { transition: "slideleft", durationS: 0.25 } };
const FADE_OUT_S = 0.8;
const FPS = 30;
const r3 = (n) => Math.round(n * 1000) / 1000;

/**
 * The edit, decided before any ffmpeg runs: for each shot the take it uses,
 * where to start (the review's best window for that take, else past the
 * padding) and how long (the planned length, or the whole take when it came
 * back short); how each shot joins the next (dissolve and whip cross-fade,
 * every other cut is a hard cut in the edit); and a fade to black when the
 * last shot's cut is fade-out. `lengths` maps take files to their seconds.
 */
export function cutPlan(plan, media, reviews, lengths) {
  const shots = plan.shots;
  const missing = shots.filter((s) => !media[s.id]?.take).map((s) => s.id);
  if (missing.length) throw usage(`${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} no take yet. Film ${missing.length === 1 ? "it" : "them"} first; the cut uses one take per shot.`);
  const notes = [];
  const segments = shots.map((s) => {
    const file = media[s.id].take;
    const takeS = lengths[file];
    const review = reviews[s.id]?.take === file ? reviews[s.id] : null;
    let startS = review?.bestWindow?.startS ?? LEAD_S;
    let durationS = s.durationS;
    if (takeS != null && takeS < durationS) {
      notes.push(`${s.id}'s take is ${takeS}s; the shot is planned at ${s.durationS}s, so all of it is used.`);
      startS = 0;
      durationS = takeS;
    } else if (takeS != null) {
      startS = Math.max(0, Math.min(startS, r3(takeS - durationS)));
    }
    if (s.copy?.length) notes.push(`${s.id} has on-screen copy (${s.copy.join(" / ")}); render it with kie render and add it in the finish, the cut does not draw text.`);
    return { shot: s.id, file, startS: r3(startS), durationS: r3(durationS), keepAudio: s.job === "lip-sync" };
  });
  const joins = shots.slice(0, -1).map((s) => (JOINS[s.cut] ? { after: s.id, type: "xfade", ...JOINS[s.cut] } : { after: s.id, type: "cut" }));
  const fadeOutS = shots.at(-1)?.cut === "fade-out" ? FADE_OUT_S : 0;
  const totalS = r3(segments.reduce((t, s) => t + s.durationS, 0) - joins.reduce((t, j) => t + (j.durationS ?? 0), 0));
  return { segments, joins, fadeOutS, totalS, notes };
}

/** One input normalised to the film: its window, the film's size and frame rate, and a stereo track (silence when it has none to keep). */
async function normalise(src, seg, out, { width, height, hasAudio, signal, onLine }) {
  const sound = seg.keepAudio && hasAudio;
  const args = ["-ss", String(seg.startS), "-t", String(seg.durationS), "-i", src];
  if (!sound) args.push("-f", "lavfi", "-t", String(seg.durationS), "-i", "anullsrc=r=48000:cl=stereo");
  args.push(
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${FPS}`,
    "-af", "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo",
    "-map", "0:v:0", "-map", sound ? "0:a:0" : "1:a:0",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-t", String(seg.durationS), out,
  );
  await ffmpeg(args, { signal, onLine });
}

/** The join graph over normalised inputs 0..n-1: cross-fades and hard cuts in order, then the fade to black. */
function joinGraph(durations, joins, fadeOutS) {
  const parts = [];
  let v = "[0:v]";
  let a = "[0:a]";
  let len = durations[0];
  for (let k = 1; k < durations.length; k++) {
    const j = joins[k - 1] ?? { type: "cut" };
    if (j.type === "xfade") {
      parts.push(`${v}[${k}:v]xfade=transition=${j.transition}:duration=${j.durationS}:offset=${r3(len - j.durationS)}[v${k}]`);
      parts.push(`${a}[${k}:a]acrossfade=d=${j.durationS}[a${k}]`);
      len += durations[k] - j.durationS;
    } else {
      parts.push(`${v}${a}[${k}:v][${k}:a]concat=n=2:v=1:a=1[v${k}][a${k}]`);
      len += durations[k];
    }
    v = `[v${k}]`;
    a = `[a${k}]`;
  }
  const fadeAt = r3(len - fadeOutS);
  parts.push(fadeOutS ? `${v}fade=t=out:st=${fadeAt}:d=${fadeOutS}[vout]` : `${v}null[vout]`);
  parts.push(fadeOutS ? `${a}afade=t=out:st=${fadeAt}:d=${fadeOutS}[aout]` : `${a}anull[aout]`);
  return { filter: parts.join(";"), totalS: r3(len) };
}

/**
 * The editor pass: trim every shot's take, join them with the plan's cuts,
 * add an end card (a rendered file, hard cut after the last shot) and the
 * music and voice-over (mixed and levelled by assemble), and deliver
 * runs/<film>/film.mp4 (film-2.mp4 next time) with cut.json recording it all.
 */
export async function cutFilm(film, { store, music = null, vo = null, endCard = null, out = null, signal, onLine } = {}) {
  requireFfmpeg();
  const plan = readPlan(film);
  if (!plan) throw usage(`runs/${film} has no plan yet.`);
  const brief = readBrief(film);
  const dir = runDir(film, { create: false });
  const media = shotMedia(store, film, plan);
  const lengths = {};
  const sound = {};
  for (const s of plan.shots) {
    const file = media[s.id]?.take;
    if (!file || file in lengths) continue;
    const info = await probe(join(dir, file), { signal });
    lengths[file] = info.durationS;
    sound[file] = info.hasAudio;
  }
  const cp = cutPlan(plan, media, readReviews(film), lengths);
  const [width, height] = dimsFor(brief?.aspectRatio ?? "16:9");
  const target = out ?? nextArtifact(dir, "film", ".mp4").path;

  const tmp = await mkdtemp(join(tmpdir(), "kie-cut-"));
  try {
    const inputs = [];
    const durations = [];
    for (const [k, seg] of cp.segments.entries()) {
      const p = join(tmp, `${k}.mp4`);
      await normalise(join(dir, seg.file), seg, p, { width, height, hasAudio: sound[seg.file], signal, onLine });
      inputs.push(p);
      durations.push(seg.durationS);
    }
    const joins = [...cp.joins];
    let fadeOutS = cp.fadeOutS;
    if (endCard) {
      const info = await probe(endCard, { signal });
      const p = join(tmp, "end.mp4");
      await normalise(endCard, { startS: 0, durationS: r3(info.durationS), keepAudio: true }, p, { width, height, hasAudio: info.hasAudio, signal, onLine });
      inputs.push(p);
      durations.push(r3(info.durationS));
      joins.push({ after: "end-card", type: "cut" });
      if (fadeOutS) cp.notes.push("The end card closes the film, so the last shot cuts to it instead of fading to black.");
      fadeOutS = 0;
    }
    const graph = joinGraph(durations, joins, fadeOutS);
    const joined = music || vo ? join(tmp, "joined.mp4") : target;
    const args = [];
    for (const p of inputs) args.push("-i", p);
    args.push(
      "-filter_complex", graph.filter, "-map", "[vout]", "-map", "[aout]",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", String(FPS),
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", String(graph.totalS), joined,
    );
    await ffmpegWriting(joined, args, { signal, onLine });
    if (joined !== target) {
      await assemble({ shots: [joined], music, vo, out: target, ratio: brief?.aspectRatio ?? "16:9", shotAudio: "keep", signal, onLine });
    }
    const record = {
      out: basename(target),
      totalS: graph.totalS,
      segments: cp.segments,
      joins,
      fadeOutS,
      endCard: endCard ? basename(endCard) : null,
      music: music ? basename(music) : null,
      vo: vo ? basename(vo) : null,
      notes: cp.notes,
      planVersion: plan.version ?? null,
    };
    writeFilmJson(film, "cut.json", record);
    return { ...record, out: target };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
