import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  buildInput,
  catalogAgeDays,
  effectiveRoute,
  isStale,
  resolveModel,
  routesFor,
  validateVideoRequest,
} from "../lib/models.mjs";
import { getProvider, providerCredits, providerKey } from "../lib/providers.mjs";
import { estimateUsd, priceLabel } from "../lib/budget.mjs";
import { loadPresets, routeFor } from "../lib/presets.mjs";
import { REPO_ROOT, RUNS_DIR, runDir } from "../lib/run.mjs";
import { unknown } from "../lib/errors.mjs";
import { dailyPosition } from "./spend.mjs";

// Read-only views shared by the MCP server (and, later, the web app). Plain
// data in, plain data out; nothing here prints, reserves or submits.

const MEDIA = /\.(mp4|mov|webm|png|jpe?g|webp|mp3|wav|m4a)$/i;
const MAX_PROMPT_CHARS = 20_000;

export const jobSummary = (j) => ({
  id: j.id,
  state: j.state,
  run: j.run,
  model: j.model,
  provider: j.provider,
  upstreamTaskId: j.upstreamTaskId ?? null,
  estimateUsd: j.estimateUsd ?? null,
  actualUsd: j.actualUsd ?? null,
  createdAt: j.createdAt,
});

/** Keys, balances, catalog age, today's position and unsettled jobs. `credits` reads a balance (injectable). */
export async function status(catalog, { store, limits, credits = providerCredits }) {
  store.sweep();
  const providers = [];
  for (const name of Object.keys(catalog.providers)) {
    const prov = getProvider(catalog, name);
    const key = providerKey(prov, { required: false });
    let balance = null;
    if (key && prov.credits) {
      try {
        balance = await credits(prov, key);
      } catch {
        balance = null;
      }
    }
    providers.push({
      name,
      label: prov.label,
      keyConfigured: Boolean(key),
      balance: typeof balance === "number" ? balance : null,
      unit: prov.creditUnit ?? null,
    });
  }
  const pos = dailyPosition(store, limits);
  return {
    providers,
    catalog: { captured: catalog.captured ?? null, ageDays: catalogAgeDays(catalog) ?? null, stale: Boolean(isStale(catalog)) },
    today: { capUsd: pos.capUsd, spentUsd: pos.spentUsd, availableUsd: pos.availableUsd },
    unsettled: pos.unsettled.map(jobSummary),
  };
}

export function listModels(catalog, { capability } = {}) {
  return catalog.list
    .filter((m) => !capability || m.capability === capability)
    .map((m) => ({
      id: m.id,
      capability: m.capability,
      durationsS: m.durationsS ?? [],
      aspectRatios: m.aspectRatios ?? [],
      resolutions: (m.resolutions ?? []).map(String),
      refRoles: m.refs ?? [],
      nativeAudio: Boolean(m.nativeAudio),
      notes: m.notes ?? null,
      routes: routesFor(catalog, m).map((r) => ({
        provider: r.provider,
        price: priceLabel(r),
        verified: Boolean(r.verified),
        usable: Boolean(r.usable),
        skipReason: r.skipReason ?? null,
      })),
    }));
}

export function listPresets(catalog) {
  return loadPresets().map((p) => {
    let route = null;
    try {
      route = routeFor(p, catalog);
    } catch {
      route = null;
    }
    return {
      id: p.id,
      title: p.title,
      tagline: p.tagline ?? null,
      bestFor: p.best_for ?? null,
      durationS: p.defaults?.duration_s ?? null,
      aspectRatio: p.defaults?.aspect_ratio ?? null,
      model: route?.modelId ?? null,
      fidelity: route?.fidelity ?? null,
      sourcePromptPath: route?.promptPath ? join(REPO_ROOT, "skills", "motion-design", route.promptPath) : null,
      guide: p.template ?? null,
    };
  });
}

/**
 * What a planned job would cost and whether the per-job budget, the per-job
 * ceiling and today's cap allow it. Reserves nothing and calls no provider. `refs` are checked by
 * role only; assets are not expanded here.
 */
export function estimate(catalog, req, { store, limits }) {
  const { model: modelId, capability, durationS, resolution, aspectRatio, refs = [], params = {}, budgetUsd, provider } = req;
  const model = resolveModel(catalog, modelId, capability);
  const problems = model.capability === "video" ? validateVideoRequest(catalog, model, { durationS, aspectRatio, refs }) : [];

  const routes = routesFor(catalog, model, { only: provider });
  const route = routes.find((r) => r.usable) ?? routes.find((r) => !provider || r.provider === provider) ?? null;
  let call = null;
  let est = null;
  if (route) {
    const useI2v = model.capability === "video" ? refs.some((r) => r.role === "first_frame") : refs.length > 0;
    call = effectiveRoute(route, useI2v);
    const built = buildInput(call, {
      prompt: "(estimate)",
      duration: durationS,
      resolution,
      aspect_ratio: aspectRatio,
      refs: refs.map((r) => ({ role: r.role, url: "pending" })),
      params,
    });
    problems.push(...built.problems);
    est = estimateUsd(call, { durationS: built.input.duration, resolution: built.input.resolution });
  } else {
    problems.push(`No route for ${model.id}${provider ? ` via ${provider}` : ""}.`);
  }

  const cap = budgetUsd ?? catalog.defaultBudgetUsd?.[model.capability] ?? null;
  const pos = dailyPosition(store, limits);
  const usd = est?.usd ?? null;
  const withinBudget = usd != null && (cap == null || usd <= cap);
  const withinDailyCap = usd != null && usd <= pos.availableUsd;
  const perJobUsd = limits.perJobUsd ?? null;
  const withinPerJob = usd != null && (perJobUsd == null || usd <= perJobUsd);
  return {
    model: model.id,
    provider: route?.provider ?? null,
    providerModel: call?.model ?? null,
    routeUsable: Boolean(route?.usable),
    estimateUsd: usd,
    basis: est?.basis ?? null,
    budgetUsd: cap,
    withinBudget,
    perJobUsd,
    withinPerJob,
    availableTodayUsd: pos.availableUsd,
    withinDailyCap,
    problems,
    allowed: !problems.length && withinBudget && withinPerJob && withinDailyCap && Boolean(route?.usable),
  };
}

export function listRuns() {
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => {
      const dir = join(RUNS_DIR, d.name);
      const files = readdirSync(dir);
      return {
        run: d.name,
        modified: statSync(dir).mtime.toISOString(),
        files: files.length,
        takes: files.filter((f) => MEDIA.test(f)).length,
      };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

const readText = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
const readJson = (p) => {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  } catch {
    return null;
  }
};

/** Everything a run folder records: prompt, settings, takes, job records, cost, review notes. */
export function getRun(slug, { store }) {
  const dir = runDir(slug, { create: false });
  if (!existsSync(dir)) {
    throw unknown(`No run "${slug}". Recent runs: ${listRuns().slice(0, 20).map((r) => r.run).join(", ") || "none"}.`);
  }
  const prompt = readText(join(dir, "prompt.txt")) ?? readText(join(dir, "image-prompt.txt"));
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((f) => f.isFile())
    .map((f) => ({ name: f.name, bytes: statSync(join(dir, f.name)).size }));
  return {
    run: slug,
    prompt: prompt && prompt.length > MAX_PROMPT_CHARS ? `${prompt.slice(0, MAX_PROMPT_CHARS)}\n[truncated]` : prompt,
    inputs: readJson(join(dir, "inputs.json")) ?? readJson(join(dir, "image-inputs.json")),
    files,
    artifacts: files.filter((f) => MEDIA.test(f.name)).map((f) => join(dir, f.name)),
    jobs: store.list().filter((j) => j.run === slug).map(jobSummary),
    cost: readJson(join(dir, "cost.json")),
    review: readText(join(dir, "review.md")),
  };
}
