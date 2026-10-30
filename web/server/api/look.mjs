// Read-only endpoints. Each one calls a cli/core view and turns paths into
// media URLs; none reserves or submits. /api/spend (like the event snapshot)
// calls store.sweep(), which settles abandoned records, so it can write.
import { loadCatalog } from "../../../cli/lib/models.mjs";
import { status, listModels, listPresets, estimate, listRuns, getRun } from "../../../cli/core/views.mjs";
import { context, jobView, spendView } from "../state.mjs";
import { mediaUrl } from "../media.mjs";

export function registerLook(router, { catalog = loadCatalog(), deps = {} } = {}) {
  router.get("/api/status", () => {
    const { store, limits } = context();
    return status(catalog, { store, limits, ...(deps.credits ? { credits: deps.credits } : {}) });
  });

  router.get("/api/models", ({ query }) => listModels(catalog, { capability: query.get("capability") || undefined }));

  router.get("/api/presets", () => listPresets(catalog));

  router.get("/api/runs", () => listRuns());

  router.get("/api/runs/:slug", ({ params }) => {
    const { store } = context();
    const { artifacts, jobs: _summaries, ...run } = getRun(params.slug, { store });
    return {
      ...run,
      media: artifacts.map(mediaUrl).filter(Boolean),
      jobs: store.list().filter((j) => j.run === params.slug).reverse().map(jobView),
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
      .map(jobView);
  });

  router.get("/api/spend", () => {
    const { store, limits } = context();
    store.sweep();
    return spendView(store, limits);
  });

  router.get("/api/library", () => context().library.list());

  router.get("/api/library/:name", ({ params }) => {
    const a = context().library.get(params.name);
    return { ...a, images: a.images.map(({ path, upload: _u, ...im }) => ({ ...im, url: mediaUrl(path) })) };
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
