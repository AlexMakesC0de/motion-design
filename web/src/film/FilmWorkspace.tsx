// web/src/film/FilmWorkspace.tsx
// One film's home: its step bar and the step you are on. Stage 1 mounts the
// existing screens: the storyboard for Brief and Shots, the film page for
// Finish. References arrives with the references-first work.
import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { FilmProgress, FilmStep } from "../api/types";
import { filmHref, replaceHash } from "../app/route";
import { onStudioEvent } from "../app/useStudio";
import { Storyboard } from "../storyboard/Storyboard";
import { useBoard } from "../storyboard/useBoard";
import { FilmPage } from "../films/FilmPage";
import { setRun } from "../studio/promptStore";
import { sendToChat } from "../chat/chatStore";
import { StepBar } from "./StepBar";
import "./film.css";

function BoardStep({ slug }: { slug: string }) {
  const { board, error, apply } = useBoard(slug);
  return <Storyboard film={slug} board={board} error={error} apply={apply} onPlan={(text) => sendToChat(text)} />;
}

function ReferencesStep({ slug }: { slug: string }) {
  return (
    <section className="film-step film-step--note" aria-labelledby="refs-h">
      <h2 id="refs-h">References</h2>
      <p>
        Reference images for each character, product and place, from several angles, come in the next update. Until then, shots use the Library
        items named in their cast.
      </p>
      <a className="button" href={filmHref(slug, "shots")}>
        Go to Shots
      </a>
    </section>
  );
}

export function FilmWorkspace({ slug, step }: { slug: string; step: FilmStep | null }) {
  const [progress, setProgress] = useState<FilmProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRun(slug);
    setProgress(null);
    setError(null);
    let alive = true;
    const load = () =>
      api<FilmProgress>(`/api/films/${encodeURIComponent(slug)}/progress`)
        .then((p) => alive && setProgress(p))
        .catch((e) => alive && setError(e instanceof ApiError ? e.message : String(e)));
    load();
    // A job settling can move the film on a step.
    const off = onStudioEvent((e) => {
      if (e.event === "job") load();
    });
    return () => {
      alive = false;
      off();
    };
  }, [slug]);

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
      {(step === "brief" || step === "shots") && <BoardStep slug={slug} />}
      {step === "references" && <ReferencesStep slug={slug} />}
      {step === "finish" && <FilmPage key={slug} slug={slug} />}
    </div>
  );
}
