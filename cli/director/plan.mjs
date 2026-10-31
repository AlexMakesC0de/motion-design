import { usage, unknown } from "../lib/errors.mjs";
import { loadMenu } from "./menu.mjs";
import { readFilmJson, writeFilmJson } from "./files.mjs";
import { readBrief } from "./brief.mjs";
import { checkPlan } from "./check.mjs";
import { suggestModel, suggestStillModel } from "./pick.mjs";

export const readPlan = (film) => readFilmJson(film, "shots.json");

export function findShot(plan, id) {
  const shot = plan?.shots?.find((s) => s.id === id);
  if (!shot) throw unknown(`No shot "${id}". Shots: ${(plan?.shots ?? []).map((s) => s.id).join(", ") || "none"}.`);
  return shot;
}

/**
 * Fill what the director left for the picker: a shot without a model gets the
 * suggested one and its reason; a shot without a still model gets one by film
 * type. A model the director or Alex chose is never replaced.
 */
export function fillSuggestions(catalog, plan, { brief, menu = loadMenu() }) {
  return {
    ...plan,
    shots: (plan.shots ?? []).map((s) => {
      if (!s || typeof s !== "object") return s;
      const out = { ...s };
      if (!out.model && typeof out.job === "string" && typeof out.durationS === "number") {
        try {
          const sug = suggestModel(catalog, out, { brief, menu });
          if (sug.model) Object.assign(out, { model: sug.model, modelReason: sug.reason });
        } catch {
          // an unknown job is reported by the checker
        }
      }
      if (!out.stillModel) {
        const st = suggestStillModel(out, { brief });
        Object.assign(out, { stillModel: st.model, stillReason: st.reason });
      }
      return out;
    }),
  };
}

/**
 * Save the shot list. Needs a brief first. Missing models are filled in, the
 * checker runs, and a plan with errors is refused with every reason (exit 1)
 * so a broken plan never reaches stills or filming. Warnings ride along.
 */
export function savePlan(catalog, film, plan, { assets = [], menu = loadMenu(), now } = {}) {
  const brief = readBrief(film);
  if (!brief) throw usage(`runs/${film} has no brief yet. Save the brief first (kie brief, or save_brief).`);
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw usage("The plan must be an object with look and shots.");
  const filled = fillSuggestions(catalog, plan, { brief, menu });
  const check = checkPlan(filled, { catalog, brief, assets, menu });
  if (check.errors.length) {
    throw usage(`The plan was not saved:\n- ${check.errors.map((e) => e.message).join("\n- ")}`, { errors: check.errors, warnings: check.warnings });
  }
  const prev = readPlan(film);
  const saved = { ...filled, version: (prev?.version ?? 0) + 1 };
  writeFilmJson(film, "shots.json", saved, { now });
  return { plan: saved, check };
}

/**
 * Change some fields of one shot and save the whole plan through savePlan,
 * so an edit that breaks the plan is refused like any other. Changing the
 * job or the length without naming a model asks the picker again.
 */
export function updateShot(catalog, film, id, changes, opts = {}) {
  const plan = readPlan(film);
  if (!plan) throw usage(`runs/${film} has no plan yet. Save one first (kie plan --file, or save_plan).`);
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw usage("changes must be an object of shot fields.");
  if ("id" in changes && changes.id !== id) throw usage("A shot's id cannot change; delete and add it in a new plan instead.");
  findShot(plan, id);
  const repick = ("job" in changes || "durationS" in changes) && !("model" in changes);
  const shots = plan.shots.map((s) => {
    if (s.id !== id) return s;
    const next = { ...s, ...changes };
    if (repick) {
      delete next.model;
      delete next.modelReason;
    }
    // A still model the picker chose follows the job; one somebody named stays.
    if ("job" in changes && !("stillModel" in changes) && s.stillReason) {
      delete next.stillModel;
      delete next.stillReason;
    }
    return next;
  });
  const { version, ...rest } = plan;
  return savePlan(catalog, film, { ...rest, shots }, opts);
}
