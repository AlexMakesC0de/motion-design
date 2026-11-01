// web/src/film/FilmWorkspace.tsx
// One film's home: its step bar and the step you are on. Idea, References and
// Scenes read the film's scenes.json; Finish is the film page (its takes and
// the finishing tools). Every step stays open.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { FilmProgress, FilmStep } from "../api/types";
import { filmHref, replaceHash } from "../app/route";
import { onStudioEvent } from "../app/useStudio";
import { FilmPage } from "../films/FilmPage";
import { SceneScreen } from "../scene/SceneScreen";
import { getRun, setRun } from "../studio/promptStore";
import { IdeaStep } from "./IdeaStep";
import { ReferencesStep } from "./ReferencesStep";
import { StepBar } from "./StepBar";
import "./film.css";

export function FilmWorkspace({ slug, step, scene }: { slug: string; step: FilmStep | null; scene?: string }) {
  const [progress, setProgress] = useState<FilmProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      {progress.legacy && step !== "finish" && (
        <p className="film-ws__legacy">Made before Shard: this film has takes only. Its scenes start empty here; its takes are on Finish.</p>
      )}
      {step === "idea" && <IdeaStep key={slug} slug={slug} onChange={load} />}
      {step === "references" && <ReferencesStep key={slug} slug={slug} />}
      {step === "scenes" && <SceneScreen key={slug} run={slug} initialId={scene} autoFirst={false} />}
      {step === "finish" && <FilmPage key={slug} slug={slug} />}
    </div>
  );
}
