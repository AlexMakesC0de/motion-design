// web/server/progress.mjs
// Where a film is: which of its four steps (Idea, References, Scenes, Finish)
// are done, which one is current, and the next thing to do, in words. Pure:
// the caller reads scenes.json, the Library, the folder and the spend. Every
// step stays open; nothing gates generation.

export const STEPS = ["idea", "references", "scenes", "finish"];

const r2 = (n) => Math.round(n * 100) / 100;
const and = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/**
 * f: { idea, scenes, sheets } where sheets maps each Library item the scenes
 * use to whether it has a sheet. facts: { outputs, hasFilm, spentUsd, legacy }.
 */
export function progressOf(f, { outputs = 0, hasFilm = false, spentUsd = 0, legacy = false } = {}) {
  const scenes = f.scenes ?? [];
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
    scenes: planned && scenes.every((s) => s.chosen),
    finish: hasFilm,
  };
  const step = STEPS.find((s) => !done[s]) ?? "finish";
  const steps = Object.fromEntries(STEPS.map((s) => [s, done[s] ? "done" : s === step ? "current" : "todo"]));
  return { ...base, step, steps, next: nextAction(f, step, missing, hasFilm) };
}

function nextAction(f, step, missing, hasFilm) {
  if (step === "idea") return { text: f.idea?.text?.trim() ? "Plan the scenes" : "Write the idea", step };
  if (step === "references") {
    return { text: missing.length === 1 ? `Make the sheet for ${missing[0]}` : `Make sheets for ${and(missing)}`, step };
  }
  if (step === "scenes") {
    const places = (pick) => f.scenes.flatMap((s, i) => (pick(s) ? [String(i + 1)] : []));
    const undrafted = places((s) => s.versions.length === 0);
    if (undrafted.length) return { text: `Draft scene${undrafted.length === 1 ? "" : "s"} ${and(undrafted)}`, step };
    const unchosen = places((s) => !s.chosen);
    return { text: `Choose a version of scene${unchosen.length === 1 ? "" : "s"} ${and(unchosen)}`, step };
  }
  return { text: hasFilm ? "Watch the film" : "Assemble the film", step: "finish" };
}
