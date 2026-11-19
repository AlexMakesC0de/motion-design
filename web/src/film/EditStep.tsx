// web/src/film/EditStep.tsx
// Edit: the film put together. A player at the top plays the whole edit (each
// take trimmed and at its speed, titles drawn over it); under it the timeline:
// the clips in order, each as wide as it plays, with handles to trim and a
// row of titles. Selecting a clip or a title opens it on the right. Export
// renders the edit to film-N.mp4; the exports are the only files listed.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { EditClip, EditTitle, EditView, FilmDetail, TaskView } from "../api/types";
import { Icon } from "../app/icons";
import { sceneHref } from "../app/route";
import { FinishPanel } from "../films/FinishPanel";
import { TaskList } from "../films/TaskList";
import { mergeTask, useTasks } from "../films/useTasks";
import { clipAt, clock, layout, seconds } from "./editMath";
import type { useEdit } from "./useEdit";
import "./edit.css";

type Film = ReturnType<typeof useEdit>;
type Selected = { kind: "clip" | "title"; id: string } | null;

const speedLabel = (s: number) => (s === 1 ? "Normal" : `${Math.round(s * 100)}%`);
const PLACE_TOP = { upper: "30%", center: "50%", lower: "75%" } as const;
const MIN_CLIP_S = 0.2;

/** The film's edit, with a clip or title changed and every clip placed again. */
function withClips(e: EditView, clips: EditClip[]) {
  const placed = layout(clips, e.choices.fadeS);
  return { clips: placed.clips, titles: e.titles, lengthS: placed.lengthS };
}

/* ---------- Player ---------- */

function Player({ edit, t, onTime, playing, setPlaying }: { edit: EditView; t: number; onTime: (t: number) => void; playing: boolean; setPlaying: (p: boolean) => void }) {
  const clips = useMemo(() => edit.clips.filter((c) => !c.missing && c.url && c.lengthS > 0), [edit.clips]);
  const urls = useMemo(() => [...new Set(clips.map((c) => c.url as string))], [clips]);
  const videos = useRef(new Map<string, HTMLVideoElement>());
  const [active, setActive] = useState(0);
  const frame = useRef(0);
  const state = useRef({ active: 0, t: 0 });
  state.current.t = t;

  const show = useCallback(
    (index: number, takeS: number, play: boolean) => {
      const c = clips[index];
      if (!c) return;
      state.current.active = index;
      setActive(index);
      videos.current.forEach((v, url) => {
        if (url !== c.url) v.pause();
      });
      const v = videos.current.get(c.url as string);
      if (!v) return;
      v.playbackRate = c.speed;
      if (Math.abs(v.currentTime - takeS) > 0.04) v.currentTime = takeS;
      if (play) v.play().catch(() => setPlaying(false));
      else v.pause();
    },
    [clips, setPlaying],
  );

  // Seek: put the right take on screen at the right moment.
  const seek = useCallback(
    (to: number, play = playing) => {
      const at = clipAt(clips, Math.max(0, Math.min(to, edit.lengthS - 0.01)));
      if (at) show(at.index, at.takeS, play);
      onTime(Math.max(0, Math.min(to, edit.lengthS)));
    },
    [clips, edit.lengthS, onTime, playing, show],
  );

  // While playing, the active take's clock is the film's clock; at a clip's out point the next clip starts.
  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const i = state.current.active;
      const c = clips[i];
      const v = c && videos.current.get(c.url as string);
      if (c && v) {
        const now = c.startS + (v.currentTime - c.inS) / c.speed;
        if (v.currentTime >= (c.endS ?? Infinity) - 0.03 || v.ended) {
          if (i + 1 < clips.length) show(i + 1, clips[i + 1].inS, true);
          else {
            onTime(edit.lengthS);
            setPlaying(false);
            v.pause();
            return;
          }
        } else onTime(Math.max(c.startS, now));
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [playing, clips, show, onTime, edit.lengthS, setPlaying]);

  // A seek from outside (the timeline) while paused.
  useEffect(() => {
    if (!playing) {
      const at = clipAt(clips, Math.min(t, Math.max(0, edit.lengthS - 0.01)));
      if (at) show(at.index, at.takeS, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, clips]);

  useEffect(() => {
    if (!playing) videos.current.forEach((v) => v.pause());
  }, [playing]);

  const toggle = () => {
    if (playing) return setPlaying(false);
    const from = t >= edit.lengthS - 0.05 ? 0 : t;
    setPlaying(true);
    seek(from, true);
  };

  const titles = edit.titles.filter((x) => t >= x.atS && t < x.atS + x.durationS);
  const [w, h] = edit.ratio.split(":").map(Number);
  return (
    <div className="eplayer">
      <div className="eplayer__screen" style={{ aspectRatio: `${w} / ${h}` }}>
        {urls.map((url) => (
          <video
            key={url}
            ref={(el) => {
              if (el) videos.current.set(url, el);
              else videos.current.delete(url);
            }}
            className="eplayer__video"
            src={url}
            preload="auto"
            playsInline
            data-on={clips[active]?.url === url || undefined}
          />
        ))}
        {!clips.length && <p className="eplayer__empty">Nothing to play yet. Add a shot below.</p>}
        {titles.map((x) => {
          const p = Math.min(1, (t - x.atS) / 0.6);
          const word = Math.min(1, Math.max(0, (t - x.atS - 0.25) / 0.5));
          return (
            <div key={x.id} className="eplayer__title" style={{ top: PLACE_TOP[x.place] }}>
              {x.kind === "logo" && x.imageUrl && <img className="eplayer__mark" src={x.imageUrl} alt="" style={{ opacity: p, transform: `scale(${0.82 + 0.18 * p})` }} />}
              <span className="eplayer__word" style={{ opacity: word, letterSpacing: `${0.02 * (1 - word) - 0.003}em` }}>
                {x.text}
              </span>
            </div>
          );
        })}
      </div>
      <div className="eplayer__bar">
        <button type="button" className="eplayer__play" onClick={toggle} aria-label={playing ? "Pause" : "Play the film"} disabled={!clips.length}>
          <Icon name={playing ? "pause" : "play"} size={18} />
        </button>
        <span className="eplayer__clock mono">
          {clock(t)} <span>/ {clock(edit.lengthS)}</span>
        </span>
        <input
          className="eplayer__scrub"
          type="range"
          min={0}
          max={Math.max(edit.lengthS, 0.1)}
          step={0.01}
          value={Math.min(t, edit.lengthS)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Where in the film"
        />
      </div>
    </div>
  );
}

/* ---------- Timeline ---------- */

type Drag =
  | { what: "trim-in" | "trim-out"; id: string; x0: number; pps: number; clip: EditClip }
  | { what: "move-clip"; id: string; x0: number; pps: number; moved: boolean }
  | { what: "move-title" | "size-title"; id: string; x0: number; pps: number; title: EditTitle };

function Timeline({ edit, t, selected, onSelect, onSeek, onClips, onTitles }: {
  edit: EditView;
  t: number;
  selected: Selected;
  onSelect: (s: Selected) => void;
  onSeek: (t: number) => void;
  onClips: (clips: EditClip[]) => void;
  onTitles: (titles: EditTitle[]) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [ghostX, setGhostX] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const span = Math.max(edit.lengthS, ...edit.titles.map((x) => x.atS + x.durationS), edit.targetS ?? 0, 4) + 1;
  const pps = drag ? drag.pps : width / span;
  const ticks = Array.from({ length: Math.floor(span) + 1 }, (_, i) => i).filter((s) => s % (pps < 30 ? 5 : pps < 60 ? 2 : 1) === 0);

  const start = (d: Drag) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag(d);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dS = (e.clientX - drag.x0) / drag.pps;
    if (drag.what === "trim-in" || drag.what === "trim-out") {
      const c = drag.clip;
      const end = c.endS ?? c.sourceS ?? c.inS + MIN_CLIP_S;
      const next =
        drag.what === "trim-in"
          ? { ...c, inS: Math.round(Math.min(Math.max(0, c.inS + dS * c.speed), end - MIN_CLIP_S) * 100) / 100 }
          : { ...c, outS: Math.round(Math.max(Math.min(c.sourceS ?? Infinity, end + dS * c.speed), c.inS + MIN_CLIP_S) * 100) / 100 };
      onClips(edit.clips.map((x) => (x.id === c.id ? next : x)));
    } else if (drag.what === "move-clip") {
      if (Math.abs(e.clientX - drag.x0) > 4) {
        if (!drag.moved) setDrag({ ...drag, moved: true });
        const rect = box.current?.getBoundingClientRect();
        setGhostX(rect ? e.clientX - rect.left : null);
      }
    } else if (drag.what === "move-title" || drag.what === "size-title") {
      const x = drag.title;
      const next = drag.what === "move-title" ? { ...x, atS: Math.max(0, Math.round((x.atS + dS) * 10) / 10) } : { ...x, durationS: Math.min(20, Math.max(0.5, Math.round((x.durationS + dS) * 10) / 10)) };
      onTitles(edit.titles.map((y) => (y.id === x.id ? next : y)));
    }
  };
  const onUp = (e: React.PointerEvent) => {
    if (drag?.what === "move-clip") {
      if (drag.moved && ghostX != null) {
        const at = ghostX / drag.pps;
        const from = edit.clips.findIndex((c) => c.id === drag.id);
        const rest = edit.clips.filter((c) => c.id !== drag.id);
        let to = rest.findIndex((c) => at < c.startS + c.lengthS / 2);
        if (to < 0) to = rest.length;
        if (to !== from) onClips([...rest.slice(0, to), edit.clips[from], ...rest.slice(to)]);
      } else {
        const c = edit.clips.find((x) => x.id === drag.id);
        onSelect({ kind: "clip", id: drag.id });
        if (c) onSeek(c.startS);
      }
    }
    setDrag(null);
    setGhostX(null);
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const seekAt = (e: React.MouseEvent) => {
    const rect = box.current?.getBoundingClientRect();
    if (rect) onSeek(Math.max(0, Math.min(edit.lengthS, (e.clientX - rect.left) / pps)));
  };

  return (
    <div className="timeline" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div className="timeline__body" ref={box}>
        <div className="timeline__ruler" onClick={seekAt} role="presentation">
          {ticks.map((s) => (
            <span key={s} className="timeline__tick mono" style={{ left: s * pps }}>
              {s}s
            </span>
          ))}
          {edit.targetS ? <span className="timeline__target" style={{ left: edit.targetS * pps }} title={`The Idea aims for ${edit.targetS}s`} /> : null}
        </div>
        <ol className="timeline__track" aria-label="Clips">
          {edit.clips.map((c, i) => {
            const on = selected?.kind === "clip" && selected.id === c.id;
            const w = Math.max(c.lengthS * pps, 28);
            return (
              <li
                key={c.id}
                className="tclip"
                data-on={on || undefined}
                data-missing={c.missing || undefined}
                data-dragging={(drag?.what === "move-clip" && drag.id === c.id && drag.moved) || undefined}
                style={{ left: c.startS * pps, width: w }}
              >
                <button
                  type="button"
                  className="tclip__body"
                  onPointerDown={start({ what: "move-clip", id: c.id, x0: 0, pps, moved: false })}
                  onPointerDownCapture={(e) => setDrag({ what: "move-clip", id: c.id, x0: e.clientX, pps, moved: false })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect({ kind: "clip", id: c.id });
                      onSeek(c.startS);
                    }
                  }}
                  aria-pressed={on}
                  aria-label={`${i + 1}. ${c.sceneTitle}, ${seconds(c.lengthS)}${c.speed !== 1 ? ` at ${speedLabel(c.speed)}` : ""}`}
                >
                  {c.url && !c.missing && <video className="tclip__frame" src={`${c.url}#t=${c.inS + 0.05}`} preload="metadata" muted playsInline tabIndex={-1} />}
                  <span className="tclip__label">
                    <span className="tclip__name">{c.sceneTitle}</span>
                    <span className="mono">
                      {c.missing ? "no take" : seconds(c.lengthS)}
                      {c.speed !== 1 ? ` · ${speedLabel(c.speed)}` : ""}
                    </span>
                  </span>
                  {i > 0 && c.into === "fade" && <span className="tclip__fade" aria-hidden="true" />}
                </button>
                {!c.missing && (
                  <>
                    <span className="tclip__handle tclip__handle--in" onPointerDown={(e) => start({ what: "trim-in", id: c.id, x0: e.clientX, pps, clip: c })(e)} aria-hidden="true" />
                    <span className="tclip__handle tclip__handle--out" onPointerDown={(e) => start({ what: "trim-out", id: c.id, x0: e.clientX, pps, clip: c })(e)} aria-hidden="true" />
                  </>
                )}
              </li>
            );
          })}
          {ghostX != null && <span className="timeline__drop" style={{ left: ghostX }} aria-hidden="true" />}
        </ol>
        <ol className="timeline__track timeline__track--titles" aria-label="Titles">
          {edit.titles.map((x) => {
            const on = selected?.kind === "title" && selected.id === x.id;
            return (
              <li key={x.id} className="ttitle" data-on={on || undefined} style={{ left: x.atS * pps, width: Math.max(x.durationS * pps, 24) }}>
                <button
                  type="button"
                  className="ttitle__body"
                  onPointerDown={(e) => {
                    onSelect({ kind: "title", id: x.id });
                    start({ what: "move-title", id: x.id, x0: e.clientX, pps, title: x })(e);
                  }}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect({ kind: "title", id: x.id }))}
                  aria-pressed={on}
                  aria-label={`Title ${x.text}, from ${seconds(x.atS)} for ${seconds(x.durationS)}`}
                >
                  <Icon name="text" size={12} />
                  <span>{x.text}</span>
                </button>
                <span className="ttitle__handle" onPointerDown={(e) => start({ what: "size-title", id: x.id, x0: e.clientX, pps, title: x })(e)} aria-hidden="true" />
              </li>
            );
          })}
          {!edit.titles.length && <li className="timeline__hint">Titles you add sit here, over the picture.</li>}
        </ol>
        <span className="timeline__head" style={{ left: t * pps }} aria-hidden="true" />
      </div>
    </div>
  );
}

/* ---------- Inspector ---------- */

function NumberField({ label, value, onChange, min = 0, max, step = 0.05, hint }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; hint?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="insp__field">
      <span className="insp__label">{label}</span>
      <span className="insp__num">
        <input
          className="input mono"
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const v = Number(text);
            if (Number.isFinite(v) && v >= min && (max == null || v <= max)) onChange(Math.round(v * 1000) / 1000);
            else setText(String(value));
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <span className="mono">s</span>
      </span>
      {hint && <span className="insp__hint">{hint}</span>}
    </label>
  );
}

function Segmented<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="insp__field" role="group" aria-label={label}>
      <span className="insp__label">{label}</span>
      <span className="seg">
        {options.map((o) => (
          <button key={o.id} type="button" className="seg__opt" aria-pressed={value === o.id} disabled={disabled} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        ))}
      </span>
    </div>
  );
}

function ClipInspector({ slug, edit, clip, onClips, onClose }: { slug: string; edit: EditView; clip: EditClip; onClips: (c: EditClip[]) => void; onClose: () => void }) {
  const i = edit.clips.findIndex((c) => c.id === clip.id);
  const shot = edit.shots.find((s) => s.id === clip.scene);
  const set = (patch: Partial<EditClip>) => onClips(edit.clips.map((c) => (c.id === clip.id ? { ...c, ...patch } : c)));
  const moveBy = (by: -1 | 1) => {
    const next = [...edit.clips];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onClips(next);
  };
  return (
    <section className="insp" aria-label={`Clip ${i + 1}: ${clip.sceneTitle}`}>
      <header className="insp__head">
        <h3 className="insp__title">
          <span className="mono insp__n">{i + 1}</span> {clip.sceneTitle}
        </h3>
        <button type="button" className="button button--quiet insp__x" onClick={onClose} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      </header>
      <p className="insp__line mono">
        {clip.missing ? "Its take is gone" : `${seconds(clip.startS)} to ${seconds(clip.startS + clip.lengthS)} in the film`}
      </p>
      <label className="insp__field">
        <span className="insp__label">Take</span>
        <select className="input" value={clip.take ?? ""} onChange={(e) => set({ take: e.target.value || null })}>
          <option value="">The starred take{shot?.starred ? "" : " (none starred: the newest)"}</option>
          {shot?.takes.map((tk, n) => (
            <option key={tk.job} value={tk.job}>
              Take {n + 1} · {tk.resolution} {tk.kind}
              {tk.job === shot.starred ? " · starred" : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="insp__pair">
        <NumberField label="Starts at" value={clip.inS} max={clip.endS ?? undefined} onChange={(v) => set({ inS: Math.min(v, (clip.endS ?? v + 1) - MIN_CLIP_S) })} />
        <NumberField label="Ends at" value={clip.endS ?? 0} min={clip.inS + MIN_CLIP_S} max={clip.sourceS ?? undefined} onChange={(v) => set({ outS: v })} hint={clip.sourceS != null ? `of ${seconds(clip.sourceS)}` : undefined} />
      </div>
      <label className="insp__field">
        <span className="insp__label">Speed</span>
        <select className="input" value={clip.speed} onChange={(e) => set({ speed: Number(e.target.value) })}>
          {edit.choices.speeds.map((s) => (
            <option key={s} value={s}>
              {speedLabel(s)}
              {s < 1 ? " · slow motion" : ""}
            </option>
          ))}
        </select>
      </label>
      <Segmented label="Into this clip" value={clip.into} disabled={i === 0} options={[{ id: "cut", label: "Cut" }, { id: "fade", label: "Fade" }]} onChange={(into) => set({ into })} />
      <div className="insp__actions">
        <button type="button" className="button" onClick={() => moveBy(-1)} disabled={i === 0}>
          Earlier
        </button>
        <button type="button" className="button" onClick={() => moveBy(1)} disabled={i === edit.clips.length - 1}>
          Later
        </button>
        <a className="button button--quiet" href={sceneHref(slug, clip.scene)}>
          Open the shot
        </a>
      </div>
      <button
        type="button"
        className="button button--quiet insp__remove"
        onClick={() => {
          onClips(edit.clips.filter((c) => c.id !== clip.id));
          onClose();
        }}
      >
        Take out of the film
      </button>
    </section>
  );
}

function TitleInspector({ edit, title, onTitles, onClose }: { edit: EditView; title: EditTitle; onTitles: (t: EditTitle[]) => void; onClose: () => void }) {
  const set = (patch: Partial<EditTitle>) => onTitles(edit.titles.map((x) => (x.id === title.id ? { ...x, ...patch } : x)));
  const [text, setText] = useState(title.text);
  useEffect(() => setText(title.text), [title.text]);
  return (
    <section className="insp" aria-label={`Title: ${title.text}`}>
      <header className="insp__head">
        <h3 className="insp__title">Title</h3>
        <button type="button" className="button button--quiet insp__x" onClick={onClose} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      </header>
      <label className="insp__field">
        <span className="insp__label">Words</span>
        <input className="input" value={text} maxLength={40} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() && text !== title.text && set({ text: text.trim() })} />
      </label>
      <Segmented label="Shows" value={title.kind} options={[{ id: "logo", label: "Logo and words" }, { id: "text", label: "Words only" }]} onChange={(kind) => set({ kind, image: kind === "logo" ? title.image ?? edit.pictures[0]?.name ?? null : null })} />
      {title.kind === "logo" && (
        <label className="insp__field">
          <span className="insp__label">Logo</span>
          {edit.pictures.length ? (
            <select className="input" value={title.image ?? ""} onChange={(e) => set({ image: e.target.value || null })}>
              <option value="">No picture</option>
              {edit.pictures.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name.replace(/^refs\//, "")}
                </option>
              ))}
            </select>
          ) : (
            <span className="insp__hint">Add a picture to the film's refs folder to use it here.</span>
          )}
        </label>
      )}
      <div className="insp__pair">
        <NumberField label="Comes in at" value={title.atS} step={0.1} onChange={(atS) => set({ atS })} />
        <NumberField label="Stays for" value={title.durationS} min={0.5} max={20} step={0.1} onChange={(durationS) => set({ durationS })} />
      </div>
      <Segmented label="Where" value={title.place} options={[{ id: "upper", label: "Upper" }, { id: "center", label: "Middle" }, { id: "lower", label: "Lower" }]} onChange={(place) => set({ place })} />
      <p className="insp__hint">The player shows a sketch of the title. Export draws it with the logo template, white with a soft shadow.</p>
      <button
        type="button"
        className="button button--quiet insp__remove"
        onClick={() => {
          onTitles(edit.titles.filter((x) => x.id !== title.id));
          onClose();
        }}
      >
        Remove the title
      </button>
    </section>
  );
}

function Overview({ edit, onAddShot, onAddTitle }: { edit: EditView; onAddShot: (scene: string) => void; onAddTitle: () => void }) {
  const playing = edit.clips.filter((c) => !c.missing);
  const spare = edit.shots.filter((s) => s.takes.length && !edit.clips.some((c) => c.scene === s.id));
  return (
    <section className="insp insp--overview" aria-label="The edit">
      <p className="insp__big mono">
        {seconds(edit.lengthS)}
        {edit.targetS ? <span> of {edit.targetS}s</span> : null}
      </p>
      <p className="insp__line">
        {playing.length} clip{playing.length === 1 ? "" : "s"} · {edit.titles.length} title{edit.titles.length === 1 ? "" : "s"}
        {edit.saved ? "" : " · every shot whole, in order, until you change something"}
      </p>
      <p className="insp__hint">Click a clip to trim it, change its take or speed. Drag a clip to move it; drag its edges to trim.</p>
      <label className="insp__field">
        <span className="insp__label">Add a shot</span>
        <select className="input" value="" onChange={(e) => e.target.value && onAddShot(e.target.value)}>
          <option value="">Choose a shot…</option>
          {edit.shots
            .filter((s) => s.takes.length)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
                {spare.includes(s) ? "" : " (again)"}
              </option>
            ))}
        </select>
      </label>
      <button type="button" className="button" onClick={onAddTitle}>
        <Icon name="text" size={14} /> Add a title
      </button>
    </section>
  );
}

/* ---------- Exports ---------- */

function Exports({ slug, onExported }: { slug: string; onExported: () => void }) {
  const [detail, setDetail] = useState<FilmDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<TaskView | null>(null);
  const load = useCallback(
    () =>
      api<FilmDetail>(`/api/films/${encodeURIComponent(slug)}`)
        .then(setDetail)
        .catch((e) => setError(e instanceof ApiError ? e.message : String(e))),
    [slug],
  );
  useEffect(() => {
    load();
  }, [load]);
  const heard = useTasks(slug, () => {
    load();
    onExported();
  });
  const tasks = (started && !heard.some((x) => x.id === started.id) ? mergeTask(heard, started) : heard).filter((x) => x.tool === "export");
  const busy = tasks.some((x) => x.state === "running");
  const films = (detail?.files ?? []).filter((f) => f.origin === "film").reverse();

  async function exportNow() {
    setError(null);
    try {
      const { task } = await api<{ task: TaskView }>(`/api/films/${encodeURIComponent(slug)}/export`, { method: "POST", body: {} });
      setStarted(task);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <section className="exports" aria-labelledby="exports-h">
      <div className="exports__head">
        <h2 id="exports-h">Exports</h2>
        <p className="exports__note">The edit as one video in the film's folder. Free: ffmpeg and the logo template run on this Mac.</p>
        <button type="button" className="button button--light button--lg exports__go" onClick={exportNow} disabled={busy}>
          {busy ? "Exporting…" : "Export the film"}
        </button>
      </div>
      {error && (
        <p className="film__error" role="alert">
          {error}
        </p>
      )}
      <TaskList tasks={tasks} />
      {films.length ? (
        <ul className="exports__list">
          {films.map((f, n) => (
            <li key={f.name} className="exports__item" data-newest={n === 0 || undefined}>
              {f.url && <video className="exports__video" src={f.url} controls preload="metadata" />}
              <span className="mono">{f.name}</span>
              <span className="exports__when">{new Date(f.modified).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
              {f.url && (
                <a className="button button--quiet" href={f.url} download={f.name}>
                  <Icon name="download" size={14} /> Download
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="exports__none">No export yet. Export when the player shows the film you want.</p>
      )}
      {detail && (
        <details className="exports__more">
          <summary>More finishing: captions, other sizes, text cards</summary>
          <FinishPanel film={detail} shots={[]} onChanged={load} only={["captions", "variants", "card"]} heading={false} />
        </details>
      )}
    </section>
  );
}

/* ---------- The step ---------- */

export function EditStep({ slug, film, onExported }: { slug: string; film: Film; onExported: () => void }) {
  const { edit, error, saving, change } = film;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<Selected>(null);

  const onClips = useCallback((clips: EditClip[]) => edit && change(withClips(edit, clips)), [edit, change]);
  const onTitles = useCallback((titles: EditTitle[]) => edit && change({ clips: edit.clips, titles }), [edit, change]);

  // Space plays and pauses, unless typing.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.code !== "Space" || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName) || el.isContentEditable) return;
      e.preventDefault();
      setPlaying((p) => !p);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  if (error && !edit)
    return (
      <p className="film-step__error" role="alert">
        {error}
      </p>
    );
  if (!edit) return <p className="film-step__loading">Opening the edit…</p>;

  const clip = selected?.kind === "clip" ? edit.clips.find((c) => c.id === selected.id) : undefined;
  const title = selected?.kind === "title" ? edit.titles.find((x) => x.id === selected.id) : undefined;
  const addShot = (scene: string) => {
    const shot = edit.shots.find((s) => s.id === scene);
    if (!shot) return;
    const tk = shot.takes.find((x) => x.job === shot.starred) ?? shot.takes.at(-1);
    const fresh: EditClip = { id: `new-${Date.now()}`, scene, take: null, inS: 0, outS: null, speed: 1, into: "cut", sceneTitle: shot.title, takeJob: tk?.job ?? null, kind: tk?.kind ?? null, resolution: tk?.resolution ?? null, url: tk?.url ?? null, sourceS: null, endS: null, startS: edit.lengthS, lengthS: 0, missing: false };
    onClips([...edit.clips, fresh]);
  };
  const addTitle = () => {
    const logo = edit.pictures.find((p) => /logo|mark/i.test(p.name)) ?? null;
    const next: EditTitle = { id: `new-${Date.now()}`, kind: logo ? "logo" : "text", text: "Title", image: logo?.name ?? null, imageUrl: logo?.url ?? null, atS: Math.round(t * 10) / 10, durationS: 3, place: "center" };
    onTitles([...edit.titles, next]);
    setSelected({ kind: "title", id: next.id });
  };

  return (
    <div className="edit">
      <div className="edit__top">
        <Player edit={edit} t={t} onTime={setT} playing={playing} setPlaying={setPlaying} />
        <div className="edit__side">
          {clip ? (
            <ClipInspector slug={slug} edit={edit} clip={clip} onClips={onClips} onClose={() => setSelected(null)} />
          ) : title ? (
            <TitleInspector edit={edit} title={title} onTitles={onTitles} onClose={() => setSelected(null)} />
          ) : (
            <Overview edit={edit} onAddShot={addShot} onAddTitle={addTitle} />
          )}
          <p className="edit__saved" aria-live="polite">
            {error ? <span className="edit__error">{error}</span> : saving ? "Saving…" : edit.saved ? "Saved" : ""}
          </p>
        </div>
      </div>
      <Timeline edit={edit} t={t} selected={selected} onSelect={setSelected} onSeek={(s) => (setPlaying(false), setT(s))} onClips={onClips} onTitles={onTitles} />
      <Exports slug={slug} onExported={onExported} />
    </div>
  );
}
