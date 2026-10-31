import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unknown } from "../lib/errors.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MENU_PATH = join(HERE, "menu.json");

/** The groups a plan picks from, in the order the menu is shown. */
export const GROUPS = [
  "sizes", "angles", "lenses", "lensLooks", "depths", "moves", "speeds",
  "lights", "cuts", "screenDirections", "keyLightSides", "jobs", "filmTypes",
];

let cache = null;

export function loadMenu(path = MENU_PATH) {
  if (cache && path === MENU_PATH) return cache;
  const menu = JSON.parse(readFileSync(path, "utf8"));
  if (path === MENU_PATH) cache = menu;
  return menu;
}

/** The ids of one group, in menu order. */
export const ids = (menu, group) => (menu[group] ?? []).map((e) => e.id);

/** One entry. Refuses an id the menu does not have, naming the ones it does. */
export function entry(menu, group, id) {
  const hit = (menu[group] ?? []).find((e) => e.id === id);
  if (!hit) throw unknown(`"${id}" is not on the director's ${group} menu. Choose one of: ${ids(menu, group).join(", ")}.`);
  return hit;
}
