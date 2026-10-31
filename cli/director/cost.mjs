import { shotFit, stillFit } from "./fit.mjs";
import { dailyPosition } from "../core/spend.mjs";

const round = (n) => Math.round(n * 1000) / 1000;

/**
 * What the plan would cost: one still and one take per shot, at the length
 * each shot is generated. Reads today's position when a store is given;
 * reserves nothing and calls no provider.
 */
export function costPlan(catalog, plan, { brief = null, store = null, limits = null } = {}) {
  const shots = (plan?.shots ?? []).map((s) => {
    const still = s.stillModel ? stillFit(catalog, s.stillModel, { aspectRatio: brief?.aspectRatio }) : null;
    const take = s.model && s.durationS > 0 ? shotFit(catalog, s.model, { plannedS: s.durationS, aspectRatio: brief?.aspectRatio }) : null;
    return {
      id: s.id,
      stillModel: s.stillModel ?? null,
      stillUsd: still?.estimateUsd ?? null,
      model: s.model ?? null,
      generatedS: take?.generatedS ?? null,
      takeUsd: take?.estimateUsd ?? null,
    };
  });
  const sum = (k) => round(shots.reduce((t, s) => t + (s[k] ?? 0), 0));
  const stillsUsd = sum("stillUsd");
  const filmUsd = sum("takeUsd");
  const priced = shots.every((s) => s.stillUsd != null && s.takeUsd != null);
  const today = store && limits ? dailyPosition(store, limits) : null;
  return {
    shots,
    stillsUsd,
    filmUsd,
    totalUsd: round(stillsUsd + filmUsd),
    complete: priced,
    availableTodayUsd: today?.availableUsd ?? null,
  };
}
