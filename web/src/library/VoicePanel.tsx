// web/src/library/VoicePanel.tsx
// A character's voice, inside its Library popup. Two ways to give it one: your
// own recording (free), or a sample in one of ElevenLabs' preset voices
// (priced on the button, spent only on that click, kept with Keep voice).
// Scenes send the voice whenever this character has a line.
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { AssetDetail, JobView, PresetVoice } from "../api/types";
import { onStudioEvent } from "../app/useStudio";
import { usd } from "../studio/format";

interface Props {
  asset: AssetDetail;
  onSaved: (asset: AssetDetail) => void;
}

type Way = "record" | "preset";
const FAILED = new Set(["failed-charged", "failed-unconfirmed", "failed-confirmed-free", "refused"]);
const phase = (job: JobView) => (job.state === "succeeded" && job.media[0] ? "done" : FAILED.has(job.state) ? "failed" : "making");
const message = (e: unknown) => (e instanceof ApiError ? e.message : String(e));

let voices: Promise<PresetVoice[]> | null = null;
const presetVoices = () => (voices ??= api<{ voices: PresetVoice[] }>("/api/voices").then((r) => r.voices));

export function VoicePanel({ asset, onSaved }: Props) {
  const id = useId();
  const path = `/api/library/${encodeURIComponent(asset.name)}`;
  const settings = asset.voiceSettings ?? { script: "" };
  const voice = asset.voice ?? null;
  const [list, setList] = useState<PresetVoice[]>([]);
  const [way, setWay] = useState<Way>(voice?.origin === "elevenlabs" ? "preset" : "record");
  const [open, setOpen] = useState(!voice);
  const [voiceId, setVoiceId] = useState(settings.voiceId ?? "");
  const [script, setScript] = useState(settings.script ?? "");
  const [job, setJob] = useState<JobView | null>(asset.voiceJob ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    presetVoices().then(setList).catch(() => setList([]));
  }, []);
  useEffect(() => {
    setJob(asset.voiceJob ?? null);
    setVoiceId(asset.voiceSettings?.voiceId ?? "");
    setScript(asset.voiceSettings?.script ?? "");
  }, [asset]);
  useEffect(
    () =>
      onStudioEvent((e) => {
        if (e.event === "job") setJob((held) => (held && e.data.id === held.id && e.data.updatedAt >= held.updatedAt ? e.data : held));
      }),
    [],
  );

  const kept = Boolean(asset.voiceJobKept && job && asset.voiceJob?.id === job.id);
  const jobPhase = job && !kept ? phase(job) : null;
  const chosen = list.find((v) => v.id === voiceId) ?? null;
  const scriptChanged = script !== (settings.script ?? "");
  const price = asset.voicePrice ? usd(asset.voicePrice.usd) : null;

  async function run(work: () => Promise<AssetDetail>) {
    setBusy(true);
    setError(null);
    try {
      onSaved(await work());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const saveSettings = (changes: Record<string, string>) => run(() => api<AssetDetail>(`${path}/voice-settings`, { method: "PATCH", body: changes }));
  const record = (file: File | undefined) => file && run(() => api<AssetDetail>(`${path}/voice`, { file: { data: file, name: file.name } }));
  /** Spends: one ElevenLabs job. The script and voice are saved first, so the sample reads what is on screen. */
  const makeSample = () =>
    run(async () => {
      if (scriptChanged || voiceId !== (settings.voiceId ?? "")) await api<AssetDetail>(`${path}/voice-settings`, { method: "PATCH", body: { voiceId, script } });
      return api<AssetDetail>(`${path}/make-voice`, { method: "POST", body: {} });
    });
  const keepSample = () => job && run(() => api<AssetDetail>(`${path}/adopt-voice`, { method: "POST", body: { job: job.id } }));
  const clear = () => {
    if (!window.confirm(`Take ${asset.name}'s voice away? It moves to the item's history.`)) return;
    run(() => api<AssetDetail>(`${path}/voice`, { method: "DELETE" }));
  };
  function playPreview() {
    if (!chosen || !preview.current) return;
    preview.current.src = chosen.previewUrl;
    preview.current.play().catch(() => setError("The preview did not play. Check your connection."));
  }

  return (
    <div className="voice" role="group" aria-label="Voice">
      <div className="voice__top">
        <p className="sheet-maker__section">Voice</p>
        {voice && (
          <button type="button" className="sheet-get__fold" onClick={() => setOpen((o) => !o)}>
            {open ? "Done" : "Change"}
          </button>
        )}
      </div>

      {voice ? (
        <div className="voice__current">
          <audio className="voice__player" controls preload="none" src={voice.url ?? undefined} aria-label={`${asset.name}'s voice`} />
          <p className="voice__note">
            {voice.origin === "recording" ? "Your recording" : `ElevenLabs · ${voice.voiceName ?? "preset voice"}`} · {voice.durationS.toFixed(1)}s. Scenes send it whenever {asset.name} has a line.
          </p>
        </div>
      ) : (
        <p className="voice__note">No voice yet. Give {asset.name} one and every scene where they speak sends it, so they sound the same each time.</p>
      )}

      {jobPhase && job && (
        <div className="sheet-made" data-phase={jobPhase} role="status">
          {jobPhase === "making" && (
            <p className="sheet-made__note">
              <span className="sheet-made__spin" aria-hidden="true" /> Making the voice sample… under a minute.
            </p>
          )}
          {jobPhase === "done" && (
            <>
              <audio className="voice__player" controls src={job.media[0]} aria-label="The new voice sample" />
              <p className="sheet-made__note">Right accent, clear in every line? Keep it; {voice ? "the old voice goes to history." : "scenes use it from now on."}</p>
              <div className="sheet-maker__actions">
                <button type="button" className="button button--light" disabled={busy} onClick={keepSample}>
                  Keep this voice
                </button>
              </div>
            </>
          )}
          {jobPhase === "failed" && (
            <p className="sheet-made__note sheet-made__note--bad">
              The sample did not come back{job.error ? `: ${job.error}` : "."} {job.state === "failed-confirmed-free" || job.state === "refused" ? "Nothing was spent." : ""}
            </p>
          )}
        </div>
      )}

      {open && (
        <div className="sheet-get">
          <div className="seg seg--tight" role="tablist" aria-label="How to get the voice">
            {(["record", "preset"] as Way[]).map((w) => (
              <button key={w} type="button" role="tab" aria-selected={way === w} className="seg__item" onClick={() => setWay(w)}>
                {w === "record" ? "Your recording" : "Preset voice"}
              </button>
            ))}
          </div>

          <label className="field__label" htmlFor={`${id}-script`}>
            Script to read · {script.length} characters
          </label>
          <textarea
            id={`${id}-script`}
            className="field voice__script"
            rows={7}
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="Write what the voice reads. English has a built-in script; other languages need one written here."
          />
          {scriptChanged && (
            <button type="button" className="sheet-get__fold voice__save" disabled={busy} onClick={() => saveSettings({ script })}>
              Save script
            </button>
          )}

          {way === "record" ? (
            <div className="sheet-get__panel">
              <p className="voice__note">
                Read the script aloud in a quiet room; the bracketed words are moods, not lines. Then add the file: 2 to 30 seconds of WAV, MP3, M4A (a phone's voice memo), AAC or OGG. Free.
              </p>
              <input ref={pick} type="file" hidden accept="audio/*,.m4a" onChange={(e) => record(e.target.files?.[0])} />
              <button type="button" className="button" disabled={busy} onClick={() => pick.current?.click()}>
                Add recording
              </button>
            </div>
          ) : (
            <div className="sheet-get__panel">
              <label className="field__label" htmlFor={`${id}-voice`}>
                Voice
              </label>
              <div className="voice__pick">
                <select id={`${id}-voice`} className="field" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                  <option value="">Choose a voice…</option>
                  {list.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {v.description}
                    </option>
                  ))}
                </select>
                <button type="button" className="button" disabled={!chosen} onClick={playPreview}>
                  Preview
                </button>
                <audio ref={preview} hidden />
              </div>
              <p className="voice__note">Previews are free. The sample reads the script above in this voice.</p>
              <button type="button" className="generate sheet-get__go" disabled={busy || !voiceId || !script.trim() || jobPhase === "making"} onClick={makeSample}>
                Make voice sample{price ? ` · ${price}` : ""}
              </button>
            </div>
          )}

          {voice && (
            <button type="button" className="sheet-get__fold voice__clear" disabled={busy} onClick={clear}>
              Remove voice
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="voice__note sheet-made__note--bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
