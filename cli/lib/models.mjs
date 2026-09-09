import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unknown, usage } from "./errors.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MODELS_PATH = join(HERE, "..", "models.json");

let cache = null;

export function loadCatalog(path = MODELS_PATH) {
  if (cache && path === MODELS_PATH) return cache;
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const catalog = {
    ...raw,
    list: Object.entries(raw.models).map(([id, m]) => ({ id, ...m })),
  };
  if (path === MODELS_PATH) cache = catalog;
  return catalog;
}

/** Days since the catalog was captured, or null if undated. */
export function catalogAgeDays(catalog) {
  if (!catalog.captured) return null;
  const then = Date.parse(catalog.captured);
  if (Number.isNaN(then)) return null;
  // Clamped: a capture date parsed as UTC midnight can sit slightly ahead of a
  // local "now" on the same calendar day, and "-1 days ago" reads as a bug.
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

export function isStale(catalog) {
  const age = catalogAgeDays(catalog);
  return age !== null && age > (catalog.staleAfterDays ?? 30);
}

/**
 * Resolve a model id. Refuses anything not in the table rather than forwarding
 * it to kie.ai -- a hallucinated `--model seedance-3` must fail here, free and
 * instantly, not as a 404 three minutes and one upload later.
 */
export function resolveModel(catalog, id, capability) {
  const m = catalog.models[id];
  if (!m) {
    const options = catalog.list
      .filter((x) => !capability || x.capability === capability)
      .map((x) => x.id);
    throw unknown(
      `Unknown model "${id}". Available${capability ? ` for ${capability}` : ""}: ${options.join(", ")}`,
      { available: options },
    );
  }
  if (capability && m.capability !== capability) {
    throw unknown(
      `Model "${id}" is a ${m.capability} model; this command needs ${capability}.`,
    );
  }
  return { id, ...m };
}

/**
 * Validate requested settings against the model's real schema, BEFORE anything
 * is submitted or uploaded. Returns the list of models that could satisfy the
 * request, so the error is actionable rather than just a refusal.
 */
export function validateVideoRequest(catalog, model, { durationS, aspectRatio, refs = [] }) {
  const problems = [];

  if (durationS != null && model.durationsS && !model.durationsS.includes(durationS)) {
    const able = catalog.list
      .filter((m) => m.capability === "video" && m.durationsS?.includes(durationS))
      .map((m) => m.id);
    problems.push(
      `${model.id} generates ${model.durationsS.join("/")}s, not ${durationS}s.` +
        (able.length
          ? ` Models that do ${durationS}s: ${able.join(", ")}.`
          : ` No model in the table does ${durationS}s in one job -- either extend a shorter take, or segment and say so (production.md treats segmentation as an explained fallback, not a default).`),
    );
  }

  if (aspectRatio && model.aspectRatios && !model.aspectRatios.includes(aspectRatio)) {
    problems.push(
      `${model.id} supports ${model.aspectRatios.join(", ")}, not ${aspectRatio}.`,
    );
  }

  for (const r of refs) {
    if (!catalog.roles.includes(r.role)) {
      problems.push(
        `Unknown reference role "${r.role}". Roles: ${catalog.roles.join(", ")}.`,
      );
    } else if (model.refs && !model.refs.includes(r.role)) {
      problems.push(
        `${model.id} accepts reference roles ${model.refs.join(", ")}; it has no "${r.role}" input.`,
      );
    }
  }

  return problems;
}

/** `--ref <url>:<role>` -- refuses a local path by design. See parseRef tests. */
export function parseRef(spec) {
  const idx = spec.lastIndexOf(":");
  if (idx <= 0) {
    throw usage(`--ref must be "<url>:<role>", got "${spec}".`);
  }
  const url = spec.slice(0, idx);
  const role = spec.slice(idx + 1);

  if (!/^https?:\/\//i.test(url)) {
    throw usage(
      `A local path is not a remote attachment: "${url}".\n` +
        `Run \`kie upload ${url}\` first and pass the URL it prints.`,
    );
  }
  return { url, role };
}
