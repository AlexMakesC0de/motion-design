import { useState } from "react";
import type { FilmDetail, FinishInfo, TaskView } from "../api/types";
import { filesOf, useStart } from "./finishing";

const OFFERED = ["9:16", "1:1"];

interface Props {
  film: FilmDetail;
  info: FinishInfo;
  busy: boolean;
  onStarted: (t: TaskView) => void;
}

/** Reframes a video for vertical and square feeds, written beside it as <name>-9x16.mp4 and <name>-1x1.mp4. */
export function VariantsForm({ film, info, busy, onStarted }: Props) {
  // Reframing a variant again loses picture, so variants are not offered here.
  const videos = filesOf(film.files, "video").filter((f) => f.origin !== "variant");
  const [video, setVideo] = useState("");
  const [ratios, setRatios] = useState<string[]>(OFFERED);
  const [mode, setMode] = useState(info.variantModes[0] ?? "blur");
  const { start, error, sending } = useStart(onStarted);
  const chosenVideo = video || videos[0]?.name || "";

  return (
    <section className="finish__tool" aria-labelledby="variants-title">
      <h3 id="variants-title">Variants</h3>
      <div className="finish__grid">
        <label htmlFor="variants-video">Video to reframe</label>
        <select id="variants-video" value={chosenVideo} onChange={(e) => setVideo(e.target.value)}>
          {videos.map((f) => (
            <option key={f.name}>{f.name}</option>
          ))}
        </select>
        <span className="finish__inline">Frames</span>
        <span className="finish__pair">
          {OFFERED.map((r) => (
            <label key={r} className="finish__check">
              <input
                type="checkbox"
                checked={ratios.includes(r)}
                onChange={() => setRatios((list) => (list.includes(r) ? list.filter((x) => x !== r) : OFFERED.filter((x) => x === r || list.includes(x))))}
              />
              <span className="mono">{r}</span>
            </label>
          ))}
        </span>
        <label htmlFor="variants-mode">Fill</label>
        <select id="variants-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
          {info.variantModes.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </div>
      <p className="finish__hint">
        Blur fills the edges with a blurred copy; crop cuts to the new frame; pad adds bars. Burn captions after reframing so they stay in frame.
      </p>
      <div className="finish__actions">
        <button
          type="button"
          className="button"
          disabled={!info.tools.ffmpeg.ok || busy || sending || !chosenVideo || !ratios.length}
          onClick={() => start(`/api/films/${encodeURIComponent(film.run)}/variants`, { video: chosenVideo, ratios, mode })}
        >
          Make variants
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
