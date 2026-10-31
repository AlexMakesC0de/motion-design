import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, unlinkSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, sep } from "node:path";
import { RUNS_DIR, runDir } from "../lib/run.mjs";
import { pidAlive } from "../core/jobs.mjs";
import { provider, unknown, usage } from "../lib/errors.mjs";

/** The director's files in a film folder. Anything else is refused. */
export const FILM_FILES = ["brief.json", "shots.json", "reviews.json", "cut.json", "production.json"];

/** Old versions kept per file in runs/<film>/.history; older ones are deleted. */
export const HISTORY_KEEP = 50;

const linked = (film, what) => unknown(`runs/${film}${what} is a link; the director only writes plain files in a film.`);

/** runs/<film>, refused when it is a link or not a real folder inside runs/. With `create`, a missing one is made. */
function filmDir(film, { create = false } = {}) {
  const dir = runDir(film, { create: false });
  const d = lstatSync(dir, { throwIfNoEntry: false });
  if (d && (d.isSymbolicLink() || !d.isDirectory())) throw linked(film, "");
  if (!d && create) runDir(film, { create: true });
  if (d || create) {
    const root = realpathSync(RUNS_DIR);
    if (!realpathSync(dir).startsWith(root + sep)) throw linked(film, "");
  }
  return dir;
}

/**
 * runs/<film>/<name>. The film must be a real folder inside runs/ (not a
 * link) and the file must not be a link, even a dangling one, so a write can
 * never land outside the film. With `create`, a missing film folder is made.
 */
export function filmFile(film, name, { create = false } = {}) {
  if (!FILM_FILES.includes(name)) throw usage(`The director keeps ${FILM_FILES.join(", ")}, not ${name}.`);
  const file = join(filmDir(film, { create }), name);
  if (lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) throw linked(film, `/${name}`);
  return file;
}

/** The parsed file, or null when the film or the file does not exist yet. A file that is not JSON is an error. */
export function readFilmJson(film, name, { ifInvalid } = {}) {
  const file = filmFile(film, name);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    if (ifInvalid !== undefined) return ifInvalid;
    throw unknown(`runs/${film}/${name} is not valid JSON. Fix it by hand or save it again.`);
  }
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const depth = new Map(); // film -> how many times this process holds its lock

/**
 * Run `fn` holding runs/<film>/.director.lock, so a read-modify-write of a
 * film file (shots.json, reviews.json) in one process cannot lose another
 * process's update. Re-entrant within a process; `fn` is synchronous. Like
 * the spend lock, a lock whose process is gone or that is older than 30
 * seconds is stale and taken over.
 */
export function withFilmLock(film, fn, { staleMs = 30_000, waitMs = 5_000 } = {}) {
  if (depth.get(film)) {
    depth.set(film, depth.get(film) + 1);
    try {
      return fn();
    } finally {
      depth.set(film, depth.get(film) - 1);
    }
  }
  const path = join(filmDir(film, { create: true }), ".director.lock");
  const token = `${process.pid}-${randomBytes(6).toString("hex")}`;
  const started = Date.now();
  for (;;) {
    try {
      const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
      try {
        writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token }));
      } finally {
        closeSync(fd);
      }
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    let held = null;
    try {
      held = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      /* gone, or half written */
    }
    const at = held ? Date.parse(held.at) : lstatSync(path, { throwIfNoEntry: false })?.mtimeMs ?? Date.now();
    if ((held && !pidAlive(held.pid)) || Date.now() - at > staleMs) {
      rmSync(path, { force: true });
      continue;
    }
    if (Date.now() - started > waitMs) throw provider(`runs/${film} is being saved by another process (pid ${held?.pid ?? "?"}). Nothing was saved; try again in a moment.`);
    sleepSync(10 + Math.floor(Math.random() * 20));
  }
  depth.set(film, 1);
  try {
    return fn();
  } finally {
    depth.delete(film);
    try {
      if (JSON.parse(readFileSync(path, "utf8")).token === token) unlinkSync(path);
    } catch {
      /* already gone */
    }
  }
}

/**
 * Write atomically, under the film's lock: a new temp file of a random name,
 * opened exclusively and without following links, then a rename. A film file
 * with other hard links is refused. The version being replaced is copied
 * first to runs/<film>/.history/<stamp>/, as the Library keeps old assets;
 * the newest HISTORY_KEEP versions of each file are kept. Returns the path.
 */
export function writeFilmJson(film, name, data, { now = () => new Date() } = {}) {
  return withFilmLock(film, () => {
    const file = filmFile(film, name, { create: true });
    const dir = runDir(film, { create: false });
    const st = lstatSync(file, { throwIfNoEntry: false });
    if (st && st.nlink > 1) throw unknown(`runs/${film}/${name} has other hard links; the director only writes plain files in a film.`);
    if (st) {
      const history = join(dir, ".history");
      if (lstatSync(history, { throwIfNoEntry: false })?.isSymbolicLink()) throw linked(film, "/.history");
      const stamp = now().toISOString().replace(/[:.]/g, "-");
      let hist = join(history, stamp);
      for (let n = 2; existsSync(join(hist, name)); n += 1) hist = join(history, `${stamp}-${n}`);
      mkdirSync(hist, { recursive: true });
      if (lstatSync(hist).isSymbolicLink()) throw linked(film, `/.history/${hist.split(sep).pop()}`);
      writeNew(join(hist, name), readFileSync(file));
      pruneHistory(history, name);
    }
    const tmp = `${file}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
    try {
      writeNew(tmp, JSON.stringify(data, null, 2) + "\n");
      renameSync(tmp, file);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw err;
    }
    return file;
  });
}

/** Stamp folders oldest first: by time, then by the -n of saves in the same instant. */
const byAge = (a, b) => {
  const [, ta = a, na = "1"] = a.match(/^(.+Z)(?:-(\d+))?$/) ?? [];
  const [, tb = b, nb = "1"] = b.match(/^(.+Z)(?:-(\d+))?$/) ?? [];
  return ta === tb ? Number(na) - Number(nb) : ta < tb ? -1 : 1;
};

function pruneHistory(history, name) {
  const versions = readdirSync(history).filter((d) => existsSync(join(history, d, name))).sort(byAge);
  for (const d of versions.slice(0, Math.max(0, versions.length - HISTORY_KEEP))) {
    rmSync(join(history, d, name), { force: true });
    try {
      rmdirSync(join(history, d));
    } catch {
      /* other files' versions are still in it */
    }
  }
}

/** A new file, never one that exists (a planted link or hard link included). */
function writeNew(path, body) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
  try {
    writeSync(fd, body);
  } finally {
    closeSync(fd);
  }
}
