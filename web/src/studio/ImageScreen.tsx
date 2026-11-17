// Image: the film's image takes (or, before the first one, a hero naming the
// model), with a floating prompt dock at the bottom: the prompt, a reference,
// model, aspect ratio and resolution chips, and the tall Generate block.
import { useState, type DragEvent } from "react";
import { ApiError } from "../api/client";
import type { JobView } from "../api/types";
import { Icon } from "../app/icons";
import { modelName } from "../app/modelMeta";
import { FilmPicker } from "./FilmPicker";
import { AttachMenu, attachFile } from "./AttachMenu";
import { GenerateMessages, PresetNote, RefChips, SelectChip } from "./controls";
import { setDraft, setRun, useRun } from "./promptStore";
import { TakeTile } from "./TakeTile";
import { TakeViewer } from "./TakeViewer";
import { useGenerate } from "./useGenerate";
import { useJobs, useNow } from "./useJobs";
import { useStudioData } from "./useStudioData";
import "./studio.css";
import "./image.css";

export function ImageScreen() {
  const run = useRun();
  const { runs, models, assets, vocab, looks, loadRuns } = useStudioData();
  const { jobs, error, reload } = useJobs(run);
  const now = useNow();
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const settled = () => {
    loadRuns();
    reload();
  };
  const g = useGenerate({ models, capability: "image", roles: vocab.roles, run, onSubmitted: settled, onUncertain: settled });
  const { draft, model } = g;

  // A picture dropped on the dock is uploaded like "Upload from your computer", as the first role.
  const hasFile = (e: DragEvent) => [...e.dataTransfer.types].includes("Files");
  const drop = async (e: DragEvent) => {
    if (!hasFile(e)) return;
    e.preventDefault();
    setDropping(false);
    const file = [...e.dataTransfer.files].find((f) => /^image\/(png|jpeg|webp)$/.test(f.type));
    if (!file) return setAttachError("Drop a PNG, JPG or WebP picture.");
    if (!run) return setAttachError("Pick a film to work in first; uploads are kept in its folder.");
    setAttachError(null);
    try {
      await attachFile(run, file, attachRoles[0] ?? "identity");
    } catch (err) {
      setAttachError(err instanceof ApiError ? err.message : String(err));
    }
  };

  // Frames and motion are video roles; a picture for an image is a character or a style.
  const imageRoles = g.roleChoices.filter((r) => r === "identity" || r === "style");
  const attachRoles = imageRoles.length ? imageRoles : g.roleChoices;

  const takes = jobs.filter((j) => j.capability === "image");
  const open: JobView | null = takes.find((j) => j.id === openId) ?? null;
  const pictures = [...takes.filter((j) => j.state === "succeeded").map((j) => j.media[0]), ...looks.map((l) => l.still)].filter((s): s is string => Boolean(s)).slice(0, 4);

  return (
    <div className="image-page">
      <div className="image-page__head">
        <FilmPicker runs={runs} run={run} onChange={setRun} />
      </div>

      <div className="image-page__body">
        {error && <p className="feed__error">{error}</p>}
        {!error && takes.length > 0 ? (
          <section className="feed image-page__feed" aria-label="Takes">
            <div className="feed__grid">
              {takes.map((j) => (
                <TakeTile key={j.id} job={j} now={now} onOpen={(job) => setOpenId(job.id)} />
              ))}
            </div>
          </section>
        ) : (
          <div className="image-hero">
            <div className="image-hero__cards" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (pictures[i] ? <img key={i} className="image-hero__card" src={pictures[i]} alt="" /> : <span key={i} className="image-hero__card" />))}
            </div>
            <h1 className="display image-hero__title">
              <span>Start creating with</span> <span className="image-hero__model">{draft.model ? modelName(draft.model) : "an image model"}</span>
            </h1>
            <p className="image-hero__sub">Describe a subject, a style or a mood, and see it in seconds</p>
          </div>
        )}
      </div>

      <section
        className="dock"
        aria-label="Prompt"
        data-dropping={dropping || undefined}
        onDragOver={(e) => {
          if (!hasFile(e)) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
        }}
        onDrop={(e) => void drop(e)}
      >
        {dropping && (
          <div className="dock__drop" aria-hidden="true">
            <Icon name="upload" size={20} /> Drop to add as a reference
          </div>
        )}
        <div className="dock__main">
          <GenerateMessages g={g} reasonId="image-generate-reason" />
          <PresetNote preset={draft.preset} title={looks.find((l) => l.id === draft.preset)?.title} />
          <textarea className="dock__text" aria-label="Prompt" placeholder="Describe the image…" rows={2} value={draft.prompt} onChange={(e) => setDraft({ prompt: e.target.value })} />
          {attachError && (
            <p className="gen-msg gen-msg--failure" role="alert">
              {attachError}
            </p>
          )}
          <RefChips refs={draft.refs} assets={assets} />
          <div className="dock__chips">
            <AttachMenu run={run} assets={assets} roles={attachRoles} onError={setAttachError} />
            <SelectChip label="Model" icon={<Icon name="model" size={16} />} value={draft.model || null} options={g.pageModels.map((m) => m.id)} format={modelName} chevron onChange={g.pickModel} />
            {model && <SelectChip label="Aspect ratio" icon={<span className="ratio-glyph" aria-hidden="true" />} value={draft.aspectRatio} options={model.aspectRatios} onChange={(aspectRatio) => setDraft({ aspectRatio })} />}
            {model && <SelectChip label="Resolution" icon={<Icon name="image" size={16} />} value={draft.resolution} options={model.resolutionOptions} empty="default" onChange={(resolution) => setDraft({ resolution, budgetUsd: null })} />}
          </div>
        </div>
        <button type="button" className="dock__generate" disabled={g.disabled} aria-describedby={g.reason ? "image-generate-reason" : undefined} onClick={g.generate}>
          <span className="dock__generate-label">{g.sending ? "Sending…" : "Generate"}</span> <span className="dock__generate-price mono">{g.price}</span>
        </button>
      </section>
      {open && <TakeViewer job={open} kinds={vocab.kinds} now={now} onClose={() => setOpenId(null)} />}
    </div>
  );
}
