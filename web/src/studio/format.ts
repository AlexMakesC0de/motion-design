import type { Estimate, JobView } from "../api/types";

export const usd = (n: number) => `$${n.toFixed(2)}`;

/** A positive gap in dollars, never shown as $0.00. */
const gap = (a: number, b: number) => usd(Math.max(0.01, a - b));

const RUNNING = new Set(["reserved", "sending", "submitted"]);

/** The actual cost when known, else the estimate marked with ~. */
export function takeCost(job: JobView): string {
  if (job.actualUsd != null) return usd(job.actualUsd);
  if (job.estimateUsd != null) return `~${usd(job.estimateUsd)}`;
  return "—";
}

/** `model-id · 5s · 720p`, the engine line every tile shows before its cost. */
export function takeSpec(job: JobView): string {
  const parts = [job.model];
  if (job.durationS != null && job.durationS !== "") parts.push(`${Number(job.durationS)}s`);
  if (job.resolution) parts.push(job.resolution);
  return parts.join(" · ");
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

/** CSS aspect-ratio for a take's frame; square when unknown. */
export function frameRatio(aspectRatio: string | null): string {
  const m = aspectRatio?.match(/^(\d+):(\d+)$/);
  return m ? `${m[1]} / ${m[2]}` : "1 / 1";
}
