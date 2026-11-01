// Scenes: one Seedance 2.5 reference-to-video generation each. The making
// itself lives in cli/director/scene-make.mjs, shared with the MCP server.
import { mkdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readScenes, saveScene, deleteScene, orderScenes, chooseVersion } from "../../../cli/director/scenes.mjs";
import { compileFor, scenePrices, makeScene, findScene, safeStem, freeName, FINALS } from "../../../cli/director/scene-make.mjs";
import { runDir } from "../../../cli/lib/run.mjs";
import { uploadFile } from "../../../cli/lib/upload.mjs";
import { checkLocalFile, MAX_BYTES } from "../../../cli/core/inputs.mjs";
import { HttpError } from "../http.mjs";
import { context, jobView } from "../state.mjs";
import { label, saveBody } from "./library.mjs";
import * as f from "./fields.mjs";

/** A film slug from the path, checked the way a run field is. `create` is Create's own run. */
const slugOf = (params) => f.run({ run: params.slug });

export function registerScenes(router, { catalog, deps = {}, follower, maxUploadBytes = MAX_BYTES.image }) {
  const upload = deps.upload ?? ((path, opts) => uploadFile(catalog, path, opts));

  /** The stored scene with each version's job state, media and cost. */
  function sceneView(scene) {
    const { store } = context();
    return {
      ...scene,
      versions: scene.versions.map((v) => {
        let job = null;
        try {
          job = jobView(store.get(v.job), follower.has);
        } catch {
          // a version whose job record is gone still shows
        }
        return { ...v, state: job?.state ?? null, media: job?.media?.[0] ?? null, estimateUsd: job?.estimateUsd ?? null, actualUsd: job?.actualUsd ?? null };
      }),
    };
  }

  router.get("/api/films/:slug/scenes", ({ params }) => {
    const slug = slugOf(params);
    const data = readScenes(slug);
    return { idea: data.idea ?? null, scenes: data.scenes.map(sceneView) };
  });

  router.post("/api/films/:slug/scenes", ({ params, body = {} }) => sceneView(saveScene(slugOf(params), { ...body, id: undefined })));

  // Before ":id", or "order" would be read as a scene.
  router.put("/api/films/:slug/scenes/order", ({ params, body = {} }) => {
    if (!Array.isArray(body.ids) || !body.ids.every((i) => typeof i === "string")) throw f.invalid("ids", "ids must be a list of scene ids.");
    orderScenes(slugOf(params), body.ids);
    return { ok: true };
  });

  router.put("/api/films/:slug/scenes/:id", ({ params, body = {} }) => sceneView(saveScene(slugOf(params), { ...body, id: params.id })));

  router.delete("/api/films/:slug/scenes/:id", ({ params }) => {
    deleteScene(slugOf(params), params.id);
    return { ok: true };
  });

  router.get("/api/films/:slug/scenes/:id/prompt", ({ params }) => {
    const slug = slugOf(params);
    const scene = findScene(slug, params.id);
    const { store, limits, library } = context();
    const { prompt, refs, problems } = compileFor(catalog, slug, scene, library);
    return { prompt, refs, problems, prices: scenePrices(catalog, scene, { store, limits }) };
  });

  /** A draft or a final, followed in the background so the page hears when it lands. */
  async function make(slug, id, kind, resolution) {
    const { store, limits, roots, library } = context();
    const r = await makeScene(catalog, slug, id, kind, resolution, { store, limits, roots, library, upload, deps: deps.generate, via: "studio" });
    follower.follow(r.job.id);
    const job = jobView(r.job, follower.has);
    return {
      localJobId: r.job.id,
      upstreamTaskId: r.job.upstreamTaskId == null ? null : String(r.job.upstreamTaskId),
      state: r.job.state,
      provider: r.job.provider,
      providerModel: r.job.providerModel,
      failedOver: Boolean(r.job.failedOver),
      estimateUsd: r.estimateUsd,
      basis: r.basis,
      refMapping: r.refMapping,
      warnings: r.warnings,
      job,
      scene: sceneView(r.scene),
    };
  }

  router.post("/api/films/:slug/scenes/:id/draft", ({ params }) => make(slugOf(params), params.id, "draft", "480p"));

  router.post("/api/films/:slug/scenes/:id/final", ({ params, body = {} }) => {
    const slug = slugOf(params);
    const resolution = f.text(body, "resolution");
    if (!FINALS.includes(resolution)) throw f.invalid("resolution", `A final is ${FINALS.join(" or ")}.`);
    return make(slug, params.id, "final", resolution);
  });

  router.post("/api/films/:slug/scenes/:id/choose", ({ params, body = {} }) => {
    const slug = slugOf(params);
    return sceneView(chooseVersion(slug, params.id, f.text(body, "job", { required: true })));
  });

  router.post(
    "/api/films/:slug/refs",
    async ({ params, req, query }) => {
      const slug = slugOf(params);
      const name = label(query.get("name") ?? req.headers["x-file-name"]);
      const dir = join(runDir(slug), "refs");
      mkdirSync(dir, { recursive: true });
      const root = realpathSync(dir);
      const part = join(root, `upload-${process.pid}-${Date.now()}.part`);
      let size;
      try {
        size = await saveBody(req, part, maxUploadBytes);
      } catch (err) {
        rmSync(part, { force: true });
        throw err;
      }
      if (size > maxUploadBytes) {
        rmSync(part, { force: true });
        throw new HttpError(413, `${name} is over ${Math.round(maxUploadBytes / 1e6)} MB; nothing was saved.`);
      }
      if (size === 0) {
        rmSync(part, { force: true });
        throw f.invalid("file", `${name} is empty.`);
      }
      let info;
      try {
        info = checkLocalFile(part, { roots: [root], kinds: ["image"] });
      } catch (err) {
        rmSync(part, { force: true });
        err.message = err.message.replaceAll(part, name);
        err.field = "file";
        throw err;
      }
      // Never overwrite: door.png, door-2.png, door-3.png…
      const file = freeName(root, safeStem(name), info.ext);
      renameSync(part, join(root, file));
      return { source: `file:refs/${file}` };
    },
    { raw: true },
  );
}
