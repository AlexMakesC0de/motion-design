// Finishing a film with the free local tools: assemble, captions, variants and
// text cards. Each endpoint checks its input, confines every path it is given
// (confinePath against the allowed roots, as the MCP tools do), then starts a
// background task (tasks.mjs) that calls the same core function the CLI and
// the MCP server call. Outputs always land in the film's folder under core's
// next free default name; the studio never takes an output name or path.
import { assemble } from "../../../cli/lib/assemble.mjs";
import { burnCaptions } from "../../../cli/lib/caption.mjs";
import { makeVariants, MODES } from "../../../cli/lib/variants.mjs";
import { render, requireRemotion } from "../../../cli/lib/render.mjs";
import { requireFfmpeg, RATIOS } from "../../../cli/lib/ffmpeg.mjs";
import { usage } from "../../../cli/lib/errors.mjs";
import { templateList } from "../templates.mjs";

/** The core functions the endpoints run; tests replace the slow ones. */
export const CORE_TOOLS = { assemble, burnCaptions, makeVariants, render };

/** ffmpeg names offered for crossfades. A fixed list: the name goes into an ffmpeg filter. */
export const TRANSITIONS = ["fade", "fadeblack", "fadewhite", "dissolve", "wipeleft", "wiperight", "slideleft", "slideright", "circleopen", "circleclose"];
export const CAPTION_STYLES = ["social", "subtle"];

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
}

/** Refuse before starting a task when a tool it needs is missing: code 1 with core's install message. */
export function need(check, ...names) {
  const found = check();
  for (const name of names) {
    if (!found[name].ok) throw usage(found[name].install, { tool: name });
  }
}
