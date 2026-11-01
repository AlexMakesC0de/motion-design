import { useCallback, useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { api } from "../api/client";
import type { AssetSummary, JobView, ModelInfo, RunSummary, Vocab } from "../api/types";
import { onStudioEvent } from "../app/useStudio";
import { SceneScreen } from "../scene/SceneScreen";
import { FilmPicker } from "./FilmPicker";
import { PromptBar } from "./PromptBar";
import { TakeTile } from "./TakeTile";
import { TakeViewer } from "./TakeViewer";
import { getRun, setRun, useRun } from "./promptStore";
import { useJobs, useNow } from "./useJobs";
import "./studio.css";

// Create's own run (SCRATCH_RUN in cli/lib/run.mjs, which the page cannot import).
const CREATE_RUN = "create";
const TAB_KEY = "shard.createTab";
type Tab = "scene" | "quick";
const TABS: { id: Tab; label: string }[] = [
  { id: "scene", label: "Scene" },
  { id: "quick", label: "Quick take" },
];

function savedTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === "quick" ? "quick" : "scene";
  } catch {
    return "scene";
  }
}

/** Create: a scene editor (the default) and Quick take, today's prompt bar and feed. The choice is remembered. */
export function StudioScreen() {
  const [tab, setTab] = useState<Tab>(savedTab);

  const pick = (next: Tab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // private mode: the choice lasts until reload
    }
  };

  // Arrow keys move between the two tabs, as in any tab list.
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = TABS[(TABS.findIndex((t) => t.id === tab) + 1) % TABS.length].id;
    pick(next);
    document.getElementById(`create-tab-${next}`)?.focus();
  };

  return (
    <div className="create">
      <div className="create__tabs" role="tablist" aria-label="Create" onKeyDown={keys}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`create-tab-${t.id}`}
            type="button"
            role="tab"
            className="create__tab"
            aria-selected={tab === t.id}
            aria-controls="create-panel"
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => pick(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="create-panel" className="create__panel" role="tabpanel" aria-labelledby={`create-tab-${tab}`}>
        {tab === "scene" ? <SceneScreen run={CREATE_RUN} /> : <QuickTake />}
      </div>
    </div>
  );
}

/** Quick take: the takes of the film you are working in, and the prompt bar. The chat is the drawer. */
function QuickTake() {
  const run = useRun();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [vocab, setVocab] = useState<Vocab>({ kinds: [], roles: [] });
  const [openId, setOpenId] = useState<string | null>(null);
  const { jobs, error, reload } = useJobs(run);
  const now = useNow();

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
    <div className="studio">
      <div className="studio__main">
        <div className="studio__head">
          <FilmPicker runs={runs} run={run} onChange={setRun} />
        </div>
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
      </div>
      {open && <TakeViewer job={open} kinds={vocab.kinds} now={now} onClose={() => setOpenId(null)} />}
    </div>
  );
}
