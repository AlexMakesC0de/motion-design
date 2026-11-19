// web/src/projects/FilmCard.tsx
// One film as a card: cover (its newest export once there is one), name, four
// step markers, how many shots and takes, what it cost, and the next thing to do as a link straight to that
// step. Shared by Home and Projects.
import type { FilmProgress, FilmSummary, StepState } from "../api/types";
import { STEPS, filmHref } from "../app/route";

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/** The marker's state in words, for screen readers (the marker shows it by its look). */
const STATE_WORDS: Record<StepState, string> = { done: "done", current: "current", locked: "locked", todo: "not started" };

/** "3 shots · 4 takes", leaving out what is zero; empty when nothing is counted yet. */
function countLine(c: FilmProgress["counts"]): string {
  const part = (n: number, one: string) => (n ? `${n} ${one}${n === 1 ? "" : "s"}` : null);
  return [part(c.scenes, "shot"), part(c.versions, "take")].filter(Boolean).join(" · ");
}

export function FilmCard({ film, onReveal }: { film: FilmSummary; onReveal?: (slug: string) => void }) {
  const p = film.progress;
  const finished = !!p && STEPS.every((s) => p.steps[s.id] === "done");
  const counts = p ? countLine(p.counts) : "";
  return (
    <article className="film-card2" aria-label={film.run}>
      <a className="film-card2__cover" href={filmHref(film.run)} tabIndex={-1} aria-hidden="true">
        {film.cover?.kind === "video" && <video src={`${film.cover.url}#t=1`} preload="metadata" muted playsInline />}
        {film.cover?.kind === "image" && <img src={film.cover.url} alt="" />}
        {finished && <span className="film-card2__badge">Finished</span>}
      </a>
      <div className="film-card2__body">
        <div className="film-card2__title">
          <a className="mono" href={filmHref(film.run)}>
            {film.run}
          </a>
          {p && <span className="mono film-card2__cost">${p.spentUsd.toFixed(2)}<span className="sr-only"> spent</span></span>}
          {onReveal && (
            <button type="button" className="button button--quiet film-card2__reveal" aria-label={`Show in Finder: ${film.run}`} onClick={() => onReveal(film.run)}>
              Show in Finder
            </button>
          )}
        </div>
        {p && (
          <ol className="film-card2__steps" aria-label="Steps">
            {STEPS.map((s) => (
              <li key={s.id} data-state={p.steps[s.id]}>
                <span className="sr-only">
                  {s.label}, {STATE_WORDS[p.steps[s.id]]}
                </span>
              </li>
            ))}
          </ol>
        )}
        {counts && <p className="film-card2__counts">{counts}</p>}
        <p className="film-card2__meta">
          {!p && <span>{film.takes === 1 ? "1 file" : `${film.takes} files`}</span>}
          <span>{when(film.modified)}</span>
        </p>
        {p && (
          <a className="film-card2__next" href={filmHref(film.run, p.next.step)}>
            Next: <b>{p.next.text}</b>
          </a>
        )}
      </div>
    </article>
  );
}
