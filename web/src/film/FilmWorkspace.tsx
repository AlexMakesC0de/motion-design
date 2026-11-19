// web/src/film/FilmWorkspace.tsx
// One film's home. Every step sits in the same frame: the film's name, the
// step bar and the next thing to do; one line saying what the step is for;
// the step; and the film itself along the bottom (on Edit the timeline is the
// film, so the strip steps aside). Every step stays open.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { FilmProgress, FilmStep } from "../api/types";
import { filmHref, replaceHash } from "../app/route";
import { onStudioEvent } from "../app/useStudio";
import { EditStep } from "./EditStep";
import { FilmStrip } from "./FilmStrip";
import { useEdit } from "./useEdit";
import { SceneScreen } from "../scene/SceneScreen";
import { getRun, setRun } from "../studio/promptStore";
import { IdeaStep } from "./IdeaStep";
import { ReferencesStep } from "./ReferencesStep";
import { StepBar } from "./StepBar";
import "./film.css";

/** What each step is for, in one line. */
export const STEP_JOBS: Record<FilmStep, string> = {
  idea: "What the film is, and the shots it needs.",
  references: "Who and what appears on screen, and how each is described.",
  scenes: "Make each shot, then star the take you want in the film.",
  finish: "Put the takes in order, trim them, add titles, watch and export.",
};

export function FilmWorkspace({ slug, step, scene }: { slug: string; step: FilmStep | null; scene?: string }) {
  const [progress, setProgress] = useState<FilmProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const film = useEdit(slug);
  // Each read gets a number; only the newest one may land, so a slow older answer never replaces a newer one.
  const seq = useRef(0);

  const load = useCallback(() => {
    const mine = ++seq.current;
    api<FilmProgress>(`/api/films/${encodeURIComponent(slug)}/progress`)
      .then((p) => {
        if (mine !== seq.current) return;
        setProgress(p);
        setError(null);
        if (getRun() !== slug) setRun(slug); // Create follows the film only once it is known to exist
      })
      .catch((e) => mine === seq.current && setError(e instanceof ApiError ? e.message : String(e)));
  }, [slug]);

  useEffect(() => {
    setProgress(null);
    setError(null);
    load();
    return () => {
      seq.current++; // an answer for the film being left is dropped
    };
  }, [load]);

  // Moving between steps reads progress again: an edit on one step can finish another.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    load();
  }, [step, load]);

  // A job landing, a finishing task or a chat tool can move the film on a step.
  useEffect(
    () =>
      onStudioEvent((e) => {
        if (e.event === "hello") load();
        else if (e.event === "job" && e.data.run === slug) load();
        else if (e.event === "task" && e.data.run === slug && e.data.state !== "running") load();
        else if (e.event === "chat" && e.data.film === slug && e.data.entry?.kind === "tool" && e.data.entry.state !== "running") load();
        else if (e.event === "library") load();
      }),
    [slug, load],
  );

  useEffect(() => {
    if (progress && !step) replaceHash(filmHref(slug, progress.step));
  }, [progress, step, slug]);

  if (error) {
    return (
      <p className="film-step__error" role="alert">
        {error}
      </p>
    );
  }
  if (!progress || !step) return <p className="film-step__loading">Opening {slug}…</p>;

  return (
    <div className="film-ws">
      <div className="film-ws__head">
        <h1 className="film-ws__name mono">{slug}</h1>
        <StepBar slug={slug} progress={progress} at={step} />
        <p className="film-ws__next">
          Next: <a href={filmHref(slug, progress.next.step)}>{progress.next.text}</a>
        </p>
      </div>
      <p className="film-ws__job">{STEP_JOBS[step]}</p>
      {progress.legacy && step !== "finish" && (
        <p className="film-ws__legacy">Made before Shard: this film has takes only. Its shots start empty here; its takes are in Edit.</p>
      )}
      <div className="film-ws__step">
        {step === "idea" && <IdeaStep key={slug} slug={slug} onChange={load} lengthS={film.edit?.lengthS ?? null} />}
        {step === "references" && <ReferencesStep key={slug} slug={slug} inFilm={film.edit ? film.edit.clips.map((c) => c.scene) : null} />}
        {step === "scenes" && <SceneScreen key={slug} run={slug} initialId={scene} autoFirst={false} inFilm={film.edit ? film.edit.clips.map((c) => c.scene) : null} />}
        {step === "finish" && <EditStep key={slug} slug={slug} film={film} onExported={load} />}
      </div>
      {step !== "finish" && film.edit && <FilmStrip slug={slug} edit={film.edit} targetS={film.edit.targetS} here={step === "scenes" ? scene : null} />}
    </div>
  );
}
