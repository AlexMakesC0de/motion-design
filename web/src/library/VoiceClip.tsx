// web/src/library/VoiceClip.tsx
// A character's talking clip, under their voice card: one short Seedance clip
// of them saying the card's words in their voice. Scenes then send it instead
// of the black card, so the face, the voice and how they react go together.
// It spends, priced on the button; keeping it is a separate, free step.
import { useEffect, useId, useState } from "react";
import type { AssetDetail, JobView } from "../api/types";
import { onStudioEvent } from "../app/useStudio";
import { usd } from "../studio/format";

interface Props {
  asset: AssetDetail;
  busy: boolean;
  run: (work: () => Promise<AssetDetail>) => Promise<void>;
  call: (path: string, body: Record<string, unknown>, method?: "POST" | "PATCH") => Promise<AssetDetail>;
}

type Resolution = "480p" | "720p";
const FAILED = new Set(["failed-charged", "failed-unconfirmed", "failed-confirmed-free", "refused"]);
const WORDS_MISSING = /exact words heard on the voice card/;

export function VoiceClip({ asset, busy, run, call }: Props) {
  const id = useId();
  const offer = asset.voiceClip ?? null;
  const clip = asset.voice?.clip ?? null;
  const [words, setWords] = useState(asset.voiceCardWords ?? "");
  const [resolution, setResolution] = useState<Resolution>("720p");
  const [job, setJob] = useState<JobView | null>(offer?.job ?? null);

  useEffect(() => {
    setWords(asset.voiceCardWords ?? "");
    setJob(asset.voiceClip?.job ?? null);
  }, [asset]);
  useEffect(
    () =>
      onStudioEvent((e) => {
        if (e.event === "job") setJob((held) => (held && e.data.id === held.id && e.data.updatedAt >= held.updatedAt ? e.data : held));
      }),
    [],
  );
  if (!offer) return null;

  const price = offer.prices?.[resolution]?.usd ?? null;
  const blocking = offer.problems.filter((p) => !WORDS_MISSING.test(p));
  const wordsSaved = words.trim() === (asset.voiceCardWords ?? "").trim();
  const canMake = !busy && price != null && blocking.length === 0 && words.trim() !== "" && wordsSaved;
  const kept = offer.kept && job?.id === offer.job?.id;
  const phase = !job || kept ? null : job.state === "succeeded" && job.media[0] ? "done" : FAILED.has(job.state) ? "failed" : "making";

  const saveWords = () => run(() => call("voice-settings", { cardWords: words.trim() }, "PATCH"));
  const make = () => price != null && run(() => call("make-voice-clip", { resolution, maxUsd: price }));
  const keep = () => job && run(() => call("adopt-voice-clip", { job: job.id }));

  return (
    <div className="voice__clip" role="group" aria-label="Talking clip">
      <p className="sheet-maker__section">Talking clip</p>
      {clip?.url ? (
        <>
          <video className="voice__card-video" controls preload="none" src={clip.url} aria-label={`${asset.name}'s talking clip`} />
          <p className="voice__note">Talking clip · {clip.seconds}s. Scenes send this instead of the card, so the face, the voice and how {asset.name} reacts go together.</p>
        </>
      ) : (
        <p className="voice__note">
          A short clip of {asset.name} saying the card's words in this voice. Scenes then send it instead of the black card, so the face, the voice and how they react go together.
        </p>
      )}

      <label className="field__label" htmlFor={`${id}-words`}>
        Words heard on the card
      </label>
      <textarea id={`${id}-words`} className="field voice__script" rows={3} maxLength={600} value={words} onChange={(e) => setWords(e.target.value)} placeholder="Play the card and write exactly what is said, word for word. The lips follow these words." />
      {!wordsSaved && (
        <div className="sheet-maker__actions">
          <button type="button" className="button" disabled={busy || !words.trim()} onClick={saveWords}>
            Save words
          </button>
        </div>
      )}
      {blocking.map((p) => (
        <p key={p} className="voice__note">
          {p}
        </p>
      ))}

      <div className="voice__pick">
        <select aria-label="Clip quality" className="field" value={resolution} onChange={(e) => setResolution(e.target.value as Resolution)}>
          <option value="720p">720p{offer.prices?.["720p"]?.usd != null ? ` · ${usd(offer.prices["720p"].usd)}` : ""}</option>
          <option value="480p">480p draft{offer.prices?.["480p"]?.usd != null ? ` · ${usd(offer.prices["480p"].usd)}` : ""}</option>
        </select>
        <button type="button" className="button button--light" disabled={!canMake || phase === "making"} onClick={make} title={offer.prices?.[resolution]?.basis ?? undefined}>
          {clip ? "Make a new clip" : "Make talking clip"}
          {price != null ? ` · ${usd(price)}` : ""}
        </button>
      </div>

      {phase && job && (
        <div className="sheet-made" data-phase={phase} role="status">
          {phase === "making" && (
            <p className="sheet-made__note">
              <span className="sheet-made__spin" aria-hidden="true" /> Making the talking clip… a few minutes.
            </p>
          )}
          {phase === "done" && (
            <>
              <video className="voice__card-video" controls src={job.media[0]} aria-label="The new talking clip" />
              <p className="sheet-made__note">Same face, lips in time, the voice right? Keep it{clip ? "; the old clip goes to history." : "; scenes send it from now on."}</p>
              <div className="sheet-maker__actions">
                <button type="button" className="button button--light" disabled={busy} onClick={keep}>
                  Keep this clip
                </button>
              </div>
            </>
          )}
          {phase === "failed" && (
            <p className="sheet-made__note sheet-made__note--bad">
              The clip did not come back{job.error ? `: ${job.error}` : "."} {job.state === "failed-confirmed-free" || job.state === "refused" ? "Nothing was spent." : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
