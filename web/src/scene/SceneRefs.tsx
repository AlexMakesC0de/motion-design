import { useId, useState } from "react";
import { MAX_REFS, refLabel } from "../../../cli/director/mentions.mjs";
import type { AssetSummary, Ref } from "../api/types";
import { leaveFor } from "../app/back";
import { libraryItemHref, libraryNewHref } from "../app/route";
import { Icon } from "../app/icons";
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

/** Cast & props: each attached image in order, with its face, its @ name and its keep line. */
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
      <h2 id={`${id}-head`} className="scene-head">
        Cast &amp; props <span className="scene-head__n">{refs.length} of {MAX_REFS}</span>
      </h2>
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
                {thumb && item?.kind === "character" ? (
                  // A character's cover is a front/side/back sheet: show the front view's head and shoulders.
                  <span className="scene-ref__thumb scene-ref__thumb--sheet">
                    <img src={thumb} alt="" loading="lazy" />
                  </span>
                ) : thumb ? (
                  <img className="scene-ref__thumb" src={thumb} alt="" loading="lazy" />
                ) : ref.source ? (
                  <span className="scene-ref__thumb" aria-hidden="true" />
                ) : (
                  <button type="button" className="scene-ref__thumb scene-ref__thumb--empty" aria-label={`Choose a picture for image ${n}`} onClick={() => onChoose(ref.id)}>
                    <Icon name="plus" size={18} />
                  </button>
                )}
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
                      {inherited && !ref.keep?.trim() && <span className="scene-ref__inherited" title={`Keeps ${inherited}`}>Keeps {inherited}</span>}
                    </>
                  )}
                </div>
                <div className="scene-ref__actions">
                  <button type="button" className="icon-button" aria-label={`Move image ${n} up`} title="Move earlier" disabled={i === 0} onClick={() => onMove(i, -1)}>
                    <Icon name="up" size={16} />
                  </button>
                  <button type="button" className="icon-button" aria-label={`Move image ${n} down`} title="Move later" disabled={i === refs.length - 1} onClick={() => onMove(i, 1)}>
                    <Icon name="down" size={16} />
                  </button>
                  <button type="button" className="icon-button" aria-label={`Remove image ${n}`} title="Remove" onClick={() => onRemove(ref.id)}>
                    <Icon name="close" size={16} />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div className="scene-refs__add">
        <button type="button" className="button" disabled={full} onClick={onAdd}>
          <Icon name="plus" size={16} />
          Add from Library
        </button>
        <label className="button scene-refs__upload" data-disabled={full || busy ? "true" : undefined}>
          <Icon name="upload" size={16} />
          {busy ? "Uploading…" : "Upload"}
          <input type="file" accept="image/*" className="sr-only" aria-label="Upload" disabled={full || busy} onChange={(e) => void upload(e.currentTarget)} />
        </label>
      </div>
      <p className="scene-hint">Type @ in any card to put someone or something in the shot.</p>
    </section>
  );
}
