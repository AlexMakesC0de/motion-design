import { existsSync } from "node:fs";
import { join } from "node:path";
import { RUNS_DIR, runDir, writeRecord } from "../lib/run.mjs";
import { resolveModel } from "../lib/models.mjs";
import { EXIT, budget, usage } from "../lib/errors.mjs";
import { lastFrame as realLastFrame } from "../lib/frames.mjs";
import { expandRefs } from "../core/refs.mjs";
import { submitJob } from "../core/generate.mjs";
import { UNSETTLED, uncertainMessage } from "../core/jobs.mjs";
import { loadMenu } from "./menu.mjs";
import { shotFit } from "./fit.mjs";
import { shotWording } from "./wording.mjs";
import { shotMedia } from "./media.mjs";
import { soundShot } from "./still.mjs";
import { readPlan, updateShot } from "./plan.mjs";
import { readFilmJson, writeFilmJson } from "./files.mjs";

const money = (usd) => `$${usd.toFixed(2)}`;
const r2 = (usd) => Math.round(usd * 100) / 100;

/** Above a shot's priced estimate, the most its take may be estimated at when submitted: rounding only. */
export const PRICE_MARGIN_USD = 0.01;

/** The shot before `id`, when it runs straight into this one. */
const continuesFrom = (plan, id) => {
  const i = plan.shots.findIndex((s) => s.id === id);
  return i > 0 && plan.shots[i - 1].cut === "continuous" ? plan.shots[i - 1] : null;
};

/** The shot's newest take that has not settled (being sent, submitted, or uncertain), or null. */
const takeInFlight = (store, film, shotId) =>
  store.list().filter((j) => j.run === film && j.shot === shotId && j.stage === "take" && UNSETTLED.has(j.state)).at(-1) ?? null;

/**
 * One take in flight per shot: refuse while one is being filmed, and never
 * resubmit one whose create ended uncertain (it may exist upstream).
 */
function refuseInFlight(store, film, shotId) {
  const job = takeInFlight(store, film, shotId);
  if (!job) return;
  if (job.state === "uncertain") throw usage(`${shotId} is already being filmed as far as anyone can tell: take ${job.id}'s submit ended uncertain.\n${uncertainMessage(job)}`);
  throw usage(`${shotId} is already being filmed: take ${job.id} is ${job.state}. Wait for it (kie job ${job.id}, or wait_job) before filming ${shotId} again.`);
}

/**
 * Film one shot: image-to-video from its still (or, on a continuous cut, from
 * the real last frame of the shot before), at the generated length (planned
 * plus the trim margin), with the shot's wording and its model's params (audio
 * off unless it is a lip-sync shot). Returns once the job is submitted.
 * ctx as for makeStill, plus `lastFrame(video, out)` (tests stub ffmpeg).
 */
export async function filmShot(catalog, film, shotId, ctx) {
  const { store, limits, library, roots = null, upload, deps, via = "cli", onEvent = () => {}, dryRun = false, menu = loadMenu(), lastFrame = realLastFrame } = ctx;
  const { plan, brief, shot, assets } = soundShot(catalog, film, shotId, { library, menu });
  refuseInFlight(store, film, shot.id);
  const dir = runDir(film);
  const media = shotMedia(store, film, plan, { assets, brief, menu });

  let frame;
  const prev = continuesFrom(plan, shot.id);
  if (prev) {
    const take = media[prev.id]?.take;
    if (!take) throw usage(`${shot.id} continues from ${prev.id}, which has no take yet. Film ${prev.id} first; ${shot.id} starts on its last frame.`);
    frame = take.replace(/\.[^.]+$/, "-last.png");
    if (!existsSync(join(dir, frame))) await lastFrame(join(dir, take), join(dir, frame));
  } else {
    frame = media[shot.id]?.still;
    if (!frame) throw usage(`${shot.id} has no still yet. Make one first (kie still, or make_still): the still is the shot's first frame.`);
  }

  const fit = shotFit(catalog, shot.model, { plannedS: shot.durationS, aspectRatio: brief?.aspectRatio });
  if (fit.problems.length) throw usage(`${shot.id} cannot be filmed on ${shot.model}: ${fit.problems.join(" ")}`);
  // The take may cost what the shot was priced at (and, under Film all, no more
  // than was agreed for it), not the catalog's flat default budget; the per-job
  // limit and the daily cap still apply in reserve().
  const priced = Math.min(fit.estimateUsd ?? Infinity, ctx.agreedUsd ?? Infinity);
  const budgetUsd = Number.isFinite(priced) ? r2(priced + PRICE_MARGIN_USD) : undefined;
  const wording = shotWording(catalog, plan, shot, { menu, assets });
  if (wording.problems.length) throw usage(`${shot.id}: ${wording.problems.join(" ")}`);

  const model = resolveModel(catalog, shot.model, "video");
  const expanded = await expandRefs([{ source: `${film}/${frame}`, role: "first_frame" }], { catalog, library, roots, baseDir: RUNS_DIR, upload, dryRun });
  const sub = await submitJob(
    catalog,
    {
      capability: "video",
      model,
      run: film,
      artifactBase: `${shot.id}-take`,
      budgetUsd,
      dryRun,
      values: { prompt: wording.prompt, duration: fit.generatedS, aspect_ratio: brief?.aspectRatio, refs: expanded.refs, params: wording.params, _useI2v: true },
      record: { shot: shot.id, stage: "take", plannedS: shot.durationS, generatedS: fit.generatedS, firstFrame: frame, refMapping: expanded.refMapping, via },
      // Checked again under the spend lock, where the take's record is written: two callers cannot both pass.
      claim: (s) => refuseInFlight(s, film, shot.id),
    },
    { store, limits, deps, onEvent },
  );
  const result = { ...sub, shot: shot.id, model: model.id, prompt: wording.prompt, params: wording.params, generatedS: fit.generatedS, firstFrame: frame, notes: [] };
  if (sub.dryRun) return result;
  try {
    await writeRecord(dir, `${shot.id}-take-prompt.txt`, wording.prompt);
  } catch (err) {
    result.notes.push(`The take is submitted, but ${shot.id}-take-prompt.txt was not written (${err.message}).`);
  }
  // A take somebody chose would outrank the new one; filming again means the new one is wanted.
  if (shot.take) {
    try {
      updateShot(catalog, film, shot.id, { take: null }, { assets, menu });
    } catch (err) {
      result.notes.push(`${shot.id} still uses ${shot.take}; pick the new take once it lands (${err.message}).`);
    }
  }
  return result;
}

/** Where each shot stands for Film all. */
function standing(plan, media) {
  return plan.shots.map((s) => {
    const m = media[s.id];
    if (m.take) return { shot: s, is: "done" };
    if (m.takes.some((t) => UNSETTLED.has(t.state))) return { shot: s, is: "filming" };
    const last = m.takes.at(-1);
    if (last) return { shot: s, is: "failed", state: last.state, error: last.error ?? null };
    return { shot: s, is: "todo" };
  });
}

/** The Film all agreement on record for a film (agreement.json), or null. */
export const readAgreement = (film) => readFilmJson(film, "agreement.json", { ifInvalid: null });

/**
 * Film all: submit every shot that is ready, in order, and return at once.
 * Call again when takes finish: a shot on a continuous cut waits for the take
 * before it. Nothing is filmed twice: a shot with a take, or one being filmed,
 * is skipped, and a failed take is reported for Alex to decide (film_shot
 * redoes it). A refusal (limits) or an ambiguous create stops the queue.
 *
 * What may be filmed is bound to an agreement: the total Alex agreed
 * (`maxUsd`), the shots left to film when he agreed it, and each one's price
 * then. Every call films only shots in it, each at no more than its agreed
 * price (passed down as the take's budget), so the takes Film all submits
 * under one agreement never cost more than the total. A shot added since, or
 * one whose price rose, stops everything with a request to agree again.
 *
 * ctx.agreement: continue that agreement (the studio queue, kie film's loop).
 * ctx.maxUsd: a stated total. It continues the agreement on record when that
 * was for the same total, else it is a new agreement, checked against what is
 * left and saved. ctx.fresh (the studio's button, pressed on the total it
 * showed) always starts a new one.
 */
export async function filmReady(catalog, film, ctx) {
  const { store, library, maxUsd, agreement: held = null, fresh = false, menu = loadMenu() } = ctx;
  if (!held && !(typeof maxUsd === "number" && maxUsd >= 0)) {
    throw usage("Film all needs max_usd (--max-usd): the total Alex agreed to spend on filming. Show the cost with kie plan first.");
  }
  const plan = readPlan(film);
  if (!plan) throw usage(`runs/${film} has no plan yet.`);
  const first = plan.shots?.[0]?.id;
  const { brief, assets } = soundShot(catalog, film, first, { library, menu });
  const media = shotMedia(store, film, plan, { assets, brief, menu });
  const rows = standing(plan, media);

  const todo = rows.filter((r) => r.is === "todo");
  const noStill = todo.filter((r) => !continuesFrom(plan, r.shot.id) && !media[r.shot.id].still).map((r) => r.shot.id);
  if (noStill.length) throw usage(`Every shot needs its still before filming: ${noStill.join(", ")} ${noStill.length === 1 ? "has" : "have"} none. Make them (kie still, or make_still) and look at the storyboard first.`);

  const price = new Map(todo.map((r) => [r.shot.id, shotFit(catalog, r.shot.model, { plannedS: r.shot.durationS, aspectRatio: brief?.aspectRatio })]));
  const remainingUsd = r2(todo.reduce((t, r) => t + (price.get(r.shot.id).estimateUsd ?? 0), 0));
  const left = todo.map((r) => r.shot.id).join(", ");

  let agreement = held;
  if (!agreement) {
    const onRecord = fresh ? null : readAgreement(film);
    if (onRecord && Math.abs(onRecord.maxUsd - maxUsd) < 0.005) agreement = onRecord;
    else {
      if (remainingUsd > maxUsd + 0.005) {
        throw budget(`Filming what is left (${left}) costs about ${money(remainingUsd)}, more than the ${money(maxUsd)} agreed. Nothing was submitted.`);
      }
      agreement = {
        maxUsd: r2(maxUsd),
        at: new Date().toISOString(),
        shots: todo.map((r) => ({ id: r.shot.id, model: r.shot.model, generatedS: price.get(r.shot.id).generatedS, estimateUsd: r2(price.get(r.shot.id).estimateUsd ?? 0) })),
      };
      if (!ctx.dryRun) writeFilmJson(film, "agreement.json", agreement);
    }
  }

  const agreed = new Map(agreement.shots.map((a) => [a.id, a]));
  const off = [];
  for (const r of todo) {
    const a = agreed.get(r.shot.id);
    const now = price.get(r.shot.id).estimateUsd ?? Infinity;
    if (!a) off.push(`${r.shot.id} is not in it`);
    else if (now > a.estimateUsd + 0.005) off.push(`${r.shot.id} now costs about ${Number.isFinite(now) ? money(r2(now)) : "an unknown price"}, more than the ${money(a.estimateUsd)} agreed for it`);
  }
  if (off.length) {
    throw budget(
      `Film all was agreed at ${money(agreement.maxUsd)} for ${agreement.shots.map((a) => a.id).join(", ") || "no shots"}; ${off.join("; ")}. Nothing was submitted. ` +
        `What is left (${left}) now costs about ${money(remainingUsd)}: ask the user to agree a new total, then Film all with it.`,
    );
  }

  const out = { submitted: [], filming: [], waiting: [], done: [], failed: [], stopped: null, remainingUsd, agreement, dryRun: Boolean(ctx.dryRun) };
  const ready = (r) => {
    const prev = continuesFrom(plan, r.shot.id);
    return !prev || Boolean(media[prev.id].take);
  };
  for (const r of rows) {
    if (r.is === "done") out.done.push(r.shot.id);
    else if (r.is === "filming") out.filming.push(r.shot.id);
    else if (r.is === "failed") out.failed.push({ shot: r.shot.id, state: r.state, error: r.error });
    else if (out.stopped || !ready(r)) out.waiting.push(r.shot.id);
    else {
      try {
        const sub = await filmShot(catalog, film, r.shot.id, { ...ctx, agreedUsd: agreed.get(r.shot.id).estimateUsd });
        out.submitted.push({ shot: r.shot.id, jobId: sub.job?.id ?? null, model: sub.model, generatedS: sub.generatedS, estimateUsd: sub.estimateUsd, ...(sub.dryRun ? { dryRun: true, label: sub.label } : {}) });
      } catch (err) {
        out.stopped = { shot: r.shot.id, code: err.code ?? EXIT.USAGE, message: err.message, localJobId: err.localJobId ?? null };
        (err.localJobId ? out.filming : out.waiting).push(r.shot.id);
      }
    }
  }
  return out;
}
