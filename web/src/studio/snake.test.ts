import { describe, expect, test } from "vitest";
import { ahead, autopilot, newSnake, placeFood, START_LENGTH, step, turn, type Snake } from "./snake";
import { progressOf, typicalSeconds } from "./format";
import { job } from "../test-fixtures";

const board = (over: Partial<Snake>): Snake => ({ cols: 10, rows: 6, body: [{ x: 5, y: 3 }, { x: 4, y: 3 }, { x: 3, y: 3 }], dir: "right", food: { x: 0, y: 0 }, score: 0, ...over });

describe("snake", () => {
  test("leaving an edge comes back on the opposite side, still heading the same way", () => {
    expect(ahead({ x: 9, y: 2 }, "right", 10, 6)).toEqual({ x: 0, y: 2 });
    expect(ahead({ x: 0, y: 2 }, "left", 10, 6)).toEqual({ x: 9, y: 2 });
    expect(ahead({ x: 4, y: 0 }, "up", 10, 6)).toEqual({ x: 4, y: 5 });
    expect(ahead({ x: 4, y: 5 }, "down", 10, 6)).toEqual({ x: 4, y: 0 });
    const s = step(board({ body: [{ x: 9, y: 3 }, { x: 8, y: 3 }, { x: 7, y: 3 }] }));
    expect(s.body[0]).toEqual({ x: 0, y: 3 });
    expect(s.dir).toBe("right");
  });

  test("a step moves the head and drops the tail; eating grows by one and scores", () => {
    const moved = step(board({}));
    expect(moved.body).toEqual([{ x: 6, y: 3 }, { x: 5, y: 3 }, { x: 4, y: 3 }]);
    const ate = step(board({ food: { x: 6, y: 3 } }), () => 0);
    expect(ate.body).toHaveLength(4);
    expect(ate.score).toBe(1);
    expect(ate.body).not.toContainEqual(ate.food);
  });

  test("it cannot reverse into its own neck", () => {
    expect(turn(board({}), "left").dir).toBe("right");
    expect(turn(board({}), "up").dir).toBe("up");
  });

  test("running into itself starts a short snake again where the head is", () => {
    // A loop: the head at (5,3) heading down into its own body at (5,4).
    const s = board({ dir: "down", body: [{ x: 5, y: 3 }, { x: 6, y: 3 }, { x: 6, y: 4 }, { x: 5, y: 4 }, { x: 4, y: 4 }], score: 3 });
    const after = step(s);
    expect(after.score).toBe(0);
    expect(after.body).toHaveLength(START_LENGTH);
    expect(after.body[0]).toEqual({ x: 5, y: 4 });
  });

  test("the autopilot heads for the food the short way round, across an edge if nearer", () => {
    expect(autopilot(board({ food: { x: 8, y: 3 } }))).toBe("right");
    // Food at x=1 is 4 cells left or 6 right round the edge; left would reverse into its neck, so it keeps going right.
    expect(autopilot(board({ food: { x: 1, y: 3 } }))).toBe("right");
    // Heading right with food 2 cells left round the edge (x=3 → wraps): it never picks the reverse.
    expect(autopilot(board({ food: { x: 2, y: 3 } }))).not.toBe("left");
    expect(autopilot(board({ food: { x: 5, y: 5 } }))).toBe("down");
  });

  test("food never lands on the snake, and a new snake starts in the middle", () => {
    const body = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    for (let i = 0; i < 20; i++) expect(body).not.toContainEqual(placeFood(body, 2, 2, () => i / 20));
    const s = newSnake(20, 10, () => 0.5);
    expect(s.body).toHaveLength(START_LENGTH);
    expect(s.body[0]).toEqual({ x: 10, y: 5 });
  });
});

describe("progress while a take is made", () => {
  const t0 = Date.parse("2026-11-17T10:00:00Z");
  const at = (s: number) => t0 + s * 1000;
  test("rises quickly, is 86% at the usual time, and stops short of 100%", () => {
    const start = new Date(t0).toISOString();
    expect(progressOf(start, at(0), 40)).toBe(0);
    expect(progressOf(start, at(10), 40)).toBeCloseTo(0.39, 2);
    expect(progressOf(start, at(40), 40)).toBeCloseTo(0.86, 2);
    expect(progressOf(start, at(400), 40)).toBe(0.97);
  });

  test("the usual time is the median of the model's finished takes, else a guess for its kind", () => {
    const done = (s: number) => job({ model: "m", state: "succeeded", createdAt: new Date(t0).toISOString(), updatedAt: new Date(at(s)).toISOString() });
    expect(typicalSeconds([done(30), done(50), done(40)], "m", "image")).toBe(40);
    expect(typicalSeconds([], "m", "image")).toBe(45);
    expect(typicalSeconds([], "m", "video")).toBe(150);
  });
});
