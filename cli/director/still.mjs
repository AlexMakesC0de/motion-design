import { createHash } from "node:crypto";
import { RUNS_DIR, runDir, writeRecord } from "../lib/run.mjs";
import { resolveModel } from "../lib/models.mjs";
import { usage } from "../lib/errors.mjs";
import { takesReferences } from "./fit.mjs";
import { expandRefs } from "../core/refs.mjs";
import { submitJob } from "../core/generate.mjs";
import { loadMenu, entry } from "./menu.mjs";
import { readBrief } from "./brief.mjs";
import { readPlan, findShot } from "./plan.mjs";
import { checkPlan } from "./check.mjs";
import { shotMedia } from "./media.mjs";

const FILM = {
  "product-ui": "a product film",
  "live-action": "a live-action film",
  character: "an animated character film",
  "product-hero": "a product commercial",
};
const REFS_LINE = "Keep every person and product exactly as in the reference images, and match the style reference's colour, light and grain.";

const trim = (s) => String(s ?? "").trim().replace(/[.\s]+$/, "");
const lower = (s) => (s ? `${s[0].toLowerCase()}${s.slice(1)}` : s);

/**
 * The still is the shot's first frame, so it is worded as a photograph of the
 * moment the action starts: the look, the framing from the menu, the cast in
 * their Library words, the light. `sha` hashes everything but the references
 * line, so the storyboard can tell a still made before the shot changed.
 */
export function stillWording(plan, shot, { assets = [], brief = null, menu = loadMenu(), withRefs = false } = {}) {
  const look = plan.look ?? {};
  const pick = (group, id) => entry(menu, group, id);
  const cast = (shot.cast ?? []).map((name) => assets.find((a) => a.name === name)?.description).filter(Boolean).map(trim);
  const lines = [
    `A single frame from ${FILM[brief?.filmType] ?? "a film"}: the first frame of this shot.`,
    `Look: ${trim(look.filmLook)}, ${trim(look.palette)}, ${trim(look.grade)}, ${pick("lensLooks", look.lensFamily).words} lenses.`,
    `Frame: ${[pick("sizes", shot.size).words, pick("angles", shot.angle).words, pick("lenses", shot.lens).words, pick("depths", shot.depth).words].join(", ")}.`,
    cast.length ? `Subject: ${cast.join("; ")}.` : "",
    `Moment: the start of this action: ${trim(shot.action)}.`,
    `Light: ${lower(trim(pick("lights", shot.light).words))}, key light from the ${shot.keyLightSide ?? look.keyLightSide}.`,
    "No text, captions, logos or watermarks.",
  ].filter(Boolean);
  const sha = createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 12);
  if (withRefs) lines.splice(lines.length - 1, 0, REFS_LINE);
  return { prompt: lines.join("\n"), sha };
}

/**
 * The still that sets the film's look for every other shot: look.styleStill
 * when somebody chose one, else the still the first shot with one uses. A
 * shot is never its own style reference.
 */
export function styleStillFor(plan, shotId, media) {
  const own = media?.[shotId]?.still;
  if (typeof plan.look?.styleStill === "string") {
    return plan.shots.find((s) => s.id === shotId)?.still === plan.look.styleStill || own === plan.look.styleStill ? null : plan.look.styleStill;
  }
  for (const s of plan.shots) {
    const file = media?.[s.id]?.still;
    if (file) return s.id === shotId ? null : file;
  }
  return null;
}

/** The plan, brief and shot, refused unless the plan passes the checker: no paid step starts from a broken plan. */
export function soundShot(catalog, film, shotId, { library, menu = loadMenu() }) {
  const plan = readPlan(film);
  if (!plan) throw usage(`runs/${film} has no plan yet. Save one first (kie plan --file, or save_plan).`);
  const brief = readBrief(film);
  const shot = findShot(plan, shotId);
  const assets = library.list();
  const check = checkPlan(plan, { catalog, brief, assets, menu });
  if (check.errors.length) {
    throw usage(`Fix the plan first:\n- ${check.errors.map((e) => e.message).join("\n- ")}`, { errors: check.errors });
  }
  return { plan, brief, shot, assets };
}

/**
 * Make one shot's still: an image job at the film's ratio on the shot's still
 * model, with the shot's cast as identity references and the style still as a
 * style reference when the model takes references. Returns as soon as the job
 * is submitted (the caller waits); `dryRun` plans it and spends nothing.
 * ctx: { store, limits, library, roots, upload, deps, via, onEvent, dryRun }.
 */
export async function makeStill(catalog, film, shotId, ctx) {
  const { store, limits, library, roots = null, upload, deps, via = "cli", onEvent = () => {}, dryRun = false, menu = loadMenu() } = ctx;
  const { plan, brief, shot, assets } = soundShot(catalog, film, shotId, { library, menu });
  const model = resolveModel(catalog, shot.stillModel, "image");
  const media = shotMedia(store, film, plan, { assets, brief, menu });
  const style = styleStillFor(plan, shot.id, media);
  const notes = [];

  let wanted = [...(shot.cast ?? []).map((name) => ({ source: name, role: "identity" })), ...(style ? [{ source: `${film}/${style}`, role: "style" }] : [])];
  if (wanted.length && !takesReferences(catalog, model.id)) {
    notes.push(`${model.id} takes no reference images, so this still rests on the words alone. GPT Image 2.5 and Nano Banana 2 take them.`);
    wanted = [];
  }
  const expanded = await expandRefs(wanted, { catalog, library, roots, baseDir: RUNS_DIR, upload, dryRun });
  const { prompt, sha } = stillWording(plan, shot, { assets, brief, menu, withRefs: expanded.refs.length > 0 });

  const sub = await submitJob(
    catalog,
    {
      capability: "image",
      model,
      run: film,
      artifactBase: `${shot.id}-still`,
      dryRun,
      values: { prompt, aspect_ratio: brief?.aspectRatio, refs: expanded.refs, params: {}, _useI2v: expanded.refs.length > 0 },
      record: { shot: shot.id, stage: "still", stillSha: sha, refMapping: expanded.refMapping, assets: expanded.assets, via },
    },
    { store, limits, deps, onEvent },
  );
  const result = { ...sub, shot: shot.id, model: model.id, prompt, refMapping: expanded.refMapping, style: expanded.refs.some((r) => r.role === "style") ? style : null, notes };
  if (sub.dryRun) return result;
  // Submitted and paid for: bookkeeping after this point only warns.
  try {
    await writeRecord(runDir(film), `${shot.id}-still-prompt.txt`, prompt);
    for (const name of expanded.assets) library.recordUse(name, film);
  } catch (err) {
    notes.push(`The still is submitted, but its records were not all written (${err.message}).`);
  }
  return result;
}

const SHEETS = {
  character: {
    model: "nano-banana-2",
    words: (d) =>
      `Character reference sheet of ${d}. Two views side by side on a plain neutral grey background: a front view of the face and shoulders, and a full-body front view standing straight. Even, soft studio light. No props, no text, no logos.`,
  },
  product: {
    model: "gpt-image-2-5",
    words: (d) =>
      `Product reference sheet of ${d}. A three-quarter view and a straight front view side by side on a seamless light grey background. Soft studio light with a gentle rim. Every label, edge and colour exact. No other objects, no added text.`,
  },
  location: {
    model: "nano-banana-2",
    words: (d) => `A wide establishing frame of ${d}, at eye level, in natural light. No people, no text, no logos.`,
  },
};

/** The words for an asset's reference sheet, by its kind; a style asset has no sheet. */
export function sheetWording(asset) {
  const sheet = SHEETS[asset.kind];
  if (!sheet) throw usage(`${asset.name} is a ${asset.kind} asset; only characters, products and locations get a reference sheet.`);
  return { prompt: sheet.words(trim(asset.description)), model: sheet.model, aspectRatio: asset.kind === "location" ? "16:9" : "3:2" };
}

/**
 * A reference sheet for a Library item, made from its own images (identity
 * references) and its description. One image job, tagged stage "sheet" and
 * filed under a film's run. adoptSheet then saves the result into the item.
 */
export async function makeSheet(catalog, film, assetName, ctx) {
  const { store, limits, library, roots = null, upload, deps, via = "cli", onEvent = () => {}, dryRun = false, model: chosenModel } = ctx;
  const asset = library.get(assetName);
  const sheet = sheetWording(asset);
  const model = resolveModel(catalog, chosenModel ?? sheet.model, "image");
  const refs = takesReferences(catalog, model.id) ? [{ source: asset.name, role: "identity" }] : [];
  const expanded = await expandRefs(refs, { catalog, library, roots, baseDir: RUNS_DIR, upload, dryRun });
  const sub = await submitJob(
    catalog,
    {
      capability: "image",
      model,
      run: film,
      artifactBase: `sheet-${asset.name}`,
      dryRun,
      values: { prompt: sheet.prompt, aspect_ratio: sheet.aspectRatio, refs: expanded.refs, params: {}, _useI2v: expanded.refs.length > 0 },
      record: { stage: "sheet", sheetFor: asset.name, refMapping: expanded.refMapping, assets: expanded.assets, via },
    },
    { store, limits, deps, onEvent },
  );
  return { ...sub, asset: asset.name, model: model.id, prompt: sheet.prompt, refMapping: expanded.refMapping };
}

/**
 * Put a finished sheet first in its Library item, keeping up to three of the
 * item's earlier images after it; the previous version moves to the item's
 * history, as every Library replace does.
 */
export function adoptSheet(library, store, jobId) {
  const job = store.get(jobId);
  if (job.stage !== "sheet" || !job.sheetFor) throw usage(`Job ${jobId} is not a reference sheet.`);
  if (job.state !== "succeeded" || !job.artifacts?.length) throw usage(`The sheet job ${jobId} has not finished (${job.state}).`);
  const asset = library.get(job.sheetFor);
  const images = [job.artifacts[0], ...asset.images.map((im) => im.path)].slice(0, 4);
  library.save({ name: asset.name, kind: asset.kind, description: asset.description, images, replace: true });
  return library.get(asset.name);
}
