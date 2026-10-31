import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { CheckResult, FramesResult, JobView } from "../api/types";
import { SaveAssetForm } from "../library/SaveAssetForm";
import { isVideo, mediaFile, takeCost, takeSpec, takeStatus } from "./format";
import { reuseJob } from "./promptStore";

const CHECKABLE = new Set(["submitted", "uncertain"]);

/** One take, large, with what was asked for and what it cost, and the three things to do with it. */
export function TakeViewer({ job, kinds, now, onClose }: { job: JobView; kinds: string[]; now: number; onClose: () => void }) {
  const [frames, setFrames] = useState<FramesResult | null>(null);
  const [saving, setSaving] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<"frames" | "check" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // The screen re-renders every second (its clock) with a new onClose; keep
  // the latest here so the Escape listener and the focus move happen once.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const media = job.media[0] ?? null;
  const status = takeStatus(job, now);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = async <T,>(what: "frames" | "check", fn: () => Promise<T>) => {
    setBusy(what);
    setNote(null);
    try {
      return await fn();
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : String(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const showFrames = () =>
    run("frames", () => api<FramesResult>("/api/frames", { method: "POST", body: { run: job.run, video: mediaFile(media!) } })).then((r) => r && setFrames(r));
  const checkAgain = () => run("check", () => api<CheckResult>(`/api/jobs/${job.id}/check`, { method: "POST" })).then((r) => r && setNote(r.message));

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-labelledby="viewer-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="viewer__panel">
        <div className="viewer__media">
          {media && isVideo(media) && <video src={media} controls autoPlay loop playsInline />}
          {media && !isVideo(media) && <img src={media} alt={job.prompt ?? "Take"} />}
          {!media && (
            <p className="viewer__nomedia">
              {status.kind === "running" ? "Still generating." : status.kind === "unwatched" ? "Not being watched: the studio is not waiting on this job. Check again reads its status once." : "No file for this take."}
            </p>
          )}
          {frames?.sheet && <img className="viewer__sheet" src={frames.sheet} alt={`8 frames from ${mediaFile(media ?? "")}`} />}
        </div>
        <aside className="viewer__side">
          <header className="viewer__head">
            <h2 id="viewer-title" className="mono">
              {takeSpec(job)}
            </h2>
            <button ref={closeRef} type="button" className="button button--quiet viewer__close" onClick={onClose} aria-keyshortcuts="Escape">
              Close
            </button>
          </header>
          <dl className="viewer__facts mono">
            <dt>cost</dt>
            <dd className="viewer__cost">
              {takeCost(job)} <span className="viewer__source">{job.costSource}</span>
            </dd>
            <dt>route</dt>
            <dd>
              {job.provider} · {job.providerModel ?? "?"}
              {job.failedOver && " (fallback)"}
            </dd>
            <dt>ratio</dt>
            <dd>{job.aspectRatio ?? "—"}</dd>
            <dt>state</dt>
            <dd>{job.state}</dd>
            <dt>job</dt>
            <dd>{job.id}</dd>
          </dl>
          {status.kind === "failed" && (
            <p className="viewer__failed">
              {status.reason} <strong>{status.label}</strong>
            </p>
          )}
          {job.prompt && <p className="viewer__prompt">{job.prompt}</p>}
          <div className="viewer__actions">
            <button
              type="button"
              className="button"
              onClick={() => {
                reuseJob(job);
                onClose();
              }}
            >
              Reuse
            </button>
            {media && !isVideo(media) && (
              <button type="button" className="button" onClick={() => setSaving([`${job.run}/${mediaFile(media)}`])}>
                Save to library
              </button>
            )}
            {media && isVideo(media) && (
              <button type="button" className="button" disabled={busy === "frames"} onClick={showFrames}>
                {busy === "frames" ? "Reading frames…" : "Frames"}
              </button>
            )}
            {CHECKABLE.has(job.state) && (
              <button type="button" className="button" disabled={busy === "check"} onClick={checkAgain}>
                {busy === "check" ? "Checking…" : "Check again"}
              </button>
            )}
          </div>
          {media && isVideo(media) && !frames && <p className="viewer__hint">The library keeps images. Open Frames to save a frame of this take.</p>}
          {frames && (
            <div className="viewer__actions">
              <button type="button" className="button button--quiet" onClick={() => setSaving([frames.firstPath])}>
                Save first frame to library
              </button>
              <button type="button" className="button button--quiet" onClick={() => setSaving([frames.lastPath])}>
                Save last frame to library
              </button>
            </div>
          )}
          {note && (
            <p className="viewer__note" role="status">
              {note}
            </p>
          )}
          {saving && (
            <SaveAssetForm
              images={saving}
              kinds={kinds}
              suggestedName={job.run}
              onSaved={(a) => {
                setSaving(null);
                setNote(`Saved as @${a.name}.`);
              }}
              onCancel={() => setSaving(null)}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
