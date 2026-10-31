import { resolveModel } from "../lib/models.mjs";
import { planJob } from "../core/views.mjs";

/** Seconds generated beyond the planned length, so the edit can drop a sluggish start. */
export const PAD_S = 1;

/** The shortest length the model makes that covers the shot plus the pad, or null. */
export function generatedLength(model, plannedS) {
  const want = plannedS + PAD_S;
  const fits = (model.durationsS ?? []).filter((d) => d >= want).sort((a, b) => a - b);
  return fits[0] ?? null;
}

/**
 * Can this video model film this shot from its still? Every reason it cannot,
 * the length it would generate and the price, without reading any spending state.
 */
export function shotFit(catalog, modelId, { plannedS, aspectRatio }) {
  let model;
  try {
    model = resolveModel(catalog, modelId, "video");
  } catch (e) {
    return { model: modelId ?? null, generatedS: null, estimateUsd: null, basis: null, problems: [e.message] };
  }
  const generatedS = generatedLength(model, plannedS);
  if (generatedS == null) {
    const longest = Math.max(...(model.durationsS ?? [0]));
    return {
      model: model.id,
      generatedS: null,
      estimateUsd: null,
      basis: null,
      problems: [`${model.id} makes at most ${longest}s; this shot needs ${plannedS + PAD_S}s including the ${PAD_S}s trim margin.`],
    };
  }
  const job = planJob(catalog, { model: model.id, capability: "video", durationS: generatedS, aspectRatio, refs: [{ role: "first_frame" }] });
  return { model: model.id, generatedS, estimateUsd: job.est?.usd ?? null, basis: job.est?.basis ?? null, problems: job.problems };
}

/** Whether an image model's route maps reference images (identity and style) to an input. */
export const takesReferences = (catalog, modelId) =>
  planJob(catalog, { model: modelId, capability: "image", refs: [{ role: "identity" }, { role: "style" }] }).problems.length === 0;

/** The same for the still: an image model at the film's aspect ratio. */
export function stillFit(catalog, modelId, { aspectRatio }) {
  try {
    const job = planJob(catalog, { model: modelId, capability: "image", aspectRatio });
    const ratios = job.model.aspectRatios ?? [];
    const problems = [...job.problems];
    if (aspectRatio && ratios.length && !ratios.includes(aspectRatio)) problems.push(`${job.model.id} makes ${ratios.join(", ")}, not ${aspectRatio}.`);
    return { model: job.model.id, estimateUsd: job.est?.usd ?? null, problems };
  } catch (e) {
    return { model: modelId ?? null, estimateUsd: null, problems: [e.message] };
  }
}
