import { useState } from "react";
import { ApiError } from "../api/client";
import type { Scene, ScenePreview, SceneVersion } from "../api/types";
import { usd } from "../studio/format";
import { useNow } from "../studio/useJobs";
import "./scene.css";

const FINALS = ["1080p", "720p"] as const;
type Final = (typeof FINALS)[number];

export interface VersionsProps {
  scene: Scene;
  /** The prompt preview for this scene: prices and problems. Null until it arrives. */
  preview: ScenePreview | null;
  onDraft(): Promise<{ scene: Scene }>;
  onFinal(resolution: Final): Promise<{ scene: Scene }>;
  onChoose(job: string): Promise<unknown>;
}

const RUNNING = new Set(["reserved", "sending", "submitted"]);

/** A short word for a version that has no picture to show yet; null when it succeeded. */
function stateWord(v: SceneVersion) {
  if (v.state === "succeeded") return null;
  if (v.state && RUNNING.has(v.state)) return "running";
  if (v.state === "uncertain") return "uncertain, check Spend";
  if (v.state) return "failed";
  return "record missing";
}

/** What the player says when the version it shows has nothing to play. */
const emptyText = (v: SceneVersion, name: string) => (v.state === "succeeded" ? `${name}'s video file is missing.` : `${name} is ${stateWord(v)}.`);

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** "Draft 2", "Final 1": numbered within their kind, in the order they were made. */
function names(versions: SceneVersion[]) {
  const count = { draft: 0, final: 0 };
  return versions.map((v) => `${v.kind === "final" ? "Final" : "Draft"} ${(count[v.kind] += 1)}`);
}

const priceText = (p: { usd: number | null } | null | undefined) => (p?.usd != null ? usd(p.usd) : "no price");

/** The right column: the player, the versions, New draft and Make final. */
export function Versions({ scene, preview, onDraft, onFinal, onChoose }: VersionsProps) {
  const now = useNow(30_000);
  const [picked, setPicked] = useState<string | null>(null);
  const [final, setFinal] = useState<Final>("1080p");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [unsure, setUnsure] = useState<string | null>(null);

  const versions = scene.versions;
  const labels = names(versions);
  const newestDone = [...versions].reverse().find((v) => v.state === "succeeded" && v.media);
  const shown = versions.find((v) => v.job === picked) ?? versions.find((v) => v.job === scene.chosen) ?? newestDone ?? versions.at(-1) ?? null;
  const shownName = shown ? labels[versions.indexOf(shown)] : null;

  const problems = preview?.problems ?? [];
  const draftPrice = preview?.prices.draft;
  const finalPrice = preview?.prices[final === "720p" ? "final720" : "final1080"];
  const held = busy || Boolean(unsure) || !preview || problems.length > 0;

  // One request at a time; a code-5 answer means kie may have the job, so nothing more is sent until it is checked.
  const make = async (go: () => Promise<{ scene: Scene }>) => {
    setBusy(true);
    setFailure(null);
    try {
      const r = await go();
      setPicked(r.scene.versions.at(-1)?.job ?? null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 5) setUnsure(e.message);
      else setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const choose = async (job: string) => {
    setFailure(null);
    try {
      await onChoose(job);
      setPicked(job);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="scene-versions" aria-label="Player and versions">
      <div className="scene-player" style={{ aspectRatio: scene.ratio.replace(":", " / ") }}>
        {shown?.media ? (
          <video key={shown.media} src={shown.media} controls playsInline aria-label={`${shownName} of ${scene.title || "this scene"}`} />
        ) : (
          <p className="scene-player__empty">{shown ? emptyText(shown, shownName!) : "No versions yet. A draft is a quick 480p try."}</p>
        )}
      </div>

      {versions.length > 0 && (
        <>
          <h2 className="scene-label">Versions</h2>
          <ol className="scene-versions__list" aria-label="Versions">
            {versions
              .map((v, i) => ({ v, name: labels[i] }))
              .reverse()
              .map(({ v, name }) => {
                const word = stateWord(v);
                const chosen = scene.chosen === v.job;
                // The full name in aria-label: name computation trims each span, which would drop the spaces.
                const label = `${name} · ${v.resolution} · ${word ?? ago(v.createdAt, now)}${chosen ? ", chosen" : ""}`;
                return (
                  <li key={v.job} className="scene-version" data-on={shown?.job === v.job ? "true" : undefined} data-state={word ? v.state ?? "missing" : undefined}>
                    <button type="button" className="scene-version__pick" aria-pressed={shown?.job === v.job} aria-label={label} onClick={() => setPicked(v.job)}>
                      <span className="scene-version__what">{name}</span>
                      <span className="mono"> · {v.resolution}</span>
                      <span className="scene-version__when"> · {word ?? ago(v.createdAt, now)}</span>
                    </button>
                    {chosen ? (
                      <span className="scene-version__chosen">★ chosen</span>
                    ) : (
                      v.state === "succeeded" && (
                        <button type="button" className="button button--quiet scene-version__choose" aria-label={`Choose ${name.toLowerCase()}`} onClick={() => void choose(v.job)}>
                          Choose
                        </button>
                      )
                    )}
                  </li>
                );
              })}
          </ol>
        </>
      )}

      <div className="scene-make">
        <button type="button" className="button scene-make__draft" disabled={held || draftPrice?.usd == null} aria-label={`New draft at 480p, ${priceText(draftPrice)}`} onClick={() => void make(onDraft)}>
          New draft <span className="mono scene-price">{priceText(draftPrice)}</span>
        </button>
        <div className="scene-make__final">
          <select className="scene-input scene-make__res" aria-label="Final resolution" value={final} onChange={(e) => setFinal(e.target.value as Final)}>
            {FINALS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <button type="button" className="generate" disabled={held || finalPrice?.usd == null} aria-label={`Make final at ${final}, ${priceText(finalPrice)}`} onClick={() => void make(() => onFinal(final))}>
            Make final <span className="mono">{priceText(finalPrice)}</span>
          </button>
        </div>
      </div>
      <p className="scene-hint">The final re-runs this prompt at {final}, so the motion will differ from the draft.</p>

      {problems.length > 0 && (
        <ul className="scene-problems" role="alert" aria-label="Fix before generating">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {failure && (
        <p className="scene-failure" role="alert">
          {failure}
        </p>
      )}
      {unsure && (
        <div className="scene-failure" role="alert">
          <p>{unsure} Check Spend before trying again.</p>
          <button type="button" className="button button--quiet" onClick={() => setUnsure(null)}>
            Dismiss
          </button>
        </div>
      )}
    </section>
  );
}
