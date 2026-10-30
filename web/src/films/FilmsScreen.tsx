import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { FilmSummary } from "../api/types";
import { FilmPage } from "./FilmPage";
import "./films.css";

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

function FilmList() {
  const [films, setFilms] = useState<FilmSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<FilmSummary[]>("/api/films")
      .then(setFilms)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  return (
    <div className="films">
      <header className="films__head">
        <h1>Films</h1>
        <p>Each run folder is a film. Open one to put its takes in order and finish it.</p>
      </header>
      {error && (
        <p className="film__error" role="alert">
          {error}
        </p>
      )}
      {films && !films.length && <p className="film__none">No films yet. Generate a take in the Studio and its run folder shows here.</p>}
      {films && films.length > 0 && (
        <ul className="films__grid">
          {films.map((f) => (
            <li key={f.run}>
              <a className="film-card" href={`#/films/${encodeURIComponent(f.run)}`}>
                {f.cover?.kind === "video" && <video className="film-card__cover" src={f.cover.url} preload="metadata" muted />}
                {f.cover?.kind === "image" && <img className="film-card__cover" src={f.cover.url} alt="" />}
                {!f.cover && <span className="film-card__cover" />}
                <span className="film-card__name mono">{f.run}</span>
                <span className="film-card__meta">
                  <span className="mono">{f.takes === 1 ? "1 take" : `${f.takes} takes`}</span> · {when(f.modified)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The hash part as typed; a stray % must not break the page. */
function decoded(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** `#/films` lists the films; `#/films/<name>` opens one. */
export function FilmsScreen({ slug }: { slug?: string }) {
  return slug ? <FilmPage key={slug} slug={decoded(slug)} /> : <FilmList />;
}
