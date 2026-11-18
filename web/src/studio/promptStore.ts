// The prompt bar's state, shared by every screen that fills it: Reuse on a
// take, "Use this" on a preset, "Use in prompt" on an asset. One module-level
// store read with useSyncExternalStore, so the bar keeps its draft when you
// switch tabs. The working film is kept here too, and remembered across reloads.
import { useSyncExternalStore } from "react";
import type { JobView, ModelInfo, ScenePicks, StagePicks } from "../api/types";

export interface RefDraft {
  source: string;
  role: string;
}

/** A video's camera and look, as director's-menu ids: what a stage and a scene take, in one. */
export type VideoPicks = StagePicks & ScenePicks;

export interface Draft {
  prompt: string;
  model: string;
  durationS: number | null;
  aspectRatio: string | null;
  resolution: string | null;
  refs: RefDraft[];
  /** Create Video's chips. The server words them after the prompt; they do not change the price. */
  picks: VideoPicks;
  /** A look (id): its picks fill the chips when chosen, and the server adds its look, pacing and sound lines. */
  look: string | null;
  preset: string | null;
  /** A per-job budget the user raised for this job; null keeps the catalog default. */
  budgetUsd: number | null;
}

export const EMPTY_DRAFT: Draft = {
  prompt: "",
  model: "",
  durationS: null,
  aspectRatio: null,
  resolution: null,
  refs: [],
  picks: {},
  look: null,
  preset: null,
  budgetUsd: null,
};

const RUN_KEY = "studio.run";
const readRun = () => {
  try {
    return localStorage.getItem(RUN_KEY) ?? "";
  } catch {
    return "";
  }
};

let state = { draft: EMPTY_DRAFT, run: readRun() };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const getDraft = () => state.draft;
export const getRun = () => state.run;

export function setDraft(patch: Partial<Draft>) {
  state = { ...state, draft: { ...state.draft, ...patch } };
  emit();
}

export function setRun(run: string) {
  state = { ...state, run };
  try {
    localStorage.setItem(RUN_KEY, run);
  } catch {
    // private mode: the choice lasts for this page only
  }
  emit();
}

export function resetForTests(draft: Partial<Draft> = {}, run = "") {
  state = { draft: { ...EMPTY_DRAFT, ...draft }, run };
  emit();
}

export const useDraft = () => useSyncExternalStore(subscribe, getDraft);
export const useRun = () => useSyncExternalStore(subscribe, getRun);

/** Settings that suit `m`, keeping what the draft has where the model takes it. */
export function fitToModel(m: ModelInfo, d: Draft): Partial<Draft> {
  const keep = <T,>(options: T[], current: T | null, preferred: T | null): T | null => {
    if (!options.length) return null;
    if (current != null && options.includes(current)) return current;
    if (preferred != null && options.includes(preferred)) return preferred;
    return options[0];
  };
  return {
    model: m.id,
    durationS: m.capability === "video" ? keep(m.durationsS, d.durationS, 5) : null,
    aspectRatio: keep(m.aspectRatios, d.aspectRatio, "16:9"),
    resolution: keep(m.resolutionOptions, d.resolution, m.defaultResolution),
    refs: m.capability === "video" ? d.refs.filter((r) => m.refRoles.includes(r.role)) : d.refs,
    budgetUsd: null,
  };
}

/**
 * Reuse: a take's prompt and settings back into the bar. A take made with chips
 * gets its typed words and its chips back, not the sent prompt, which already
 * has the chips' words in it. Refs are not restored: a job keeps provider URLs,
 * not the asset and role.
 */
export function reuseJob(job: JobView) {
  setDraft({
    prompt: (job.picks || job.look ? job.typedPrompt : null) ?? job.prompt ?? "",
    picks: job.picks ?? {},
    look: job.look ?? null,
    model: job.model,
    durationS: job.durationS == null || job.durationS === "" ? null : Number(job.durationS),
    aspectRatio: job.aspectRatio,
    resolution: job.resolution,
    refs: [],
    preset: null,
    budgetUsd: null,
  });
}

/** Use this: a preset's source prompt and defaults. The prompt is the source to adapt, not to send as is. Chips stay. */
export function applyPreset(p: { id: string; model: string | null; durationS: number | null; aspectRatio: string | null; prompt: string | null }) {
  presetPrompt = p.prompt ?? "";
  setDraft({
    prompt: p.prompt ?? "",
    model: p.model ?? state.draft.model,
    durationS: p.durationS,
    aspectRatio: p.aspectRatio,
    resolution: null,
    refs: [],
    look: null,
    preset: p.id,
    budgetUsd: null,
  });
}

/** Choose a look: its picks fill the chips (still yours to change); its look, pacing and sound lines are added on the server. */
export function applyLook(look: { id: string; picks: VideoPicks }) {
  setDraft({ look: look.id, picks: { ...look.picks } });
}

/** Take a look off, with the chips it set that are still as it set them. Chips you changed stay. */
export function clearLook(look: { picks: VideoPicks } | null) {
  const own = look?.picks ?? {};
  const picks = Object.fromEntries(Object.entries(state.draft.picks).filter(([k, v]) => own[k as keyof VideoPicks] !== v)) as VideoPicks;
  setDraft({ look: null, picks });
}

/** The source prompt the last template put in the box, so taking the look off can take its untouched prompt with it. */
let presetPrompt = "";

/** Take the template off. Its source prompt goes too, unless it has been edited; what you wrote stays. */
export function clearPreset() {
  const untouched = Boolean(presetPrompt) && state.draft.prompt === presetPrompt;
  presetPrompt = "";
  setDraft({ preset: null, ...(untouched ? { prompt: "" } : {}) });
}

export function addRef(ref: RefDraft) {
  const refs = state.draft.refs.filter((r) => !(r.source === ref.source && r.role === ref.role));
  setDraft({ refs: [...refs, ref] });
}

export function removeRef(index: number) {
  setDraft({ refs: state.draft.refs.filter((_, i) => i !== index) });
}

/** POST /api/estimate's body (camelCase, as that endpoint has always taken). */
export function estimateBody(d: Draft, m: ModelInfo) {
  return {
    model: d.model,
    durationS: m.capability === "video" ? (d.durationS ?? undefined) : undefined,
    resolution: d.resolution ?? undefined,
    aspectRatio: d.aspectRatio ?? undefined,
    refs: d.refs,
    budgetUsd: d.budgetUsd ?? undefined,
  };
}

/** POST /api/generate/{video,image}'s body: the MCP generate tools' argument names. */
/** A look and the chips as sent. With a look, the chips go even when empty, so a chip the user took off stays off. */
const lookFields = (d: Draft) => ({
  look: d.look ?? undefined,
  picks: Object.keys(d.picks).length ? d.picks : d.look ? {} : undefined,
});

export function generateBody(d: Draft, m: ModelInfo, run: string) {
  return {
    run,
    prompt: d.prompt,
    model: d.model,
    ...(m.capability === "video" ? { duration_s: d.durationS ?? undefined, preset: d.preset ?? undefined, ...lookFields(d) } : {}),
    resolution: d.resolution ?? undefined,
    aspect_ratio: d.aspectRatio ?? undefined,
    refs: d.refs,
    budget_usd: d.budgetUsd ?? undefined,
  };
}
