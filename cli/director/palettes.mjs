// Colour palettes for a video's grade. The built-in ones live in menu.json
// ("palettes"); a person's own, made from a picture of theirs in the studio,
// live in library/palettes.json with that picture beside it
// (library/palettes/<id>.jpg). Both are picked the same way: picks.palette,
// worded after the prompt as "Colour palette: <words>."
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LIBRARY_DIR } from "../lib/run.mjs";
import { unknown } from "../lib/errors.mjs";
import { loadMenu } from "./menu.mjs";

const HEX = /^#[0-9a-f]{6}$/;
export const OWN_PREFIX = "own-";
const file = () => join(LIBRARY_DIR, "palettes.json");
const picDir = () => join(LIBRARY_DIR, "palettes");
/** Where an own palette's picture is kept (it may not exist). */
export const ownPalettePicture = (id) => join(picDir(), `${id}.jpg`);

/** The person's own palettes, newest first. */
export function loadOwnPalettes() {
  if (!existsSync(file())) return [];
  try {
    const list = JSON.parse(readFileSync(file(), "utf8"));
    return Array.isArray(list) ? list.filter((p) => p && typeof p.id === "string" && Array.isArray(p.colors)) : [];
  } catch {
    return [];
  }
}

function saveAll(list) {
  mkdirSync(LIBRARY_DIR, { recursive: true });
  const tmp = `${file()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(list, null, 2)}\n`);
  renameSync(tmp, file());
}

/** A built-in or own palette by id. Refuses one that is neither, naming the built-in ones. */
export function findPalette(id, menu = loadMenu()) {
  const hit = (menu.palettes ?? []).find((p) => p.id === id) ?? (id?.startsWith(OWN_PREFIX) ? loadOwnPalettes().find((p) => p.id === id) : null);
  if (!hit) throw unknown(`"${id}" is not a colour palette. Choose one of: ${(menu.palettes ?? []).map((p) => p.id).join(", ")}, or one of your own.`);
  return hit;
}

// Names for describing a colour in words; the nearest one wins.
const NAMES = [
  ["black", "#0a0a0a"], ["charcoal", "#2b2b2b"], ["dark grey", "#4a4a4a"], ["grey", "#808080"], ["silver", "#b5b5b5"], ["off-white", "#ecebe6"], ["white", "#ffffff"],
  ["cream", "#f1e6c8"], ["beige", "#d6c3a0"], ["tan", "#b8996a"], ["khaki", "#a39a6a"], ["brown", "#6b4423"], ["dark brown", "#3a2414"], ["chocolate", "#4e2e1c"],
  ["rust", "#a5482a"], ["burnt orange", "#c8601e"], ["orange", "#f0882a"], ["peach", "#f2b48c"], ["amber", "#d99a2b"], ["gold", "#d4af37"], ["mustard", "#c9a227"],
  ["yellow", "#f2d73a"], ["dark mustard", "#6a5a1e"], ["ochre", "#a07f2c"], ["dark olive", "#4a4518"], ["pale yellow", "#f4ecb0"], ["olive", "#6e6d2e"], ["moss green", "#5c6b3a"], ["sage", "#a3b18a"], ["green", "#3f8f3f"], ["forest green", "#1f4a2a"],
  ["mint", "#a8e0c0"], ["teal", "#1f7a7a"], ["deep teal", "#0f4048"], ["turquoise", "#36c2c2"], ["cyan", "#2ad4f0"], ["sky blue", "#86b8e0"], ["steel blue", "#4a6f94"],
  ["blue", "#2f5fd0"], ["navy", "#14204a"], ["midnight blue", "#0b1026"], ["indigo", "#3b2a8a"], ["violet", "#7a3ad0"], ["purple", "#5e2a6e"], ["lavender", "#c4b0e0"],
  ["magenta", "#d02a9a"], ["hot pink", "#ff3f8f"], ["pink", "#f0a0b8"], ["blush", "#e8c4c0"], ["dusty rose", "#c08088"], ["red", "#c8262a"], ["crimson", "#9a1428"],
  ["burgundy", "#5a1424"], ["coral", "#f07a64"], ["salmon", "#e8907a"],
];
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const NAMED = NAMES.map(([name, hex]) => [name, rgb(hex)]);
function nameOf(hex) {
  const [r, g, b] = rgb(hex);
  let best = NAMED[0][0];
  let gap = Infinity;
  for (const [name, [R, G, B]] of NAMED) {
    // Weighted for how eyes see it: green counts most, blue least.
    const d = 2 * (r - R) ** 2 + 4 * (g - G) ** 2 + 3 * (b - B) ** 2;
    if (d < gap) [best, gap] = [name, d];
  }
  return best;
}

/** Plain words for a set of colours: their names once each, in the order given. */
export function paletteWords(colors) {
  return [...new Set(colors.map(nameOf))].join(", ");
}

/** Check { name, colors } for an own palette; returns the cleaned values. */
function cleanOwn(input) {
  const name = typeof input?.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  if (!name) throw unknown("A palette needs a name.");
  if (name.length > 40) throw unknown("A palette's name is at most 40 characters.");
  const colors = Array.isArray(input?.colors) ? input.colors.map((c) => String(c).toLowerCase()) : [];
  if (colors.length < 2 || colors.length > 12 || !colors.every((c) => HEX.test(c))) throw unknown("A palette is 2 to 12 colours, each written #rrggbb.");
  return { name, colors };
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "palette";

/**
 * Save a new own palette. `picture` is the JPEG it came from (a Buffer), kept
 * small by the studio; optional. Returns the saved palette.
 */
export function addOwnPalette(input, picture = null) {
  const { name, colors } = cleanOwn(input);
  const list = loadOwnPalettes();
  let id = `${OWN_PREFIX}${slug(name)}`;
  for (let n = 2; list.some((p) => p.id === id); n++) id = `${OWN_PREFIX}${slug(name)}-${n}`;
  const palette = { id, label: name, colors, words: paletteWords(colors), created: new Date().toISOString() };
  if (picture) {
    mkdirSync(picDir(), { recursive: true });
    writeFileSync(ownPalettePicture(id), picture);
  }
  saveAll([palette, ...list]);
  return palette;
}

/** Remove an own palette and its picture. Refuses an id that is not one. */
export function removeOwnPalette(id) {
  const list = loadOwnPalettes();
  if (!list.some((p) => p.id === id)) throw unknown(`You have no palette "${id}".`);
  saveAll(list.filter((p) => p.id !== id));
  rmSync(ownPalettePicture(id), { force: true });
  return { removed: id };
}
