import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { ChatPanel } from "../chat/ChatPanel";
import type { AssetSummary, JobView, ModelInfo, RunSummary, Vocab } from "../api/types";
import { onStudioEvent } from "../app/useStudio";
import { FilmPicker } from "./FilmPicker";
import { PromptBar } from "./PromptBar";
import { TakeTile } from "./TakeTile";
import { TakeViewer } from "./TakeViewer";
import { getRun, setRun, useRun } from "./promptStore";
import { useJobs, useNow } from "./useJobs";
import { Storyboard } from "../storyboard/Storyboard";
import { useBoard } from "../storyboard/useBoard";
import "./studio.css";

export function StudioScreen() {
  const run = useRun();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [vocab, setVocab] = useState<Vocab>({ kinds: [], roles: [] });
  const [openId, setOpenId] = useState<string | null>(null);
  const { jobs, error, reload } = useJobs(run);
  const now = useNow();
  const { board, error: boardError, apply } = useBoard(run);
  const [view, setView] = useState<"board" | "takes" | null>(null);
  const [outbox, setOutbox] = useState<{ id: number; text: string } | null>(null);
  useEffect(() => setView(null), [run]);
  // Until chosen, a film opens on its storyboard when it has a brief or plan, or nothing filmed yet.
  const shown = view ?? (board ? (board.plan || board.brief || !jobs.length ? "board" : "takes") : jobs.length ? "takes" : "board");

  const loadRuns = useCallback(
    () =>
      api<RunSummary[]>("/api/runs")
        .then((list) => {
          setRuns(list);
          if (!getRun() && list.length) setRun(list[0].run); // first visit: the newest film
        })
        .catch(() => {}),
    [],
  );

  useEffect(() => {
    loadRuns();
    // The banner in App reports a server that is down; these just stay empty.
    api<ModelInfo[]>("/api/models").then((m) => setModels(m.filter((x) => x.capability !== "audio"))).catch(() => {});
    api<AssetSummary[]>("/api/library").then(setAssets).catch(() => {});
    api<Vocab>("/api/vocab").then(setVocab).catch(() => {});
  }, [loadRuns]);

  useEffect(() => onStudioEvent((e) => e.event === "library" && setAssets(e.data)), []);

  const open: JobView | null = jobs.find((j) => j.id === openId) ?? null;

  return (
    <div className={shown === "board" && run ? "studio studio--board" : "studio"}>
      <div className="studio__main">
        <div className="studio__head">
          <FilmPicker runs={runs} run={run} onChange={setRun} />
          <div className="view-switch" role="group" aria-label="View">
            <button type="button" className="view-switch__option" aria-pressed={shown === "board"} onClick={() => setView("board")}>
              Storyboard
            </button>
            <button type="button" className="view-switch__option" aria-pressed={shown === "takes"} onClick={() => setView("takes")}>
              Takes
            </button>
          </div>
        </div>
        {shown === "board" && run ? (
          <Storyboard film={run} board={board} error={boardError} apply={apply} onPlan={(text) => setOutbox((o) => ({ id: (o?.id ?? 0) + 1, text }))} />
        ) : (
          <>
            <section className="feed" aria-label="Takes">
              {error && <p className="feed__error">{error}</p>}
              {!error && !jobs.length && <p className="feed__empty">{run ? `No takes in ${run} yet. Write a prompt below.` : "Pick a film, or start a new one, then write a prompt below."}</p>}
              {jobs.length > 0 && (
                <div className="feed__grid">
                  {jobs.map((j) => (
                    <TakeTile key={j.id} job={j} now={now} onOpen={(job) => setOpenId(job.id)} />
                  ))}
                </div>
              )}
            </section>
            <PromptBar
              models={models}
              assets={assets}
              roles={vocab.roles}
              run={run}
              onSubmitted={() => {
                loadRuns();
                reload();
              }}
              onUncertain={() => {
                loadRuns();
                reload();
              }}
            />
          </>
        )}
      </div>
      <ChatPanel film={run || null} outbox={outbox} />
      {open && <TakeViewer job={open} kinds={vocab.kinds} now={now} onClose={() => setOpenId(null)} />}
    </div>
  );
}
