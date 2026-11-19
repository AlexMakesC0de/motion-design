// web/src/film/editMath.ts
// The same placing rule as cli/director/edit.mjs, run on the page so a trim
// or a reorder moves the timeline at once, before the save comes back.
import type { EditClip } from "../api/types";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Each clip's start and length in the film; returns the clips and the film's length. */
export function layout(clips: EditClip[], fadeS: number): { clips: EditClip[]; lengthS: number } {
  let at = 0;
  const placed = clips.map((c, i) => {
    const end = c.outS == null ? c.sourceS : c.sourceS == null ? c.outS : Math.min(c.outS, c.sourceS);
    const plays = end == null || c.missing ? 0 : Math.max(0, (end - c.inS) / c.speed);
    const fade = i > 0 && c.into === "fade" ? Math.min(fadeS, plays / 2) : 0;
    const startS = r3(Math.max(0, at - fade));
    at = startS + plays;
    return { ...c, endS: end == null ? null : r3(end), startS, lengthS: r3(plays) };
  });
  return { clips: placed, lengthS: r3(at) };
}

/** The clip playing at film time t, and where in its take that is. */
export function clipAt(clips: EditClip[], t: number): { index: number; takeS: number } | null {
  for (let i = clips.length - 1; i >= 0; i--) {
    const c = clips[i];
    if (c.lengthS > 0 && t >= c.startS - 1e-6) return { index: i, takeS: c.inS + Math.min(t - c.startS, c.lengthS) * c.speed };
  }
  return null;
}

export const seconds = (s: number) => `${s.toFixed(1)}s`;
export const clock = (s: number) => {
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
};
