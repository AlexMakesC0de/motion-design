// Preview stills for the Ad templates gallery. The repository ships none: the
// frames of each template's source video belong to their creators, so they are
// not redistributed here. A folder of stills you have the rights to can be
// pointed to with SHARD_PRESET_STILLS_DIR (a sources.json listing { preset, file }
// plus the PNGs). Only files listed there are ever served; without them the
// gallery shows text cards.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, RUNS_DIR } from "../../cli/lib/run.mjs";
import { loadMenu } from "../../cli/director/menu.mjs";

export const STILLS_DIR = join(REPO_ROOT, "docs", "images");

/** Preset id → absolute path of its still. Empty when the list is missing or unreadable. */
export function presetStills(dir = process.env.SHARD_PRESET_STILLS_DIR || STILLS_DIR) {
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

/**
 * A camera move's preview clip: runs/camera-moves/<move id>.mp4, put there by
 * hand once a clip is agreed. It lives in runs/ because it is a generation of a
 * personal character and is never committed. Only menu move ids are served;
 * a move without a clip keeps its drawn preview.
 */
export const MOVE_CLIPS_DIR = () => process.env.SHARD_MOVE_CLIPS_DIR || join(RUNS_DIR, "camera-moves");
export function moveClip(id, dir = MOVE_CLIPS_DIR()) {
  if (!/^[a-z0-9-]+$/.test(id) || !loadMenu().moves.some((m) => m.id === id)) return null;
  const path = join(dir, `${id}.mp4`);
  return existsSync(path) ? path : null;
}
/** Built-in palette stills (runs/palettes/<id>.jpg): never committed, like the move clips. */
export const PALETTE_STILLS_DIR = () => process.env.SHARD_PALETTE_STILLS_DIR || join(RUNS_DIR, "palettes");
export function paletteStill(id, dir = PALETTE_STILLS_DIR()) {
  if (!/^[a-z0-9-]+$/.test(id) || !(loadMenu().palettes ?? []).some((p) => p.id === id)) return null;
  const path = join(dir, `${id}.jpg`);
  return existsSync(path) ? path : null;
}
/** Palette id → the URL of its still, for every built-in palette that has one. */
export function paletteStills(dir = PALETTE_STILLS_DIR()) {
  const out = {};
  for (const p of loadMenu().palettes ?? []) if (paletteStill(p.id, dir)) out[p.id] = `/media/palettes/${encodeURIComponent(p.id)}.jpg`;
  return out;
}
/** Move id → the URL of its clip, for every move that has one. */
export function moveClips(dir = MOVE_CLIPS_DIR()) {
  const out = {};
  for (const m of loadMenu().moves) if (moveClip(m.id, dir)) out[m.id] = `/media/moves/${encodeURIComponent(m.id)}.mp4`;
  return out;
}
