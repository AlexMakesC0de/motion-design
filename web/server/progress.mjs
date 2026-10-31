// web/server/progress.mjs
// Where a film is: which of its four steps (Brief, References, Shots, Finish)
// are done, which one is current, and the next thing to do, in words. Pure:
// the caller reads the board, the folder and the spend. References has no
// check of its own until the references-first stage, so it is done once the
// brief is.

export const STEPS = ["brief", "references", "shots", "finish"];

const r2 = (n) => Math.round(n * 100) / 100;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const and = (ids) => (ids.length < 2 ? ids.join("") : `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}`);

/** b: board() ({ brief, plan, shots }); facts: { outputs, hasFilm, spentUsd, legacy }. */
export function progressOf(b, { outputs = 0, hasFilm = false, spentUsd = 0, legacy = false } = {}) {
  const shots = b.shots ?? [];
  const counts = {
    shots: shots.length,
    stills: shots.filter((s) => s.still).length,
    takes: shots.filter((s) => s.take).length,
    outputs,
  };
  const base = { counts, spentUsd: r2(spentUsd), legacy };

  if (legacy) {
    return {
      ...base,
      step: "finish",
      steps: { brief: "todo", references: "todo", shots: "todo", finish: hasFilm ? "done" : "current" },
      next: { text: "Made before the studio: takes only", step: "finish" },
    };
  }

  // A saved plan with no shots in it is not a plan to film yet.
  const planned = Boolean(b.brief && b.plan && shots.length > 0);
  const done = {
    brief: planned,
    references: planned,
    shots: shots.length > 0 && shots.every((s) => s.take),
    finish: hasFilm,
  };
  const step = STEPS.find((s) => !done[s]) ?? "finish";
  const at = STEPS.indexOf(step);
  const steps = Object.fromEntries(STEPS.map((s, i) => [s, done[s] ? "done" : i === at ? "current" : "locked"]));
  return { ...base, step, steps, next: nextAction(b, step, hasFilm) };
}

function nextAction(b, step, hasFilm) {
  if (step === "brief") return { text: !b.brief ? "Write the brief" : b.plan ? "Add a shot" : "Plan the shots", step };
  if (step === "shots") {
    const needStill = b.shots.filter((s) => !s.continuesFrom && !s.still && !s.take);
    if (needStill.length) return { text: `Make ${plural(needStill.length, "still")}`, step };
    const filming = b.shots.filter((s) => !s.take && s.filming.length);
    if (filming.length) return { text: `Filming ${plural(filming.length, "shot")}`, step };
    return { text: `Film ${and(b.shots.filter((s) => !s.take).map((s) => s.id))}`, step };
  }
  return { text: hasFilm ? "Watch the film" : "Assemble the film", step: "finish" };
}
