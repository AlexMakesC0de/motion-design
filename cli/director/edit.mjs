// A film's edit: which takes play, in what order, trimmed where, at what
// speed, and the titles laid over them. Kept in runs/<film>/edit.json. With no
// edit saved, the film is every scene's starred take (or newest finished
// take), whole, in scene order. Export renders the edit to film-N.mp4.
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { readFilmJson, writeFilmJson } from "./files.mjs";
import { readScenes } from "./scenes.mjs";
import { versionFile } from "./scene-copy.mjs";
import { usage } from "../lib/errors.mjs";

const FILE = "edit.json";
export const SPEEDS = [0.25, 0.4, 0.5, 0.75, 1, 1.5, 2];
export const INTO = ["cut", "fade"];
export const TITLE_KINDS = ["logo", "text"];
export const PLACES = ["upper", "center", "lower"];
/** How long a fade between two clips lasts. */
export const FADE_S = 0.4;
const MAX_CLIPS = 60;
const MAX_TITLES = 20;
const MAX_TITLE_TEXT = 40;

const r3 = (n) => Math.round(n * 1000) / 1000;
const bad = (field, message) => Object.assign(usage(message), { field });

/** The takes a scene can play: finished versions with a file, oldest first. */
export const playable = (scene) => (scene?.versions ?? []).filter((v) => v.state === "succeeded" && v.file);

/** The take a clip plays: the one it names, else the scene's starred take, else its newest finished one. */
export function takeOf(scene, take) {
  const ok = playable(scene);
  return ok.find((v) => v.job === take) ?? ok.find((v) => v.job === scene?.chosen) ?? ok.at(-1) ?? null;
}

/** The edit a film starts with: each scene with a finished take, whole, in order. */
export function defaultEdit(scenes) {
  return {
    version: 1,
    clips: scenes.filter((s) => playable(s).length).map((s, i) => ({ id: `c${i + 1}`, scene: s.id, take: null, inS: 0, outS: null, speed: 1, into: "cut" })),
    titles: [],
    saved: false,
  };
}

export function readEdit(film, { scenes = readScenes(film).scenes } = {}) {
  const stored = readFilmJson(film, FILE, { ifInvalid: null });
  return stored ? { ...stored, saved: true } : defaultEdit(scenes);
}

const num = (v, field, { min = 0, max = Infinity, nullable = false } = {}) => {
  if (v == null && nullable) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw bad(field, `${field} must be a number from ${min}${max === Infinity ? "" : ` to ${max}`}.`);
  return r3(v);
};
const pick = (v, field, choices, fallback) => {
  const x = v ?? fallback;
  if (!choices.includes(x)) throw bad(field, `${field} must be one of ${choices.join(", ")}.`);
  return x;
};

/** Check an edit a caller sent against the film's scenes. Ids are given here, never taken from the caller. */
export function cleanEdit(input, scenes) {
  const clips = Array.isArray(input?.clips) ? input.clips : [];
  const titles = Array.isArray(input?.titles) ? input.titles : [];
  if (clips.length > MAX_CLIPS) throw bad("clips", `An edit holds up to ${MAX_CLIPS} clips.`);
  if (titles.length > MAX_TITLES) throw bad("titles", `An edit holds up to ${MAX_TITLES} titles.`);
  return {
    version: 1,
    clips: clips.map((c, i) => {
      const at = `clips[${i}]`;
      const scene = scenes.find((s) => s.id === c?.scene);
      if (!scene) throw bad(`${at}.scene`, `There is no scene ${c?.scene} in this film.`);
      const take = c.take ?? null;
      if (take != null && !playable(scene).some((v) => v.job === take)) throw bad(`${at}.take`, `Scene ${scene.id} has no finished take ${take}.`);
      const inS = num(c.inS ?? 0, `${at}.inS`, { max: 600 });
      const outS = num(c.outS, `${at}.outS`, { max: 600, nullable: true });
      if (outS != null && outS <= inS + 0.05) throw bad(`${at}.outS`, "A clip must end after it starts.");
      return { id: `c${i + 1}`, scene: scene.id, take, inS, outS, speed: pick(c.speed, `${at}.speed`, SPEEDS, 1), into: pick(c.into, `${at}.into`, INTO, "cut") };
    }),
    titles: titles.map((t, i) => {
      const at = `titles[${i}]`;
      const kind = pick(t?.kind, `${at}.kind`, TITLE_KINDS, "text");
      const text = String(t.text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
      if (!text) throw bad(`${at}.text`, "A title needs words.");
      if (text.length > MAX_TITLE_TEXT) throw bad(`${at}.text`, `A title is at most ${MAX_TITLE_TEXT} characters.`);
      const image = kind === "logo" ? String(t.image ?? "").trim() || null : null;
      if (image && !/^refs\/[\w.-]+\.(png|svg|jpe?g|webp)$/i.test(image)) throw bad(`${at}.image`, "A logo is a picture in the film's refs folder, such as refs/logo.png.");
      return {
        id: `t${i + 1}`,
        kind,
        text,
        image,
        atS: num(t.atS ?? 0, `${at}.atS`, { max: 600 }),
        durationS: num(t.durationS ?? 3, `${at}.durationS`, { min: 0.5, max: 20 }),
        place: pick(t.place, `${at}.place`, PLACES, "center"),
      };
    }),
  };
}

/**
 * The film's idea and scenes with each take's state and file filled in from
 * the job records: scenes.json keeps only the job id (a take copied from
 * Create also keeps its own file). Without a store, the scenes as stored.
 */
export function scenesWithTakes(film, store) {
  const { idea, scenes } = readScenes(film);
  if (!store) return { idea, scenes };
  const fill = (v) => {
    let job = null;
    try {
      job = store.get(v.job);
    } catch {
      // a take whose job record is gone keeps only what scenes.json says
    }
    const file = v.file && isAbsolute(v.file) && existsSync(v.file) ? v.file : versionFile(film, v, store);
    return { ...v, state: v.state ?? job?.state ?? (file ? "succeeded" : null), file };
  };
  return { idea, scenes: scenes.map((s) => ({ ...s, versions: s.versions.map(fill) })) };
}

export function saveEdit(film, input, { scenes = readScenes(film).scenes } = {}) {
  const edit = cleanEdit(input, scenes);
  writeFilmJson(film, FILE, edit);
  return { ...edit, saved: true };
}

/**
 * The edit with each clip's take found: its file, how long the take is
 * (sourceS, from `durationOf`), where the clip sits in the film (startS) and
 * how long it plays (lengthS, after trim and speed, less any fade into it).
 * A clip whose take is gone is kept with `missing`, so the page can say so.
 */
export async function resolveEdit(film, edit, { scenes = readScenes(film).scenes, durationOf }) {
  let at = 0;
  const clips = [];
  for (const [i, c] of edit.clips.entries()) {
    const scene = scenes.find((s) => s.id === c.scene);
    const take = takeOf(scene, c.take);
    const file = take?.file && existsSync(take.file) ? take.file : null;
    const sourceS = file ? await durationOf(file) : null;
    const outS = c.outS == null ? sourceS : sourceS == null ? c.outS : Math.min(c.outS, sourceS);
    const plays = outS == null ? 0 : Math.max(0, (outS - c.inS) / c.speed);
    const fade = i > 0 && c.into === "fade" ? Math.min(FADE_S, plays / 2) : 0;
    const startS = r3(Math.max(0, at - fade));
    clips.push({ ...c, sceneTitle: scene?.title ?? c.scene, takeJob: take?.job ?? null, kind: take?.kind ?? null, resolution: take?.resolution ?? null, file, sourceS: sourceS == null ? null : r3(sourceS), endS: outS == null ? null : r3(outS), startS, lengthS: r3(plays), missing: !file });
    at = startS + plays;
  }
  return { ...edit, clips, lengthS: r3(at) };
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/** atempo takes 0.5 to 2 per step, so slower or faster speeds chain steps. */
export function atempoChain(speed) {
  const steps = [];
  let s = speed;
  while (s < 0.5) (steps.push(0.5), (s /= 0.5));
  while (s > 2) (steps.push(2), (s /= 2));
  steps.push(r3(s));
  return steps.map((x) => `atempo=${x}`).join(",");
}

/** Where a title sits: its offset from the frame's centre, as a share of the height. */
const PLACE_Y = { upper: -0.2, center: 0, lower: 0.25 };

/**
 * The ffmpeg arguments that render a resolved edit: every clip trimmed,
 * scaled into `width`×`height`, sped up or slowed (slowed video gets motion
 * in-between frames), joined by cuts or fades, then each title (an
 * alpha-channel render at `titles[i].file`) laid over at its time.
 * `hasAudio[i]` says whether clip i has sound; silence stands in when not.
 */
export function exportArgs(resolved, { width, height, fps = 24, titleFiles = [], hasAudio = [], out }) {
  const clips = resolved.clips.filter((c) => !c.missing && c.lengthS > 0);
  if (!clips.length) throw usage("The edit has no clip that plays. Add a finished take first.");
  const args = [];
  const f = [];
  clips.forEach((c, i) => {
    args.push("-ss", String(c.inS), "-to", String(c.endS), "-i", c.file);
    const slow = c.speed < 1 ? `,minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:vsbmc=1` : "";
    f.push(`[${i}:v]setpts=(PTS-STARTPTS)/${c.speed},fps=${fps}${slow},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v${i}]`);
    if (hasAudio[resolved.clips.indexOf(c)] ?? true) f.push(`[${i}:a]asetpts=PTS-STARTPTS,${c.speed === 1 ? "anull" : atempoChain(c.speed)},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    else f.push(`anullsrc=r=48000:cl=stereo,atrim=0:${c.lengthS},aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
  });
  // Join one clip at a time: a cut concatenates, a fade overlaps by FADE_S.
  let v = "v0";
  let a = "a0";
  let length = clips[0].lengthS;
  for (let i = 1; i < clips.length; i++) {
    const c = clips[i];
    const fade = c.into === "fade" ? r3(Math.min(FADE_S, c.lengthS / 2, length / 2)) : 0;
    if (fade > 0) {
      f.push(`[${v}][v${i}]xfade=transition=fade:duration=${fade}:offset=${r3(length - fade)}[vj${i}]`);
      f.push(`[${a}][a${i}]acrossfade=d=${fade}[aj${i}]`);
    } else {
      f.push(`[${v}][${a}][v${i}][a${i}]concat=n=2:v=1:a=1[vj${i}][aj${i}]`);
    }
    v = `vj${i}`;
    a = `aj${i}`;
    length = r3(length + c.lengthS - fade);
  }
  resolved.titles.forEach((t, k) => {
    const file = titleFiles[k];
    if (!file) return;
    const idx = clips.length + k;
    args.push("-i", file);
    const y = Math.round(PLACE_Y[t.place] * height);
    f.push(`[${idx}:v]scale=${width}:${height},format=yuva420p,setpts=PTS-STARTPTS+${t.atS}/TB[t${k}]`);
    f.push(`[${v}][t${k}]overlay=0:${y}:format=auto:eof_action=pass[vt${k}]`);
    v = `vt${k}`;
  });
  args.push("-filter_complex", f.join(";"), "-map", `[${v}]`, "-map", `[${a}]`, "-t", String(length));
  args.push("-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out);
  return { args, lengthS: length };
}

/** The frame size of an export: the tallest clip's height at the film's ratio, never above 1080. */
export function exportSize(heights, ratio = "16:9") {
  const [w, h] = ratio.split(":").map(Number);
  const tall = Math.min(1080, Math.max(...heights.filter(Boolean), 480));
  return [even((tall * w) / h), even(tall)];
}

/** The props a title is rendered with: Shard's logo template on a clear background, held to the end. */
export function titleProps(t, filmDir) {
  return {
    wordmark: t.text,
    tagline: "",
    logo: t.kind === "logo" && t.image ? join(filmDir, t.image) : null,
    background: "none",
    markColor: "white",
    fadeOut: false,
    brand: { colors: { fg: "#FFFFFF" } },
  };
}

/**
 * Render the film's edit to runs/<film>/film-N.mp4. Titles are rendered first
 * (each an alpha-channel clip from the logo template), then one ffmpeg pass
 * cuts, joins and overlays. `tools` holds probe, render and ffmpeg so tests
 * can replace them. Returns { out, lengthS, width, height }.
 */
export async function exportEdit(film, { dir, ratio = "16:9", tools, outFor, tmpDir, onLine, signal, scenes = readScenes(film).scenes }) {
  const edit = readEdit(film, { scenes });
  const probes = new Map();
  const info = async (file) => {
    if (!probes.has(file)) probes.set(file, await tools.probe(file, { signal }));
    return probes.get(file);
  };
  const resolved = await resolveEdit(film, edit, { scenes, durationOf: async (file) => (await info(file)).durationS });
  const playing = resolved.clips.filter((c) => !c.missing && c.lengthS > 0);
  if (!playing.length) throw usage("The edit has no clip that plays. Star a finished take in Shots first.");
  const sizes = await Promise.all(playing.map((c) => info(c.file)));
  const [width, height] = exportSize(sizes.map((s) => s.height), ratio);
  const titleFiles = [];
  for (const [k, t] of resolved.titles.entries()) {
    onLine?.(`Drawing title ${k + 1}: ${t.text}`);
    const propsPath = join(tmpDir, `title-${k + 1}.json`);
    await writeFile(propsPath, JSON.stringify(titleProps(t, dir)));
    const r = await tools.render({ template: "logo-reveal", propsPath, out: join(tmpDir, `title-${k + 1}.mov`), ratio, durationS: t.durationS, alpha: true, signal, onLine });
    titleFiles.push(r.out);
  }
  const hasAudio = resolved.clips.map((c) => (c.missing ? false : probes.get(c.file)?.hasAudio ?? false));
  const out = outFor();
  const { args, lengthS } = exportArgs(resolved, { width, height, titleFiles, hasAudio, out });
  onLine?.(`Joining ${playing.length} clips${titleFiles.length ? ` and ${titleFiles.length} title${titleFiles.length === 1 ? "" : "s"}` : ""} into ${width}×${height}`);
  await tools.ffmpeg(args, { onLine, signal });
  return { out, lengthS, width, height };
}
