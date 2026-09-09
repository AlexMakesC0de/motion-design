import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { usage } from "./errors.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..", "..");
export const RUNS_DIR = process.env.KIE_RUNS_DIR || join(REPO_ROOT, "runs");

const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;

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
