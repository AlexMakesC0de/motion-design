import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RUNS_DIR } from "./run.mjs";

export const LEDGER_PATH = join(RUNS_DIR, ".ledger.jsonl");

/**
 * Append-only. Every submitted job writes one line whether it succeeded or not
 * -- a failed generation still costs money on most providers, and a ledger that
 * only records successes systematically under-reports spend.
 *
 * `estimatedUsd` comes from cli/models.json and is a guess. `creditsBefore` and
 * `creditsAfter` are facts read from the account. They are recorded separately
 * and reported separately, because kie.ai exposes no per-job cost and dressing
 * an estimate up as an actual is how a budget tool stops being trustworthy.
 */
export function append(entry) {
  mkdirSync(RUNS_DIR, { recursive: true });
  appendFileSync(
    LEDGER_PATH,
    JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n",
  );
}

export function read() {
  if (!existsSync(LEDGER_PATH)) return [];
  return readFileSync(LEDGER_PATH, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export function summarise(entries) {
  const byModel = new Map();
  let estimated = 0;
  let jobs = 0;
  let failures = 0;

  for (const e of entries) {
    jobs += 1;
    if (e.status && e.status !== "success") failures += 1;
    const est = Number(e.estimatedUsd) || 0;
    estimated += est;
    const cur = byModel.get(e.model) ?? { jobs: 0, estimated: 0 };
    cur.jobs += 1;
    cur.estimated += est;
    byModel.set(e.model, cur);
  }

  // Credit deltas are only meaningful when jobs ran sequentially, which the CLI
  // does by default. Reported as a range rather than a total for that reason.
  const withCredits = entries.filter(
    (e) => typeof e.creditsBefore === "number" && typeof e.creditsAfter === "number",
  );
  const creditsUsed = withCredits.reduce(
    (sum, e) => sum + Math.max(0, e.creditsBefore - e.creditsAfter),
    0,
  );

  return {
    jobs,
    failures,
    estimatedUsd: Math.round(estimated * 100) / 100,
    creditsUsed: withCredits.length ? creditsUsed : null,
    creditSamples: withCredits.length,
    byModel: [...byModel.entries()]
      .map(([model, v]) => ({ model, ...v, estimated: Math.round(v.estimated * 100) / 100 }))
      .sort((a, b) => b.estimated - a.estimated),
  };
}

export function filter(entries, { run, since, today } = {}) {
  let out = entries;
  if (run) out = out.filter((e) => e.run === run);
  if (today) {
    const d = new Date().toISOString().slice(0, 10);
    out = out.filter((e) => (e.at ?? "").slice(0, 10) === d);
  }
  if (since) out = out.filter((e) => (e.at ?? "") >= since);
  return out;
}
