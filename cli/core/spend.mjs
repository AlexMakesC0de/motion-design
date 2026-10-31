import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { RUNS_DIR } from "../lib/run.mjs";
import { budget, provider, usage } from "../lib/errors.mjs";
import { UNSETTLED, countedUsd, localDay, pidAlive } from "./jobs.mjs";

export const DEFAULT_LIMITS = { dailyUsd: 10, allowRoots: [] };
export const LOCK_PATH = join(RUNS_DIR, ".spend.lock");

/** ~/.config/kie/limits.json. Writers: `kie limits` and the studio's Settings screen. No MCP tool or chat path writes it. */
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
  if (limits.perJobUsd != null && (typeof limits.perJobUsd !== "number" || !(limits.perJobUsd > 0))) {
    throw usage(`${path}: perJobUsd must be a dollar amount above 0, or absent for no per-job limit.`);
  }
  return limits;
}

/**
 * Write limits.json whole or not at all: the new text goes to a temp file in
 * the same folder (so the rename cannot cross a filesystem), is flushed, and
 * is renamed over the old file. A crash leaves the old file or the new one,
 * never half of either. A limits.json that is a symlink (dotfiles setups) is
 * written through to its target, so the link survives.
 */
function writeLimits(path, limits) {
  const target = existsSync(path) ? realpathSync(path) : path;
  mkdirSync(dirname(target), { recursive: true });
  const temp = join(dirname(target), `.${basename(target)}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`);
  try {
    const fd = openSync(temp, "wx", 0o644);
    try {
      writeFileSync(fd, JSON.stringify(limits, null, 2) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, target);
  } catch (err) {
    try {
      unlinkSync(temp);
    } catch {
      /* never created, or already renamed */
    }
    throw err;
  }
}

function dailyValue(usd) {
  const n = Number(usd);
  // Number("") is 0, which would silently set the cap to 0.
  if (String(usd ?? "").trim() === "" || !Number.isFinite(n) || n < 0) throw usage(`--daily wants a dollar amount of 0 or more, got "${usd}".`);
  return n;
}

/** A dollar amount above 0, or null for "off" (or null, undefined): no per-job ceiling. */
function perJobValue(usd) {
  if (usd == null || String(usd).trim() === "off") return null;
  const n = Number(usd);
  if (String(usd).trim() === "" || !Number.isFinite(n) || n <= 0) throw usage(`--per-job wants a dollar amount above 0, or "off", got "${usd}".`);
  return n;
}

export function setDailyLimit(usd, path = limitsPath()) {
  const next = { ...readLimits(path), dailyUsd: dailyValue(usd) };
  writeLimits(path, next);
  return next;
}

/** "off" (or null) removes the per-job ceiling; anything else must be a dollar amount above 0. */
export function setPerJobLimit(usd, path = limitsPath()) {
  const { perJobUsd: _old, ...rest } = readLimits(path);
  const n = perJobValue(usd);
  const next = n == null ? rest : { ...rest, perJobUsd: n };
  writeLimits(path, next);
  return next;
}

/**
 * Both limits in one write, for a caller (the studio's Settings) that has both
 * values at once: with two setters, a failure between them would leave one
 * changed. Same rules and messages as the setters; both are checked before
 * anything is written. perJobUsd null, undefined or "off" means no ceiling.
 */
export function setLimits({ dailyUsd, perJobUsd } = {}, path = limitsPath()) {
  const { perJobUsd: _old, ...rest } = readLimits(path);
  const daily = dailyValue(dailyUsd);
  const each = perJobValue(perJobUsd);
  const next = { ...rest, dailyUsd: daily, ...(each == null ? {} : { perJobUsd: each }) };
  writeLimits(path, next);
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
 *
 * `claim(store)`, when given, runs under the same lock just before the record
 * is written and throws to refuse. Every reservation in every process is
 * written under this lock, so a claim that finds no conflicting record knows
 * none can appear before its own: the director uses it so a shot never has two
 * takes in flight.
 */
export async function reserve(store, fields, { limits = readLimits(), lock = {}, claim = null } = {}) {
  if (limits.perJobUsd != null && fields.estimateUsd > limits.perJobUsd) {
    throw budget(
      `Refused, nothing spent. Estimated $${fields.estimateUsd.toFixed(2)} is above the ` +
        `$${limits.perJobUsd.toFixed(2)} per-job limit. Ask the user; only they can raise it, with: kie limits --per-job N`,
      { estimatedUsd: fields.estimateUsd, perJobUsd: limits.perJobUsd },
    );
  }
  return withSpendLock(() => {
    store.sweep();
    claim?.(store);
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
