import { useState, type CSSProperties } from "react";
import { api, ApiError } from "../api/client";
import type { CheckResult, JobView } from "../api/types";
import {
  frameRatio,
  isVideo,
  progressOf,
  takeCost,
  takeName,
  takeSpec,
  takeStatus,
} from "./format";
import { SnakeLoader } from "./SnakeLoader";

/** The one separator between parts of a caption. The spaces are part of it; the dot is for the eye only. */
const Sep = () => <span aria-hidden="true"> · </span>;

/**
 * One take in the feed: the footage, then the engine line and what happened.
 * While it is being made, the frame is a game of Snake with a progress bar;
 * `expectedS` is how long its model usually takes.
 */
export function TakeTile({
  job,
  now,
  onOpen,
  expectedS = 60,
  spec = true,
}: {
  job: JobView;
  now: number;
  onOpen: (job: JobView) => void;
  expectedS?: number;
  /** The engine and cost line; the Image thread shows it in the prompt bubble instead. */
  spec?: boolean;
}) {
  const status = takeStatus(job, now);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // One free status read; a settled job reaches the feed as a job event.
  const checkAgain = async () => {
    setChecking(true);
    setNote(null);
    try {
      setNote(
        (
          await api<CheckResult>(`/api/jobs/${job.id}/check`, {
            method: "POST",
          })
        ).message,
      );
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };
  const media = status.kind === "done" ? (job.media[0] ?? null) : null;
  return (
    // --r is the frame's width over its height; studio.css sizes the tile from it.
    <article
      className="take"
      data-state={status.kind}
      style={{ "--r": frameRatio(job.aspectRatio) } as CSSProperties}
    >
      {status.kind === "running" ? (
        <div className="take__frame take__frame--making">
          <SnakeLoader
            progress={progressOf(job.createdAt, now, expectedS)}
            label={takeName(job, status)}
          />
        </div>
      ) : (
        <button
          type="button"
          className="take__frame"
          onClick={() => onOpen(job)}
          aria-label={takeName(job, status)}
        >
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
          {media && !isVideo(media) && (
            <img src={media} alt="" loading="lazy" />
          )}
          {!media && <span className="take__empty" aria-hidden="true" />}
        </button>
      )}
      <div className="take__info">
        {spec && (
          <p className="take__spec mono">
            <span>{takeSpec(job)}</span>
            <Sep />
            <span className="take__cost">{takeCost(job)}</span>
            {job.failedOver && (
              <span className="take__via">→ {job.provider}</span>
            )}
          </p>
        )}
        {status.kind === "running" && (
          <p className="take__status mono">{status.label}</p>
        )}
        {status.kind === "unwatched" && (
          <p className="take__status take__status--unwatched">
            {status.label}
            <Sep />
            <button
              type="button"
              className="take__check"
              disabled={checking}
              onClick={checkAgain}
            >
              {checking ? "Checking…" : "Check again"}
            </button>
            {job.state === "uncertain" && (
              <>
                <Sep />
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
            {status.label}
            <Sep />
            <code className="mono">{job.id}</code>
          </p>
        )}
        {status.kind === "failed" && (
          <p className="take__status take__status--failed">
            <span className="take__reason">{status.reason}</span>{" "}
            <span className="take__charged">{status.label}</span>
          </p>
        )}
      </div>
    </article>
  );
}
