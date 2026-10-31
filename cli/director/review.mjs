import { join } from "node:path";
import { runDir } from "../lib/run.mjs";
import { usage } from "../lib/errors.mjs";
import { extractFrames } from "../lib/frames.mjs";
import { readFilmJson, withFilmLock, writeFilmJson } from "./files.mjs";
import { readPlan, findShot } from "./plan.mjs";
import { shotMedia } from "./media.mjs";

export const readReviews = (film) => readFilmJson(film, "reviews.json") ?? {};

/**
 * What to look at before judging a shot: the contact sheet and the first and
 * last frames of the take the shot uses, with the shot's own checks. Free:
 * ffmpeg on a file already on disk.
 */
export async function reviewShot(film, shotId, { store, signal } = {}) {
  const plan = readPlan(film);
  if (!plan) throw usage(`runs/${film} has no plan yet.`);
  const shot = findShot(plan, shotId);
  const take = shotMedia(store, film, plan)[shot.id]?.take;
  if (!take) throw usage(`${shot.id} has no take yet. Film it first.`);
  const f = await extractFrames(join(runDir(film, { create: false }), take), { signal });
  return { shot: shot.id, take, sheet: f.sheet, first: f.first, last: f.last, durationS: f.durationS, checks: shot.checks ?? [] };
}

const text = (v) => typeof v === "string" && v.trim() !== "";

/**
 * Record the verdict on a shot's take: pass or redo, each check judged, and
 * optionally the best window to keep (bestWindow.startS, used by the cut).
 * Saved against the take it judges, so a new take is not mistaken for passed.
 */
export function saveReview(film, shotId, review, { take = review?.take, now } = {}) {
  if (!review || typeof review !== "object") throw usage("A review is an object: { verdict, checks, bestWindow? }.");
  if (!["pass", "redo"].includes(review.verdict)) throw usage(`verdict must be pass or redo, got "${review.verdict}".`);
  if (!Array.isArray(review.checks) || !review.checks.every((c) => text(c?.check) && typeof c?.ok === "boolean" && (c.note == null || typeof c.note === "string"))) {
    throw usage("checks must be a list of { check, ok, note? }: each check needs ok (true or false).");
  }
  const start = review.bestWindow?.startS;
  if (review.bestWindow != null && !(typeof start === "number" && start >= 0)) throw usage("bestWindow must be { startS }, seconds from the start of the take.");
  if (!text(take)) throw usage("Say which take this review judges (take).");
  const plan = readPlan(film);
  findShot(plan, shotId);
  const saved = {
    take,
    verdict: review.verdict,
    checks: review.checks.map((c) => ({ check: c.check.trim(), ok: c.ok, ...(text(c.note) ? { note: c.note.trim() } : {}) })),
    ...(review.bestWindow ? { bestWindow: { startS: start } } : {}),
    at: (now ? now() : new Date()).toISOString(),
  };
  withFilmLock(film, () => writeFilmJson(film, "reviews.json", { ...readReviews(film), [shotId]: saved }, { now }));
  return saved;
}
