import { mkdirSync, rmdirSync } from "node:fs";
import { usage } from "../lib/errors.mjs";
import { RUNS_DIR, runDir } from "../lib/run.mjs";
import { loadMenu, ids } from "./menu.mjs";
import { readFilmJson, writeFilmJson } from "./files.mjs";

/** The frame shapes a film can be cut in. */
export const ASPECTS = ["16:9", "9:16", "1:1", "21:9"];
export const MAX_FILM_S = 120;
const KEYS = new Set(["takeaway", "audience", "durationS", "aspectRatio", "tone", "mustShow", "copy", "sound", "filmType"]);
const SOUND_KEYS = new Set(["music", "voice", "sfx"]);

const text = (v) => typeof v === "string" && v.trim() !== "";
const textList = (v) => Array.isArray(v) && v.every(text);

/** Every problem with a brief, as plain sentences. An empty list means it is sound. */
export function validateBrief(brief, { menu = loadMenu() } = {}) {
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) return ["The brief must be an object."];
  const problems = [];
  for (const k of Object.keys(brief)) if (!KEYS.has(k)) problems.push(`The brief has no field "${k}". Fields: ${[...KEYS].join(", ")}.`);
  if (!text(brief.takeaway)) problems.push("takeaway is missing: the one thing the viewer should leave with.");
  if (!(Number.isInteger(brief.durationS) && brief.durationS >= 1 && brief.durationS <= MAX_FILM_S)) problems.push(`durationS must be whole seconds from 1 to ${MAX_FILM_S}.`);
  if (!ASPECTS.includes(brief.aspectRatio)) problems.push(`aspectRatio must be one of: ${ASPECTS.join(", ")}.`);
  if (!ids(menu, "filmTypes").includes(brief.filmType)) problems.push(`filmType must be one of: ${ids(menu, "filmTypes").join(", ")}.`);
  for (const k of ["audience", "tone"]) if (brief[k] != null && !text(brief[k])) problems.push(`${k} must be a sentence, or left out.`);
  for (const k of ["mustShow", "copy"]) if (brief[k] != null && !textList(brief[k])) problems.push(`${k} must be a list of short lines.`);
  if (brief.sound != null) {
    if (typeof brief.sound !== "object" || Array.isArray(brief.sound)) problems.push("sound must be { music, voice, sfx }.");
    else {
      for (const k of Object.keys(brief.sound)) if (!SOUND_KEYS.has(k)) problems.push(`sound has no field "${k}". Fields: music, voice, sfx.`);
      for (const k of SOUND_KEYS) if (brief.sound[k] != null && !text(brief.sound[k])) problems.push(`sound.${k} must be a sentence, or left out.`);
    }
  }
  return problems;
}

export const readBrief = (film) => readFilmJson(film, "brief.json");

/**
 * Save a brief after checking it; a bad brief is refused with every reason
 * (exit 1). With `create`, the brief starts a new film: runs/<film> is made
 * here and must not exist yet (anything already there, a folder, a file or a
 * link, is refused with `exists: true`), so a new film never lands on an old one.
 */
export function saveBrief(film, brief, { create = false, ...opts } = {}) {
  const problems = validateBrief(brief, opts);
  if (problems.length) throw usage(`The brief was not saved:\n- ${problems.join("\n- ")}`, { problems });
  if (!create) {
    writeFilmJson(film, "brief.json", brief, opts);
    return brief;
  }
  const dir = runDir(film, { create: false });
  mkdirSync(RUNS_DIR, { recursive: true });
  try {
    mkdirSync(dir); // not recursive: fails if anything is already at runs/<film>
  } catch (err) {
    if (err.code === "EEXIST") throw usage(`runs/${film} already exists; a new film needs a name of its own.`, { exists: true });
    throw err;
  }
  try {
    writeFilmJson(film, "brief.json", brief, opts);
  } catch (err) {
    try {
      rmdirSync(dir); // only if still empty: never leave a folder that blocks the next try
    } catch {
      // something else was written there; leave it
    }
    throw err;
  }
  return brief;
}
