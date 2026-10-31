import { loadMenu, entry } from "./menu.mjs";
import { shotFit } from "./fit.mjs";

const TIER_ORDER = { S: 0, A: 1 };

/** Why a model cannot take the shot, in words for Alex rather than for the request builder. */
const whyNot = (id, problem) =>
  /No captured contract/.test(problem) ? `${id} cannot start from a still yet: its image-to-video input has not been captured.` : problem;

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
 * contract) is ruled out with the reason. When nothing rated for the shot's job
 * fits, the best cinematic model is the fallback, and the reason says so.
 */
export function suggestModel(catalog, shot, { brief = null, menu = loadMenu() } = {}) {
  const job = entry(menu, "jobs", shot.job);
  const lists = [job.ratings ?? job.id];
  if (lists[0] !== "cinematic") lists.push("cinematic");
  const ruledOut = [];
  for (const ratings of lists) {
    for (const c of candidates(catalog, ratings, shot, brief?.aspectRatio)) {
      if (ruledOut.some((r) => r.model === c.id)) continue;
      if (c.fit.problems.length) {
        ruledOut.push({ model: c.id, tier: c.tier, why: whyNot(c.id, c.fit.problems[0]) });
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

const STILL_BY_FILM = {
  "product-ui": ["gpt-image-2-5", "GPT Image 2.5 keeps screens and products exact."],
  "product-hero": ["gpt-image-2-5", "GPT Image 2.5 keeps screens and products exact."],
  "live-action": ["nano-banana-2", "Nano Banana 2 for photoreal people and places."],
  character: ["seedream-5-pro", "Seedream 5 Pro for a stylised look."],
};

/** The image model for a shot's still: exact screens and products, photoreal, or stylised. */
export function suggestStillModel(shot, { brief = null } = {}) {
  const [model, reason] =
    shot.job === "motion-graphics" ? STILL_BY_FILM["product-ui"] : STILL_BY_FILM[brief?.filmType] ?? STILL_BY_FILM["product-ui"];
  return { model, reason };
}
