// web/src/library/VoicePanel.tsx
// A character's voice, inside its Library popup. Three ways to give it one,
// cheapest first: your own recording (free), a take from VoiceStudio running
// on this computer (free), or a sample in one of ElevenLabs' preset voices
// (priced on the button, spent only on that click). Takes are kept with Keep.
// Scenes send the voice whenever this character has a line.
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { AssetDetail, JobView, PresetVoice, VoiceStudioStatus } from "../api/types";
import { onStudioEvent } from "../app/useStudio";
import { usd } from "../studio/format";
import { VoiceClip } from "./VoiceClip";

interface Props {
  asset: AssetDetail;
  onSaved: (asset: AssetDetail) => void;
}

type Way = "record" | "voicestudio" | "preset";
const VOICESTUDIO_DOWNLOAD = "https://github.com/debpalash/VoiceStudio#platforms";
const ORIGIN_WAY: Record<string, Way> = { recording: "record", voicestudio: "voicestudio", elevenlabs: "preset" };
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
  const [way, setWay] = useState<Way>(ORIGIN_WAY[voice?.origin ?? ""] ?? "record");
  const [localText, setLocalText] = useState(asset.voiceStudioScript ?? "");
  const [studio, setStudio] = useState<VoiceStudioStatus | null>(null);
  const [studioVoice, setStudioVoice] = useState("default");
  const [making, setMaking] = useState(false);
  const [cardText, setCardText] = useState(asset.voiceCardName ?? "");
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
    setLocalText(asset.voiceStudioScript ?? "");
    setCardText(asset.voiceCardName ?? "");
  }, [asset]);
  useEffect(() => {
    if (way === "voicestudio" && !studio) checkStudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [way]);
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
  const take = asset.voiceStudioTake ?? null;
  const local = way === "voicestudio";
  const shown = local ? localText : script;

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
  async function checkStudio() {
    setStudio(null);
    try {
      setStudio(await api<VoiceStudioStatus>("/api/voicestudio"));
    } catch (e) {
      setStudio({ running: false, url: "", voices: [], error: message(e) });
    }
  }
  /** Free: VoiceStudio on this computer reads the script on screen. */
  const makeLocal = async () => {
    setMaking(true);
    await run(() => api<AssetDetail>(`${path}/voicestudio`, { method: "POST", body: { voice: studioVoice, script: localText } }));
    setMaking(false);
  };
  const keepLocal = () => take && run(() => api<AssetDetail>(`${path}/keep-voicestudio`, { method: "POST", body: { take: take.id } }));
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
            {voice.origin === "recording" ? "Your recording" : voice.origin === "voicestudio" ? `VoiceStudio · ${voice.voiceName ?? "default voice"}` : `ElevenLabs · ${voice.voiceName ?? "preset voice"}`} · {voice.durationS.toFixed(1)}s. Scenes send it whenever {asset.name} has a line.
          </p>
          <div className="voice__card">
            {voice.card?.url ? (
              <video className="voice__card-video" controls preload="none" src={voice.card.url} aria-label={`${asset.name}'s voice card`} />
            ) : (
              <p className="voice__note">The voice card is made from this voice when a scene needs it.</p>
            )}
            <p className="voice__note">
              Voice card{voice.card ? ` · ${voice.card.seconds}s` : ""}: up to 15 seconds of the voice, cut at a pause, on a black screen with the name. Scenes send it until {asset.name} has a talking clip; creators find Seedance keeps a voice more consistent this way.
            </p>
            <label className="field__label" htmlFor={`${id}-card-name`}>
              Name on the card
            </label>
            <div className="voice__pick">
              <input id={`${id}-card-name`} className="field" maxLength={40} value={cardText} onChange={(e) => setCardText(e.target.value)} />
              <button type="button" className="button" disabled={busy || !cardText.trim() || cardText.trim() === (asset.voiceCardName ?? "")} onClick={() => saveSettings({ cardName: cardText.trim() })}>
                Save name
              </button>
            </div>
          </div>
          <VoiceClip asset={asset} busy={busy} run={run} call={(sub, body, method = "POST") => api<AssetDetail>(`${path}/${sub}`, { method, body })} />
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
            {(["record", "voicestudio", "preset"] as Way[]).map((w) => (
              <button key={w} type="button" role="tab" aria-selected={way === w} className="seg__item" onClick={() => setWay(w)}>
                {w === "record" ? "Your recording · free" : w === "voicestudio" ? "VoiceStudio · free" : `ElevenLabs${price ? ` · ${price}` : ""}`}
              </button>
            ))}
          </div>

          <label className="field__label" htmlFor={`${id}-script`}>
            Script to read · {shown.length} characters
          </label>
          <textarea
            id={`${id}-script`}
            className="field voice__script"
            rows={7}
            value={shown}
            onChange={(e) => (local ? setLocalText(e.target.value) : setScript(e.target.value))}
            placeholder="Write what the voice reads. English has a built-in script; other languages need one written here."
          />
          {local && <p className="voice__note">VoiceStudio would say mood tags like [excited] out loud, so this script has none; only [pause] and [laughter] work. Changes here are for the next take only.</p>}
          {!local && scriptChanged && (
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
          ) : local ? (
            <div className="sheet-get__panel">
              {studio === null ? (
                <p className="voice__note">Looking for VoiceStudio on this computer…</p>
              ) : !studio.running ? (
                <>
                  <p className="voice__note">
                    VoiceStudio isn't open on this computer. It's a free voice app that runs on your own machine: make a voice in it (describe one, or clone a recording), keep it open, then check again.
                    {studio.error ? ` (${studio.error})` : ""}
                  </p>
                  <div className="voice__pick">
                    <a className="button" href={VOICESTUDIO_DOWNLOAD} target="_blank" rel="noreferrer">
                      Get VoiceStudio
                    </a>
                    <button type="button" className="button" onClick={checkStudio}>
                      Check again
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label className="field__label" htmlFor={`${id}-studio-voice`}>
                    VoiceStudio voice
                  </label>
                  <div className="voice__pick">
                    <select id={`${id}-studio-voice`} className="field" value={studioVoice} onChange={(e) => setStudioVoice(e.target.value)}>
                      <option value="default">Default voice</option>
                      {studio.voices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="button" onClick={checkStudio}>
                      Refresh
                    </button>
                  </div>
                  <p className="voice__note">Voices you make in VoiceStudio show here. It all runs on this computer; nothing is spent.</p>
                  {making && (
                    <p className="sheet-made__note" role="status">
                      <span className="sheet-made__spin" aria-hidden="true" /> VoiceStudio is reading the script… The first time can take several minutes while it downloads its model.
                    </p>
                  )}
                  <button type="button" className="generate sheet-get__go" disabled={busy || !localText.trim()} onClick={makeLocal}>
                    Make voice · free
                  </button>
                </>
              )}
              {take && (
                <div className="sheet-made" data-phase="done">
                  <audio className="voice__player" controls src={take.url ?? undefined} aria-label="The new VoiceStudio take" />
                  <p className="sheet-made__note">
                    {take.durationS != null ? `${take.durationS.toFixed(1)}s · ` : ""}Sounds right? Keep it; {voice ? "the old voice goes to history." : "scenes use it from now on."}
                  </p>
                  <div className="sheet-maker__actions">
                    <button type="button" className="button button--light" disabled={busy} onClick={keepLocal}>
                      Keep this voice
                    </button>
                  </div>
                </div>
              )}
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
