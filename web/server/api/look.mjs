// Read-only endpoints. Each one calls a cli/core view and turns paths into
// media URLs; none reserves or submits. /api/spend (like the event snapshot)
// calls store.sweep(), which settles abandoned records, so it can write.
import { loadCatalog, routesFor } from "../../../cli/lib/models.mjs";
import { status, listModels, estimate, listRuns, getRun } from "../../../cli/core/views.mjs";
import { context, jobView, spendView } from "../state.mjs";
import { mediaUrl } from "../media.mjs";

export function registerLook(router, { catalog = loadCatalog(), deps = {}, following } = {}) {
  const view = (j) => jobView(j, following);
  router.get("/api/status", () => {
    const { store, limits } = context();
    return status(catalog, { store, limits, ...(deps.credits ? { credits: deps.credits } : {}) });
  });

  router.get("/api/models", ({ query }) =>
    listModels(catalog, { capability: query.get("capability") || undefined }).map((m) => ({ ...m, ...resolutionChoices(catalog, m) })),
  );

  router.get("/api/runs", () => listRuns());

  router.get("/api/runs/:slug", ({ params }) => {
    const { store } = context();
    const { artifacts, jobs: _summaries, ...run } = getRun(params.slug, { store });
    return {
      ...run,
      media: artifacts.map(mediaUrl).filter(Boolean),
      jobs: store.list().filter((j) => j.run === params.slug).reverse().map(view),
    };
  });

  router.get("/api/jobs", ({ query }) => {
    const { store } = context();
    const run = query.get("run");
    const limit = Math.min(Number(query.get("limit")) || 200, 1000);
    return store
      .list()
      .filter((j) => !run || j.run === run)
      .reverse()
      .slice(0, limit)
      .map(view);
  });

  router.get("/api/spend", () => {
    const { store, limits } = context();
    store.sweep();
    return spendView(store, limits);
  });

  router.post("/api/estimate", ({ body = {} }) => {
    const { store, limits } = context();
    return estimate(
      catalog,
      {
        model: body.model,
        durationS: body.durationS,
        resolution: body.resolution,
        aspectRatio: body.aspectRatio,
        refs: body.refs ?? [],
        params: body.params ?? {},
        budgetUsd: body.budgetUsd,
        provider: body.provider,
      },
      { store, limits },
    );
  });
}

/**
 * Resolution choices for the prompt bar's chip. listModels carries image
 * models' resolutions; a video model keeps its list on each route's captured
 * contract, so this reads the first usable route's enum (the route submitJob
 * tries first), falling back to the resolutions it has prices for.
 */
export function resolutionChoices(catalog, m) {
  if (m.resolutions.length) return { resolutionOptions: m.resolutions, defaultResolution: null };
  const model = catalog.list.find((x) => x.id === m.id);
  const route = routesFor(catalog, model).find((r) => r.usable) ?? null;
  const options = route?.input?.enums?.resolution ?? Object.keys(route?.pricing?.usdPerSecond ?? {});
  const fallback = route?.input?.defaults?.resolution;
  return { resolutionOptions: options.map(String), defaultResolution: fallback != null ? String(fallback) : null };
}
