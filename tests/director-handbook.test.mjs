import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadMenu } from "../cli/director/menu.mjs";
import { loadCatalog } from "../cli/lib/models.mjs";

const menu = loadMenu();
const DIR = new URL("../skills/motion-design/references/director/", import.meta.url);
const read = (name) => readFileSync(new URL(name, DIR), "utf8");

describe("the director's handbook", () => {
  test("every film type's chapter exists in the handbook", () => {
    for (const f of menu.filmTypes) assert.ok(read(f.chapter).length > 500, f.chapter);
  });

  test("craft.md explains every size, angle, lens, move and light by its label", () => {
    const craft = read("craft.md").toLowerCase();
    for (const g of ["sizes", "angles", "lenses", "depths", "moves", "lights", "cuts"]) {
      for (const e of menu[g]) assert.ok(craft.includes(e.label.toLowerCase()), `craft.md mentions ${g}: ${e.label}`);
    }
  });

  test("names no provider model id, so prose never pins a model", () => {
    const ids = loadCatalog().list.map((m) => m.id);
    for (const name of ["craft.md", "brief.md", ...menu.filmTypes.map((f) => f.chapter)]) {
      const text = read(name);
      for (const id of ids) assert.ok(!new RegExp(`\\b${id}\\b`).test(text), `${name} names ${id}`);
    }
  });
});
