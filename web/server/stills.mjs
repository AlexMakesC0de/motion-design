// Preview stills for the preset gallery. They are unretouched frames of each
// preset's source video, kept in docs/images/ and listed with their preset id
// in docs/images/sources.json. Only files listed there are ever served.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../cli/lib/run.mjs";

export const STILLS_DIR = join(REPO_ROOT, "docs", "images");

/** Preset id → absolute path of its still. Empty when the list is missing or unreadable. */
export function presetStills(dir = STILLS_DIR) {
  const map = new Map();
  let list;
  try {
    list = JSON.parse(readFileSync(join(dir, "sources.json"), "utf8")).stills ?? [];
  } catch {
    return map; // no stills: the gallery shows text cards
  }
  for (const s of list) {
    if (typeof s?.preset !== "string" || typeof s?.file !== "string" || !/^[a-z0-9-]+\.png$/.test(s.file)) continue;
    const path = join(dir, s.file);
    if (existsSync(path)) map.set(s.preset, path);
  }
  return map;
}

export const stillUrl = (id, stills = presetStills()) => (stills.has(id) ? `/media/presets/${encodeURIComponent(id)}.png` : null);

/** A look's preview picture: docs/images/looks/<id>.jpg, made from the look's own words. Only look ids are ever served. */
export const LOOK_STILLS_DIR = join(STILLS_DIR, "looks");
export function lookStill(id, dir = LOOK_STILLS_DIR) {
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  const path = join(dir, `${id}.jpg`);
  return existsSync(path) ? path : null;
}
export const lookStillUrl = (id) => (lookStill(id) ? `/media/looks/${encodeURIComponent(id)}.jpg` : null);
