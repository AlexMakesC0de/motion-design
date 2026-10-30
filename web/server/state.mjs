// Per-request context and the shapes the page reads. Context is rebuilt per
// call, like the MCP server's, so a limits change or a new run is seen at once.
import { openJobs, countedUsd, localDay, systemTimeZone } from "../../cli/core/jobs.mjs";
import { readLimits, dailyPosition } from "../../cli/core/spend.mjs";
import { openLibrary } from "../../cli/core/assets.mjs";
import { allowedRoots } from "../../cli/core/inputs.mjs";
import { jobSummary } from "../../cli/core/views.mjs";
import { mediaUrl } from "./media.mjs";

export function context() {
  const limits = readLimits();
  return { limits, store: openJobs(), library: openLibrary(), roots: allowedRoots(limits) };
}

const round = (n) => Math.round(n * 10_000) / 10_000;

/** A job as a take tile needs it. The raw provider input stays on disk. */
export function jobView(j) {
  const input = j.input ?? {};
  return {
    ...jobSummary(j),
    capability: j.capability ?? null,
    providerModel: j.providerModel ?? null,
    prompt: typeof input.prompt === "string" ? input.prompt : null,
    durationS: input.duration ?? input.duration_s ?? null,
    resolution: input.resolution != null ? String(input.resolution) : null,
    aspectRatio: input.aspect_ratio ?? null,
    failedOver: Boolean(j.failedOver),
    costSource: j.costSource ?? "none",
    countedUsd: countedUsd(j),
    error: j.error ?? null,
    media: (j.artifacts ?? []).map(mediaUrl).filter(Boolean),
    updatedAt: j.history?.at(-1)?.at ?? j.createdAt,
  };
}

/** Today against the cap, the per-job ceiling, and the last 14 local days. */
export function spendView(store, limits, now = new Date()) {
  const pos = dailyPosition(store, limits, now);
  const tz = systemTimeZone();
  const jobs = store.list();
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const day = localDay(new Date(now.getTime() - i * 86_400_000), tz);
    days.push({ day, usd: round(jobs.filter((j) => j.day === day).reduce((s, j) => s + countedUsd(j), 0)) });
  }
  // Today's bar uses the same rule as the cap (each job judged in its own zone).
  days[days.length - 1].usd = pos.spentUsd;
  return {
    capUsd: pos.capUsd,
    spentUsd: pos.spentUsd,
    availableUsd: pos.availableUsd,
    perJobUsd: limits.perJobUsd ?? null,
    unsettled: pos.unsettled.length,
    days,
  };
}
