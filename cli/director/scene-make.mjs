// A scene's prompt, prices and generation, shared by the studio and the MCP
// server so both make a scene the same way. Drafts are 480p with draft=true;
// finals re-run the same prompt and refs at 720p or 1080p.
import { copyFileSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { join, parse } from "node:path";
import { compileScene, DEFAULT_REF_TOKEN } from "./scene.mjs";
import { readScenes, addVersion } from "./scenes.mjs";
import { resolveModel } from "../lib/models.mjs";
import { RUNS_DIR, runDir, writeRecord } from "../lib/run.mjs";
import { estimate } from "../core/views.mjs";
import { checkLocalFile } from "../core/inputs.mjs";
import { expandRefs } from "../core/refs.mjs";
import { submitJob } from "../core/generate.mjs";
import { unknown } from "../lib/errors.mjs";

export const SCENE_MODEL = "seedance-2-5";
export const FINALS = ["720p", "1080p"];

export function findScene(film, id) {
  const scene = readScenes(film).scenes.find((s) => s.id === id);
  if (!scene) throw unknown(`No scene "${id}".`, { field: "id" });
  return scene;
}

const sceneModel = (catalog) => resolveModel(catalog, SCENE_MODEL, "video");

/** Width and height of a film's own picture, `<film>/refs/<file>`; null when unreadable (submit reports it). */
function sizeOf(path) {
  try {
    return checkLocalFile(join(RUNS_DIR, path), { kinds: ["image"] });
  } catch {
    return null;
  }
}

/** { prompt, refs, problems } for a scene, with pictures the model would refuse named. */
export function compileFor(catalog, film, scene, library) {
  const model = sceneModel(catalog);
  const route = model.routes.find((r) => r.provider === "kie");
  return compileScene(scene, {
    film,
    library,
    refToken: model.promptProfile?.refToken ?? DEFAULT_REF_TOKEN,
    limits: route?.input?.refLimits?.image ?? null,
    sizeOf,
  });
}

/** The draft and both finals' prices. */
export function scenePrices(catalog, scene, { store, limits }) {
  const price = (resolution, extra = {}) => {
    const r = estimate(
      catalog,
      { model: SCENE_MODEL, capability: "video", durationS: scene.durationS, resolution, aspectRatio: scene.ratio, refs: [], params: { generate_audio: true, ...extra } },
      { store, limits },
    );
    return { usd: r.estimateUsd ?? null, basis: r.basis ?? null };
  };
  return { draft: price("480p", { draft: true }), final720: price("720p"), final1080: price("1080p") };
}

/** A file name from a label: lowercase, odd characters as "-". */
export function safeStem(name) {
  const stem = parse(name).name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 60);
  return stem || "image";
}

/** A free name in `dir` for `stem` + `ext`: door.png, door-2.png, door-3.png… */
export function freeName(dir, stem, ext) {
  let file = `${stem}${ext}`;
  for (let n = 2; existsSync(join(dir, file)); n += 1) file = `${stem}-${n}${ext}`;
  return file;
}

/** Copy a checked local picture into the film's refs folder, never over another. Returns the scene source. */
export function addSceneImage(film, path, { roots, name }) {
  const info = checkLocalFile(path, { roots, kinds: ["image"] });
  const dir = join(runDir(film), "refs");
  mkdirSync(dir, { recursive: true });
  const file = freeName(realpathSync(dir), safeStem(name ?? parse(path).base), info.ext);
  copyFileSync(path, join(dir, file));
  return { source: `file:refs/${file}`, width: info.width ?? null, height: info.height ?? null };
}

/**
 * A draft or a final: compile, refuse on problems before anything is
 * reserved, submit, then record the version. `via` marks who sent it.
 */
export async function makeScene(catalog, film, id, kind, resolution, { store, limits, roots, library, upload, deps, via }) {
  if (kind === "final" && !FINALS.includes(resolution)) throw unknown(`A final is ${FINALS.join(" or ")}.`, { field: "resolution" });
  const scene = findScene(film, id);
  const { prompt, refs, problems } = compileFor(catalog, film, scene, library);
  if (problems.length) throw unknown(`Refused before submitting, nothing was spent. ${problems.join(" ")}`, { field: "scene", problems });

  const model = sceneModel(catalog);
  const params = kind === "draft" ? { draft: true, generate_audio: true } : { generate_audio: true };
  const dir = runDir(film);
  const promptFile = `${id}-prompt.txt`;
  const inputsFile = `${id}-inputs.json`;
  const expanded = await expandRefs(refs, { catalog, library, roots, baseDir: RUNS_DIR, upload });
  // Written only once a job exists, so an attempt refused by a limit never replaces an earlier take's record.
  const record = async () => {
    await writeRecord(dir, promptFile, prompt);
    await writeRecord(dir, inputsFile, { model: model.id, scene: id, kind, refs: expanded.refs, refMapping: expanded.refMapping, params, via });
  };

  let sub;
  try {
    sub = await submitJob(
      catalog,
      {
        capability: "video",
        model,
        run: film,
        artifactBase: `${id}-${kind}`,
        budgetUsd: null,
        only: null,
        values: { prompt, duration: scene.durationS, aspect_ratio: scene.ratio, resolution, refs: expanded.refs, params, _useI2v: false },
        record: { refMapping: expanded.refMapping, assets: expanded.assets, via },
      },
      { store, limits, deps },
    );
  } catch (err) {
    // An ambiguous create (code 5) left a job that may still produce a take: keep its record.
    if (err.localJobId) await record().catch(() => {});
    throw err;
  }
  // Submitted and paid for: nothing after this may throw, or the caller loses the job id.
  const warnings = [];
  try {
    await record();
  } catch (err) {
    warnings.push(`Could not write ${promptFile} and ${inputsFile} in ${film} (${err.message}); the job is submitted.`);
  }
  for (const name of expanded.assets) {
    try {
      library.recordUse(name, film);
    } catch (err) {
      warnings.push(`Could not record that asset "${name}" was used in ${film} (${err.message}); the job is submitted.`);
    }
  }
  let saved = scene;
  try {
    saved = addVersion(film, id, { job: sub.job.id, kind, resolution, prompt, createdAt: new Date().toISOString() });
  } catch (err) {
    warnings.push(`Could not add ${sub.job.id} to ${id}'s versions (${err.message}); the job is submitted.`);
  }
  return { job: sub.job, estimateUsd: sub.estimateUsd, basis: sub.basis, refMapping: expanded.refMapping, warnings, scene: saved };
}
