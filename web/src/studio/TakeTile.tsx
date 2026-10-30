import { useState } from "react";
import { api, ApiError } from "../api/client";
import type { CheckResult, JobView } from "../api/types";
import { frameRatio, isVideo, takeCost, takeSpec, takeStatus } from "./format";

/** One take in the feed: the footage, then the engine line and what happened. */
export function TakeTile({ job, now, onOpen }: { job: JobView; now: number; onOpen: (job: JobView) => void }) {
  const status = takeStatus(job, now);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // One free status read; a settled job reaches the feed as a job event.
  const checkAgain = async () => {
    setChecking(true);
    setNote(null);
    try {
      setNote((await api<CheckResult>(`/api/jobs/${job.id}/check`, { method: "POST" })).message);
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };
  const media = status.kind === "done" ? (job.media[0] ?? null) : null;
  return (
    <article className="take" data-state={status.kind}>
      <button type="button" className="take__frame" style={{ aspectRatio: frameRatio(job.aspectRatio) }} onClick={() => onOpen(job)} aria-label={`Open take ${job.id}`}>
        {media && isVideo(media) && (
          <video
            src={media}
            muted
            loop
            playsInline
            preload="metadata"
            onMouseEnter={(e) => void e.currentTarget.play()?.catch(() => {})}
            onMouseLeave={(e) => e.currentTarget.pause()}
          />
        )}
        {media && !isVideo(media) && <img src={media} alt="" loading="lazy" />}
        {!media && <span className="take__empty" aria-hidden="true" />}
      </button>
      <div className="take__info">
        <p className="take__spec mono">
          <span>{takeSpec(job)}</span>
          <span aria-hidden="true"> · </span>
          <span className="take__cost">{takeCost(job)}</span>
          {job.failedOver && <span className="take__via">→ {job.provider}</span>}
        </p>
        {status.kind === "running" && <p className="take__status mono">{status.label}</p>}
        {status.kind === "unwatched" && (
          <p className="take__status take__status--unwatched">
            {status.label} ·{" "}
            <button type="button" className="take__check" disabled={checking} onClick={checkAgain}>
              {checking ? "Checking…" : "Check again"}
            </button>
            {job.state === "uncertain" && (
              <>
                {" "}
                <code className="mono">{job.id}</code>
              </>
            )}
          </p>
        )}
        {note && (
          <p className="take__note" role="status">
            {note}
          </p>
        )}
        {status.kind === "uncertain" && (
          <p className="take__status take__status--uncertain">
            {status.label} <code className="mono">{job.id}</code>
          </p>
        )}
        {status.kind === "failed" && (
          <p className="take__status take__status--failed">
            <span className="take__reason">{status.reason}</span> <span className="take__charged">{status.label}</span>
          </p>
        )}
      </div>
    </article>
  );
}
