// Picks on a plain video generation (Create Video, `kie video --pick`, MCP
// generate_video): the same menu ids as a scene's, worded after the typed
// prompt in the shape the chosen model reads best.
import { unknown } from "../lib/errors.mjs";
import { loadMenu, entry } from "./menu.mjs";
import { STAGE_PICKS, SCENE_PICKS, stageWords, framingWords, pickSentence, cameraWords } from "./picks.mjs";
import { findLook, lookLines } from "./looks.mjs";
import { findPalette } from "./palettes.mjs";

/** What only a plain video takes: the camera body, the lens look, the aperture and the colour palette. */
export const SETUP_PICKS = { camera: "cameras", lensLook: "lensLooks", depth: "depths", palette: "palettes" };
/** Every key a video takes → its menu group. */
export const VIDEO_PICKS = { ...STAGE_PICKS, ...SCENE_PICKS, ...SETUP_PICKS };

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
    if (key === "palette") findPalette(id, menu); // a built-in palette or one of the person's own
    else entry(menu, groups[key], id); // refuses an unknown id, naming the menu's own
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
  // "Shot on 35mm film…, warm vintage glass…, shallow depth of field." One sentence for the camera setup.
  const setupWords = [picks.camera && pick("cameras", picks.camera).words, picks.lensLook && `${pick("lensLooks", picks.lensLook).words} lenses`, picks.depth && pick("depths", picks.depth).words].filter(Boolean).join(", ");
  const setup = setupWords ? pickSentence({ words: setupWords }) : "";
  const light = picks.light ? pickSentence(pick("lights", picks.light)) : "";
  const palette = picks.palette ? `Colour palette: ${findPalette(picks.palette, menu).words}.` : "";
  const move = picks.move ? pick("moves", picks.move) : null;
  let lines;
  if (family === "hailuo" && move?.hailuo) {
    // A bracket command is the move; a speed has no bracket, so it is a short sentence after it.
    const speed = picks.speed ? pickSentence(pick("speeds", picks.speed)) : "";
    const framing = stageWords({ size: picks.size, angle: picks.angle }, pick);
    lines = [[move.hailuo, speed].filter(Boolean).join(" "), framing, setup, lens, light, palette];
  } else if (family === "hailuo") {
    lines = [stageWords(picks, pick), setup, lens, light, palette];
  } else {
    const camera = stageWords(picks, pick);
    lines = [camera && `Camera: ${camera}`, setup, lens, light, palette];
  }
  return lines.filter(Boolean).join("\n");
}

/**
 * { prompt, picks, look, typedPrompt } to send. A look's picks stand in when
 * the caller sends no picks at all (undefined); any picks sent, even none ({}),
 * are used instead, so the studio's chips are exactly what goes. The look's own
 * lines follow the picks. Throws (nothing spent) when the result is past maxChars.
 */
export function applyVideoPicks(prompt, input, model, { menu = loadMenu(), look: lookId = null } = {}) {
  const look = lookId ? findLook(lookId) : null;
  const picks = cleanVideoPicks(input === undefined && look ? look.picks : input, { menu });
  const family = model?.promptProfile?.family;
  const block = [picks ? picksBlock(picks, family, { menu }) : "", ...lookLines(look, family)].filter(Boolean).join("\n");
  if (!block) return { prompt, picks: null, look: null, typedPrompt: null };
  const full = `${prompt.trimEnd()}\n\n${block}`;
  const max = model?.promptProfile?.maxChars;
  if (max && full.length > max) {
    throw unknown(
      `Refused before submitting, nothing was spent. With the ${look ? "look and picks" : "picks"} the prompt is ${full.length} characters; ${model.id} follows at most ${max}. Shorten the prompt or remove a ${look ? "look or pick" : "pick"}.`,
      { field: "prompt" },
    );
  }
  return { prompt: full, picks, look: look?.id ?? null, typedPrompt: prompt };
}
