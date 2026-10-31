import { budget, usage } from "../lib/errors.mjs";
import { UNSETTLED, countedUsd } from "../core/jobs.mjs";
import { loadMenu } from "./menu.mjs";
import { readFilmJson, writeFilmJson } from "./files.mjs";
import { readPlan, findShot } from "./plan.mjs";
import { readBrief } from "./brief.mjs";
import { shotMedia } from "./media.mjs";
import { shotFit } from "./fit.mjs";
import { readReviews } from "./review.mjs";
import { filmShot } from "./film.mjs";

/** Redos a shot gets on its own; a third is Alex's call. */
export const MAX_REDOS = 2;

const money = (usd) => `$${usd.toFixed(2)}`;

/** The film's production settings: auto-redo, and the total its takes may cost with redos. */
export const readProduction = (film) => ({ autoRedo: false, maxUsd: null, ...(readFilmJson(film, "production.json", { ifInvalid: {} }) ?? {}) });

/**
 * Switch auto-redo on or off. On needs `maxUsd`: the most the film's takes may
 * cost in all, first takes and redos together, so redos stop at a total Alex
 * named rather than one worked out for him.
 */
export function saveProduction(film, { autoRedo, maxUsd } = {}, opts = {}) {
  if (typeof autoRedo !== "boolean") throw usage("autoRedo must be true or false.");
  if (autoRedo && !(typeof maxUsd === "number" && Number.isFinite(maxUsd) && maxUsd > 0)) {
    throw usage("Auto-redo needs max_usd (--max-usd): the most this film's takes may cost in all, redos included.");
  }
  if (!readPlan(film)) throw usage(`runs/${film} has no plan yet.`);
  const next = autoRedo ? { autoRedo, maxUsd: Math.round(maxUsd * 100) / 100 } : { autoRedo: false, maxUsd: null };
  writeFilmJson(film, "production.json", next, opts);
  return next;
}

/** What the film's takes have cost so far: the charge where known, else the estimate; takes that failed free count nothing. */
export function takesSpentUsd(store, film) {
  const usd = store.list().filter((j) => j.run === film && j.stage === "take").reduce((t, j) => t + countedUsd(j), 0);
  return Math.round(usd * 100) / 100;
}

/**
 * Refilm a shot whose take in use was judged a redo, within the film's
 * auto-redo limits: at most MAX_REDOS redos per shot, and the takes' total
 * spend (with this one) within production.maxUsd. Anything outside those is
 * refused with the reason; Film again stays for Alex.
 */
export async function redoShot(catalog, film, shotId, ctx) {
  const { store, library, menu = loadMenu() } = ctx;
  const plan = readPlan(film);
  if (!plan) throw usage(`runs/${film} has no plan yet.`);
  const shot = findShot(plan, shotId);
  const production = readProduction(film);
  if (!production.autoRedo) throw usage(`Auto-redo is off for ${film}.`);
  const brief = readBrief(film);
  const m = shotMedia(store, film, plan, { assets: library?.list?.() ?? [], brief, menu })[shot.id];
  const review = readReviews(film)[shot.id];
  if (!m.take || review?.take !== m.take || review.verdict !== "redo") throw usage(`${shot.id}'s take in use has no redo verdict.`);
  if (m.takes.some((t) => UNSETTLED.has(t.state))) throw usage(`${shot.id} is already being filmed.`);
  const tries = m.takes.filter((t) => t.state !== "failed-confirmed-free").length;
  if (tries > MAX_REDOS) throw usage(`${shot.id} has been filmed ${tries} times; auto-redo stops at ${MAX_REDOS} redos. Another is Alex's call (Film again).`);
  const estimateUsd = shotFit(catalog, shot.model, { plannedS: shot.durationS, aspectRatio: brief?.aspectRatio }).estimateUsd ?? 0;
  const spent = takesSpentUsd(store, film);
  if (spent + estimateUsd > production.maxUsd + 0.005) {
    throw budget(`Redoing ${shot.id} (about ${money(estimateUsd)}) would take the film's takes to ${money(spent + estimateUsd)}, over the ${money(production.maxUsd)} set for auto-redo.`);
  }
  const sub = await filmShot(catalog, film, shot.id, ctx);
  return { ...sub, redo: tries };
}

/**
 * After a review is saved: with auto-redo on and a redo verdict, refilm the
 * shot if the limits allow. Never throws for a limit; it says why it held back.
 */
export async function afterReview(catalog, film, shotId, saved, ctx) {
  if (saved.verdict !== "redo" || !readProduction(film).autoRedo) return null;
  try {
    const sub = await redoShot(catalog, film, shotId, ctx);
    return { submitted: true, shot: sub.shot, jobId: sub.job?.id ?? null, dryRun: Boolean(sub.dryRun), estimateUsd: sub.estimateUsd, model: sub.model, redo: sub.redo };
  } catch (err) {
    if (err.localJobId) throw err; // submitted but uncertain: not a limit, the caller must see it
    return { submitted: false, shot: shotId, reason: err.message };
  }
}
