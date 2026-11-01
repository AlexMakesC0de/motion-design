// Scenes: one Seedance 2.5 reference-to-video generation each. Drafts at 480p
// with draft=true; finals re-run the same prompt and refs at 720p or 1080p.
import { existsSync, mkdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import { join, parse } from "node:path";
import { readScenes, saveScene, deleteScene, orderScenes, addVersion, chooseVersion } from "../../../cli/director/scenes.mjs";
import { compileScene, DEFAULT_REF_TOKEN } from "../../../cli/director/scene.mjs";
import { resolveModel } from "../../../cli/lib/models.mjs";
import { runDir, RUNS_DIR } from "../../../cli/lib/run.mjs";
import { estimate } from "../../../cli/core/views.mjs";
import { checkLocalFile, MAX_BYTES } from "../../../cli/core/inputs.mjs";
import { unknown } from "../../../cli/lib/errors.mjs";
import { HttpError } from "../http.mjs";
import { context, jobView } from "../state.mjs";
import { createSubmitter } from "./generate.mjs";
import { label, saveBody } from "./library.mjs";
import * as f from "./fields.mjs";

const MODEL = "seedance-2-5";
const FINALS = ["720p", "1080p"];

/** A film slug from the path, checked the way a run field is. `create` is Create's own run. */
const slugOf = (params) => f.run({ run: params.slug });

/** A file name from the client's label: lowercase, odd characters as "-". */
function safeStem(name) {
  const stem = parse(name).name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 60);
  return stem || "image";
}

export function registerScenes(router, { catalog, deps = {}, follower, maxUploadBytes = MAX_BYTES.image }) {
  const submit = createSubmitter({ catalog, deps, follower });
  const model = () => resolveModel(catalog, MODEL, "video");

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

  const findScene = (slug, id) => {
    const scene = readScenes(slug).scenes.find((s) => s.id === id);
    if (!scene) throw unknown(`No scene "${id}".`, { field: "id" });
    return scene;
  };

  /** Width and height of a film's own picture, `<slug>/refs/<file>`; null when unreadable (submit reports it). */
  const sizeOf = (path) => {
    try {
      return checkLocalFile(join(RUNS_DIR, path), { kinds: ["image"] });
    } catch {
      return null;
    }
  };

  const compile = (slug, scene) => {
    const route = model().routes.find((r) => r.provider === "kie");
    return compileScene(scene, {
      film: slug,
      library: context().library,
      refToken: model().promptProfile?.refToken ?? DEFAULT_REF_TOKEN,
      limits: route?.input?.refLimits?.image ?? null,
      sizeOf,
    });
  };

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
    const { prompt, refs, problems } = compile(slug, scene);
    const { store, limits } = context();
    const price = (resolution, extra = {}) => {
      const r = estimate(
        catalog,
        { model: MODEL, capability: "video", durationS: scene.durationS, resolution, aspectRatio: scene.ratio, refs: [], params: { generate_audio: true, ...extra } },
        { store, limits },
      );
      return { usd: r.estimateUsd ?? null, basis: r.basis ?? null };
    };
    return { prompt, refs, problems, prices: { draft: price("480p", { draft: true }), final720: price("720p"), final1080: price("1080p") } };
  });

  /** A draft or a final: compile, refuse on problems, submit, then record the version. */
  async function make(slug, id, kind, resolution, params) {
    const scene = findScene(slug, id);
    const { prompt, refs, problems } = compile(slug, scene);
    if (problems.length) throw unknown(`Refused before submitting, nothing was spent. ${problems.join(" ")}`, { field: "scene", problems });
    const r = await submit(
      "video",
      model(),
      { run: slug, prompt, refs, params, budget_usd: null, provider: null },
      { prompt, duration: scene.durationS, aspect_ratio: scene.ratio, resolution },
      { promptFile: `${id}-prompt.txt`, inputsFile: `${id}-inputs.json`, artifactBase: `${id}-${kind}`, useI2v: () => false, extra: { scene: id, kind } },
    );
    const saved = addVersion(slug, id, { job: r.localJobId, kind, resolution, prompt, createdAt: new Date().toISOString() });
    return { ...r, scene: sceneView(saved) };
  }

  router.post("/api/films/:slug/scenes/:id/draft", ({ params }) => make(slugOf(params), params.id, "draft", "480p", { draft: true, generate_audio: true }));

  router.post("/api/films/:slug/scenes/:id/final", ({ params, body = {} }) => {
    const slug = slugOf(params);
    const resolution = f.text(body, "resolution");
    if (!FINALS.includes(resolution)) throw f.invalid("resolution", `A final is ${FINALS.join(" or ")}.`);
    return make(slug, params.id, "final", resolution, { generate_audio: true });
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
      const stem = safeStem(name);
      let file = `${stem}${info.ext}`;
      for (let n = 2; existsSync(join(root, file)); n += 1) file = `${stem}-${n}${info.ext}`;
      renameSync(part, join(root, file));
      return { source: `file:refs/${file}` };
    },
    { raw: true },
  );
}
