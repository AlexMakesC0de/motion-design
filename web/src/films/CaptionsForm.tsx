import { useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { FilmDetail, FinishInfo, SavedSrt, TaskView } from "../api/types";
import { filesOf, useStart } from "./finishing";

interface Props {
  film: FilmDetail;
  info: FinishInfo;
  busy: boolean;
  onStarted: (t: TaskView) => void;
  onChanged: () => void;
}

/**
 * Captions in two steps: save SRT text into the film (pasted, or read from a
 * file here in the page), then burn a saved SRT into a video.
 */
export function CaptionsForm({ film, info, busy, onStarted, onChanged }: Props) {
  const videos = filesOf(film.files, "video");
  const srts = filesOf(film.files, "srt");
  const [video, setVideo] = useState("");
  const [srt, setSrt] = useState("");
  const [style, setStyle] = useState(info.captionStyles[0] ?? "social");
  const [text, setText] = useState("");
  const [saved, setSaved] = useState<SavedSrt | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const { start, error, sending } = useStart(onStarted);
  // Until the user picks, take the newest of each.
  const chosenVideo = video || videos[0]?.name || "";
  const chosenSrt = srt || srts[0]?.name || "";
  const off = !info.tools.ffmpeg.ok || !info.tools.render.ok;

  async function save() {
    setSaved(null);
    setSaveError(null);
    try {
      const r = await api<SavedSrt>(`/api/films/${encodeURIComponent(film.run)}/srt`, { method: "POST", body: { text } });
      setSaved(r);
      setSrt(r.name);
      onChanged();
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <section className="finish__tool" aria-labelledby="captions-title">
      <h3 id="captions-title">Captions</h3>
      <label htmlFor="caption-text" className="finish__inline">
        SRT text
      </label>
      <textarea
        id="caption-text"
        className="mono"
        rows={5}
        value={text}
        placeholder={"1\n00:00:00,000 --> 00:00:02,000\nFirst line"}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="finish__actions">
        <button type="button" className="button" disabled={!text.trim()} onClick={save}>
          Save captions
        </button>
        <button type="button" className="button button--quiet" onClick={() => picker.current?.click()}>
          Load .srt
        </button>
        <input
          ref={picker}
          type="file"
          accept=".srt,application/x-subrip,text/plain"
          hidden
          aria-label="Load an .srt file"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) setText(await file.text());
          }}
        />
      </div>
      {saved && (
        <p className="finish__note">
          Saved {saved.name}: {saved.cues === 1 ? "1 cue" : `${saved.cues} cues`}, ending at {saved.lastEndS}s.
        </p>
      )}
      {saved?.problems.map((p) => (
        <p key={p} className="task__warning">
          {p}
        </p>
      ))}
      {saveError && (
        <p className="finish__error" role="alert">
          {saveError}
        </p>
      )}

      <div className="finish__grid">
        <label htmlFor="caption-video">Video to caption</label>
        <select id="caption-video" value={chosenVideo} onChange={(e) => setVideo(e.target.value)}>
          {videos.map((f) => (
            <option key={f.name}>{f.name}</option>
          ))}
        </select>
        <label htmlFor="caption-srt">Captions file</label>
        <select id="caption-srt" value={chosenSrt} onChange={(e) => setSrt(e.target.value)}>
          {!srts.length && <option value="">Save captions first</option>}
          {srts.map((f) => (
            <option key={f.name}>{f.name}</option>
          ))}
        </select>
        <label htmlFor="caption-style">Style</label>
        <select id="caption-style" value={style} onChange={(e) => setStyle(e.target.value)}>
          {info.captionStyles.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="finish__actions">
        <button
          type="button"
          className="button"
          disabled={off || busy || sending || !chosenVideo || !chosenSrt}
          onClick={() => start(`/api/films/${encodeURIComponent(film.run)}/caption`, { video: chosenVideo, srt: chosenSrt, style })}
        >
          Burn captions
        </button>
      </div>
      {error && (
        <p className="finish__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
