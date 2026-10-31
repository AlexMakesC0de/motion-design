import { UNSETTLED } from "../core/jobs.mjs";
import { loadMenu } from "./menu.mjs";
import { readBrief } from "./brief.mjs";
import { readPlan } from "./plan.mjs";
import { shotMedia } from "./media.mjs";
import { readReviews } from "./review.mjs";
import { readFilmJson } from "./files.mjs";
import { readProduction } from "./redo.mjs";

/**
 * The storyboard: for each shot the still and take it uses, every attempt,
 * whether a take is being filmed or failed, and the review of the take in
 * use (a review of an older take is not shown as current). Free; shared by
 * kie shots, get_shots and the studio.
 */
export function board(store, film, { assets = [], menu = loadMenu() } = {}) {
  const plan = readPlan(film);
  const brief = readBrief(film);
  const production = readProduction(film);
  if (!plan) return { film, brief, plan: null, shots: [], production, cut: readFilmJson(film, "cut.json", { ifInvalid: null }) ?? null };
  const media = shotMedia(store, film, plan, { assets, brief, menu });
  const reviews = readReviews(film);
  const shots = plan.shots.map((s, i) => {
    const m = media[s.id];
    const stillItem = m.stills.find((x) => x.file === m.still);
    const review = reviews[s.id] && reviews[s.id].take === m.take ? reviews[s.id] : null;
    const lastTake = m.takes.at(-1);
    return {
      id: s.id,
      durationS: s.durationS,
      continuesFrom: i > 0 && plan.shots[i - 1].cut === "continuous" ? plan.shots[i - 1].id : null,
      still: m.still,
      stillStale: Boolean(stillItem?.stale),
      take: m.take,
      filming: m.takes.filter((t) => UNSETTLED.has(t.state)).map((t) => t.jobId),
      failed: !m.take && lastTake && !UNSETTLED.has(lastTake.state) && lastTake.state !== "succeeded" ? { jobId: lastTake.jobId, state: lastTake.state, error: lastTake.error } : null,
      review,
      tries: m.takes.filter((t) => t.state !== "failed-confirmed-free").length,
      stills: m.stills,
      takes: m.takes,
    };
  });
  return { film, brief, plan, shots, production, cut: readFilmJson(film, "cut.json", { ifInvalid: null }) ?? null };
}

/** One line per shot: its still, its take and the verdict on it. */
export function boardLines(b) {
  if (!b.plan) return [`runs/${b.film} has no plan yet.`];
  const lines = [`${b.film} · v${b.plan.version ?? "?"} · ${b.shots.length} shot(s)`];
  for (const s of b.shots) {
    const still = s.continuesFrom ? `starts on ${s.continuesFrom}'s last frame` : s.still ? `still ${s.still}${s.stillStale ? " (stale: the shot changed after it)" : ""}` : "no still";
    const take = s.take ? `take ${s.take}` : s.filming.length ? `filming (${s.filming.join(", ")})` : s.failed ? `take ${s.failed.state}: ${s.failed.error ?? "no message"}` : "no take";
    const review = s.review ? `${s.review.verdict}${s.review.checks.some((c) => !c.ok) ? ` · ${s.review.checks.filter((c) => !c.ok).map((c) => c.note ?? c.check).join("; ")}` : ""}` : s.take ? "not reviewed" : "";
    lines.push(`${s.id}  ${s.durationS}s  ${still} · ${take}${review ? ` · ${review}` : ""}`);
  }
  if (b.production?.autoRedo) lines.push("", `auto-redo on: up to 2 redos a shot, takes within $${b.production.maxUsd.toFixed(2)} in all`);
  if (b.cut) lines.push("", `cut: ${b.cut.out} · ${b.cut.totalS}s`);
  return lines;
}
