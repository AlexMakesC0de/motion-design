// web/src/studio/snake.ts
// The snake game that plays on the dot grid while a take is being made.
// Pure rules, no drawing: the board wraps at every edge, so leaving on the
// right comes back on the left still heading right, exactly as in classic Snake.

export type Dir = "up" | "down" | "left" | "right";
export interface Cell {
  x: number;
  y: number;
}
export interface Snake {
  cols: number;
  rows: number;
  /** Head first. */
  body: Cell[];
  dir: Dir;
  food: Cell;
  score: number;
}

const STEP: Record<Dir, Cell> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPPOSITE: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };
export const START_LENGTH = 4;

const wrap = (n: number, size: number) => ((n % size) + size) % size;
const same = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;

/** The cell one step from `c` in `dir`, wrapping round the board. */
export function ahead(c: Cell, dir: Dir, cols: number, rows: number): Cell {
  return { x: wrap(c.x + STEP[dir].x, cols), y: wrap(c.y + STEP[dir].y, rows) };
}

/** A free cell for the food, or the head's own cell on a full board. */
export function placeFood(body: Cell[], cols: number, rows: number, rand: () => number = Math.random): Cell {
  const free = cols * rows - body.length;
  if (free <= 0) return body[0];
  let n = Math.floor(rand() * free);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      if (body.some((b) => b.x === x && b.y === y)) continue;
      if (n-- === 0) return { x, y };
    }
  return body[0];
}

/** A new snake in the middle of a `cols` × `rows` board, heading right. */
export function newSnake(cols: number, rows: number, rand: () => number = Math.random): Snake {
  const y = Math.floor(rows / 2);
  const x0 = Math.floor(cols / 2);
  const body = line({ x: x0, y }, "right", cols, rows);
  return { cols, rows, body, dir: "right", food: placeFood(body, cols, rows, rand), score: 0 };
}

/** Turn, unless it would reverse straight into the neck. */
export function turn(s: Snake, dir: Dir): Snake {
  return dir === OPPOSITE[s.dir] && s.body.length > 1 ? s : { ...s, dir };
}

/** A straight snake of the starting length with its head at `head`, trailing away from `dir`. */
function line(head: Cell, dir: Dir, cols: number, rows: number): Cell[] {
  const body = [head];
  while (body.length < Math.min(START_LENGTH, cols)) body.push(ahead(body[body.length - 1], OPPOSITE[dir], cols, rows));
  return body;
}

/**
 * One step. Eating keeps the tail where it is (the snake grows by one) and
 * moves the food. Running into itself starts a short snake again where the
 * head is, score back to 0.
 */
export function step(s: Snake, rand: () => number = Math.random): Snake {
  const head = ahead(s.body[0], s.dir, s.cols, s.rows);
  const eats = same(head, s.food);
  const rest = eats ? s.body : s.body.slice(0, -1);
  if (rest.some((c) => same(c, head))) {
    const body = line(head, s.dir, s.cols, s.rows);
    return { ...s, body, score: 0, food: placeFood(body, s.cols, s.rows, rand) };
  }
  const body = [head, ...rest];
  return eats ? { ...s, body, score: s.score + 1, food: placeFood(body, s.cols, s.rows, rand) } : { ...s, body };
}

/** The shorter way to go along one axis on a wrapping board: +1, -1 or 0. */
function toward(from: number, to: number, size: number) {
  const d = wrap(to - from, size);
  if (d === 0) return 0;
  return d <= size / 2 ? 1 : -1;
}

/** The autopilot: head for the food the short way round, never into itself if it can help it. */
export function autopilot(s: Snake): Dir {
  const h = s.body[0];
  const dx = toward(h.x, s.food.x, s.cols);
  const dy = toward(h.y, s.food.y, s.rows);
  const wants: Dir[] = [];
  if (dx) wants.push(dx > 0 ? "right" : "left");
  if (dy) wants.push(dy > 0 ? "down" : "up");
  const all: Dir[] = [...wants, s.dir, "up", "right", "down", "left"];
  const body = s.body.slice(0, -1);
  const safe = all.find((d) => d !== OPPOSITE[s.dir] && !body.some((c) => same(c, ahead(h, d, s.cols, s.rows))));
  return safe ?? s.dir;
}

/** The arrow and WASD keys a player steers with. */
export const KEYS: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
  W: "up",
  S: "down",
  A: "left",
  D: "right",
};
