import { useId, useState } from "react";
import { MAX_REFS, refLabel } from "../../../cli/director/mentions.mjs";
import type { AssetSummary, Ref } from "../api/types";
import { LooseInput } from "./SceneCards";
import "./scene.css";

export interface SceneRefsProps {
  run: string;
  refs: Ref[];
  library: Map<string, AssetSummary>;
  onMove(index: number, by: -1 | 1): void;
  onRemove(id: string): void;
  onKeep(id: string, keep: string): void;
  /** Open the chooser for this slot. */
  onChoose(id: string): void;
  /** Open the chooser for a new slot at the end. */
  onAdd(): void;
  /** Store a picture and add it as a new image. */
  onUpload(file: File): Promise<void>;
}

/** Where a ref's picture is shown from: the Library item's cover, or the film's own refs folder. */
function thumbOf(ref: Ref, run: string, library: SceneRefsProps["library"]) {
  if (!ref.source) return null;
  if (ref.source.startsWith("library:")) return library.get(refLabel(ref))?.cover ?? null;
  return `/media/runs/${encodeURIComponent(run)}/${ref.source.slice("file:".length)}`;
}

/** What is wrong with a filled ref, said under its name; null when it is fine. */
function trouble(ref: Ref, library: SceneRefsProps["library"]) {
  if (!ref.source?.startsWith("library:")) return null;
  const item = library.get(refLabel(ref));
  if (!item) return "not in the Library";
  return item.hasSheet ? null : "no sheet yet";
}

/** The left column, "In this scene": each attached image in order, with its keep line. */
export function SceneRefs({ run, refs, library, onMove, onRemove, onKeep, onChoose, onAdd, onUpload }: SceneRefsProps) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const full = refs.length >= MAX_REFS;

  const upload = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await onUpload(file);
    } finally {
      setBusy(false);
      input.value = "";
    }
  };

  return (
    <section className="scene-refs" aria-labelledby={`${id}-head`}>
      <h2 id={`${id}-head`} className="scene-label">In this scene</h2>
      {refs.length > 0 && (
        <ol className="scene-refs__list" aria-label="In this scene">
          {refs.map((ref, i) => {
            const n = i + 1;
            const thumb = thumbOf(ref, run, library);
            const item = ref.source?.startsWith("library:") ? library.get(refLabel(ref)) : undefined;
            const problem = trouble(ref, library);
            return (
              <li key={ref.id} className="scene-ref" data-empty={ref.source ? undefined : "true"}>
                {thumb ? <img className="scene-ref__thumb" src={thumb} alt="" loading="lazy" /> : <span className="scene-ref__thumb" aria-hidden="true" />}
                <div className="scene-ref__text">
                  {ref.source ? (
                    <>
                      <span className="scene-ref__tag mono">image{n}</span>
                      {ref.source.startsWith("library:") ? (
                        <span className="scene-ref__name mono">@library:{refLabel(ref)}</span>
                      ) : (
                        <span className="scene-ref__name">{refLabel(ref)}</span>
                      )}
                      {problem && <span className="scene-ref__problem">{problem}</span>}
                      <LooseInput
                        className="scene-ref__keep"
                        aria-label={`Keep for image ${n}`}
                        placeholder={item?.keep || item?.description || "What to keep, e.g. exact face and glasses"}
                        value={ref.keep ?? ""}
                        onValue={(v) => onKeep(ref.id, v)}
                      />
                    </>
                  ) : (
                    <span className="scene-ref__name scene-ref__name--empty mono">image {n} · empty</span>
                  )}
                  <div className="scene-ref__actions">
                    {!ref.source && (
                      <button type="button" className="button" aria-label={`Choose a picture for image ${n}`} onClick={() => onChoose(ref.id)}>
                        Choose
                      </button>
                    )}
                    <button type="button" className="button button--quiet" aria-label={`Remove image ${n}`} onClick={() => onRemove(ref.id)}>
                      Remove
                    </button>
                    <button type="button" className="button button--quiet" aria-label={`Move image ${n} up`} disabled={i === 0} onClick={() => onMove(i, -1)}>
                      Up
                    </button>
                    <button type="button" className="button button--quiet" aria-label={`Move image ${n} down`} disabled={i === refs.length - 1} onClick={() => onMove(i, 1)}>
                      Down
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div className="scene-refs__add">
        <button type="button" className="button" disabled={full} onClick={onAdd}>
          + Add from Library
        </button>
        <label className="button scene-refs__upload" data-disabled={full || busy ? "true" : undefined}>
          {busy ? "Uploading…" : "Upload"}
          <input type="file" accept="image/*" className="sr-only" aria-label="Upload" disabled={full || busy} onChange={(e) => void upload(e.currentTarget)} />
        </label>
      </div>
      <p className="scene-hint">Type @ in any card. Up to {MAX_REFS} images.</p>
    </section>
  );
}
