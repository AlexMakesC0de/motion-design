// Video: a settings panel on the left (look, references, prompt, model,
// duration, ratio, quality, Generate) and a stage on the right that shows the
// film's takes (History) or how it works. Scenes, the staged editor, is the
// second tab and fills the page.
import { useLayoutEffect, useRef, useState } from "react";
import menu from "../../../cli/director/menu.json";
import { setPick } from "../../../cli/director/picks.mjs";
import type { AssetSummary, JobView, PresetInfo } from "../api/types";
import { Icon } from "../app/icons";
import { modelName } from "../app/modelMeta";
import { PickChip } from "../scene/PickChips";
import { SceneScreen } from "../scene/SceneScreen";
import { FilmPicker } from "./FilmPicker";
import { GenerateMessages, ModelMenu, PresetNote, SelectCard } from "./controls";
import { RefTiles } from "./RefTiles";
import { isVideo } from "./format";
import { getDraft, setDraft, setRun, useRun, type VideoPicks } from "./promptStore";
import { typicalSeconds } from "./format";
import { TakeTile } from "./TakeTile";
import { TakeViewer } from "./TakeViewer";
import { useGenerate } from "./useGenerate";
import { useJobs, useNow } from "./useJobs";
import { useStudioData } from "./useStudioData";
import "./studio.css";
import "./video.css";

// Create's own run (SCRATCH_RUN in cli/lib/run.mjs, which the page cannot import).
const CREATE_RUN = "create";

function VideoTabs({ tab }: { tab: "create" | "scenes" }) {
  return (
    <nav className="video-tabs" aria-label="Video">
      <a className="video-tabs__tab" href="#/video" aria-current={tab === "create" ? "page" : undefined}>
        Create Video
      </a>
      <a className="video-tabs__tab" href="#/video/scenes" aria-current={tab === "scenes" ? "page" : undefined}>
        Scenes
      </a>
    </nav>
  );
}

export function VideoScreen({ tab }: { tab: "create" | "scenes" }) {
  if (tab === "scenes") {
    return (
      <div className="video video--scenes">
        <VideoTabs tab="scenes" />
        <div className="video__scenes">
          <SceneScreen run={CREATE_RUN} saveInto />
        </div>
      </div>
    );
  }
  return <CreateVideo />;
}

type View = "history" | "how";

// One chip changed. setPick drops the speed with its move (and for Static), so the draft never holds a speed alone.
const pick = (key: keyof VideoPicks, id: string | undefined) => setDraft({ picks: setPick(getDraft().picks, key, id) ?? {} });

function CreateVideo() {
  const run = useRun();
  const { runs, models, assets, vocab, looks, loadRuns } = useStudioData();
  const { jobs, error, reload } = useJobs(run);
  const now = useNow();
  const [view, setView] = useState<View | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const settled = () => {
    loadRuns();
    reload();
    setView("history");
  };
  const g = useGenerate({ models, capability: "video", roles: vocab.roles, run, onSubmitted: settled, onUncertain: settled });
  const { draft, model } = g;
  // The prompt grows with its text (up to the CSS max-height, then it scrolls); it is never dragged to size.
  const promptBox = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const box = promptBox.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
  }, [draft.prompt]);

  const takes = jobs.filter((j) => j.capability === "video");
  const shown: View = view ?? (takes.length ? "history" : "how");
  const look = looks.find((l) => l.id === draft.preset) ?? null;
  const cover = look?.still ?? looks.find((l) => l.still)?.still ?? null;
  const open: JobView | null = takes.find((j) => j.id === openId) ?? null;

  return (
    <div className="video">
      <aside className="video__panel" aria-label="Create video" data-side-menus>
        <div className="video__scroll">
          <VideoTabs tab="create" />

          <div className="look-card">
            {cover && <img className="look-card__img" src={cover} alt="" />}
            <a className="look-card__change" href="#/presets">
              Change
            </a>
            <div className="look-card__words">
              <p className="look-card__title">{look?.title ?? "General"}</p>
              <p className="look-card__model">{draft.model ? modelName(draft.model) : "No model yet"}</p>
            </div>
          </div>

          <RefTiles refs={draft.refs} assets={assets} roles={g.roleChoices} />

          <div className="prompt-card">
            <label className="prompt-card__label" htmlFor="video-prompt">
              Prompt
            </label>
            <textarea
              id="video-prompt"
              className="prompt-card__text"
              placeholder="Describe the shot. Add references from your Library…"
              ref={promptBox}
              rows={3}
              value={draft.prompt}
              onChange={(e) => setDraft({ prompt: e.target.value })}
            />
            <div className="pick-row" role="group" aria-label="Camera and look picks">
              <PickChip
                label="Move"
                scope="Move"
                options={menu.moves}
                value={draft.picks.move}
                onPick={(id) => pick("move", id)}
                speeds={menu.speeds}
                speed={draft.picks.speed}
                onSpeed={(id) => pick("speed", id)}
              />
              <PickChip label="Shot size" scope="Shot size" options={menu.sizes} value={draft.picks.size} onPick={(id) => pick("size", id)} />
              <PickChip label="Angle" scope="Angle" options={menu.angles} value={draft.picks.angle} onPick={(id) => pick("angle", id)} />
              <PickChip label="Lens" scope="Lens" options={menu.lenses} value={draft.picks.lens} onPick={(id) => pick("lens", id)} />
              <PickChip label="Lighting" scope="Lighting" options={menu.lights} value={draft.picks.light} onPick={(id) => pick("light", id)} />
            </div>
            <PresetNote preset={draft.preset} title={look?.title} />
          </div>

          <ModelMenu models={g.pageModels} value={draft.model} onPick={g.pickModel} />

          {model && (
            <div className="field-cards">
              <SelectCard label="Duration" value={draft.durationS} options={model.durationsS} format={(s) => `${s}s`} onChange={(durationS) => setDraft({ durationS, budgetUsd: null })} />
              <SelectCard label="Aspect Ratio" value={draft.aspectRatio} options={model.aspectRatios} onChange={(aspectRatio) => setDraft({ aspectRatio })} />
              <SelectCard label="Quality" value={draft.resolution} options={model.resolutionOptions} empty="default" onChange={(resolution) => setDraft({ resolution, budgetUsd: null })} />
            </div>
          )}
        </div>

        <div className="video__go">
          <GenerateMessages g={g} reasonId="video-generate-reason" />
          <button type="button" className="big-generate" disabled={g.disabled} aria-describedby={g.reason ? "video-generate-reason" : undefined} onClick={g.generate}>
            {g.sending ? "Sending…" : "Generate"} <span className="mono">{g.price}</span>
          </button>
        </div>
      </aside>

      <section className="video__stage" aria-label="Takes and help">
        <div className="video__stage-head">
          <div className="pill-toggle" role="group" aria-label="Show">
            <button type="button" className="pill-toggle__item" aria-pressed={shown === "history"} onClick={() => setView("history")}>
              <Icon name="library" size={16} />
              History
            </button>
            <button type="button" className="pill-toggle__item" aria-pressed={shown === "how"} onClick={() => setView("how")}>
              <Icon name="presets" size={16} />
              How it works
            </button>
          </div>
          {shown === "history" && <FilmPicker runs={runs} run={run} onChange={setRun} />}
        </div>

        {shown === "history" ? (
          <section className="feed video__feed" aria-label="Takes">
            {error && <p className="feed__error">{error}</p>}
            {!error && !takes.length && <p className="feed__empty">{run ? `No video takes in ${run} yet. Write a prompt on the left.` : "Pick a film, or start a new one, then write a prompt on the left."}</p>}
            {takes.length > 0 && (
              <div className="feed__grid">
                {takes.map((j) => (
                  <TakeTile key={j.id} job={j} now={now} expectedS={typicalSeconds(jobs, j.model, j.capability)} onOpen={(job) => setOpenId(job.id)} />
                ))}
              </div>
            )}
          </section>
        ) : (
          <HowItWorks looks={looks} assets={assets} takes={takes} />
        )}
      </section>
      {open && <TakeViewer job={open} kinds={vocab.kinds} now={now} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** How it works: three steps with pictures from the user's own looks, Library and takes. */
function HowItWorks({ looks, assets, takes }: { looks: PresetInfo[]; assets: AssetSummary[]; takes: JobView[] }) {
  const stills = looks.map((l) => l.still).filter((s): s is string => Boolean(s));
  const refCover = assets.find((a) => a.cover)?.cover ?? stills[3] ?? null;
  const latest = takes.find((j) => j.state === "succeeded" && j.media[0])?.media[0] ?? null;
  const result = latest ?? stills[4] ?? stills[0] ?? null;
  return (
    <div className="how">
      <div className="how__main">
        <h2 className="display how__title">Make videos in one click</h2>
        <p className="how__sub">Pick a look for the camera move and the mood, or stay on General and direct every shot yourself.</p>
        <ol className="how__steps">
          <li className="how-step">
            <div className="how-step__art how-step__art--refs">
              <div className="how-step__drop">
                <Icon name="upload" size={24} />
                <span className="display how-step__drop-title">From your Library</span>
              </div>
              {refCover && <img className="how-step__tilt" src={refCover} alt="" />}
            </div>
            <h3 className="display how-step__title">Add references</h3>
            <p className="how-step__text">A character, product or place from your Library, and the role it plays in the shot.</p>
          </li>
          <li className="how-step">
            <div className="how-step__art how-step__art--looks">
              {[stills[1], stills[0], stills[2]].map((s, i) =>
                s ? <img key={i} className="how-step__look" data-mid={i === 1 || undefined} src={s} alt="" /> : <span key={i} className="how-step__look" data-mid={i === 1 || undefined} />,
              )}
            </div>
            <h3 className="display how-step__title">Choose a look</h3>
            <p className="how-step__text">A look sets the camera move, the pacing and the mood, with a prompt to adapt.</p>
          </li>
          <li className="how-step">
            <div className="how-step__art how-step__art--result">
              <div className="how-step__frame">
                {result && isVideo(result) && <video src={result} muted playsInline preload="metadata" />}
                {result && !isVideo(result) && <img src={result} alt="" />}
                {!result && <Icon name="video" size={28} />}
              </div>
            </div>
            <h3 className="display how-step__title">Get video</h3>
            <p className="how-step__text">Check the price on the button, then Generate. The take lands in History.</p>
          </li>
        </ol>
      </div>
      <a className="how__start" href="#/presets">
        <span className="how__start-stack" aria-hidden="true">
          {stills.slice(0, 3).map((s, i) => (
            <img key={s} src={s} alt="" data-i={i} />
          ))}
        </span>
        <span className="how__start-words">
          <span className="how__start-title">Don't know where to start?</span>
          <span className="how__start-sub">Pick a look and adapt its prompt</span>
        </span>
        <Icon name="arrow" size={18} />
      </a>
    </div>
  );
}
