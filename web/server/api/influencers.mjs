// The AI influencer builder. Chips become a description (cli/core/influencers),
// the description becomes four face options (four image jobs on one model),
// the face you pick is saved as a Library character with a persona, and a
// reference sheet is made from it with the director's makeSheet. Adopting the
// finished sheet is a separate, free step, so a bad sheet never replaces the face.
//
// Faces and sheets are filed under runs/influencers, hidden from film lists.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { INFLUENCER_RUN } from "../../../cli/lib/run.mjs";
import { resolveModel, routesFor } from "../../../cli/lib/models.mjs";
import { estimateUsd } from "../../../cli/lib/budget.mjs";
import { uploadFile } from "../../../cli/lib/upload.mjs";
import { ASSET_NAME, sheetOf } from "../../../cli/core/assets.mjs";
import { TRAITS, checkTraits, describe, facePrompt, influencerSlug, MAX_EXTRA } from "../../../cli/core/influencers.mjs";
import { makeSheet, adoptSheet, sheetWording } from "../../../cli/director/still.mjs";
import { dailyPosition } from "../../../cli/core/spend.mjs";
import { HttpError } from "../http.mjs";
import { context, jobView } from "../state.mjs";
import { mediaUrl } from "../media.mjs";
import { createSubmitter } from "./generate.mjs";
import * as f from "./fields.mjs";

export { INFLUENCER_RUN };
export const FACE_MODEL = "nano-banana-2";
/** 1K is plenty to judge a face; the sheet is made at the model's default. */
const FACE_RESOLUTION = "1K";
export const FACES = 4;
const SHEET_MODEL = sheetWording({ kind: "character", name: "x", description: "x" }).model;

const sha = (path) => (existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null);
const routeOf = (catalog, id) => {
  const m = resolveModel(catalog, id, "image");
  return { model: m, route: routesFor(catalog, m).find((r) => r.usable) ?? m.routes[0] };
};

/** The persona and description from the request, checked. */
function personaFrom(body) {
  const traits = checkTraits(body.traits ?? {});
  const extra = f.text(body, "extra") ?? "";
  if (extra.length > MAX_EXTRA) throw f.invalid("extra", `Keep the extra words under ${MAX_EXTRA} characters.`);
  if (!traits.gender) throw f.invalid("traits", "Pick a gender first; the rest can stay open.");
  return { traits, extra, description: describe(traits, extra) };
}

export function registerInfluencers(router, { catalog, deps = {}, follower }) {
  const submit = createSubmitter({ catalog, deps, follower });
  const upload = deps.upload ?? ((path, opts) => uploadFile(catalog, path, opts));

  const prices = () => {
    const face = routeOf(catalog, FACE_MODEL);
    const sheet = routeOf(catalog, SHEET_MODEL);
    const faceUsd = estimateUsd(face.route, { resolution: FACE_RESOLUTION }).usd;
    const sheetUsd = estimateUsd(sheet.route, {}).usd;
    return { faceModel: face.model.id, sheetModel: sheet.model.id, faceUsd, facesUsd: Math.round(faceUsd * FACES * 10_000) / 10_000, sheetUsd };
  };

  /** Influencers: Library characters with a persona, newest first, with their latest sheet job. */
  function influencersView() {
    const { library, store } = context();
    const jobs = store.list();
    return library
      .list()
      .filter((a) => a.persona)
      .map((s) => {
        const a = library.get(s.name);
        const sheet = sheetOf(a);
        const face = a.images.find((im) => im.role === "source") ?? a.images[0];
        const sheetJob = jobs.filter((j) => j.stage === "sheet" && j.sheetFor === a.name && j.run === INFLUENCER_RUN).at(-1) ?? null;
        return {
          name: a.name,
          displayName: a.persona.displayName ?? a.name,
          description: a.description,
          persona: a.persona,
          face: mediaUrl(face?.path),
          sheet: sheet ? mediaUrl(sheet.path) : null,
          sheetJobId: sheetJob?.id ?? null,
          // The latest sheet job's picture is the one in the Library already: nothing new to keep.
          sheetJobKept: Boolean(sheet?.sha256 && sheetJob?.artifacts?.[0] && sha(sheetJob.artifacts[0]) === sheet.sha256),
          createdAt: a.createdAt,
        };
      })
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  }

  /** Each batch of face options, newest first: its description and its job ids in order. */
  function batchesView() {
    const batches = new Map();
    for (const j of context().store.list()) {
      if (j.run !== INFLUENCER_RUN || j.stage !== "face" || !j.batch) continue;
      const b = batches.get(j.batch) ?? { batch: j.batch, description: j.persona?.description ?? null, createdAt: j.createdAt, jobIds: [] };
      b.jobIds.push(j.id);
      batches.set(j.batch, b);
    }
    return [...batches.values()].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  }

  router.get("/api/influencers", () => {
    const { store, limits } = context();
    return {
      run: INFLUENCER_RUN,
      traits: TRAITS.map((t) => ({ id: t.id, label: t.label, options: t.options.map((o) => ({ id: o.id, label: o.label })) })),
      faces: FACES,
      ...prices(),
      availableTodayUsd: dailyPosition(store, limits).availableUsd,
      batches: batchesView(),
      influencers: influencersView(),
    };
  });

  /** Free: the words the chips make, so the page shows exactly what will be sent. */
  router.post("/api/influencers/describe", ({ body = {} }) => {
    const traits = checkTraits(body.traits ?? {});
    const extra = f.text(body, "extra") ?? "";
    return { description: describe(traits, extra), prompt: facePrompt(describe(traits, extra)) };
  });

  /** Spends: four face options, one image job each, under the per-job limit and the daily cap. */
  router.post("/api/influencers/faces", async ({ body = {} }) => {
    const persona = personaFrom(body);
    const { model } = routeOf(catalog, FACE_MODEL);
    const { facesUsd } = prices();
    const { store, limits } = context();
    if (facesUsd > dailyPosition(store, limits).availableUsd) {
      throw f.invalid("traits", `Four faces cost about $${facesUsd.toFixed(2)}, more than is left of today's cap. Nothing was spent.`);
    }
    const batch = randomBytes(6).toString("hex");
    const prompt = facePrompt(persona.description);
    const jobs = [];
    const warnings = [];
    for (let i = 0; i < FACES; i++) {
      const a = { run: INFLUENCER_RUN, prompt, refs: [], params: {}, budget_usd: null, provider: null };
      try {
        const r = await submit("image", model, a, { prompt, resolution: FACE_RESOLUTION, aspect_ratio: "3:4" }, {
          promptFile: "face-prompt.txt",
          inputsFile: "face-inputs.json",
          artifactBase: `face-${batch}`,
          useI2v: () => false,
          extra: { persona },
          jobRecord: { stage: "face", batch, persona },
        });
        jobs.push(r.localJobId);
      } catch (err) {
        // Nothing submitted yet: the whole request failed and nothing was spent.
        if (!jobs.length) throw err;
        warnings.push(`Only ${jobs.length} of ${FACES} faces were sent: ${err.message}`);
        break;
      }
    }
    return { batch, jobs, description: persona.description, warnings };
  });

  /** Keep a face: save it as a Library character with its persona, then make its sheet (spends). */
  router.post("/api/influencers", async ({ body = {} }) => {
    const displayName = f.text(body, "name", { required: true }).trim();
    const name = influencerSlug(displayName);
    if (!name || !ASSET_NAME.test(name)) throw f.invalid("name", "Give the influencer a name with at least one letter or digit.");
    const jobId = f.text(body, "face", { required: true });
    const { library, store, limits, roots } = context();
    if (library.list().some((a) => a.name === name)) throw f.invalid("name", `"${name}" is already in the Library. Pick another name.`);
    let job;
    try {
      job = store.get(jobId);
    } catch {
      throw f.invalid("face", `No face job ${jobId}.`);
    }
    if (job.stage !== "face" || job.run !== INFLUENCER_RUN) throw f.invalid("face", `${jobId} is not a face from the builder.`);
    if (job.state !== "succeeded" || !job.artifacts?.length) throw f.invalid("face", "That face has not finished.");
    const { traits, extra, description } = job.persona;
    library.save({ name, kind: "character", description, images: [{ path: job.artifacts[0], role: "source" }], persona: { displayName, traits, extra } }, { roots });

    let sheetJobId = null;
    const warnings = [];
    try {
      const r = await makeSheet(catalog, INFLUENCER_RUN, name, { store, limits, library, roots, upload, deps: deps.generate, via: "studio" });
      sheetJobId = r.job.id;
      follower.follow(sheetJobId);
    } catch (err) {
      warnings.push(`${displayName} is saved, but the sheet was not made: ${err.message}`);
    }
    return { influencer: influencersView().find((x) => x.name === name), sheetJobId, warnings };
  });

  /** Spends: make the sheet again. */
  router.post("/api/influencers/:name/sheet", async ({ params }) => {
    const { library, store, limits, roots } = context();
    const a = library.get(params.name);
    if (!a.persona) throw new HttpError(404, `${params.name} is not an influencer.`);
    const r = await makeSheet(catalog, INFLUENCER_RUN, a.name, { store, limits, library, roots, upload, deps: deps.generate, via: "studio" });
    follower.follow(r.job.id);
    return { sheetJobId: r.job.id, job: jobView(store.get(r.job.id), follower.has) };
  });

  /** Free: put a finished sheet first in the influencer's Library item, marked as its sheet. The face stays after it. */
  router.post("/api/influencers/:name/adopt", ({ params, body = {} }) => {
    const jobId = f.text(body, "job", { required: true });
    const { library, store } = context();
    let job;
    try {
      job = store.get(jobId);
    } catch {
      throw f.invalid("job", `No job ${jobId}.`);
    }
    if (job.stage !== "sheet" || job.sheetFor !== params.name) throw f.invalid("job", `${jobId} is not ${params.name}'s sheet.`);
    if (job.state !== "succeeded" || !job.artifacts?.length) throw f.invalid("job", "That sheet has not finished.");
    adoptSheet(library, store, jobId);
    return influencersView().find((x) => x.name === params.name);
  });
}
