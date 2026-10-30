import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./run.mjs";
import { unknown } from "./errors.mjs";

export const PRESETS_PATH = join(
  REPO_ROOT,
  "skills",
  "motion-design",
  "assets",
  "presets.json",
);

export function loadPresets(path = PRESETS_PATH) {
  return JSON.parse(readFileSync(path, "utf8")).presets;
}

export function findPreset(presets, idOrAlias) {
  const needle = String(idOrAlias).toLowerCase().trim();
  const hit =
    presets.find((p) => p.id === needle) ??
    presets.find((p) => p.title.toLowerCase() === needle) ??
    presets.find((p) => (p.aliases ?? []).some((a) => a.toLowerCase() === needle));
  if (!hit) {
    throw unknown(
      `Unknown preset "${idOrAlias}". Available: ${presets.map((p) => p.id).join(", ")}`,
    );
  }
  return hit;
}

/**
 * Which kie.ai model a preset should run on, and -- more importantly -- whether
 * that is a native route or an adaptation.
 *
 * Three of the ten source prompts were generated on minimax_h3/_max, which
 * kie.ai exposes directly: those run on the model they were written for. The
 * other seven came from Higgsfield's Marketing Studio, an internal
 * orchestration product that no raw API reproduces -- including Higgsfield's
 * own MCP. `fidelity` carries that distinction so the agent can state it
 * instead of overclaiming, which SKILL.md explicitly requires.
 */
export function routeFor(preset, catalog, { override } = {}) {
  const kie = preset.kie ?? {};
  const chain = override ? [override] : [kie.native, ...(kie.route ?? [])].filter(Boolean);
  const modelId = chain.find((id) => Object.hasOwn(catalog.models, id));

  if (!modelId) {
    throw unknown(
      `No usable kie.ai model for preset "${preset.id}". Tried: ${chain.join(", ") || "(none listed)"}.`,
    );
  }

  const native = !override && kie.native != null && modelId === kie.native;
  return {
    modelId,
    fidelity: native ? "native" : "adaptation",
    sourceLabel: preset.source?.prompt_model_label ?? null,
    note:
      kie.note ??
      (native
        ? `Running on ${modelId}, the model this source prompt was generated with.`
        : `Adaptation: source was ${preset.source?.prompt_model_label ?? "unknown"}, running on ${modelId}.`),
    defaults: preset.defaults ?? {},
    promptPath: preset.source?.prompt_path ?? null,
    templatePath: preset.template ?? null,
    recipePath: preset.recipe ?? null,
  };
}
