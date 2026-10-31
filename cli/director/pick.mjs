import { loadMenu, entry } from "./menu.mjs";
import { shotFit, stillFit, takesReferences } from "./fit.mjs";
import { shotWording } from "./wording.mjs";

const TIER_ORDER = { S: 0, A: 1 };

/** Why a model cannot take the shot, in words for Alex rather than for the request builder. */
const whyNot = (id, problem) =>
  /No captured contract/.test(problem) ? `${id} cannot start from a still yet: its image-to-video input has not been captured.` : problem;

/** The first reason the shot's wording breaks this model's prompt limit, or null. */
function wordingProblem(catalog, plan, shot, menu, assets) {
  try {
    return shotWording(catalog, plan, shot, { menu, assets }).problems[0] ?? null;
  } catch {
    return null; // a shot too incomplete to word is the checker's to report
  }
}

/** Video models rated for a job, best tier first, then cheapest for this shot. */
function candidates(catalog, ratings, shot, aspectRatio) {
  return catalog.list
    .filter((m) => m.capability === "video" && m.goodFor?.[ratings])
    .map((m) => ({ id: m.id, tier: m.goodFor[ratings], fit: shotFit(catalog, m.id, { plannedS: shot.durationS, aspectRatio }) }))
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || (a.fit.estimateUsd ?? Infinity) - (b.fit.estimateUsd ?? Infinity));
}

/**
 * The model to film one shot on. Alex's ratings (`goodFor` in models.json) give
 * the order; a model that cannot take the shot (length, ratio, no first-frame
 * contract, or, given the plan, wording longer than its prompt limit) is ruled
 * out with the reason. When nothing rated for the shot's job fits, the best
 * cinematic model is the fallback, and the reason says so.
 */
export function suggestModel(catalog, shot, { brief = null, plan = null, assets = [], menu = loadMenu() } = {}) {
  const job = entry(menu, "jobs", shot.job);
  const lists = [job.ratings ?? job.id];
  if (lists[0] !== "cinematic") lists.push("cinematic");
  const ruledOut = [];
  for (const ratings of lists) {
    for (const c of candidates(catalog, ratings, shot, brief?.aspectRatio)) {
      if (ruledOut.some((r) => r.model === c.id)) continue;
      const problem = c.fit.problems[0] ?? (plan ? wordingProblem(catalog, plan, { ...shot, model: c.id }, menu, assets) : null);
      if (problem) {
        ruledOut.push({ model: c.id, tier: c.tier, why: whyNot(c.id, problem) });
        continue;
      }
      const label = ratings === job.id ? job.label : entry(menu, "jobs", ratings).label;
      const fallback = ratings !== lists[0];
      return {
        model: c.id,
        tier: c.tier,
        ratings,
        reason: fallback
          ? `Nothing rated for ${job.label} can take this shot, so the best ${label.toLowerCase()} model: ${c.id} (${c.tier} tier).`
          : `${c.tier} tier for ${label.toLowerCase()}.`,
        generatedS: c.fit.generatedS,
        estimateUsd: c.fit.estimateUsd,
        ruledOut,
      };
    }
  }
  return { model: null, tier: null, ratings: null, reason: `No rated model can take this shot.`, generatedS: null, estimateUsd: null, ruledOut };
}

const EXACT = ["gpt-image-2-5", "GPT Image 2.5", "keeps screens and products exact."];
const CAST = ["nano-banana-2", "Nano Banana 2"];
const STILL_BY_FILM = {
  "product-ui": EXACT,
  "product-hero": EXACT,
  "live-action": ["nano-banana-2", "Nano Banana 2", "for photoreal people and places."],
  character: ["seedream-5-pro", "Seedream 5 Pro", "for a stylised look."],
};

/**
 * The image model for a shot's still: exact screens and products, photoreal, or
 * stylised. Given the catalog, a model that cannot make the film's aspect ratio
 * gives way to GPT Image 2.5, which makes the most, and a shot with a cast
 * moves to Nano Banana 2 when its model cannot take the cast's reference sheets.
 */
export function suggestStillModel(shot, { brief = null, catalog = null } = {}) {
  const [model, name, why] = shot.job === "motion-graphics" ? EXACT : STILL_BY_FILM[brief?.filmType] ?? EXACT;
  const ratio = brief?.aspectRatio;
  if (catalog && ratio && model !== EXACT[0] && stillFit(catalog, model, { aspectRatio: ratio }).problems.length) {
    return { model: EXACT[0], reason: `${name} makes no ${ratio} stills, so ${EXACT[1]}, which does.` };
  }
  if (catalog && shot.cast?.length && !takesReferences(catalog, model)) {
    return { model: CAST[0], reason: `${name} takes no reference images, so ${CAST[1]}, which keeps the cast from their sheets.` };
  }
  return { model, reason: `${name} ${why}` };
}
