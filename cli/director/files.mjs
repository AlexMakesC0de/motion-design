import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeSync } from "node:fs";
import { join, sep } from "node:path";
import { RUNS_DIR, runDir } from "../lib/run.mjs";
import { unknown, usage } from "../lib/errors.mjs";

/** The director's files in a film folder. Anything else is refused. */
export const FILM_FILES = ["brief.json", "shots.json", "reviews.json", "cut.json"];

const linked = (film, what) => unknown(`runs/${film}${what} is a link; the director only writes plain files in a film.`);

/**
 * runs/<film>/<name>. The film must be a real folder inside runs/ (not a
 * link) and the file must not be a link, even a dangling one, so a write can
 * never land outside the film. With `create`, a missing film folder is made.
 */
export function filmFile(film, name, { create = false } = {}) {
  if (!FILM_FILES.includes(name)) throw usage(`The director keeps ${FILM_FILES.join(", ")}, not ${name}.`);
  const dir = runDir(film, { create: false });
  const d = lstatSync(dir, { throwIfNoEntry: false });
  if (d && (d.isSymbolicLink() || !d.isDirectory())) throw linked(film, "");
  if (!d && create) runDir(film, { create: true });
  if (d || create) {
    const root = realpathSync(RUNS_DIR);
    if (!realpathSync(dir).startsWith(root + sep)) throw linked(film, "");
  }
  const file = join(dir, name);
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

/**
 * Write atomically: a temp file opened with O_NOFOLLOW, then a rename. The
 * version being replaced is copied first to runs/<film>/.history/<stamp>/,
 * as the Library keeps old assets. Returns the path written.
 */
export function writeFilmJson(film, name, data, { now = () => new Date() } = {}) {
  const file = filmFile(film, name, { create: true });
  const dir = runDir(film, { create: false });
  if (existsSync(file)) {
    if (lstatSync(join(dir, ".history"), { throwIfNoEntry: false })?.isSymbolicLink()) throw linked(film, "/.history");
    const stamp = now().toISOString().replace(/[:.]/g, "-");
    let hist = join(dir, ".history", stamp);
    for (let n = 2; existsSync(join(hist, name)); n += 1) hist = join(dir, ".history", `${stamp}-${n}`);
    mkdirSync(hist, { recursive: true });
    writeNoFollow(join(hist, name), readFileSync(file));
  }
  const tmp = `${file}.tmp`;
  writeNoFollow(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, file);
  return file;
}

function writeNoFollow(path, body) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644);
  try {
    writeSync(fd, body);
  } finally {
    closeSync(fd);
  }
}
