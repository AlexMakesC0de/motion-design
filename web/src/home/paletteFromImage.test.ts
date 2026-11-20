import { describe, expect, test } from "vitest";
import { paletteFromPixels } from "./paletteFromImage";

const pixels = (...colors: [number, number, number, number?][]) => colors.flatMap(([r, g, b, a = 255]) => [r, g, b, a]);

describe("paletteFromPixels", () => {
  test("groups a picture's pixels into its colours, darkest first, leaving see-through pixels out", () => {
    const data = pixels(...Array(40).fill([250, 240, 220]), ...Array(30).fill([20, 120, 120]), ...Array(30).fill([10, 10, 10]), [255, 0, 0, 0]);
    expect(paletteFromPixels(data, 3)).toEqual(["#0a0a0a", "#147878", "#faf0dc"]);
  });

  test("never more colours than it was asked for, nor more than the picture has", () => {
    const data = pixels(...Array.from({ length: 200 }, (_, i): [number, number, number] => [i, 255 - i, (i * 7) % 256]));
    expect(paletteFromPixels(data, 12)).toHaveLength(12);
    expect(paletteFromPixels(pixels([1, 2, 3], [1, 2, 3]), 12)).toEqual(["#010203"]);
    expect(paletteFromPixels([], 12)).toEqual([]);
  });
});
