import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EXIT } from "../cli/lib/errors.mjs";
import { loadMenu, ids, entry, GROUPS } from "../cli/director/menu.mjs";

const menu = loadMenu();

describe("the director's menu", () => {
  test("has every group, each entry with an id, a label and when to use it", () => {
    for (const g of GROUPS) {
      assert.ok(Array.isArray(menu[g]) && menu[g].length, g);
      for (const e of menu[g]) {
        assert.match(e.id, /^[a-z0-9][a-z0-9-]*$/, `${g}: ${e.id}`);
        assert.ok(e.label && e.when, `${g}/${e.id} has a label and a when`);
      }
      assert.equal(new Set(ids(menu, g)).size, menu[g].length, `${g} ids are unique`);
    }
  });

  test("the sizes, angles, lenses, moves, lights and cuts the spec names", () => {
    assert.equal(menu.sizes.length, 10);
    assert.equal(menu.angles.length, 8);
    assert.deepEqual(ids(menu, "lenses"), ["14mm", "24mm", "35mm", "50mm", "85mm", "135mm", "100mm-macro"]);
    assert.deepEqual(ids(menu, "speeds"), ["creep", "slow", "medium", "fast"]);
    assert.equal(menu.lights.length, 12);
    assert.deepEqual(ids(menu, "cuts"), ["hard", "jump", "on-action", "match", "whip", "dissolve", "fade-out", "continuous"]);
    assert.deepEqual(ids(menu, "filmTypes"), ["product-ui", "live-action", "character", "product-hero"]);
  });

  test("every entry that goes into a prompt has words; every move has a hailuo bracket or null", () => {
    for (const g of ["sizes", "angles", "lenses", "lensLooks", "depths", "moves", "speeds", "lights", "screenDirections"]) {
      for (const e of menu[g]) assert.equal(typeof e.words, "string", `${g}/${e.id}`);
    }
    for (const m of menu.moves) assert.ok(m.hailuo === null || /^\[.+\]$/.test(m.hailuo), m.id);
  });

  test("entry refuses an id that is not on the menu and names the valid ones", () => {
    assert.equal(entry(menu, "sizes", "wide").label, "Wide");
    assert.throws(() => entry(menu, "sizes", "huge"), (e) => e.code === EXIT.UNKNOWN && /extreme-wide, wide/.test(e.message));
  });
});
