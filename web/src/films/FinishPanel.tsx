import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { FilmDetail, FinishInfo, TaskView } from "../api/types";
import { AssembleForm } from "./AssembleForm";
import { CaptionsForm } from "./CaptionsForm";
import { CardForm } from "./CardForm";
import { VariantsForm } from "./VariantsForm";
import { TaskList } from "./TaskList";
import { mergeTask, useTasks } from "./useTasks";

interface Props {
  film: FilmDetail;
  /** The chosen shot names, in order. */
  shots: string[];
  /** Read the film again: a task ended or a file was added. */
  onChanged: () => void;
  /** Show only these tools (Edit hides Assemble: its Export makes the film). */
  only?: ("assemble" | "captions" | "variants" | "card")[];
  /** A heading; Edit's More section has its own. */
  heading?: boolean;
}

function MissingTools({ info }: { info: FinishInfo }) {
  const { ffmpeg, render } = info.tools;
  if (ffmpeg.ok && render.ok) return null;
  return (
    <section className="finish__missing" role="status" aria-label="Missing tools">
      {!ffmpeg.ok && (
        <>
          <p>ffmpeg isn't installed, so Assemble, Captions and Variants are off.</p>
          {ffmpeg.install && <pre className="mono">{ffmpeg.install}</pre>}
        </>
      )}
      {!render.ok && (
        <>
          <p>The render engine isn't set up, so Captions and Text cards are off.</p>
          {render.install && <pre className="mono">{render.install}</pre>}
        </>
      )}
    </section>
  );
}

/** The finishing tools for one film. Each runs as a server task; one at a time per film. */
export function FinishPanel({ film, shots, onChanged, only, heading = true }: Props) {
  const has = (t: "assemble" | "captions" | "variants" | "card") => !only || only.includes(t);
  const [info, setInfo] = useState<FinishInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<TaskView | null>(null);
  const heard = useTasks(film.run, onChanged);

  useEffect(() => {
    api<FinishInfo>("/api/finish")
      .then(setInfo)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  // The POST answers with the task before its first event may arrive.
  const tasks = started && !heard.some((t) => t.id === started.id) ? mergeTask(heard, started) : heard;
  const busy = tasks.some((t) => t.state === "running");

  if (error)
    return (
      <aside className="finish">
        <p className="finish__error" role="alert">
          {error}
        </p>
      </aside>
    );
  if (!info) return <aside className="finish" aria-busy="true" />;
  return (
    <aside className="finish" aria-label="Finish">
      {heading && <h2>Finish</h2>}
      <MissingTools info={info} />
      <TaskList tasks={tasks} />
      {has("assemble") && <AssembleForm film={film} info={info} shots={shots} busy={busy} onStarted={setStarted} onChanged={onChanged} />}
      {has("captions") && <CaptionsForm film={film} info={info} busy={busy} onStarted={setStarted} onChanged={onChanged} />}
      {has("variants") && <VariantsForm film={film} info={info} busy={busy} onStarted={setStarted} />}
      {has("card") && <CardForm film={film} info={info} busy={busy} onStarted={setStarted} />}
    </aside>
  );
}
