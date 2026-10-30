// Finishing a film with the free local tools: assemble, captions, variants and
// text cards. Each endpoint checks its input, confines every path it is given
// (confinePath against the allowed roots, as the MCP tools do), then starts a
// background task (tasks.mjs) that calls the same core function the CLI and
// the MCP server call. Outputs always land in the film's folder under core's
// next free default name; the studio never takes an output name or path.
import { existsSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { assemble } from "../../../cli/lib/assemble.mjs";
import { burnCaptions } from "../../../cli/lib/caption.mjs";
import { makeVariants, MODES } from "../../../cli/lib/variants.mjs";
import { render, requireRemotion } from "../../../cli/lib/render.mjs";
import { requireFfmpeg, RATIOS, dimsFor } from "../../../cli/lib/ffmpeg.mjs";
import { RUNS_DIR, runDir, outPath, writeRecord } from "../../../cli/lib/run.mjs";
import { unknown, usage } from "../../../cli/lib/errors.mjs";
import { checkLocalFile } from "../../../cli/core/inputs.mjs";
import { templateList } from "../templates.mjs";
import { context } from "../state.mjs";
import { mediaUrl } from "../media.mjs";
import * as f from "./fields.mjs";

/** The core functions the endpoints run; tests replace the slow ones. */
export const CORE_TOOLS = { assemble, burnCaptions, makeVariants, render };

/** ffmpeg names offered for crossfades. A fixed list: the name goes into an ffmpeg filter. */
export const TRANSITIONS = ["fade", "fadeblack", "fadewhite", "dissolve", "wipeleft", "wiperight", "slideleft", "slideright", "circleopen", "circleclose"];
export const CAPTION_STYLES = ["social", "subtle"];
const SHOT_AUDIO = ["auto", "keep", "drop"];
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
}

/** Refuse before starting a task when a tool it needs is missing: code 1 with core's install message. */
export function need(check, ...names) {
  const found = check();
  for (const name of names) {
    if (!found[name].ok) throw usage(found[name].install, { tool: name });
  }
}
