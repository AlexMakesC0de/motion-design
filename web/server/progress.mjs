// web/server/progress.mjs
// Where a film is: which of its four steps (Idea, References, Scenes, Finish)
// are done, which one is current, and the next thing to do, in words. Pure:
// the caller reads scenes.json, the Library, the folder and the spend. Every
// step stays open; nothing gates generation.

export const STEPS = ["idea", "references", "scenes", "finish"];

const r2 = (n) => Math.round(n * 100) / 100;
const and = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/**
 * f: { idea, scenes, sheets, edit } where sheets maps each Library item the
 * scenes use to whether it has a sheet, and edit (when one is saved) lists the
 * scene ids the film plays. facts: { outputs, hasFilm, filmStale, spentUsd, legacy };
 * filmStale means the edit changed after the newest export.
 */
export function progressOf(f, { outputs = 0, hasFilm = false, filmStale = false, spentUsd = 0, legacy = false } = {}) {
  const all = f.scenes ?? [];
  // A saved edit says which scenes are in the film; the rest are spare and ask for nothing.
  const scenes = f.edit?.scenes ? all.filter((s) => f.edit.scenes.includes(s.id)) : all;
  const counts = {
    scenes: scenes.length,
    versions: scenes.reduce((n, s) => n + s.versions.length, 0),
    chosen: scenes.filter((s) => s.chosen).length,
    outputs,
  };
  const base = { counts, spentUsd: r2(spentUsd), legacy };

  if (legacy) {
    return {
      ...base,
      step: "finish",
      steps: { idea: "todo", references: "todo", scenes: "todo", finish: hasFilm ? "done" : "current" },
      next: { text: "Made before Shard: takes only", step: "finish" },
    };
  }

  const missing = Object.entries(f.sheets ?? {})
    .filter(([, has]) => !has)
    .map(([name]) => name)
    .sort();
  const planned = scenes.length > 0;
  const done = {
    idea: planned,
    references: planned && missing.length === 0,
    scenes: planned && scenes.every((s) => s.chosen || s.versions.some((v) => v.state === "succeeded")),
    finish: hasFilm && !filmStale,
  };
  const step = STEPS.find((s) => !done[s]) ?? "finish";
  const steps = Object.fromEntries(STEPS.map((s) => [s, done[s] ? "done" : s === step ? "current" : "todo"]));
  return { ...base, step, steps, next: nextAction({ ...f, scenes }, step, missing, hasFilm, filmStale) };
}

function nextAction(f, step, missing, hasFilm, filmStale) {
  if (step === "idea") return { text: f.idea?.text?.trim() ? "Plan the scenes" : "Write the idea", step };
  if (step === "references") {
    return { text: missing.length === 1 ? `Make the sheet for ${missing[0]}` : `Make sheets for ${and(missing)}`, step };
  }
  if (step === "scenes") {
    const names = (pick) => f.scenes.filter(pick).map((s) => s.title || s.id);
    const undrafted = names((s) => s.versions.length === 0);
    if (undrafted.length) return { text: `Make ${and(undrafted)}`, step };
    return { text: `Wait for ${and(names(() => true))}`, step };
  }
  if (!hasFilm) return { text: "Export the film", step: "finish" };
  return { text: filmStale ? "Export the new edit" : "Watch the film", step: "finish" };
}
