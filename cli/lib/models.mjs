import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unknown, usage } from "./errors.mjs";
import { getProvider, hasKey } from "./providers.mjs";

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
  // Own keys only: "constructor" or "__proto__" must not read as a model.
  const m = Object.hasOwn(catalog.models, id) ? catalog.models[id] : undefined;
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

/**
 * The route as it will actually be called. Providers that split image-to-video
 * into its own model id often give it its own contract too -- kie's H3 i2v has
 * no aspect_ratio at all -- so the i2v model brings `i2vInput` when one was
 * captured, and falls back to the t2v contract when not.
 */
export function effectiveRoute(route, useI2v) {
  if (!useI2v || !route.i2vModel) return route;
  return { ...route, model: route.i2vModel, input: route.i2vInput ?? route.input };
}

/**
 * Build the `input` object kie.ai actually wants for THIS model.
 *
 * Every model has its own contract and they disagree in ways that fail at
 * submit time with an unhelpful "This field is required": wan takes `duration`
 * as a string and has no aspect ratio at all, seedance takes it as an integer
 * and requires `resolution`, seedream requires `quality` with values
 * basic|high rather than the low|medium|high its sibling models use. Encoding
 * the contract in models.json and building from it here is the only way a
 * single `kie video` can serve all of them.
 */
export function buildInput(route, values = {}) {
  const schema = route.input;
  if (!schema) {
    // No captured contract: send what we were given and say so loudly. This is
    // the schemaVerified:false path -- a guess, not a claim.
    // `refs` is our own vocabulary, not a provider field. Without a captured
    // contract there is no field name to map it to, so it must be dropped
    // rather than posted as a stray array the provider will reject.
    const { refs, params, ...rest } = values;
    const problems = [];
    if (refs?.length) {
      problems.push(
        `No captured contract for this route, so reference roles ` +
          `(${refs.map((r) => r.role).join(", ")}) cannot be mapped to its input fields. ` +
          `Use a route whose schema is verified, or capture this one's doc page.`,
      );
    }
    if (params && Object.keys(params).length) {
      problems.push(
        `No captured contract for this route, so --param ${Object.keys(params).join(", ")} ` +
          `cannot be checked. Capture its doc page into models.json first.`,
      );
    }
    return {
      input: Object.fromEntries(Object.entries(rest).filter(([, v]) => v != null)),
      unverified: true,
      problems,
    };
  }

  const out = { ...(schema.defaults ?? {}) };
  const problems = [];

  const coerce = (key, v) => {
    const type = schema.types?.[key];
    if (type === "string") return String(v);
    if (type === "integer") return Math.round(Number(v));
    return v;
  };

  for (const [key, v] of Object.entries(values)) {
    if (v == null) continue;
    if (key === "refs" || key === "params") continue;
    out[key] = coerce(key, v);
  }

  // Passthrough fields: only what the route's contract declares, with its type.
  // Undeclared keys are refused, so a param can never override the prompt, a
  // reference field or anything else the CLI builds itself.
  const declared = schema.params ?? {};
  for (const [key, v] of Object.entries(values.params ?? {})) {
    const spec = declared[key];
    if (!spec) {
      problems.push(
        `${route.model} has no passthrough field "${key}". Allowed: ${Object.keys(declared).join(", ") || "none"}.`,
      );
      continue;
    }
    const typeOk =
      spec.type === "boolean" ? typeof v === "boolean"
        : spec.type === "integer" ? Number.isInteger(v)
          : spec.type === "string" ? typeof v === "string"
            : true;
    if (!typeOk) {
      problems.push(`${route.model}: ${key} must be a ${spec.type}, got ${JSON.stringify(v)}.`);
      continue;
    }
    if (spec.enum && !spec.enum.includes(v)) {
      problems.push(`${route.model}: ${key}="${v}" is not allowed. Allowed: ${spec.enum.join(", ")}.`);
      continue;
    }
    out[key] = v;
  }

  // A model with no aspect-ratio parameter must not be sent one.
  for (const key of Object.keys(out)) {
    if (schema.enums && !(key in schema.enums)) continue;
  }
  if (!schema.enums?.aspect_ratio && !schema.defaults?.aspect_ratio) delete out.aspect_ratio;
  // Some routes take the clip's shape from its first frame and refuse any
  // other ratio once a frame is sent (Seedance 2.5 on kie).
  if (schema.frameAspectRatio && values.refs?.some((r) => r.role === "first_frame" || r.role === "last_frame")) {
    out.aspect_ratio = schema.frameAspectRatio;
  }

  for (const [key, allowed] of Object.entries(schema.enums ?? {})) {
    if (out[key] == null) continue;
    if (!allowed.map(String).includes(String(out[key]))) {
      problems.push(
        `${route.model}: ${key}="${out[key]}" is not allowed. Allowed: ${allowed.join(", ")}.`,
      );
    }
  }

  if (schema.durationRange && out.duration != null) {
    const [lo, hi] = schema.durationRange;
    const n = Number(out.duration);
    if (n < lo || n > hi) {
      problems.push(`${route.model}: duration ${n}s is outside its ${lo}-${hi}s range.`);
    }
  }

  for (const key of schema.required ?? []) {
    if (out[key] == null || out[key] === "") {
      problems.push(`${route.model}: "${key}" is required and was not supplied.`);
    }
  }

  // Reference roles map to per-model field names; array-valued fields (named
  // *_urls, or listed in refLists) collect.
  for (const ref of values.refs ?? []) {
    const field = schema.refFields?.[ref.role];
    if (!field) {
      problems.push(
        `${route.model} has no input for role "${ref.role}". It accepts: ${
          Object.keys(schema.refFields ?? {}).join(", ") || "no references"
        }.`,
      );
      continue;
    }
    if (field.endsWith("_urls") || schema.refLists?.includes(field)) (out[field] ??= []).push(ref.url);
    else out[field] = ref.url;
  }

  // Documented per-route limits, checked after asset expansion so `zed`
  // counts as however many images it holds.
  const refLimits = schema.refLimits ?? {};
  for (const [field, max] of Object.entries(refLimits.maxCount ?? {})) {
    const n = Array.isArray(out[field]) ? out[field].length : 0;
    if (n > max) problems.push(`${route.model} takes at most ${max} in ${field}; got ${n}.`);
  }
  const img = refLimits.image;
  for (const r of img ? values.refs ?? [] : []) {
    const f = r.file;
    if (!f?.mime?.startsWith("image/")) continue;
    const name = r.label ?? r.url;
    if (f.width && f.height) {
      if (Math.min(f.width, f.height) < img.minSide || Math.max(f.width, f.height) > img.maxSide) {
        problems.push(`${name}: ${f.width}×${f.height} is outside ${route.model}'s ${img.minSide}-${img.maxSide}px per side.`);
      }
      const aspect = f.width / f.height;
      if (aspect < img.minAspect || aspect > img.maxAspect) {
        problems.push(`${name}: aspect ${aspect.toFixed(2)} is outside ${route.model}'s ${img.minAspect}-${img.maxAspect}.`);
      }
    }
    if (f.bytes > img.maxBytes) {
      problems.push(`${name}: ${(f.bytes / 1e6).toFixed(1)}MB is over ${route.model}'s ${img.maxBytes / 1e6}MB per image.`);
    }
  }

  // Combinations the provider documents as impossible are refused here, free,
  // rather than posted for a paid round trip or a silently ignored input.
  const roles = new Set((values.refs ?? []).map((r) => r.role));
  const rules = schema.refRules ?? {};
  const groupsUsed = (rules.exclusiveGroups ?? [])
    .map((group) => group.filter((role) => roles.has(role)))
    .filter((used) => used.length);
  if (groupsUsed.length > 1) {
    problems.push(
      `${route.model} cannot combine ${groupsUsed.map((g) => g.join("+")).join(" with ")} in one job.` +
        (rules.note ? ` ${rules.note}` : ""),
    );
  }
  for (const [role, needs] of Object.entries(rules.requires ?? {})) {
    if (roles.has(role) && !roles.has(needs)) {
      problems.push(`${route.model}: "${role}" needs a "${needs}" reference too.`);
    }
  }

  return { input: out, unverified: false, problems };
}

/** `--ref <url|asset|asset#n>:<role>` -- refuses a local path by design. See parseRef tests. */
export function parseRef(spec) {
  const idx = spec.lastIndexOf(":");
  if (idx <= 0) {
    throw usage(`--ref must be "<url>:<role>", got "${spec}".`);
  }
  const url = spec.slice(0, idx);
  const role = spec.slice(idx + 1);

  // A saved asset: `zed` (all its images) or `zed#2` (one of them). The role
  // check keeps a URL with no role ("https://x.test/a.png" splits at "https:")
  // from reading as an asset named "https".
  if (/^[a-z0-9][a-z0-9-]{0,80}(#\d+)?$/.test(url) && /^[a-z_]+$/.test(role)) return { source: url, role };

  if (!/^https?:\/\//i.test(url)) {
    throw usage(
      `A local path is not a remote attachment: "${url}".\n` +
        `Run \`kie upload ${url}\` first and pass the URL it prints, or save it as an asset ` +
        `(kie asset save) and pass its name.`,
    );
  }
  return { source: url, role };
}

/**
 * `--param key=value` → { key: value }. A value that parses as JSON is used as
 * that type, so `generate_audio=false` reaches the provider as the boolean it
 * expects rather than the string "false". Anything else stays a string.
 */
export function parseParams(list = []) {
  const out = {};
  for (const spec of list ?? []) {
    const idx = spec.indexOf("=");
    if (idx <= 0) throw usage(`--param must be "key=value", got "${spec}".`);
    const raw = spec.slice(idx + 1);
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
    out[spec.slice(0, idx).trim()] = value;
  }
  return out;
}

/**
 * The routes a model can actually be reached through, in preference order,
 * annotated with their provider and whether a key for it exists on this
 * machine. A route with no key is not an error -- it is simply skipped, so
 * configuring one provider is enough to work.
 */
export function routesFor(catalog, model, { only } = {}) {
  return (model.routes ?? []).map((r) => {
    const prov = getProvider(catalog, r.provider);
    return {
      ...r,
      prov,
      usable: (!only || r.provider === only) && hasKey(prov),
      skipReason: only && r.provider !== only
        ? `--provider ${only} was requested`
        : hasKey(prov)
          ? null
          : `no ${prov.label} key (set ${prov.keyEnv} or write ~/${prov.keyFile})`,
    };
  });
}

/** Cheapest ESTIMATED route, used only for display and budget pre-flight. */
export function cheapestRoute(routes) {
  const usable = routes.filter((r) => r.usable);
  if (!usable.length) return null;
  return usable.reduce((a, b) => ((b.priceUsd ?? Infinity) < (a.priceUsd ?? Infinity) ? b : a));
}
