import { useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { FilmDetail, FinishInfo, SavedAudio, TaskView } from "../api/types";
import { filesOf, useStart } from "./finishing";

interface Props {
  film: FilmDetail;
  info: FinishInfo;
  shots: string[];
  busy: boolean;
  onStarted: (t: TaskView) => void;
  onChanged: () => void;
}

/** Joins the chosen shots in order, with crossfades and an optional music bed or voice-over; core normalises the loudness. */
export function AssembleForm({ film, info, shots, busy, onStarted, onChanged }: Props) {
  const [music, setMusic] = useState("");
  const [vo, setVo] = useState("");
  const [transition, setTransition] = useState(info.transitions[0] ?? "fade");
  const [seconds, setSeconds] = useState("0");
  const [ratio, setRatio] = useState("16:9");
  const [added, setAdded] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const { start, error, sending } = useStart(onStarted);
  const audio = filesOf(film.files, "audio");
  const off = !info.tools.ffmpeg.ok;

  async function add(file: File) {
    setAdded(null);
    setUploadError(null);
    try {
      const saved = await api<SavedAudio>(`/api/films/${encodeURIComponent(film.run)}/audio`, { file: { data: file, name: file.name } });
      setAdded(saved.name);
      onChanged();
    } catch (e) {
      setUploadError(e instanceof ApiError ? e.message : String(e));
    }
  }

  function submit() {
    start(`/api/films/${encodeURIComponent(film.run)}/assemble`, {
      shots,
      ...(music && { music }),
      ...(vo && { vo }),
      transition,
      transition_s: Number(seconds) || 0,
      aspect_ratio: ratio,
    });
  }

  return (
    <section className="finish__tool" aria-labelledby="assemble-title">
      <h3 id="assemble-title">Assemble</h3>
      <p className="finish__hint">
        {shots.length ? `${shots.length === 1 ? "1 shot" : `${shots.length} shots`}, in the order on the left.` : "Choose at least one shot on the left."}
      </p>
      <div className="finish__grid">
        <label htmlFor="assemble-music">Music</label>
        <select id="assemble-music" value={music} onChange={(e) => setMusic(e.target.value)}>
          <option value="">None</option>
          {audio.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name}
            </option>
          ))}
        </select>
        <label htmlFor="assemble-vo">Voice-over</label>
        <select id="assemble-vo" value={vo} onChange={(e) => setVo(e.target.value)}>
          <option value="">None</option>
          {audio.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name}
            </option>
          ))}
        </select>
        <label htmlFor="assemble-transition">Transition</label>
        <span className="finish__pair">
          <select id="assemble-transition" value={transition} onChange={(e) => setTransition(e.target.value)}>
            {info.transitions.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <label htmlFor="assemble-seconds" className="finish__inline">
            Seconds
          </label>
          <input
            id="assemble-seconds"
            className="mono"
            type="number"
            min="0"
            max="5"
            step="0.25"
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
          />
        </span>
        <label htmlFor="assemble-ratio">Frame</label>
        <select id="assemble-ratio" value={ratio} onChange={(e) => setRatio(e.target.value)}>
          {info.ratios.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </div>
      <p className="finish__hint">Seconds 0 cuts straight between shots. The sound is levelled to streaming loudness.</p>
      <div className="finish__actions">
        <button type="button" className="button" disabled={off || busy || sending || !shots.length} onClick={submit}>
          Assemble
        </button>
        <button type="button" className="button button--quiet" onClick={() => picker.current?.click()}>
          Add audio
        </button>
        <input
          ref={picker}
          type="file"
          accept="audio/*"
          hidden
          aria-label="Add an audio file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) add(file);
            e.target.value = "";
          }}
        />
      </div>
      {added && <p className="finish__note">Added {added}. Pick it under Music or Voice-over.</p>}
      {uploadError && (
        <p className="finish__error" role="alert">
          {uploadError}
        </p>
      )}
      {error && (
        <p className="finish__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
