// web/src/film/StepBar.tsx
// A film's four steps in order. Done and current steps are links; a locked
// step is plain text whose title (and a visually hidden description) says
// what to do first.
import type { FilmProgress, FilmStep } from "../api/types";
import { STEPS, filmHref } from "../app/route";

export function StepBar({ slug, progress, at }: { slug: string; progress: FilmProgress; at: FilmStep }) {
  return (
    <ol className="stepbar" aria-label="Steps">
      {STEPS.map((s, i) => {
        const state = progress.steps[s.id];
        const label = (
          <>
            <span className="stepbar__n">{state === "done" ? "✓" : i + 1}</span>
            {s.label}
          </>
        );
        if (state === "locked") {
          const why = `Locked: ${progress.next.text} first.`;
          const whyId = `stepbar-why-${s.id}`;
          return (
            <li key={s.id} className="stepbar__step" data-state="locked" title={why} aria-describedby={whyId}>
              {label}
              <span id={whyId} className="stepbar__why">
                {why}
              </span>
            </li>
          );
        }
        return (
          <li key={s.id} className="stepbar__step" data-state={state}>
            <a href={filmHref(slug, s.id)} aria-current={s.id === at ? "step" : undefined}>
              {label}
            </a>
          </li>
        );
      })}
    </ol>
  );
}
