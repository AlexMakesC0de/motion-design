import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { runDir } from "../lib/run.mjs";
import { loadMenu } from "./menu.mjs";
import { stillWording } from "./still.mjs";

/** One still, take or sheet attempt as the storyboard shows it. */
const item = (j) => ({
  jobId: j.id,
  state: j.state,
  file: j.artifacts?.length ? basename(j.artifacts[0]) : null,
  model: j.model,
  estimateUsd: j.estimateUsd ?? null,
  actualUsd: j.actualUsd ?? null,
  error: j.error ?? null,
  createdAt: j.createdAt,
});

/**
 * The stills and takes of each shot, read from the job store: every attempt
 * with its state, plus the file each shot uses. A shot uses the still or take
 * somebody chose (shot.still, shot.take) while that file is in the run folder,
 * else its newest finished one. A still made from older wording than the
 * shot's current wording is stale: the shot changed after it was made.
 */
export function shotMedia(store, film, plan, { assets = [], brief = null, menu = loadMenu() } = {}) {
  const dir = runDir(film, { create: false });
  const jobs = store.list().filter((j) => j.run === film && j.shot);
  const out = {};
  for (const s of Array.isArray(plan?.shots) ? plan.shots : []) {
    if (!s || typeof s.id !== "string") continue;
    const mine = jobs.filter((j) => j.shot === s.id);
    let sha = null;
    try {
      sha = stillWording(plan, s, { assets, brief, menu }).sha;
    } catch {
      // a shot too incomplete to word has no current wording to compare
    }
    const stills = mine.filter((j) => j.stage === "still").map((j) => ({ ...item(j), stale: Boolean(sha && j.stillSha && j.stillSha !== sha) }));
    const takes = mine.filter((j) => j.stage === "take").map((j) => ({ ...item(j), from: j.firstFrame ?? null, generatedS: j.generatedS ?? null }));
    out[s.id] = { stills, takes, still: chosen(dir, s.still, stills), take: chosen(dir, s.take, takes) };
  }
  return out;
}

/** The file somebody chose while it exists, else the newest finished attempt's. */
function chosen(dir, named, attempts) {
  if (typeof named === "string" && /^[\w.-]+$/.test(named) && existsSync(join(dir, named))) return named;
  return attempts.filter((a) => a.state === "succeeded" && a.file && existsSync(join(dir, a.file))).at(-1)?.file ?? null;
}
