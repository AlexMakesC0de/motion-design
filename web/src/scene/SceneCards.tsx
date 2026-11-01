import { useEffect, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { DURATION, stageTimes } from "../../../cli/director/scene-shape.mjs";
import type { Cards, Ref, Scene, Span, Stage } from "../api/types";
import { MentionField } from "./MentionField";
import "./scene.css";

/**
 * A text input that keeps what you typed while the server's tidied copy comes
 * back: the server trims titles and keep lines, so "keep the " would lose its
 * space mid-word. Only a real change from outside replaces the text.
 */
export function LooseInput({ value, onValue, ...rest }: { value: string; onValue(v: string): void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText((t) => (t.trim() === value.trim() ? t : value));
  }, [value]);
  return <input {...rest} value={text} onChange={(e) => { setText(e.target.value); onValue(e.target.value); }} />;
}

/** Whole seconds, 1 to 30; a half-typed or empty box waits for a number and goes back on leaving. */
function SecondsInput({ value, onValue, label }: { value: number; onValue(n: number): void; label: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      type="number"
      className="scene-input scene-stage__seconds"
      aria-label={label}
      min={1}
      max={DURATION.max}
      step={1}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number.parseInt(e.target.value, 10);
        if (Number.isInteger(n) && n >= 1) onValue(Math.min(DURATION.max, n));
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

export interface SceneCardsProps {
  scene: Scene;
  items: Map<string, { hasSheet: boolean }>;
  /** A change to the cards; `refs` is set when a field settled and added empty slots. */
  onText(change: (cards: Cards) => Cards, refs: Ref[] | null): void;
  /** Any other change to the scene (stages). */
  onScene(change: (scene: Scene) => Scene): void;
  onChoose(span: Span): void;
  onPasteWhole(cards: Cards): void;
  /** Focus left a field: attach the Library items its text mentions. */
  onSettle(): void;
}

const blankStage = (seconds: number): Stage => ({ title: "", seconds, camera: "", action: "", end: "" });
const total = (stages: Stage[]) => stages.reduce((n, s) => n + s.seconds, 0);

/** The centre column: the stage bar and the cards, every text a MentionField. */
export function SceneCards({ scene, items, onText, onScene, onChoose, onPasteWhole, onSettle }: SceneCardsProps) {
  const { cards, refs } = scene;
  const stages = cards.stages;
  const times = stageTimes(scene);
  const full = stages.length > 0 && total(stages) >= DURATION.max;

  // Each field writes one part of the cards. The refs it hands back are new only when it settled and added slots.
  const field = (label: string, value: string, set: (c: Cards, text: string) => Cards, rows = 2) => (
    <MentionField
      label={label}
      value={value}
      refs={refs}
      items={items}
      rows={rows}
      onChange={(text, next) => onText((c) => set(c, text), next === refs ? null : next)}
      onChoose={onChoose}
      onPasteWhole={onPasteWhole}
    />
  );

  const setStage = (i: number, patch: Partial<Stage>) => (c: Cards): Cards => ({ ...c, stages: c.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const addStage = () =>
    onScene((s) => {
      const have = s.cards.stages;
      // The first stage takes the scene's whole length, so adding it changes nothing; later ones add up to 4s.
      const seconds = have.length ? Math.max(1, Math.min(4, DURATION.max - total(have))) : s.durationS;
      return { ...s, cards: { ...s.cards, stages: [...have, blankStage(seconds)] } };
    });

  const removeStage = (i: number) => onScene((s) => ({ ...s, cards: { ...s.cards, stages: s.cards.stages.filter((_, j) => j !== i) } }));

  return (
    <div className="scene-cards" onBlur={onSettle}>
      <div className="scene-bar">
        {stages.length ? (
          stages.map((s, i) => (
            <span key={i} className="scene-bar__part" data-n={i % 4} style={{ flexGrow: s.seconds }}>
              {`${times[i].fromS}–${times[i].toS}s ${s.title || `Stage ${i + 1}`}`}
            </span>
          ))
        ) : (
          <span className="scene-bar__part" data-n={0} style={{ flexGrow: 1 }}>whole scene</span>
        )}
      </div>

      <div className="scene-card">
        <h3 className="scene-card__head">Goal</h3>
        {field("Goal", cards.goal, (c, t) => ({ ...c, goal: t }), 3)}
      </div>

      <div className="scene-card">
        <h3 className="scene-card__head">Scene</h3>
        {field("Scene", cards.scene, (c, t) => ({ ...c, scene: t }), 3)}
      </div>

      {stages.map((s, i) => {
        const n = i + 1;
        const name = s.title || `Stage ${n}`;
        return (
          <div key={i} role="group" className="scene-card scene-card--stage" data-n={i % 4} aria-label={`Stage ${n}`}>
            <div className="scene-stage__head">
              <h3 className="scene-card__head">{name}</h3>
              <span className="scene-stage__time mono">{`${times[i].fromS}–${times[i].toS}s`}</span>
              <button type="button" className="button button--quiet scene-stage__remove" aria-label={`Remove stage ${n}`} onClick={() => removeStage(i)}>
                Remove stage
              </button>
            </div>
            <div className="scene-stage__meta">
              <label className="scene-stage__label">
                <span>Title</span>
                <LooseInput className="scene-input" aria-label={`Stage ${n} title`} placeholder={`Stage ${n}`} value={s.title} onValue={(v) => onText(setStage(i, { title: v }), null)} />
              </label>
              <label className="scene-stage__label">
                <span>Seconds</span>
                <SecondsInput label={`Stage ${n} seconds`} value={s.seconds} onValue={(v) => onText(setStage(i, { seconds: v }), null)} />
              </label>
            </div>
            {(["camera", "action", "end"] as const).map((k) => (
              <div key={k} className="scene-stage__row">
                <span className="scene-stage__key" aria-hidden="true">{k[0].toUpperCase() + k.slice(1)}</span>
                {field(`Stage ${n} ${k}`, s[k], (c, t) => setStage(i, { [k]: t })(c))}
              </div>
            ))}
          </div>
        );
      })}

      <button type="button" className="button scene-cards__add" disabled={full} onClick={addStage}>
        + Add stage
      </button>
      {full && <p className="scene-hint">The stages fill the {DURATION.max}s a scene can last.</p>}

      <div className="scene-card">
        <h3 className="scene-card__head">Style</h3>
        {field("Style", cards.style, (c, t) => ({ ...c, style: t }))}
      </div>

      <div className="scene-card">
        <h3 className="scene-card__head">Audio</h3>
        <p className="scene-hint">Music in (), sound effects in &lt;&gt;, dialogue in {"{}"}.</p>
        {field("Audio", cards.audio, (c, t) => ({ ...c, audio: t }))}
      </div>
    </div>
  );
}
