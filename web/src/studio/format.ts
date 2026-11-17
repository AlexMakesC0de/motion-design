import type { Estimate, JobView } from "../api/types";

/** Dollars to the cent; a price with part of a cent in it (Seedream's $0.035) keeps that digit. */
export const usd = (n: number) => `$${Math.abs(n * 100 - Math.round(n * 100)) > 1e-6 ? n.toFixed(3) : n.toFixed(2)}`;

/** A positive gap in dollars, never shown as $0.00. */
const gap = (a: number, b: number) => usd(Math.max(0.01, a - b));

const RUNNING = new Set(["reserved", "sending", "submitted"]);

/** The actual cost when known, else the estimate marked with ~. */
export function takeCost(job: JobView): string {
  if (job.actualUsd != null) return usd(job.actualUsd);
  if (job.estimateUsd != null) return `~${usd(job.estimateUsd)}`;
  return "—";
}

/** `5s`, or null for a take with no duration (an image, or a route that does not record one). */
export function durationLabel(job: JobView): string | null {
  if (job.durationS == null || job.durationS === "") return null;
  const s = Number(job.durationS);
  return Number.isFinite(s) ? `${s}s` : null;
}

/** `model-id · 5s · 720p`, the engine line every tile shows before its cost. */
export function takeSpec(job: JobView): string {
  return [job.model, durationLabel(job), job.resolution].filter(Boolean).join(" · ");
}

/** `model-id · 5s · 16:9`: which engine, how long, what shape. The film page's line under a shot's name. */
export function shotSpec(job: JobView): string {
  return [job.model, durationLabel(job), job.aspectRatio].filter(Boolean).join(" · ");
}

/** The text on one line, cut to `max` characters with an ellipsis. */
export function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max).trimEnd()}…` : one;
}

/** m:ss since `fromIso`. */
export function elapsed(fromIso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export type TakeStatus =
  | { kind: "running"; label: string }
  | { kind: "unwatched"; label: string }
  | { kind: "done" }
  | { kind: "uncertain"; label: string }
  | { kind: "failed"; label: string; reason: string };

/** What a tile says about its job, from the job state core recorded. */
export function takeStatus(job: JobView, now: number): TakeStatus {
  // Waiting at the provider with nobody polling it: a clock would run forever.
  if ((job.state === "submitted" || job.state === "uncertain") && !job.following) return { kind: "unwatched", label: "not being watched" };
  if (RUNNING.has(job.state)) return { kind: "running", label: `running ${elapsed(job.createdAt, now)}` };
  if (job.state === "uncertain") return { kind: "uncertain", label: "still checking" };
  if (job.state === "succeeded") return { kind: "done" };
  const reason = job.state === "refused" ? "Stopped before sending." : (job.error ?? "No reason given.").split("\n")[0];
  const label =
    job.state === "failed-confirmed-free"
      ? job.costSource === "create-rejected"
        ? `refused by ${job.provider}, not charged`
        : "not charged"
      : job.state === "failed-charged"
        ? job.actualUsd != null
          ? `charged ${usd(job.actualUsd)}`
          : "charged"
        : job.state === "failed-unconfirmed"
          ? "may have been charged"
          : "not sent, not charged";
  return { kind: "failed", label, reason };
}

const STATE_WORD: Record<TakeStatus["kind"], string | null> = { done: null, running: "running", unwatched: "not being watched", uncertain: "uncertain", failed: "failed" };

/**
 * What a tile's button says to a screen reader: `Open minimax-h3 6s take: Ink drop blooms…`.
 * Model and duration tell takes apart, the state is named when the take did not succeed,
 * and the prompt is cut to about 60 characters.
 */
export function takeName(job: JobView, status: TakeStatus): string {
  const what = [job.model, durationLabel(job), STATE_WORD[status.kind]].filter(Boolean).join(" ");
  const prompt = job.prompt ? clip(job.prompt, 60) : "";
  return `Open ${what} take${prompt ? `: ${prompt}` : ""}`;
}

/**
 * Why Generate is disabled, from core's estimate, or null when it may run.
 * Core decides; this only words its verdict and the gap.
 */
export function refusalReason(est: Estimate | null): string | null {
  if (!est) return null;
  if (est.problems.length) return est.problems[0];
  if (!est.routeUsable) return `No usable route for ${est.model}. Check provider keys in Settings.`;
  if (est.estimateUsd == null) return `No price for ${est.model} at these settings.`;
  if (!est.withinPerJob && est.perJobUsd != null) return `over the per-job limit by ${gap(est.estimateUsd, est.perJobUsd)}, raise it in Settings`;
  if (!est.withinDailyCap) return `over today's cap by ${gap(est.estimateUsd, est.availableTodayUsd)}, raise it in Settings`;
  if (!est.withinBudget && est.budgetUsd != null) return `over this job's ${usd(est.budgetUsd)} budget`;
  return null;
}

/** Only the job's own budget stands in the way, which the user may lift for this job. */
export function onlyBudgetBlocks(est: Estimate | null): boolean {
  return Boolean(est && !est.problems.length && est.routeUsable && est.estimateUsd != null && est.withinPerJob && est.withinDailyCap && !est.withinBudget);
}

/** The file name at the end of a /media URL. */
export function mediaFile(url: string): string {
  return decodeURIComponent(url.split("/").pop() ?? "");
}

export const isVideo = (url: string) => /\.(mp4|mov|webm)$/i.test(url);

/** Width over height of a take's frame, e.g. 1.7778 for 16:9; 1 (square) when unknown. */
export function frameRatio(aspectRatio: string | null): number {
  const m = aspectRatio?.match(/^(\d+):(\d+)$/);
  const [w, h] = m ? [Number(m[1]), Number(m[2])] : [0, 0];
  return w > 0 && h > 0 ? Math.round((w / h) * 10_000) / 10_000 : 1;
}

/** How long a model usually takes: the median of its last few finished takes, else a fair guess for its kind. */
export function typicalSeconds(jobs: JobView[], model: string, capability: JobView["capability"]): number {
  const times = jobs
    .filter((j) => j.model === model && j.state === "succeeded")
    .slice(0, 7)
    .map((j) => (Date.parse(j.updatedAt) - Date.parse(j.createdAt)) / 1000)
    .filter((s) => Number.isFinite(s) && s > 1 && s < 3600)
    .sort((a, b) => a - b);
  if (times.length) return times[Math.floor(times.length / 2)];
  return capability === "video" ? 150 : 45;
}

/**
 * A rough share done, 0 to 0.97: quick at first, slowing as it nears the usual
 * time (86% there), and never reaching the end before the take does.
 */
export function progressOf(createdAt: string, now: number, expectedS: number): number {
  const t = Math.max(0, (now - Date.parse(createdAt)) / 1000);
  if (!Number.isFinite(t) || expectedS <= 0) return 0;
  return Math.min(0.97, 1 - Math.exp((-2 * t) / expectedS));
}
