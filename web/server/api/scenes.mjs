// Scenes: one Seedance 2.5 reference-to-video generation each. The making
// itself lives in cli/director/scene-make.mjs, shared with the MCP server.
import { mkdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readScenes, saveScene, saveIdea, deleteScene, orderScenes, chooseVersion } from "../../../cli/director/scenes.mjs";
import { copyScene, versionFile } from "../../../cli/director/scene-copy.mjs";
import { compileFor, scenePrices, makeScene, findScene, safeStem, freeName, FINALS } from "../../../cli/director/scene-make.mjs";
import { SCRATCH_RUN, runDir } from "../../../cli/lib/run.mjs";
import { uploadFile } from "../../../cli/lib/upload.mjs";
import { checkLocalFile, MAX_BYTES } from "../../../cli/core/inputs.mjs";
import { HttpError } from "../http.mjs";
import { context, jobView } from "../state.mjs";
import { mediaUrl } from "../media.mjs";
import { label, saveBody } from "./library.mjs";
import * as f from "./fields.mjs";

/** A film slug from the path, checked the way a run field is. `create` is Create's own run. */
const slugOf = (params) => f.run({ run: params.slug });

export function registerScenes(router, { catalog, deps = {}, follower, maxUploadBytes = MAX_BYTES.image }) {
  const upload = deps.upload ?? ((path, opts) => uploadFile(catalog, path, opts));

  /** The stored scene with each version's job state, media and cost. A version copied from Create plays its own copy. */
  function sceneView(slug, scene) {
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
        const own = v.file ? versionFile(slug, v, store) : null;
        const media = own ? mediaUrl(own) : (job?.media?.[0] ?? null);
        return { ...v, state: job?.state ?? (own ? "succeeded" : null), media, estimateUsd: job?.estimateUsd ?? null, actualUsd: job?.actualUsd ?? null };
      }),
    };
  }

  router.get("/api/films/:slug/scenes", ({ params }) => {
    const slug = slugOf(params);
    const data = readScenes(slug);
    return { idea: data.idea ?? null, scenes: data.scenes.map((s) => sceneView(slug, s)) };
  });

  /** The idea and, optionally, a scene list (titles and lengths). With create, Home starts a film: 409 when the name is taken. */
  router.put("/api/films/:slug/idea", ({ params, body = {} }) => {
    const slug = slugOf(params);
    if (slug === SCRATCH_RUN) throw f.invalid("slug", "Create's scratch scenes have no idea; save a scene into a film first.");
    let data;
    try {
      data = saveIdea(slug, body.idea, { scenes: body.scenes ?? null, create: body.create === true });
    } catch (err) {
      if (err?.exists) throw new HttpError(409, err.message, { exists: true });
      throw err;
    }
    return { idea: data.idea, scenes: data.scenes.map((s) => sceneView(slug, s)) };
  });

  router.post("/api/films/:slug/scenes", ({ params, body = {} }) => {
    const slug = slugOf(params);
    return sceneView(slug, saveScene(slug, { ...body, id: undefined }));
  });

  // Before ":id", or "order" would be read as a scene.
  router.put("/api/films/:slug/scenes/order", ({ params, body = {} }) => {
    if (!Array.isArray(body.ids) || !body.ids.every((i) => typeof i === "string")) throw f.invalid("ids", "ids must be a list of scene ids.");
    orderScenes(slugOf(params), body.ids);
    return { ok: true };
  });

  router.put("/api/films/:slug/scenes/:id", ({ params, body = {} }) => {
    const slug = slugOf(params);
    return sceneView(slug, saveScene(slug, { ...body, id: params.id }));
  });

  /** Save into film: the scene, its pictures and its versions' videos copied into another film (made if new). */
  router.post("/api/films/:slug/scenes/:id/copy", ({ params, body = {} }) => {
    const slug = slugOf(params);
    const to = f.run({ run: f.text(body, "to", { required: true }) });
    if (to === SCRATCH_RUN) throw f.invalid("to", "Choose a film to save the scene into.");
    const scene = copyScene(slug, params.id, to, { store: context().store });
    return { film: to, scene: sceneView(to, scene) };
  });

  router.delete("/api/films/:slug/scenes/:id", ({ params }) => {
    deleteScene(slugOf(params), params.id);
    return { ok: true };
  });

  router.get("/api/films/:slug/scenes/:id/prompt", ({ params }) => {
    const slug = slugOf(params);
    const scene = findScene(slug, params.id);
    const { store, limits, library } = context();
    const compiled = compileFor(catalog, slug, scene, library);
    const { prompt, refs, problems, voices } = compiled;
    return { prompt, refs, problems, voices, prices: scenePrices(catalog, scene, { store, limits, compiled }) };
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
      scene: sceneView(slug, r.scene),
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
    return sceneView(slug, chooseVersion(slug, params.id, f.text(body, "job", { required: true })));
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
