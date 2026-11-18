// Looks: short style blocks for a plain video generation (Create Video, MCP
// generate_video, `kie video --look`). A look sets the camera with the same
// menu picks a video takes, and adds a line each for the look, the pacing and
// the sound, after the typed prompt. The ten gallery presets are different:
// they are whole films to adapt (cli/lib/presets.mjs), not styles.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unknown } from "../lib/errors.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const LOOKS_PATH = join(HERE, "looks.json");

/** Families whose models make no sound: a sound line would only spend characters. */
const SILENT = new Set(["hailuo", "wan"]);

let cache = null;
export function loadLooks(path = LOOKS_PATH) {
  if (cache && path === LOOKS_PATH) return cache;
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (path === LOOKS_PATH) cache = data;
  return data;
}

/** One look by id. Refuses an unknown one, naming the looks there are. */
export function findLook(id, data = loadLooks()) {
  const hit = data.looks.find((l) => l.id === id);
  if (!hit) throw unknown(`No look "${id}". Looks: ${data.looks.map((l) => l.id).join(", ")}.`, { field: "look" });
  return hit;
}

/** The look's own lines for a model family: "Look: …", "Pacing: …", and "Sound: …" when the model makes sound. */
export function lookLines(look, family) {
  if (!look) return [];
  return [`Look: ${look.look}`, look.pacing && `Pacing: ${look.pacing}`, look.sound && !SILENT.has(family) && `Sound: ${look.sound}`].filter(Boolean);
}

/** A look as the studio and the MCP list it. */
export const lookView = (l) => ({ id: l.id, title: l.title, category: l.category, tagline: l.tagline, bestFor: l.bestFor, picks: l.picks, look: l.look, pacing: l.pacing, sound: l.sound, swatch: l.swatch });
