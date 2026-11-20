// Openjutsu: one character picture and one reference video in, one take out.
// Motion transfer makes the character perform the video's motion (Kling motion
// control); Swap puts the character into the video in place of its person
// (Wan 2.2 Animate Replace). Both bill the reference video's seconds, so the
// clip is probed when it is uploaded and every price is from that length.
//
// Uploads live in runs/jutsu/: clips/ for reference videos (each with a
// <file>.json of its probed length and size) and cast/ for pictures. The page
// names files by their name only; paths are built here, never taken from it.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JUTSU_RUN, runDir } from "../../../cli/lib/run.mjs";
import { ffmpegWriting, probe as ffprobe, requireFfmpeg } from "../../../cli/lib/ffmpeg.mjs";
import { mp4Meta } from "../../../cli/lib/mp4meta.mjs";
import { estimateUsd } from "../../../cli/lib/budget.mjs";
import { routesFor } from "../../../cli/lib/models.mjs";
import { checkLocalFile, MAX_BYTES } from "../../../cli/core/inputs.mjs";
import { freeName, safeStem } from "../../../cli/director/scene-make.mjs";
import { HttpError } from "../http.mjs";
import { context } from "../state.mjs";
import { dailyPosition } from "../../../cli/core/spend.mjs";
import { mediaUrl } from "../media.mjs";
import { createSubmitter } from "./generate.mjs";
import { label, saveBody } from "./library.mjs";
import { heightWords } from "../../../cli/core/assets.mjs";
import * as f from "./fields.mjs";

export { JUTSU_RUN };
/** The Motion Library's shelves; a clip is filed under one, or none. */
export const CLIP_CATEGORIES = ["Dance", "Action", "Sports", "Comedy", "Fashion", "Lifestyle"];
function categoryOf(value, field = "category") {
  if (value == null || value === "") return null;
  if (!CLIP_CATEGORIES.includes(value)) throw f.invalid(field, `File it under one of: ${CLIP_CATEGORIES.join(", ")}.`);
  return value;
}
const FOLDERS = { video: "clips", image: "cast" };

const jutsuModels = (catalog) => catalog.list.filter((m) => m.capability === "jutsu" && m.jutsu);

/**
 * What made swap-7 the take to keep (red-square, 2026-11-20): each new person
 * keeps the build of their own picture rather than the size of the person
 * replaced, takes nothing of that person's, and has lively eyes. Without it a
 * man swapped in for a small woman came out at her size, with a blank stare.
 */
export function swapHold(people) {
  const each = people > 1 ? "Each new person" : "The new person";
  return (
    `${each} keeps the same face, hair and clothes in every frame, and wears and carries nothing of the person they replace that is not in their picture: no sunglasses, hat, coat or bag of theirs. ` +
    `${each} keeps the full build of their picture, as tall and as broad, never smaller or slimmer, even when the person they replace is shorter or slighter: only that person's moves and place in the frame carry over, not their size. ` +
    `Their eyes are lively and focused, fully open and alert: they look at the camera${people > 1 ? " and at each other" : ""} with intent, blink naturally, their eyes follow their head turns, and the light of the scene puts a bright catchlight in each eye. ` +
    "Their expressions are engaged and match the energy of the performance, never a blank stare."
  );
}

/**
 * H3 swaps by instruction, with no mask: this is what it is told when the user
 * writes nothing. It names the roles of the two references, says what to take
 * from the picture, and lists what must stay, as kie's H3 guide advises.
 */
const SWAP_INTRO = "Video edit. The reference video is the source footage; the reference picture is the new character. ";
const SWAP_LINE = "Replace the main person in the video with the character from the picture: their face, hair, skin, build and clothes all come from the picture.";
const SWAP_KEEP =
  "Keep everything else exactly as in the video: the performance, pose, gestures and timing, the camera movement and framing, the cuts, the background, the lighting, " +
  "and every other person and object. Keep the original sound.";
export const H3_SWAP_PROMPT = `${SWAP_INTRO}${SWAP_LINE} ${swapHold(1)} ${SWAP_KEEP}`;

/** What an H3 swap can change, and what the extra words mean for each. */
export const H3_TARGETS = ["person", "outfit", "object", "background"];
const DETAIL_MAX = 500;
const KEEP_CAMERA = "the camera movement and framing, the cuts";

/**
 * The written edit H3 gets for one target: what the reference picture is (if
 * there is one), the one thing to change, and everything that must stay. H3
 * has no mask on kie, so the list of what stays is how "only what you pick" is
 * asked for; it is a request, not a guarantee.
 */
export function h3Instruction(target, detail, hasPicture, { sheet = false } = {}) {
  const d = (detail ?? "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  const pic = (what) => (hasPicture ? `; the reference picture shows ${what}` : "");
  switch (target) {
    case "outfit":
      return (
        `Video edit. The reference video is the source footage${pic("the new outfit")}. ` +
        `Change only the clothes of the main person, to ${d || "the outfit in the reference picture"}${d && hasPicture ? ", matching the reference picture" : ""}. ` +
        `Keep everything else exactly as in the video: the person's face, hair and body, their performance, pose, gestures and timing, ${KEEP_CAMERA}, ` +
        "the background, the lighting, every other person and object, and the original sound."
      );
    case "object":
      return (
        `Video edit. The reference video is the source footage${pic("the new object")}. ` +
        `Change only this: ${d || "replace the main object with the one in the reference picture"}${d && hasPicture ? ", looking like the reference picture" : ""}. ` +
        `It moves and is lit like what it replaces. Keep everything else exactly as in the video: the people and their performance, ${KEEP_CAMERA}, ` +
        "the background, the lighting, and the original sound."
      );
    case "background":
      return (
        `Video edit. The reference video is the source footage${pic("the new place")}. ` +
        `Change only the background and surroundings, to ${d || "the place in the reference picture"}${d && hasPicture ? ", matching the reference picture" : ""}. ` +
        "Keep the people exactly as they are: their faces, hair, clothes, performance, pose, gestures and timing; adjust the light on them only as much as the new place needs. " +
        `Keep ${KEEP_CAMERA} and the original sound.`
      );
    default: {
      const line = d ? SWAP_LINE.replace("the main person", d) : SWAP_LINE;
      return `${SWAP_INTRO}${line} ${sheet ? `${SHEET_NOTE} ` : ""}${swapHold(1)} ${SWAP_KEEP}`;
    }
  }
}

/**
 * A Library character sheet is three panels of one person (close-up, front with
 * the face hidden by a grey oval, back). Said out loud so H3 makes one person,
 * takes the face from the close-up and never paints the oval.
 */
export const SHEET_NOTE =
  "The reference picture is a character sheet of one single person in three panels: a close-up of the face on the left, the full body from the front in the middle, and from the back on the right. " +
  "Take the face from the close-up; the grey oval in the middle panel only hides the face there and must never appear. Make exactly one person, not three.";

/**
 * The edit for several characters at once, written the way swap-7's was: who
 * each picture replaces, the sheets explained, then the build, eyes and what
 * stays. `cast` is [{ who, sheet }] in the order H3 gets the pictures.
 */
export function castInstruction(cast) {
  const n = cast.length;
  const sheets = cast.map((c, i) => (c.sheet ? ORDINALS[i] : null)).filter(Boolean);
  const sheetNote = !sheets.length
    ? ""
    : `${sheets.length === n ? "Each reference picture is" : `The ${listWords(sheets)} reference picture${sheets.length > 1 ? "s are each" : " is"}`} ` +
      "a character sheet of one single person in three panels: a close-up of the face on the left, the full body from the front in the middle, and from the back on the right. " +
      "Take each face from its close-up; the grey oval in the middle panel only hides the face there and must never appear. Make one person from each sheet, not three. ";
  const lines = cast.map(
    (c, i) => `Replace ${clean(c.who) || `the ${ORDINALS[i]} person from the left`} with the character in the ${ORDINALS[i]} reference picture: their face, hair, skin, build and clothes all come from that picture.`,
  );
  return (
    `Video edit. The reference video is the source footage; there are ${n} reference pictures, one new character each. ${sheetNote}` +
    `${lines.join(" ")} ${swapHold(n)} ` +
    "Keep everything else exactly as in the video: every person's performance, poses, gestures and timing, the camera movement and framing, the cuts, the background, the lighting, every other person and object, and the original sound."
  );
}
const clean = (words) => (words ?? "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
const listWords = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"];
/** Opens the heights sentence; a prompt that already holds it is not given it twice. */
const HEIGHTS_LEAD = "Real heights:";

/**
 * The heights of the Library characters among the pictures, in the order H3
 * gets them. A sheet has nothing to measure against, so without this a swap
 * keeps the size of the person replaced: a tall man swapped in for a short
 * woman came out at her size (red-square, 2026-11-19).
 */
export function heightsNote(pictures) {
  const known = pictures.map((p, i) => (p?.heightCm ? { i, cm: p.heightCm } : null)).filter(Boolean);
  if (!known.length) return "";
  const who = (i) => (pictures.length === 1 ? "the person in the reference picture" : `the person in the ${ORDINALS[i] ?? `#${i + 1}`} reference picture`);
  const list = known.map(({ i, cm }) => `${who(i)} is ${heightWords(cm)} tall`).join("; ");
  return `${HEIGHTS_LEAD} ${list}. Draw each at that height, with a build to match, whatever the size of the person they replace; keep the difference in height between people true.`;
}
const withHeights = (prompt, pictures) => {
  const note = heightsNote(pictures);
  return note && !prompt.includes(HEIGHTS_LEAD) ? `${prompt}${prompt ? " " : ""}${note}` : prompt;
};

/** The longest prompt each family takes. */
const promptMax = (m) => (m.jutsu.prompt === "required" ? 7000 : 2500);
const takesPrompt = (m) => m.id.startsWith("kling") || Boolean(m.jutsu.prompt);
/** H3 makes a video of whole seconds, 4 to 15: as long as the clip, rounded. */
/**
 * The swap keeps the clip's shape: the nearest ratio H3 offers. "adaptive"
 * let H3 follow the wide character sheet and turn a 9:16 TikTok clip into a
 * 16:9 video with invented room at the sides (first real take, 2026-11-18).
 */
export function clipRatio(m, clip) {
  const route = m.routes?.[0];
  const ratios = (route?.input?.enums?.aspect_ratio ?? []).filter((r) => /^\d+:\d+$/.test(r));
  if (!clip?.width || !clip?.height || !ratios.length) return "adaptive";
  const want = Math.log(clip.width / clip.height);
  const value = (r) => {
    const [w, h] = r.split(":").map(Number);
    return Math.abs(Math.log(w / h) - want);
  };
  return ratios.reduce((best, r) => (value(r) < value(best) ? r : best));
}

export function outputSeconds(m, clipS) {
  const [lo, hi] = m.jutsu.outputS;
  return Math.min(hi, Math.max(lo, Math.round(clipS)));
}

function modelView(catalog, m) {
  const route = routesFor(catalog, m).find((r) => r.usable) ?? m.routes[0];
  const field = route.pricing?.resolutionField ?? "resolution";
  return {
    id: m.id,
    label: m.label ?? m.id,
    mode: m.jutsu.mode,
    tier: m.jutsu.tier,
    notes: m.notes ?? null,
    resolutions: route.input?.enums?.[field] ?? [],
    defaultResolution: route.input?.defaults?.[field] ?? null,
    usdPerSecond: route.pricing?.usdPerSecond ?? {},
    prompt: takesPrompt(m),
    promptMax: takesPrompt(m) ? promptMax(m) : null,
    defaultPrompt: m.jutsu.prompt === "required" ? H3_SWAP_PROMPT : null,
    // What a swap can change; only H3, which is told in words, can change more than the person.
    targets: m.jutsu.prompt === "required" ? H3_TARGETS : null,
    // H3 bills the clip's seconds on top of a video of its own length.
    billsInput: Boolean(m.jutsu.outputS),
    orientations: m.jutsu.orientations ?? null,
    videoS: m.jutsu.videoS,
    imageOrientationMaxS: m.jutsu.imageOrientationMaxS ?? null,
    maxVideoBytes: m.jutsu.maxVideoBytes,
    maxImageBytes: m.jutsu.maxImageBytes,
    usable: routesFor(catalog, m).some((r) => r.usable),
  };
}

/** A file name from the page, as a name inside one of our folders: no path parts, and it must exist. */
function fileIn(kind, name, field) {
  if (typeof name !== "string" || !name || name !== name.split(/[\\/]/).pop() || name.startsWith(".")) {
    throw f.invalid(field, `Pick the ${kind === "video" ? "reference video" : "character picture"} again.`);
  }
  const dir = join(runDir(JUTSU_RUN), FOLDERS[kind]);
  const path = join(dir, name);
  if (!existsSync(path)) throw f.invalid(field, `${name} is no longer in ${JUTSU_RUN}/${FOLDERS[kind]}. Upload it again.`);
  return { name, path, source: `${JUTSU_RUN}/${FOLDERS[kind]}/${name}`, bytes: statSync(path).size };
}

/**
 * The character picture: a name in cast/ (an upload), or "@asset#n", one
 * picture of a Library item. The models take a single picture, so a Library
 * item is never expanded to all its images the way Create Video does.
 */
function imageIn(name) {
  if (typeof name === "string" && name.startsWith("gen:")) {
    let job = null;
    try {
      job = context().store.get(name.slice(4));
    } catch {}
    const path = job?.state === "succeeded" ? (job.artifacts ?? []).find((a) => IMAGE_FILE.test(a) && existsSync(a)) : null;
    if (!path) throw f.invalid("image", "That generated picture is no longer there. Pick another.");
    return { name, path, source: path, bytes: statSync(path).size };
  }
  if (typeof name === "string" && name.startsWith("@")) {
    const m = name.match(/^@([a-z0-9][a-z0-9-]{0,80})#(\d{1,2})$/);
    if (!m) throw f.invalid("image", "Pick the character again.");
    let record;
    try {
      record = context().library.get(m[1]);
    } catch {
      throw f.invalid("image", `${m[1]} is not in the Library any more.`);
    }
    const im = record.images.find((x) => x.n === Number(m[2]));
    if (!im || !existsSync(im.path)) throw f.invalid("image", `${m[1]} has no picture #${m[2]}.`);
    return { name, path: im.path, source: im.path, bytes: statSync(im.path).size, sheet: im.role === "sheet", heightCm: record.kind === "character" ? record.heightCm ?? null : null };
  }
  return fileIn("image", name, "image");
}

const IMAGE_FILE = /\.(png|jpe?g|webp)$/i;
/** H3 bills pictures after the fifth; one swap stays within the five it includes. */
const MORE_PICTURES = 4;

/** Pictures made in the studio, newest first, each file once (a later take may have replaced an earlier one's file). */
function generationsView(limit = 60) {
  const seen = new Set();
  const out = [];
  for (const j of context().store.list().reverse()) {
    if (j.capability !== "image" || j.state !== "succeeded") continue;
    const path = (j.artifacts ?? []).find((a) => IMAGE_FILE.test(a));
    if (!path || seen.has(path) || !existsSync(path)) continue;
    seen.add(path);
    out.push({ ref: `gen:${j.id}`, media: mediaUrl(path), model: j.model, run: j.run, createdAt: j.createdAt, prompt: typeof j.input?.prompt === "string" ? j.input.prompt.slice(0, 140) : null });
    if (out.length >= limit) break;
  }
  return out;
}

/** Library pictures to cast from, characters first, each identical picture once. */
function libraryView() {
  const { library } = context();
  const order = { character: 0, product: 1, location: 2, style: 3 };
  const out = [];
  for (const a of library.list().sort((x, y) => (order[x.kind] ?? 9) - (order[y.kind] ?? 9) || x.name.localeCompare(y.name))) {
    if (a.kind === "style" || a.kind === "location") continue;
    let record;
    try {
      record = library.get(a.name);
    } catch {
      continue;
    }
    const seen = new Set();
    for (const im of record.images) {
      const key = im.sha256 ?? im.file;
      if (seen.has(key) || !existsSync(im.path)) continue;
      seen.add(key);
      out.push({ ref: `@${a.name}#${im.n}`, asset: a.name, kind: a.kind, n: im.n, role: im.role, media: mediaUrl(im.path), width: im.width ?? null, height: im.height ?? null, influencer: a.persona ? (a.persona.displayName ?? a.name) : null });
    }
  }
  return out;
}

const sidecar = (path) => `${path}.json`;
/** Seconds as priced: up to the next tenth, so an estimate never undercounts. */
const billedS = (s) => Math.ceil(s * 10 - 1e-9) / 10;

/** Length and size from the file's own boxes; ffprobe only when they say nothing. */
async function realProbe(path) {
  const own = mp4Meta(path);
  if (own.durationS != null) return own;
  return ffprobe(path);
}

/**
 * Cut [startS, startS + lengthS) out of a clip into a new MP4. Re-encoded, so
 * the cut lands on the exact frame (a stream copy would start at the nearest
 * keyframe and could add a second the provider then bills).
 */
async function realTrim(src, out, startS, lengthS) {
  requireFfmpeg();
  await ffmpegWriting(out, [
    "-ss", String(startS), "-i", src, "-t", String(lengthS),
    "-map", "0:v:0", "-map", "0:a:0?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out,
  ]);
}

/** ffmpeg's failure in words: a broken install is named, with the fix. */
function trimFailure(err) {
  const text = String(err?.message ?? err);
  const broken = /Library not loaded|dyld|not found on PATH|Could not run ffmpeg/i.test(text);
  return new HttpError(
    500,
    broken
      ? "Cutting needs ffmpeg, and it could not start on this Mac (a library it needs is missing). Run brew reinstall ffmpeg, then try again. Nothing was spent."
      : `ffmpeg could not cut this clip. Nothing was spent. ${text.split("\n").slice(-3).join(" ").slice(0, 300)}`,
  );
}

const tenth = (n) => Math.round(n * 10) / 10;
const secondsWord = (n) => String(tenth(n)).replace(".", "-");

function clipInfo(path) {
  let info = {};
  try {
    info = JSON.parse(readFileSync(sidecar(path), "utf8"));
  } catch {}
  if (info.durationS == null) {
    // Uploaded before the length could be read: read it now and keep it.
    try {
      const own = mp4Meta(path);
      if (own.durationS != null) {
        info = { ...info, ...own };
        writeFileSync(sidecar(path), `${JSON.stringify(info, null, 2)}\n`);
      }
    } catch {}
  }
  return info;
}

/**
 * Everything wrong with this pairing for this model, in the user's words. Empty
 * means the provider's documented limits are met; nothing here is a guess.
 */
export function problemsFor(m, { clip, image, orientation }) {
  const j = m.jutsu;
  const out = [];
  const mb = (b) => `${Math.round(b / 1e6)} MB`;
  const s = clip?.durationS;
  if (clip) {
    if (s == null) out.push("The video's length could not be read, so it cannot be priced. Upload it again as an MP4 or MOV.");
    else {
      const [lo, hi] = j.videoS;
      if (s < lo || s > hi) out.push(`The video is ${s.toFixed(1)}s; ${m.label} takes ${lo} to ${hi} seconds. Trim it first.`);
      if (orientation === "image" && j.imageOrientationMaxS && s > j.imageOrientationMaxS) {
        out.push(`Facing "as in the picture" takes videos up to ${j.imageOrientationMaxS}s; this one is ${s.toFixed(1)}s. Pick "as in the video", or trim it.`);
      }
    }
    if (clip.bytes > j.maxVideoBytes) out.push(`The video is ${mb(clip.bytes)}; ${m.label} takes up to ${mb(j.maxVideoBytes)}.`);
    if (j.minSidePx && clip.width && clip.height && Math.min(clip.width, clip.height) <= j.minSidePx) {
      out.push(`The video is ${clip.width}×${clip.height}; each side must be over ${j.minSidePx}px.`);
    }
    if (j.maxSidePx && clip.width && clip.height && Math.max(clip.width, clip.height) > j.maxSidePx) {
      out.push(`The video is ${clip.width}×${clip.height}; ${m.label} takes up to ${j.maxSidePx}px a side.`);
    }
    if (j.aspect && clip.width && clip.height) {
      const a = clip.width / clip.height;
      if (a < j.aspect[0] || a > j.aspect[1]) out.push(`The video's shape (${clip.width}×${clip.height}) is too tall or too wide for ${m.label}.`);
    }
  }
  if (image && image.bytes > j.maxImageBytes) out.push(`The picture is ${mb(image.bytes)}; ${m.label} takes up to ${mb(j.maxImageBytes)}.`);
  return out;
}

export function registerJutsu(router, { catalog, deps = {}, follower }) {
  const submit = createSubmitter({ catalog, deps, follower });
  const probe = deps.probe ?? realProbe;
  const trim = deps.trim ?? realTrim;

  function model(body) {
    const id = f.text(body, "model", { required: true });
    const m = jutsuModels(catalog).find((x) => x.id === id);
    if (!m) throw f.invalid("model", `Pick one of: ${jutsuModels(catalog).map((x) => x.id).join(", ")}.`);
    return m;
  }

  function resolutionFor(m, body) {
    const v = modelView(catalog, m);
    const r = f.text(body, "resolution") ?? v.defaultResolution;
    if (!v.resolutions.includes(r)) throw f.invalid("resolution", `${m.label} makes ${v.resolutions.join(", ")}.`);
    return r;
  }

  function orientationFor(m, body) {
    if (!m.jutsu.orientations) return null;
    const o = f.text(body, "orientation") ?? "video";
    if (!m.jutsu.orientations.includes(o)) throw f.invalid("orientation", "Facing is video or image.");
    return o;
  }

  /**
   * What an H3 swap changes, and its words. Only the person needs a picture;
   * an outfit, object or place may be a picture, words, or both, never neither.
   */
  function targetFor(m, body) {
    if (m.jutsu.prompt !== "required") return { target: "person", detail: "" };
    const target = f.text(body, "target") ?? "person";
    if (!H3_TARGETS.includes(target)) throw f.invalid("target", `What to change is one of: ${H3_TARGETS.join(", ")}.`);
    const detail = (f.text(body, "detail") ?? "").trim();
    if (detail.length > DETAIL_MAX) throw f.invalid("detail", `Keep it under ${DETAIL_MAX} characters.`);
    return { target, detail };
  }

  /** The clip and picture this request names, with the clip's probed length. The picture may be left out where the target allows. */
  function inputs(body, { target, detail }) {
    const clipFile = fileIn("video", body.video, "video");
    const clip = { ...clipFile, ...clipInfo(clipFile.path), bytes: clipFile.bytes };
    if (target !== "person" && !body.image) {
      if (!detail) throw f.invalid("detail", `Describe the new ${target === "background" ? "place" : target}, or add a picture of it.`);
      return { clip, image: null, more: [] };
    }
    const image = imageIn(body.image);
    return { clip, image, more: morePictures(body) };
  }

  /**
   * More character pictures for one H3 swap, to recast several people at once
   * (H3 takes up to 9 pictures; the prompt says which is whom). The page sends
   * one; the API takes `images`, a list of names like `image`.
   */
  function morePictures(body) {
    if (body.images == null) return [];
    if (!Array.isArray(body.images) || body.images.length > MORE_PICTURES) throw f.invalid("images", `Send up to ${MORE_PICTURES} more pictures as a list.`);
    return body.images.map((n) => imageIn(n));
  }

  /** Who each extra picture replaces, in words, one per picture; the first picture's is the person target's words. */
  function replacesFor(body, more) {
    const words = body.replaces ?? [];
    if (!Array.isArray(words) || words.length > more.length || words.some((w) => typeof w !== "string" || w.length > DETAIL_MAX)) {
      throw f.invalid("replaces", "Send who each extra picture replaces as a list of words, one per picture.");
    }
    return more.map((_, i) => words[i] ?? "");
  }

  /** The H3 edit for what was picked: several characters get swap-7's cast edit, one gets the target's. */
  function h3Edit(aim, image, more, body, hasPicture) {
    if (!more.length || aim.target !== "person") return h3Instruction(aim.target, aim.detail, hasPicture, { sheet: Boolean(image?.sheet) });
    const words = replacesFor(body, more);
    return castInstruction([{ who: aim.detail, sheet: Boolean(image?.sheet) }, ...more.map((p, i) => ({ who: words[i], sheet: Boolean(p.sheet) }))]);
  }

  /** With several characters and no prompt of the user's, H3 must be told who each one replaces. */
  const unnamed = (aim, body, more) => more.length > 0 && aim.target === "person" && !(f.text(body, "prompt") ?? "").trim() && [aim.detail, ...replacesFor(body, more)].some((w) => !clean(w));
  const UNNAMED = "With more than one character, say who each one replaces.";

  /** The price for a clip of `clipS` seconds: its length for motion control and Wan; H3's output plus the clip's whole seconds. */
  function price(m, resolution, clipS) {
    const route = routesFor(catalog, m).find((r) => r.usable) ?? m.routes[0];
    const field = route.pricing?.resolutionField ?? "resolution";
    const video = route.pricing?.videoInput;
    if (m.jutsu.outputS && video) {
      return estimateUsd(route, { durationS: outputSeconds(m, clipS), resolution, input: { [field]: resolution, [video.field]: ["clip"] }, inputS: clipS });
    }
    return estimateUsd(route, { durationS: billedS(clipS), resolution, input: { [field]: resolution } });
  }

  function clipsView() {
    const dir = join(runDir(JUTSU_RUN), FOLDERS.video);
    if (!existsSync(dir)) return [];
    // How many takes used each clip: the remix count, from the job records.
    const uses = new Map();
    for (const j of context().store.list()) {
      const name = j.jutsu?.video;
      if (j.run === JUTSU_RUN && name) uses.set(name, (uses.get(name) ?? 0) + 1);
    }
    return readdirSync(dir)
      .filter((n) => /\.(mp4|mov)$/i.test(n))
      .map((name) => {
        const path = join(dir, name);
        const info = clipInfo(path);
        return {
          name,
          media: mediaUrl(path),
          durationS: info.durationS ?? null,
          width: info.width ?? null,
          height: info.height ?? null,
          bytes: statSync(path).size,
          addedAt: info.addedAt ?? statSync(path).mtime.toISOString(),
          uses: uses.get(name) ?? 0,
          category: info.category ?? null,
        };
      })
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  function castView() {
    const dir = join(runDir(JUTSU_RUN), FOLDERS.image);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((n) => /\.(png|jpe?g|webp)$/i.test(n))
      .map((name) => ({ name, media: mediaUrl(join(dir, name)), addedAt: statSync(join(dir, name)).mtime.toISOString() }))
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  router.get("/api/jutsu", () => ({
    run: JUTSU_RUN,
    categories: CLIP_CATEGORIES,
    models: jutsuModels(catalog).map((m) => modelView(catalog, m)),
    clips: clipsView(),
    cast: castView(),
    library: libraryView(),
    generations: generationsView(),
  }));

  /** Upload a reference video (?kind=video) or a character picture (?kind=image). A video is probed for its length. */
  router.post(
    "/api/jutsu/upload",
    async ({ req, query }) => {
      const kind = query.get("kind") === "video" ? "video" : "image";
      const category = kind === "video" ? categoryOf(query.get("category")) : null;
      const name = label(query.get("name") ?? req.headers["x-file-name"]);
      const limit = MAX_BYTES[kind];
      const dir = join(runDir(JUTSU_RUN), FOLDERS[kind]);
      mkdirSync(dir, { recursive: true });
      const root = realpathSync(dir);
      const part = join(root, `upload-${process.pid}-${Date.now()}.part`);
      let size;
      try {
        size = await saveBody(req, part, limit);
        if (size > limit) throw new HttpError(413, `${name} is over ${Math.round(limit / 1e6)} MB; nothing was saved.`);
        if (size === 0) throw f.invalid("file", `${name} is empty.`);
      } catch (err) {
        rmSync(part, { force: true });
        throw err;
      }
      let info;
      try {
        info = checkLocalFile(part, { roots: [root], kinds: [kind] });
      } catch (err) {
        rmSync(part, { force: true });
        err.message = err.message.replaceAll(part, name);
        err.field = "file";
        throw err;
      }
      const file = freeName(root, safeStem(name) || kind, info.ext);
      const path = join(root, file);
      renameSync(part, path);
      if (kind === "image") return { kind, name: file, media: mediaUrl(path) };
      let probed = {};
      try {
        const p = await probe(path);
        probed = { durationS: p.durationS, width: p.width, height: p.height };
      } catch {
        // ffprobe missing or the file unreadable: kept, and the page says it cannot be priced.
      }
      writeFileSync(sidecar(path), `${JSON.stringify({ ...probed, ...(category ? { category } : {}), addedAt: new Date().toISOString() }, null, 2)}\n`);
      return { kind, name: file, media: mediaUrl(path), durationS: probed.durationS ?? null, width: probed.width ?? null, height: probed.height ?? null, bytes: size, category };
    },
    { raw: true },
  );

  /**
   * Free: cut part of a clip into a new clip next to it ("part to use"). H3
   * takes at most 15 seconds and every model bills the clip's seconds, so a
   * shorter part is both allowed and cheaper. The original is kept.
   */
  router.post("/api/jutsu/trim", async ({ body = {} }) => {
    const src = fileIn("video", body.video, "video");
    const total = clipInfo(src.path).durationS;
    if (total == null) throw f.invalid("video", "This clip's length could not be read, so it cannot be cut. Upload it again as an MP4 or MOV.");
    const startS = Number(body.startS);
    const lengthS = Number(body.lengthS);
    if (!Number.isFinite(startS) || startS < 0 || startS >= total) throw f.invalid("startS", `Start between 0 and ${tenth(total)}s.`);
    if (!Number.isFinite(lengthS) || lengthS < 1) throw f.invalid("lengthS", "Keep at least 1 second.");
    if (startS + lengthS > total + 0.05) throw f.invalid("lengthS", `The clip ends at ${tenth(total)}s; from ${tenth(startS)}s that leaves ${tenth(total - startS)}s.`);
    const dir = join(runDir(JUTSU_RUN), FOLDERS.video);
    const stem = safeStem(src.name.replace(/\.(mp4|mov)$/i, "")) || "clip";
    const file = freeName(dir, `${stem}-${secondsWord(startS)}s-${secondsWord(lengthS)}s`, ".mp4");
    const out = join(dir, file);
    try {
      await trim(src.path, out, tenth(startS), tenth(lengthS));
    } catch (err) {
      rmSync(out, { force: true });
      throw trimFailure(err);
    }
    let probed = {};
    try {
      const p = await probe(out);
      probed = { durationS: p.durationS, width: p.width, height: p.height };
    } catch {}
    writeFileSync(sidecar(out), `${JSON.stringify({ ...probed, trimmedFrom: src.name, startS: tenth(startS), addedAt: new Date().toISOString() }, null, 2)}\n`);
    return { name: file, media: mediaUrl(out), durationS: probed.durationS ?? null, width: probed.width ?? null, height: probed.height ?? null, bytes: statSync(out).size, trimmedFrom: src.name };
  });

  /** File a clip under a Motion Library category, or take it off the shelves (category null). */
  router.patch("/api/jutsu/files/video/:name", ({ params, body = {} }) => {
    const file = fileIn("video", params.name, "name");
    const category = categoryOf(body.category);
    const info = clipInfo(file.path);
    const { category: _old, ...rest } = info;
    writeFileSync(sidecar(file.path), `${JSON.stringify({ ...rest, ...(category ? { category } : {}) }, null, 2)}\n`);
    return { name: file.name, category };
  });

  /** Remove an uploaded clip or picture. Takes already made from it are kept. */
  router.delete("/api/jutsu/files/:kind/:name", ({ params }) => {
    const kind = params.kind === "video" ? "video" : params.kind === "image" ? "image" : null;
    if (!kind) throw new HttpError(404, "Files are video or image.");
    const file = fileIn(kind, params.name, "name");
    rmSync(file.path, { force: true });
    rmSync(sidecar(file.path), { force: true });
    return { removed: file.name };
  });

  /** Free: the price for this clip at this resolution on each model, and what would refuse it. */
  router.post("/api/jutsu/estimate", ({ body = {} }) => {
    const m = model(body);
    const resolution = resolutionFor(m, body);
    const orientation = orientationFor(m, body);
    const clipFile = body.video ? fileIn("video", body.video, "video") : null;
    const clip = clipFile ? { ...clipFile, ...clipInfo(clipFile.path), bytes: clipFile.bytes } : null;
    const image = body.image ? imageIn(body.image) : null;
    const more = m.jutsu.prompt === "required" ? morePictures(body) : [];
    const problems = problemsFor(m, { clip, image, orientation });
    const est = clip?.durationS ? price(m, resolution, clip.durationS) : null;
    const usd = est?.usd ?? null;
    const { store, limits } = context();
    const pos = dailyPosition(store, limits);
    const budgetUsd = catalog.defaultBudgetUsd?.jutsu ?? null;
    const perJobUsd = limits?.perJobUsd ?? null;
    // What H3 would be told for what the user picked, shown and editable on the page.
    const aim = targetFor(m, body);
    const instruction = m.jutsu.prompt === "required" ? withHeights(h3Edit(aim, image, more, body, Boolean(body.image)), [image, ...more]) : null;
    if (unnamed(aim, body, more)) problems.push(UNNAMED);
    return {
      usd,
      instruction,
      basis: est?.basis ?? null,
      durationS: clip?.durationS ?? null,
      problems,
      usable: modelView(catalog, m).usable,
      budgetUsd,
      perJobUsd,
      availableTodayUsd: pos.availableUsd,
      withinBudget: usd != null && (budgetUsd == null || usd <= budgetUsd),
      withinPerJob: usd != null && (perJobUsd == null || usd <= perJobUsd),
      withinDailyCap: usd != null && usd <= pos.availableUsd,
    };
  });

  /** Spends: one job through core, under the per-job limit and the daily cap. */
  router.post("/api/jutsu/generate", async ({ body = {} }) => {
    const m = model(body);
    const resolution = resolutionFor(m, body);
    const orientation = orientationFor(m, body);
    const aim = targetFor(m, body);
    const { clip, image, more } = inputs(body, aim);
    const problems = problemsFor(m, { clip, image, orientation });
    if (more.length && m.jutsu.prompt !== "required") problems.push(`${m.label} takes one picture; only MiniMax H3 takes more.`);
    if (unnamed(aim, body, more)) problems.push(UNNAMED);
    for (const p of more) problems.push(...problemsFor(m, { image: p }));
    if (problems.length) throw f.invalid("video", `Refused before submitting, nothing was spent. ${problems.join(" ")}`);
    const kling = m.id.startsWith("kling");
    const h3 = m.jutsu.prompt === "required";
    const typed = takesPrompt(m) ? (f.text(body, "prompt") ?? "").trim() : "";
    // A prompt the user wrote is sent as written; otherwise H3 gets the edit for what they picked.
    // Library characters' heights are said either way, once.
    const prompt = h3 ? withHeights(typed || h3Edit(aim, image, more, body, Boolean(image)), [image, ...more]) : typed;
    if (prompt.length > promptMax(m)) throw f.invalid("prompt", `The prompt is over ${promptMax(m).toLocaleString("en")} characters.`);
    const durationS = h3 ? outputSeconds(m, clip.durationS) : billedS(clip.durationS);
    const values = h3
      ? { prompt, duration: durationS, resolution, aspect_ratio: clipRatio(m, clip), _inputS: clip.durationS }
      : kling
        ? { ...(prompt ? { prompt } : {}), mode: resolution, character_orientation: orientation, _durationS: durationS }
        : { resolution, _durationS: durationS };
    const a = {
      run: JUTSU_RUN,
      prompt,
      refs: [...[image, ...more].filter(Boolean).map((p) => ({ source: p.source, role: "identity" })), { source: clip.source, role: "motion" }],
      params: {},
      budget_usd: f.amount(body, "budget_usd"),
      provider: null,
    };
    const jutsu = { mode: m.jutsu.mode, video: clip.name, image: image?.name ?? null, ...(more.length ? { images: more.map((p) => p.name), ...(h3 ? { replaces: replacesFor(body, more) } : {}) } : {}), ...(h3 ? { target: aim.target } : {}) };
    return submit("jutsu", m, a, values, {
      promptFile: "jutsu-prompt.txt",
      inputsFile: "jutsu-inputs.json",
      artifactBase: m.jutsu.mode === "swap" ? "swap" : "motion",
      useI2v: () => false,
      extra: { jutsu, durationS, resolution, orientation },
      jobRecord: { jutsu, durationS },
    });
  });
}
