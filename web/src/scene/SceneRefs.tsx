import { useId, useState } from "react";
import { MAX_REFS, refLabel } from "../../../cli/director/mentions.mjs";
import type { AssetSummary, Ref } from "../api/types";
import { leaveFor } from "../app/back";
import { libraryItemHref, libraryNewHref } from "../app/route";
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

/** What is wrong with a filled ref, said under its name, and the way to fix it; null when it is fine. */
function trouble(ref: Ref, library: SceneRefsProps["library"]) {
  if (!ref.source?.startsWith("library:")) return null;
  const name = refLabel(ref);
  const item = library.get(name);
  if (!item) return { text: "not in the Library", fix: "Make it", fixLabel: `Make @library:${name}`, href: libraryNewHref(name) };
  if (!item.hasSheet) return { text: "no sheet yet", fix: "Make its sheet", fixLabel: `Make the sheet for @library:${name}`, href: libraryItemHref(name) };
  return null;
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
            const inherited = item?.keep || item?.description || "";
            return (
              <li key={ref.id} className="scene-ref" data-empty={ref.source ? undefined : "true"}>
                {thumb ? <img className="scene-ref__thumb" src={thumb} alt="" loading="lazy" /> : <span className="scene-ref__thumb" aria-hidden="true" />}
                <div className="scene-ref__text">
                  <span className="scene-ref__tag mono">{ref.source ? `image ${n}` : `image ${n} · empty`}</span>
                  {ref.source && (
                    <>
                      {ref.source.startsWith("library:") ? (
                        <span className="scene-ref__name mono" title={`@library:${refLabel(ref)}`}>@library:{refLabel(ref)}</span>
                      ) : (
                        <span className="scene-ref__name" title={refLabel(ref)}>{refLabel(ref)}</span>
                      )}
                      {problem && (
                        <span className="scene-ref__trouble">
                          <span className="scene-ref__problem">{problem.text}</span>
                          <button type="button" className="scene-ref__fix" aria-label={problem.fixLabel} onClick={() => leaveFor(problem.href, "the scene")}>
                            {problem.fix}
                          </button>
                        </span>
                      )}
                      <LooseInput
                        className="scene-ref__keep"
                        aria-label={`Keep for image ${n}`}
                        placeholder={inherited ? "Also keep…" : "What to keep, e.g. exact face and glasses"}
                        value={ref.keep ?? ""}
                        onValue={(v) => onKeep(ref.id, v)}
                      />
                      {/* The Library's keep, used while the line above is empty: shown whole, as a placeholder would cut it off. */}
                      {inherited && !ref.keep?.trim() && <span className="scene-ref__inherited">Keeps {inherited}</span>}
                    </>
                  )}
                </div>
                <div className="scene-ref__actions">
                  {!ref.source && (
                    <button type="button" className="button" aria-label={`Choose a picture for image ${n}`} onClick={() => onChoose(ref.id)}>
                      Choose
                    </button>
                  )}
                  <button type="button" className="button button--quiet" aria-label={`Remove image ${n}`} onClick={() => onRemove(ref.id)}>
                    Remove
                  </button>
                  <button type="button" className="button button--quiet scene-ref__up" aria-label={`Move image ${n} up`} disabled={i === 0} onClick={() => onMove(i, -1)}>
                    Up
                  </button>
                  <button type="button" className="button button--quiet" aria-label={`Move image ${n} down`} disabled={i === refs.length - 1} onClick={() => onMove(i, 1)}>
                    Down
                  </button>
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
