import { describe, expect, test } from "vitest";
import { aimingAt, inTriangle, tipOf } from "./menuAim";

// A panel hanging below the bar, 400px wide.
const panel = { left: 100, right: 500, top: 60 };

describe("menu aim", () => {
  test("a point inside the triangle counts, one outside does not", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    const c = { x: 0, y: 10 };
    expect(inTriangle({ x: 2, y: 2 }, a, b, c)).toBe(true);
    expect(inTriangle({ x: 9, y: 9 }, a, b, c)).toBe(false);
  });

  test("moving down and across toward the panel is aiming, even over a neighbouring link", () => {
    expect(aimingAt({ x: 150, y: 20 }, { x: 170, y: 28 }, panel)).toBe(true);
    // Steeply sideways, toward its far right corner: still inside the triangle.
    expect(aimingAt({ x: 150, y: 20 }, { x: 195, y: 25 }, panel)).toBe(true);
  });

  test("sliding sideways along the bar, moving up, or standing still is not aiming", () => {
    expect(aimingAt({ x: 150, y: 20 }, { x: 190, y: 20 }, panel)).toBe(false);
    expect(aimingAt({ x: 150, y: 30 }, { x: 160, y: 20 }, panel)).toBe(false);
    expect(aimingAt({ x: 150, y: 20 }, { x: 150, y: 20 }, panel)).toBe(false);
    expect(aimingAt(null, { x: 150, y: 20 }, panel)).toBe(false);
  });

  test("heading somewhere well beside the panel is not aiming", () => {
    expect(aimingAt({ x: 480, y: 20 }, { x: 560, y: 30 }, panel)).toBe(false);
  });

  test("a pointer already level with the panel is not aiming at it", () => {
    expect(aimingAt({ x: 150, y: 50 }, { x: 160, y: 65 }, panel)).toBe(false);
  });

  test("the triangle's tip is the oldest recent point, so one jittery event does not decide", () => {
    const trail = [
      { x: 0, y: 0, t: 0 },
      { x: 10, y: 5, t: 950 },
      { x: 12, y: 6, t: 990 },
      { x: 13, y: 7, t: 1000 },
    ];
    expect(tipOf(trail, 1000)).toEqual({ x: 10, y: 5, t: 950 });
    expect(tipOf(trail.slice(-1), 1000)).toBeNull();
    // Nothing recent before the last point: fall back to the one before it.
    expect(tipOf([{ x: 0, y: 0, t: 0 }, { x: 5, y: 5, t: 1000 }], 1000)).toEqual({ x: 0, y: 0, t: 0 });
  });
});
