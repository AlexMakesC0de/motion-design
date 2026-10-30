import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { RUNS_DIR } from "../lib/run.mjs";
import { budget, provider, usage } from "../lib/errors.mjs";
import { UNSETTLED, countedUsd, localDay, pidAlive } from "./jobs.mjs";

export const DEFAULT_LIMITS = { dailyUsd: 10, allowRoots: [] };
export const LOCK_PATH = join(RUNS_DIR, ".spend.lock");

/** ~/.config/kie/limits.json. No MCP tool writes it; `kie limits` is the only writer. */
export const limitsPath = () => process.env.KIE_LIMITS_FILE || join(homedir(), ".config", "kie", "limits.json");

export function readLimits(path = limitsPath()) {
  if (!existsSync(path)) return { ...DEFAULT_LIMITS };
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw usage(`${path} is not valid JSON (${e.message}). Fix it or delete it to return to a $10 cap.`);
  }
  const limits = { ...DEFAULT_LIMITS, ...raw };
  if (typeof limits.dailyUsd !== "number" || !(limits.dailyUsd >= 0)) {
    throw usage(`${path}: dailyUsd must be a number of dollars, 0 or more.`);
  }
  if (!Array.isArray(limits.allowRoots)) throw usage(`${path}: allowRoots must be a list of directories.`);
  return limits;
}

export function setDailyLimit(usd, path = limitsPath()) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n < 0) throw usage(`--daily wants a dollar amount of 0 or more, got "${usd}".`);
  const next = { ...readLimits(path), dailyUsd: n };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
  return next;
}

const round = (n) => Math.round(n * 10_000) / 10_000;

/** Sum of what today's jobs count, each judged in the time zone it was submitted in. */
export function spentToday(jobs, now = new Date()) {
  return round(
    jobs.filter((j) => j.day === localDay(now, j.timeZone)).reduce((sum, j) => sum + countedUsd(j), 0),
  );
}

export function dailyPosition(store, limits, now = store.now()) {
  const jobs = store.list();
  const spentUsd = spentToday(jobs, now);
  return {
    capUsd: limits.dailyUsd,
    spentUsd,
    availableUsd: round(Math.max(0, limits.dailyUsd - spentUsd)),
    unsettled: jobs.filter((j) => UNSETTLED.has(j.state)),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readLock(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Run `fn` holding runs/.spend.lock. The lock covers one local read-and-write
 * (check the total, write the reservation) and is never held across a network
 * call, so a slow provider cannot block every other job.
 *
 * A lock is stale when its process is gone or it is older than 30 seconds.
 * Known limit: two waiters that both judge the same lock stale can race on
 * removing it. Stale locks only follow a crash, so this is accepted.
 */
export async function withSpendLock(fn, { path = LOCK_PATH, staleMs = 30_000, waitMs = 5_000, onWarn = () => {} } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const started = Date.now();

  for (;;) {
    try {
      const fd = openSync(path, "wx");
      writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token }));
      closeSync(fd);
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const held = readLock(path);
    const ageMs = held ? Date.now() - Date.parse(held.at) : Date.now() - (statSafe(path)?.mtimeMs ?? Date.now());
    const stale = held ? !pidAlive(held.pid) || ageMs > staleMs : ageMs > staleMs;
    if (stale) {
      try {
        unlinkSync(path);
      } catch {
        /* someone else removed it first */
      }
      onWarn(`Removed a stale spend lock (pid ${held?.pid ?? "?"}, taken ${held?.at ?? "at an unknown time"}).`);
      continue;
    }
    if (Date.now() - started > waitMs) {
      throw provider(
        `The spend lock is busy (${path}, held by pid ${held?.pid ?? "?"}). Nothing was submitted; try again in a moment.`,
      );
    }
    await sleep(25 + Math.random() * 50);
  }

  try {
    return await fn();
  } finally {
    if (readLock(path)?.token === token) unlinkSync(path);
  }
}

function statSafe(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * Reserve, then submit, then reconcile. This is the first step: under the lock,
 * settle abandoned records, check the estimate against what is left of today's
 * cap, and write the `reserved` record. Over the cap, nothing is written and
 * the error says only the user can raise it.
 */
export async function reserve(store, fields, { limits = readLimits(), lock = {} } = {}) {
  return withSpendLock(() => {
    store.sweep();
    const pos = dailyPosition(store, limits);
    if (fields.estimateUsd > pos.availableUsd) {
      throw budget(
        `Refused, nothing spent. Estimated $${fields.estimateUsd.toFixed(2)}; ` +
          `$${pos.availableUsd.toFixed(2)} of today's $${limits.dailyUsd.toFixed(2)} cap is available ` +
          `($${pos.spentUsd.toFixed(2)} spent or held). Ask the user; only they can raise it, with: kie limits --daily N`,
        { estimatedUsd: fields.estimateUsd, availableUsd: pos.availableUsd, capUsd: limits.dailyUsd },
      );
    }
    return store.create(fields);
  }, lock);
}
