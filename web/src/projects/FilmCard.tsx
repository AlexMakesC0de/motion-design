// web/src/projects/FilmCard.tsx
// One film as a card: cover, name, four step markers, what it cost, and the
// next thing to do as a link straight to that step. Shared by Home and Projects.
import type { FilmSummary } from "../api/types";
import { STEPS, filmHref } from "../app/route";

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

export function FilmCard({ film, onReveal }: { film: FilmSummary; onReveal?: (slug: string) => void }) {
  const p = film.progress;
  return (
    <article className="film-card2" aria-label={film.run}>
      <a className="film-card2__cover" href={filmHref(film.run)} tabIndex={-1} aria-hidden="true">
        {film.cover?.kind === "video" && <video src={film.cover.url} preload="metadata" muted />}
        {film.cover?.kind === "image" && <img src={film.cover.url} alt="" />}
      </a>
      <div className="film-card2__body">
        <div className="film-card2__title">
          <a className="mono" href={filmHref(film.run)}>
            {film.run}
          </a>
          {onReveal && (
            <button type="button" className="button button--quiet film-card2__reveal" aria-label={`Show ${film.run} in Finder`} onClick={() => onReveal(film.run)}>
              Show in Finder
            </button>
          )}
        </div>
        {p && (
          <ol className="film-card2__steps" aria-label="Steps">
            {STEPS.map((s) => (
              <li key={s.id} data-state={p.steps[s.id]}>
                {s.label}
              </li>
            ))}
          </ol>
        )}
        <p className="film-card2__meta">
          {p ? <span className="mono film-card2__cost">${p.spentUsd.toFixed(2)} spent</span> : <span>{film.takes === 1 ? "1 file" : `${film.takes} files`}</span>}
          <span>{when(film.modified)}</span>
        </p>
        {p && (
          <a className="film-card2__next" href={filmHref(film.run, p.next.step)}>
            Next: {p.next.text}
          </a>
        )}
      </div>
    </article>
  );
}
