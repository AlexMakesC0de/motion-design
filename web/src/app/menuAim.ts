// web/src/app/menuAim.ts
// "Menu aim", or the safe triangle: while the pointer is heading for an open
// dropdown, links it brushes past on the way must not take the menu over.
// The triangle runs from where the pointer was a moment ago to the panel's two
// top corners (widened a little). A pointer inside it is aiming at the panel.

export interface Point {
  x: number;
  y: number;
}
export interface Box {
  left: number;
  right: number;
  top: number;
}

/** How far past each top corner the triangle reaches, so aiming at an edge item still counts. */
export const AIM_SLACK = 24;
/** How long the pointer may rest on another link before that link wins after all. */
export const AIM_REST_MS = 120;
/** How far back the trail looks for the triangle's tip, so one jittery event does not decide. */
export const AIM_LOOKBACK_MS = 80;

const side = (p: Point, a: Point, b: Point) => (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);

/** Whether `p` lies inside the triangle a, b, c (edges count). */
export function inTriangle(p: Point, a: Point, b: Point, c: Point) {
  const d1 = side(p, a, b);
  const d2 = side(p, b, c);
  const d3 = side(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Whether moving from `from` to `to` heads into the panel `box`, which hangs below. */
export function aimingAt(from: Point | null, to: Point, box: Box, slack = AIM_SLACK) {
  if (!from || (from.x === to.x && from.y === to.y)) return false;
  // Only a pointer still above the panel can be on its way to it.
  if (to.y >= box.top || from.y >= box.top) return false;
  return inTriangle(to, from, { x: box.left - slack, y: box.top }, { x: box.right + slack, y: box.top });
}

/** The trail's oldest point within the lookback, or its previous point; the tip of the triangle. */
export function tipOf(trail: { x: number; y: number; t: number }[], now: number): Point | null {
  if (trail.length < 2) return null;
  const recent = trail.slice(0, -1).find((p) => now - p.t <= AIM_LOOKBACK_MS);
  return recent ?? trail[trail.length - 2];
}
