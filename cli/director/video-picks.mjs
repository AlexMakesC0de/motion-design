// Picks on a plain video generation (Create Video, `kie video --pick`, MCP
// generate_video): the same menu ids as a scene's, worded after the typed
// prompt in the shape the chosen model reads best.
import { unknown } from "../lib/errors.mjs";
import { loadMenu, entry } from "./menu.mjs";
import { STAGE_PICKS, SCENE_PICKS, stageWords, framingWords, pickSentence, cameraWords } from "./picks.mjs";

/** Every key a video takes → its menu group. */
export const VIDEO_PICKS = { ...STAGE_PICKS, ...SCENE_PICKS };

const bad = (field, message) => unknown(message, { field });

/**
 * A picks object, checked against the menu. `groups` maps key → menu group;
 * `where` starts the message ("Stage 2", "The scene", "The video"). Empty
 * values are dropped. Returns null when nothing is picked. The one copy: the
 * scene validation imports it from here.
 */
export function cleanPicks(input, groups, where, menu = loadMenu()) {
  if (input == null) return null;
  if (typeof input !== "object" || Array.isArray(input)) throw bad("picks", `${where}'s picks must be an object.`);
  const out = {};
  for (const [key, id] of Object.entries(input)) {
    if (id == null || id === "") continue;
    if (!groups[key]) throw bad("picks", `${where} has no "${key}" pick. It takes: ${Object.keys(groups).join(", ")}.`);
    entry(menu, groups[key], id); // refuses an unknown id, naming the menu's own
    out[key] = id;
  }
  if (out.speed && (!out.move || out.move === "static")) throw bad("picks", `${where}: a speed needs a move other than static.`);
  return Object.keys(out).length ? out : null;
}

/** Checked picks, or null when nothing is picked. */
export const cleanVideoPicks = (input, { menu = loadMenu() } = {}) => cleanPicks(input, VIDEO_PICKS, "The video", menu);

/** The lines added after the typed prompt, for a model family. "" when no picks. */
export function picksBlock(picks, family, { menu = loadMenu() } = {}) {
  if (!picks) return "";
  const pick = (group, id) => entry(menu, group, id);
  const lens = picks.lens ? pickSentence(pick("lenses", picks.lens)) : "";
  const light = picks.light ? pickSentence(pick("lights", picks.light)) : "";
  const move = picks.move ? pick("moves", picks.move) : null;
  let lines;
  if (family === "hailuo" && move?.hailuo) {
    // A bracket command is the move; a speed has no bracket, so it is a short sentence after it.
    const speed = picks.speed ? pickSentence(pick("speeds", picks.speed)) : "";
    const framing = stageWords({ size: picks.size, angle: picks.angle }, pick);
    lines = [[move.hailuo, speed].filter(Boolean).join(" "), framing, lens, light];
  } else if (family === "hailuo") {
    lines = [stageWords(picks, pick), lens, light];
  } else {
    const camera = stageWords(picks, pick);
    lines = [camera && `Camera: ${camera}`, lens, light];
  }
  return lines.filter(Boolean).join("\n");
}

/** { prompt, picks, typedPrompt } to send. Throws (nothing spent) when the block pushes the prompt past maxChars. */
export function applyVideoPicks(prompt, input, model, { menu = loadMenu() } = {}) {
  const picks = cleanVideoPicks(input, { menu });
  if (!picks) return { prompt, picks: null, typedPrompt: null };
  const block = picksBlock(picks, model?.promptProfile?.family, { menu });
  const full = `${prompt.trimEnd()}\n\n${block}`;
  const max = model?.promptProfile?.maxChars;
  if (max && full.length > max) {
    throw unknown(
      `Refused before submitting, nothing was spent. With the picks the prompt is ${full.length} characters; ${model.id} follows at most ${max}. Shorten the prompt or remove a pick.`,
      { field: "prompt" },
    );
  }
  return { prompt: full, picks, typedPrompt: prompt };
}
