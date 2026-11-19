import { useState } from "react";
import { ApiError } from "../api/client";
import type { Scene, ScenePreview, SceneVersion } from "../api/types";
import { Icon } from "../app/icons";
import { usd } from "../studio/format";
import { useNow } from "../studio/useJobs";
import "./scene.css";

export const FINALS = ["1080p", "720p"] as const;
export type Final = (typeof FINALS)[number];

const RUNNING = new Set(["reserved", "sending", "submitted"]);

/** A short word for a version that has no picture to show yet; null when it succeeded. */
function stateWord(v: SceneVersion) {
  if (v.state === "succeeded") return null;
  if (v.state && RUNNING.has(v.state)) return "running";
  if (v.state === "uncertain") return "uncertain, check Spend";
  if (v.state) return "failed";
  return "record missing";
}

const isRunning = (v: SceneVersion) => Boolean(v.state && RUNNING.has(v.state));

/** What a version's frame says when it has nothing to play. */
const emptyText = (v: SceneVersion) => (v.state === "succeeded" ? "The video file is missing." : `This take is ${stateWord(v)}.`);

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** How long a running version has been filming, as m:ss. */
function elapsed(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "";
}

/** "Draft 2", "Final 1": numbered within their kind, in the order they were made. */
export function versionNames(versions: SceneVersion[]) {
  const count = { draft: 0, final: 0 };
  return versions.map((v) => `${v.kind === "final" ? "Final" : "Draft"} ${(count[v.kind] += 1)}`);
}

const priceText = (p: { usd: number | null } | null | undefined) => (p?.usd != null ? usd(p.usd) : "no price");
const cost = (v: SceneVersion) => v.actualUsd ?? v.estimateUsd;

/** The version the player shows: the one picked in the list, else the chosen one, else the newest that has a video. */
export function shownVersion(scene: Scene, picked: string | null) {
  const by = (job: string | null) => (job ? scene.versions.find((v) => v.job === job) : undefined);
  return by(picked) ?? by(scene.chosen) ?? [...scene.versions].reverse().find((v) => v.media) ?? scene.versions.at(-1) ?? null;
}

/**
 * The two spending buttons' state: one request at a time, and a code-5 answer
 * (kie may have the job) holds everything until it is checked.
 */
export function useMaking({ preview, onDraft, onFinal, onChoose }: {
  preview: ScenePreview | null;
  onDraft(): Promise<{ scene: Scene }>;
  onFinal(resolution: Final): Promise<{ scene: Scene }>;
  onChoose(job: string): Promise<unknown>;
}) {
  const [final, setFinal] = useState<Final>("1080p");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [unsure, setUnsure] = useState<string | null>(null);

  const problems = preview?.problems ?? [];
  const held = busy || Boolean(unsure) || !preview || problems.length > 0;

  const make = async (go: () => Promise<{ scene: Scene }>) => {
    setBusy(true);
    setFailure(null);
    try {
      await go();
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
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    }
  };

  return {
    final, setFinal, problems, failure, unsure, held,
    draftPrice: preview?.prices.draft,
    finalPrice: preview?.prices[final === "720p" ? "final720" : "final1080"],
    draft: () => make(onDraft),
    makeFinal: () => make(() => onFinal(final)),
    choose,
    dismissUnsure: () => setUnsure(null),
  };
}
export type Making = ReturnType<typeof useMaking>;

/** The big player: the shown version, with whether it is the one in the film. */
export function Player({ scene, version, name, onChoose }: { scene: Scene; version: SceneVersion | null; name: string; onChoose(job: string): void }) {
  const ratio = scene.ratio.replace(":", " / ");
  if (!version) {
    return (
      <div className="scene-player scene-player--empty" style={{ aspectRatio: ratio }}>
        <p className="scene-player__empty">No takes yet. A draft is a quick 480p try, so you can see the motion before paying for a final.</p>
      </div>
    );
  }
  const chosen = scene.chosen === version.job;
  return (
    <div className="scene-player" style={{ aspectRatio: ratio }}>
      {version.media ? (
        <video key={version.job} src={version.media} controls playsInline preload="metadata" aria-label={`Player: ${name} of ${scene.title || "this scene"}`} />
      ) : (
        <p className="scene-player__empty">{emptyText(version)}</p>
      )}
      <div className="scene-player__tag">
        {chosen ? (
          <>
            <Icon name="star" size={14} />
            <span>{name} · starred, the film plays it</span>
          </>
        ) : (
          <>
            <span>{name}</span>
            {version.state === "succeeded" && (
              <button type="button" className="scene-player__use" onClick={() => onChoose(version.job)}>
                <Icon name="star" size={14} /> Star this take
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Every take, newest first, as a small frame: pick one to watch it, Star the one the film plays. */
export function VersionList({ scene, shown, onShow, onChoose }: { scene: Scene; shown: string | null; onShow(job: string): void; onChoose(job: string): void }) {
  const now = useNow(1000);
  const labels = versionNames(scene.versions);
  if (scene.versions.length === 0) return null;
  return (
    <section className="scene-versions" aria-label="Takes">
      <h2 className="scene-head">
        Takes <span className="scene-head__n">{scene.versions.length}</span>
      </h2>
      <ol className="scene-versions__list" aria-label="Takes">
        {scene.versions
          .map((v, i) => ({ v, name: labels[i] }))
          .reverse()
          .map(({ v, name }) => {
            const word = stateWord(v);
            const chosen = scene.chosen === v.job;
            const price = cost(v);
            return (
              <li
                key={v.job}
                className="scene-version"
                aria-label={`${name}${chosen ? ", starred" : ""}`}
                data-chosen={chosen ? "true" : undefined}
                data-shown={shown === v.job ? "true" : undefined}
                data-state={word ? (v.state ?? "missing") : undefined}
              >
                <button type="button" className="scene-version__frame" aria-label={`Watch ${name.toLowerCase()}`} aria-pressed={shown === v.job} onClick={() => onShow(v.job)}>
                  {v.media ? (
                    <video src={`${v.media}#t=1`} muted playsInline preload="metadata" tabIndex={-1} aria-label={`${name} of ${scene.title || "this scene"}`} />
                  ) : isRunning(v) ? (
                    <span className="scene-version__running">
                      <span>Filming · {elapsed(v.createdAt, now)}</span>
                      <span className="scene-version__pulse" aria-hidden="true" />
                      <span className="sr-only">{emptyText(v)}</span>
                    </span>
                  ) : (
                    <span className="scene-version__empty">{emptyText(v)}</span>
                  )}
                  <span className="scene-version__name">
                    {chosen && <Icon name="star" size={12} />}
                    {name}
                  </span>
                </button>
                <div className="scene-version__bar">
                  <span className="mono scene-version__when">
                    {v.resolution} · {word ?? ago(v.createdAt, now)}
                  </span>
                  {price != null && <span className="mono scene-price">{usd(price)}</span>}
                </div>
                {chosen ? (
                  <span className="scene-version__chosen">Starred</span>
                ) : (
                  v.state === "succeeded" && (
                    <button type="button" className="button button--quiet scene-version__choose" aria-label={`Star ${name.toLowerCase()}`} onClick={() => onChoose(v.job)}>
                      <Icon name="star" size={12} /> Star
                    </button>
                  )
                )}
              </li>
            );
          })}
      </ol>
    </section>
  );
}

/** What stops making, said above the bar. */
export function MakeAlerts({ making }: { making: Making }) {
  const { problems, failure, unsure, dismissUnsure } = making;
  return (
    <>
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
          <button type="button" className="button button--quiet" onClick={dismissUnsure}>
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}

/** The bar along the bottom: New draft, the final's resolution, Make final. Every price is on its button. */
export function MakeBar({ making }: { making: Making }) {
  const { final, setFinal, held, draftPrice, finalPrice, draft, makeFinal } = making;
  return (
    <div className="scene-make">
      <p className="scene-make__hint">The final re-runs this prompt at {final}, so the motion will differ from the draft.</p>
      <button type="button" className="button button--lg scene-make__draft" disabled={held || draftPrice?.usd == null} aria-label={`New draft at 480p, ${priceText(draftPrice)}`} onClick={() => void draft()}>
        New draft · 480p <span className="mono scene-price">{priceText(draftPrice)}</span>
      </button>
      <label className="chip-select scene-make__res">
        <span className="sr-only">Final resolution</span>
        <select aria-label="Final resolution" value={final} onChange={(e) => setFinal(e.target.value as Final)}>
          {FINALS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </label>
      <button type="button" className="generate scene-make__final" disabled={held || finalPrice?.usd == null} aria-label={`Make final at ${final}, ${priceText(finalPrice)}`} onClick={() => void makeFinal()}>
        Make final <span className="mono">{priceText(finalPrice)}</span>
      </button>
    </div>
  );
}
