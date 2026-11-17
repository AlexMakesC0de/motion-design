import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { FilmDetail, FilmFile } from "../api/types";
import { onStudioEvent } from "../app/useStudio";
import { shotSpec, takeCost } from "../studio/format";
import { FinishPanel } from "./FinishPanel";
import "./films.css";

/** A prompt longer than this starts folded to three lines. */
const PROMPT_FOLD_CHARS = 280;
const OUTPUT_LABEL = { film: "Film", captioned: "Captioned", variant: "Variant", card: "Text card" } as const;

const isShot = (f: FilmFile) => f.kind === "video" && f.origin === "take";
const isOutput = (f: FilmFile) => f.origin != null && f.origin !== "take";

/** The shot names in the last assembly's order, then any newer takes oldest first. */
export function shotOrder(files: FilmFile[], order: string[]): string[] {
  const takes = files
    .filter(isShot)
    .sort((a, b) => a.modified.localeCompare(b.modified))
    .map((f) => f.name);
  const kept = order.filter((n) => takes.includes(n));
  return [...kept, ...takes.filter((n) => !kept.includes(n))];
}

export interface Shot {
  name: string;
  on: boolean;
}

/** Keep the user's order and choices across reloads; new takes join at the end, switched on. */
function mergeShots(prev: Shot[], names: string[]): Shot[] {
  const kept = prev.filter((s) => names.includes(s.name));
  return [...kept, ...names.filter((n) => !kept.some((s) => s.name === n)).map((name) => ({ name, on: true }))];
}

function move(list: Shot[], i: number, by: -1 | 1): Shot[] {
  const next = [...list];
  [next[i], next[i + by]] = [next[i + by], next[i]];
  return next;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function FilmPage({ slug }: { slug: string }) {
  const [detail, setDetail] = useState<FilmDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [fullPrompt, setFullPrompt] = useState(false);

  const load = useCallback(
    () =>
      api<FilmDetail>(`/api/films/${encodeURIComponent(slug)}`)
        .then((d) => {
          setDetail(d);
          setError(null);
          setShots((prev) => mergeShots(prev, shotOrder(d.files, d.order)));
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : String(e))),
    [slug],
  );

  useEffect(() => {
    setDetail(null);
    setShots([]);
    load();
  }, [load]);
  // A finished take lands in the run folder, so read the film again.
  useEffect(() => onStudioEvent((e) => e.event === "job" && e.data.run === slug && e.data.state === "succeeded" && load()), [slug, load]);

  const byName = new Map((detail?.files ?? []).map((f) => [f.name, f]));
  const outputs = (detail?.files ?? []).filter(isOutput).reverse();
  const chosen = shots.filter((s) => s.on).length;
  // Prompts for long takes run to pages; fold them so the shots and Finish stay on the first screen.
  const long = (detail?.prompt?.length ?? 0) > PROMPT_FOLD_CHARS;

  return (
    <div className="film">
      <header className="film__head">
        {detail?.prompt && (
          <>
            <p id="film-prompt" className="film__prompt" data-folded={long && !fullPrompt}>
              {detail.prompt}
            </p>
            {long && (
              <button type="button" className="film__more" aria-expanded={fullPrompt} aria-controls="film-prompt" onClick={() => setFullPrompt((v) => !v)}>
                {fullPrompt ? "Fold the prompt" : "Show the whole prompt"}
              </button>
            )}
          </>
        )}
      </header>

      {error && (
        <p className="film__error" role="alert">
          {error}
        </p>
      )}

      {detail && (
        <div className="film__body">
          <div className="film__main">
            <section className="film__section" aria-labelledby="film-shots">
              <div className="film__section-head">
                <h2 id="film-shots">Shots</h2>
                <span className="film__count">
                  {chosen} of {shots.length} shots chosen
                </span>
              </div>
              {shots.length ? (
                <ol className="shots" aria-label="Shots">
                  {shots.map((s, i) => {
                    const f = byName.get(s.name);
                    return (
                      <li key={s.name} className="shot" data-on={s.on}>
                        {f?.url ? <video className="shot__thumb" src={f.url} preload="metadata" muted /> : <span className="shot__thumb" />}
                        <div className="shot__body">
                          <label className="shot__use">
                            <input
                              type="checkbox"
                              checked={s.on}
                              aria-label={`Use ${s.name}`}
                              onChange={() => setShots((list) => list.map((x) => (x.name === s.name ? { ...x, on: !x.on } : x)))}
                            />
                            <span className="mono">{s.name}</span>
                          </label>
                          {f?.job && (
                            <p className="shot__detail mono" title={f.job.prompt ?? undefined}>
                              <span>{shotSpec(f.job)}</span>
                              {f.job.prompt && (
                                <>
                                  <span aria-hidden="true"> · </span>
                                  <span>{f.job.prompt}</span>
                                </>
                              )}
                            </p>
                          )}
                        </div>
                        <span className="mono shot__cost">{f?.job ? takeCost(f.job) : ""}</span>
                        <span className="shot__move">
                          <button
                            type="button"
                            className="button button--quiet"
                            aria-label={`Move ${s.name} up`}
                            disabled={i === 0}
                            onClick={() => setShots((l) => move(l, i, -1))}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            className="button button--quiet"
                            aria-label={`Move ${s.name} down`}
                            disabled={i === shots.length - 1}
                            onClick={() => setShots((l) => move(l, i, 1))}
                          >
                            Down
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="film__none">
                  No video takes in this film yet. Make some in <a href="#/video">Video</a>.
                </p>
              )}
            </section>

            <section className="film__section" aria-labelledby="film-outputs">
              <h2 id="film-outputs">Outputs</h2>
              {outputs.length ? (
                <ul className="outputs" aria-label="Outputs">
                  {outputs.map((f) => (
                    <li key={f.name} className="output">
                      {f.url && <video className="output__player" src={f.url} controls preload="metadata" />}
                      <div className="output__info">
                        <span className="mono">{f.name}</span>
                        <span className="output__meta">
                          {OUTPUT_LABEL[f.origin as keyof typeof OUTPUT_LABEL]} · {when(f.modified)}
                        </span>
                        {f.url && (
                          <a className="button" href={f.url} download={f.name} aria-label={`Download ${f.name}`}>
                            Download
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="film__none">Nothing finished yet. Assemble the shots, add captions or make a text card.</p>
              )}
            </section>
          </div>
          <FinishPanel film={detail} shots={shots.filter((s) => s.on).map((s) => s.name)} onChanged={load} />
        </div>
      )}
    </div>
  );
}
