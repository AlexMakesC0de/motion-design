// Finishing a film with the free local tools: assemble, captions, variants and
// text cards. Each endpoint checks its input, confines every path it is given
// (confinePath against the allowed roots, as the MCP tools do), then starts a
// background task (tasks.mjs) that calls the same core function the CLI and
// the MCP server call. Outputs always land in the film's folder under core's
// next free default name; the studio never takes an output name or path.
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { assemble } from "../../../cli/lib/assemble.mjs";
import { burnCaptions } from "../../../cli/lib/caption.mjs";
import { makeVariants, MODES, captionOrderWarning } from "../../../cli/lib/variants.mjs";
import { render, requireRemotion, TEMPLATES } from "../../../cli/lib/render.mjs";
import { requireFfmpeg, RATIOS, dimsFor } from "../../../cli/lib/ffmpeg.mjs";
import { RUNS_DIR, runDir, outPath, writeRecord } from "../../../cli/lib/run.mjs";
import { unknown, usage } from "../../../cli/lib/errors.mjs";
import { checkLocalFile, confinePath, confineProps } from "../../../cli/core/inputs.mjs";
import { templateList, TEMPLATE_FIELDS } from "../templates.mjs";
import { context } from "../state.mjs";
import { mediaUrl } from "../media.mjs";
import * as f from "./fields.mjs";

/** The core functions the endpoints run; tests replace the slow ones. */
export const CORE_TOOLS = { assemble, burnCaptions, makeVariants, render };

/** ffmpeg names offered for crossfades. A fixed list: the name goes into an ffmpeg filter. */
export const TRANSITIONS = ["fade", "fadeblack", "fadewhite", "dissolve", "wipeleft", "wiperight", "slideleft", "slideright", "circleopen", "circleclose"];
export const CAPTION_STYLES = ["social", "subtle"];
const SHOT_AUDIO = ["auto", "keep", "drop"];
const MAX_CARD_S = 60;
// Size limits are for files sent to a provider; finishing reads local files only.
const ANY_SIZE = { image: Infinity, video: Infinity, audio: Infinity };

/** The film's folder. Code 1 for a bad slug, code 3 for a film that does not exist. */
export function filmDir(slug) {
  const dir = runDir(slug, { create: false });
  if (!existsSync(dir)) throw unknown(`No film "${slug}". Its folder appears with its first take.`);
  return dir;
}

/**
 * A file the client named, checked by content: a bare name is in the film's
 * folder, a path with a slash is inside runs/, an absolute path must sit in
 * an allowed root. The MCP tools' rule. Refused as code 3 on `field`.
 */
export function mediaFile(dir, field, name, kinds) {
  const named = isAbsolute(name) ? name : name.includes("/") ? join(RUNS_DIR, name) : join(dir, name);
  try {
    return checkLocalFile(named, { roots: context().roots, kinds, maxBytes: ANY_SIZE }).path;
  } catch (err) {
    throw f.invalid(field, err.message);
  }
}

/** An SRT the client named: the same path rule, confined, and only a .srt file (its text is burned into a video). */
function srtFile(dir, name) {
  if (!/\.srt$/i.test(name)) throw f.invalid("srt", `${name} is not an .srt file. Save the captions first; they are kept as captions.srt in the film.`);
  const named = isAbsolute(name) ? name : name.includes("/") ? join(RUNS_DIR, name) : join(dir, name);
  try {
    return confinePath(named, context().roots);
  } catch (err) {
    throw f.invalid("srt", err.message);
  }
}

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

const output = (path) => ({ name: basename(path), url: mediaUrl(path) });

function oneOf(body, field, choices, fallback) {
  const v = f.text(body, field) ?? fallback;
  if (!choices.includes(v)) throw f.invalid(field, `${field} must be one of ${choices.join(", ")}.`);
  return v;
}

/** Whether ffmpeg (with ffprobe) and the render engine are installed. When not, `install` is core's own message saying how. */
export function toolCheck() {
  const one = (requireTool) => {
    try {
      requireTool();
      return { ok: true, install: null };
    } catch (err) {
      return { ok: false, install: err.message };
    }
  };
  return { ffmpeg: one(requireFfmpeg), render: one(requireRemotion) };
}

export function registerFinish(router, { tasks, tools = CORE_TOOLS, check = toolCheck } = {}) {
  router.get("/api/finish", () => ({
    tools: check(),
    templates: templateList(),
    ratios: Object.keys(RATIOS),
    transitions: TRANSITIONS,
    captionStyles: CAPTION_STYLES,
    variantModes: MODES,
  }));

  /** Assemble: the chosen shots in order, optional music and voice-over, crossfades; loudness-normalised by core. */
  router.post("/api/films/:slug/assemble", ({ params, body = {} }) => {
    const dir = filmDir(params.slug);
    const names = f.strings(body, "shots");
    if (!names.length) throw f.invalid("shots", "Choose at least one shot.");
    const shots = names.map((s) => mediaFile(dir, "shots", s, ["video"]));
    const music = f.text(body, "music");
    const vo = f.text(body, "vo");
    const a = {
      shots,
      music: music ? mediaFile(dir, "music", music, ["audio"]) : null,
      vo: vo ? mediaFile(dir, "vo", vo, ["audio"]) : null,
      transition: oneOf(body, "transition", TRANSITIONS, "fade"),
      transitionS: f.amount(body, "transition_s") ?? 0,
      ratio: oneOf(body, "aspect_ratio", Object.keys(RATIOS), "16:9"),
      shotAudio: oneOf(body, "shot_audio", SHOT_AUDIO, "auto"),
    };
    need(check, "ffmpeg");
    const [width, height] = dimsFor(a.ratio);
    const task = tasks.start(params.slug, "assemble", "Assemble", async ({ progress }) => {
      const result = await tools.assemble({ ...a, width, height, out: outPath(dir, undefined, "film", ".mp4"), onLine: progress });
      await writeRecord(dir, "assembly.json", result);
      return { outputs: [output(result.out)] };
    });
    return { task };
  });

  /** Captions: an SRT burned into a video (core draws them with the render engine and overlays them with ffmpeg). */
  router.post("/api/films/:slug/caption", ({ params, body = {} }) => {
    const dir = filmDir(params.slug);
    const video = mediaFile(dir, "video", f.text(body, "video", { required: true }), ["video"]);
    const srt = srtFile(dir, f.text(body, "srt", { required: true }));
    const style = oneOf(body, "style", CAPTION_STYLES, "social");
    need(check, "ffmpeg", "render");
    const task = tasks.start(params.slug, "caption", "Captions", async ({ progress }) => {
      const result = await tools.burnCaptions({ video, srt, style, out: outPath(dir, undefined, "captioned", ".mp4"), onLine: progress });
      await writeRecord(dir, "captions.json", result);
      return { outputs: [output(result.out)], warnings: result.warnings ?? [] };
    });
    return { task };
  });

  /**
   * Variants: a video reframed to other ratios, written beside it in the film
   * as <name>-9x16.mp4 and so on. Core names them, so a second run for the
   * same video and ratio replaces the first, as `kie variants` does.
   */
  router.post("/api/films/:slug/variants", ({ params, body = {} }) => {
    const dir = filmDir(params.slug);
    const video = mediaFile(dir, "video", f.text(body, "video", { required: true }), ["video"]);
    const ratios = [...new Set(f.strings(body, "ratios"))];
    if (!ratios.length) throw f.invalid("ratios", "Choose at least one ratio, such as 9:16 or 1:1.");
    const unknownRatio = ratios.find((r) => !RATIOS[r]);
    if (unknownRatio) throw f.invalid("ratios", `Unknown ratio "${unknownRatio}". Known: ${Object.keys(RATIOS).join(", ")}.`);
    const mode = oneOf(body, "mode", MODES, "blur");
    need(check, "ffmpeg");
    const warning = captionOrderWarning(video, dir, readJson);
    const task = tasks.start(params.slug, "variants", "Variants", async ({ progress }) => {
      const result = await tools.makeVariants({ video, ratios, mode, outDir: dir, onLine: progress });
      await writeRecord(dir, "variants.json", result);
      return { outputs: result.variants.map((v) => output(v.out)), warnings: warning ? [warning] : [] };
    });
    return { task };
  });

  /**
   * Text cards: exact titles, logos or numbers rendered from a template by the
   * render engine. Image paths in the props are confined by core's
   * confineProps, as for the MCP render tool, and the props are kept in the
   * film as props-<template>.json beside core's render record.
   */
  router.post("/api/films/:slug/card", ({ params, body = {} }) => {
    const dir = filmDir(params.slug);
    const template = f.text(body, "template", { required: true });
    if (!TEMPLATES[template]) throw f.invalid("template", `Unknown template "${template}". Templates: ${Object.keys(TEMPLATES).join(", ")}.`);
    const props = f.params({ params: body.props }); // a plain object, or {} when absent
    for (const field of TEMPLATE_FIELDS[template].fields) {
      const v = props[field.name];
      const empty = v == null || v === "" || (Array.isArray(v) && !v.length);
      if (field.required && empty) throw f.invalid(`props.${field.name}`, `${field.label} is required for ${template}.`);
    }
    let confined;
    try {
      confined = confineProps(props, context().roots);
    } catch (err) {
      throw f.invalid("props", err.message);
    }
    const ratio = oneOf(body, "aspect_ratio", Object.keys(RATIOS), "16:9");
    const durationS = f.amount(body, "duration_s");
    if (durationS > MAX_CARD_S) throw f.invalid("duration_s", `A text card runs ${MAX_CARD_S} seconds at most.`);
    need(check, "render");
    const task = tasks.start(params.slug, "card", `Text card (${template})`, async ({ progress }) => {
      const propsPath = join(dir, `props-${template}.json`);
      await writeFile(propsPath, JSON.stringify(confined, null, 2) + "\n");
      const result = await tools.render({ template, propsPath, ratio, durationS, out: outPath(dir, undefined, template, ".mp4"), onLine: progress });
      await writeRecord(dir, `render-${template}.json`, result);
      return { outputs: [output(result.out)] };
    });
    return { task };
  });
}

/** Refuse before starting a task when a tool it needs is missing: code 1 with core's install message. */
export function need(check, ...names) {
  const found = check();
  for (const name of names) {
    if (!found[name].ok) throw usage(found[name].install, { tool: name });
  }
}
