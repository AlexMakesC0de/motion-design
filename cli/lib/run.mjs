import { constants, copyFileSync, existsSync, linkSync, mkdirSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { usage } from "./errors.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..", "..");
export const RUNS_DIR = process.env.KIE_RUNS_DIR || join(REPO_ROOT, "runs");
export const LIBRARY_DIR = process.env.KIE_LIBRARY_DIR || join(REPO_ROOT, "library");

/** True when `path` is strictly inside `root`. Both should already be real paths. */
export function isInside(path, root) {
  const rel = relative(root, path);
  return rel !== "" && !isAbsolute(rel) && rel.split(sep)[0] !== "..";
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

/** Create's own run: one-off scenes that belong to no film. Hidden from film lists. */
export const SCRATCH_RUN = "create";
/** Openjutsu's run: uploaded clips and pictures, and the takes made from them. Hidden from film lists. */
export const JUTSU_RUN = "jutsu";
/** Faces and sheets made in the AI influencer builder. Hidden from film lists. */
export const INFLUENCER_RUN = "influencers";
/** Sheets made from the Library's own popup. Hidden from film lists. */
export const LIBRARY_RUN = "library";
/** Runs that are pages' workspaces, not films. */
export const SIDE_RUNS = new Set([SCRATCH_RUN, JUTSU_RUN, INFLUENCER_RUN, LIBRARY_RUN]);

/**
 * Every generation is scoped to a run directory. There is no such thing as a
 * loose output: production.md requires a reproducible record per film, and the
 * only way that record reliably exists is if the tool writes it.
 */
export function runDir(slug, { create = true } = {}) {
  if (!slug) {
    throw usage("--run <slug> is required. It names the folder this film's record lands in.");
  }
  if (!SLUG.test(slug)) {
    throw usage(`--run "${slug}" must be lowercase letters, digits and hyphens.`);
  }
  const dir = join(RUNS_DIR, slug);
  if (create) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Never overwrite. A corrective retry produces out-2.mp4 beside out.mp4,
 * because production.md says to retain the original result for comparison --
 * which is impossible if take two lands on take one.
 */
export function nextArtifact(dir, base, ext) {
  const e = ext.startsWith(".") ? ext : `.${ext}`;
  let candidate = join(dir, `${base}${e}`);
  let n = 1;
  while (existsSync(candidate)) {
    n += 1;
    candidate = join(dir, `${base}-${n}${e}`);
  }
  return { path: candidate, take: n };
}

/**
 * Move a finished download into place under the first free take name. The
 * name is chosen at the moment of the move, and the move never replaces a
 * file: link() fails with EEXIST when the name is taken, so two processes
 * finishing together get out.mp4 and out-2.mp4 rather than one clobbering
 * the other. Where hard links are unsupported, an exclusive copy keeps the
 * same no-clobber rule.
 */
export function claimArtifact(tmpPath, dir, base, ext) {
  const e = ext.startsWith(".") ? ext : `.${ext}`;
  for (let n = 1; ; n += 1) {
    const candidate = join(dir, n === 1 ? `${base}${e}` : `${base}-${n}${e}`);
    try {
      linkSync(tmpPath, candidate);
    } catch (err) {
      if (err.code === "EEXIST") continue;
      if (!["EPERM", "ENOTSUP", "EXDEV", "ENOSYS", "EMLINK"].includes(err.code)) throw err;
      try {
        copyFileSync(tmpPath, candidate, constants.COPYFILE_EXCL);
      } catch (copyErr) {
        if (copyErr.code === "EEXIST") continue;
        throw copyErr;
      }
    }
    rmSync(tmpPath, { force: true });
    return { path: candidate, take: n };
  }
}

/**
 * Fetch one result into the run without ever writing a half file under a take
 * name. `fetchTo(path)` writes a hidden `.part` file in `dir`; only a complete
 * file is moved to its final name. An interrupted fetch (Ctrl-C) leaves at most
 * the `.part`, and a failed one leaves nothing.
 */
export async function landArtifact(dir, base, ext, fetchTo) {
  const e = ext.startsWith(".") ? ext : `.${ext}`;
  const part = join(dir, `.${base}${e}.${randomBytes(4).toString("hex")}.part`);
  try {
    await fetchTo(part);
    return claimArtifact(part, dir, base, e);
  } finally {
    rmSync(part, { force: true });
  }
}

/**
 * Resolve a user-supplied `--out`.
 *
 * A bare name belongs to the run directory -- `--out film.mp4` must not write
 * to whatever directory the agent happened to be standing in, or the run record
 * points at a file that is not there. A name carrying a separator, or an
 * absolute path, is an explicit location and is honoured. With no `--out` at
 * all, fall through to non-destructive numbering.
 */
export function outPath(dir, out, base, ext) {
  if (!out) return nextArtifact(dir, base, ext).path;
  if (isAbsolute(out)) return out;
  if (out.includes("/")) return resolve(out);
  return join(dir, out);
}

/** Same rule for inputs: a bare name is looked for in the run directory first. */
export function inPath(dir, name) {
  if (!name) return null;
  if (isAbsolute(name) || name.includes("/")) return resolve(name);
  const inRun = join(dir, name);
  return existsSync(inRun) ? inRun : resolve(name);
}

export function extFromUrl(url, fallback) {
  const clean = url.split("?")[0];
  const ext = extname(clean);
  return ext && ext.length <= 5 ? ext : fallback;
}

export async function writeRecord(dir, name, data) {
  const path = join(dir, name);
  const body = typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n";
  await writeFile(path, body);
  return path;
}
