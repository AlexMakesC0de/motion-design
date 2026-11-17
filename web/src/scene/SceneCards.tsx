import { useEffect, useState } from "react";
import type { InputHTMLAttributes } from "react";
import { DURATION, stageTimes } from "../../../cli/director/scene-shape.mjs";
import type { Cards, Ref, Scene, Span, Stage } from "../api/types";
import { Icon } from "../app/icons";
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
  /** The stage open in the notes; null when the scene has no stages. */
  stage: number | null;
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
/** Stage n's gel, 1 to 4, repeating. */
export const gel = (i: number) => `var(--gel-${(i % 4) + 1})`;

/** Add a stage: the first takes the scene's whole length, so adding it changes nothing; later ones add up to 4s. */
export function addStage(s: Scene): Scene {
  const have = s.cards.stages;
  const seconds = have.length ? Math.max(1, Math.min(4, DURATION.max - total(have))) : s.durationS;
  return { ...s, cards: { ...s.cards, stages: [...have, blankStage(seconds)] } };
}
export const stagesFull = (s: Scene) => s.cards.stages.length > 0 && total(s.cards.stages) >= DURATION.max;

/**
 * The stage timeline under the player: one coloured part per stage, as wide as
 * its seconds. Click a part to open that stage in the notes; + adds one.
 */
export function StageTimeline({ scene, stage, onStage, onAdd }: { scene: Scene; stage: number | null; onStage(i: number): void; onAdd(): void }) {
  const stages = scene.cards.stages;
  const times = stageTimes(scene);
  const full = stagesFull(scene);
  return (
    <div className="scene-timeline">
      <div className="scene-bar" role="group" aria-label="Stages">
        {stages.length ? (
          stages.map((s, i) => {
            const name = s.title || `Stage ${i + 1}`;
            return (
              <button
                key={i}
                type="button"
                className="scene-bar__part"
                style={{ flexGrow: s.seconds, ["--g" as string]: gel(i) }}
                aria-pressed={stage === i}
                aria-label={`${times[i].fromS}–${times[i].toS}s ${name}`}
                onClick={() => onStage(i)}
              >
                <span className="scene-bar__title">{name}</span>
                <span className="scene-bar__time mono">{`${times[i].fromS}–${times[i].toS}s`}</span>
              </button>
            );
          })
        ) : (
          <span className="scene-bar__part scene-bar__part--whole">
            <span className="scene-bar__title">whole scene</span>
            <span className="scene-bar__time mono">{`0–${scene.durationS}s`}</span>
          </span>
        )}
        <button type="button" className="scene-bar__add" aria-label="Add stage" title={full ? `The stages fill the ${DURATION.max}s a scene can last.` : "Add stage"} disabled={full} onClick={onAdd}>
          <Icon name="plus" size={18} />
        </button>
      </div>
      {stages.length === 0 && <p className="scene-hint">Split the scene into stages to direct each beat: camera, action and how it ends.</p>}
      {full && <p className="scene-hint">The stages fill the {DURATION.max}s a scene can last.</p>}
    </div>
  );
}

const OPTIONAL = [
  { key: "scene", label: "Scene", hint: "Where and when: the place, the light, the time of day." },
  { key: "style", label: "Style", hint: "The look: lens, grade, film stock, references." },
  { key: "audio", label: "Audio", hint: "Music in (), sound effects in <>, dialogue in {}." },
] as const;

/** The notes column: the goal, the open stage, then Scene, Style and Audio when they have words or are asked for. */
export function SceneCards({ scene, items, stage, onText, onScene, onChoose, onPasteWhole, onSettle }: SceneCardsProps) {
  const { cards, refs } = scene;
  const stages = cards.stages;
  const times = stageTimes(scene);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());

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
  const removeStage = (i: number) => onScene((s) => ({ ...s, cards: { ...s.cards, stages: s.cards.stages.filter((_, j) => j !== i) } }));

  const shownOptional = OPTIONAL.filter((o) => cards[o.key].trim() || opened.has(o.key));
  const closedOptional = OPTIONAL.filter((o) => !shownOptional.includes(o));
  const st = stage != null ? stages[stage] : undefined;
  const n = (stage ?? 0) + 1;

  return (
    <div className="scene-cards" onBlur={onSettle}>
      <div className="scene-card">
        <h3 className="scene-card__head">Goal</h3>
        {field("Goal", cards.goal, (c, t) => ({ ...c, goal: t }), 3)}
      </div>

      {st && stage != null && (
        <div role="group" className="scene-card scene-card--stage" aria-label={`Stage ${n}`}>
          <div className="scene-stage__head">
            <span className="scene-stage__swatch" style={{ background: gel(stage) }} aria-hidden="true" />
            <LooseInput className="scene-stage__title" aria-label={`Stage ${n} title`} placeholder={`Stage ${n}`} value={st.title} onValue={(v) => onText(setStage(stage, { title: v }), null)} />
            <span className="scene-stage__time mono">{`${times[stage].fromS}–${times[stage].toS}s`}</span>
            <button type="button" className="icon-button" aria-label={`Remove stage ${n}`} title="Remove stage" onClick={() => removeStage(stage)}>
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="scene-stage__meta">
            <span className="scene-stage__of">Stage {n} of {stages.length}</span>
            <label className="scene-stage__label">
              <span>Seconds</span>
              <SecondsInput label={`Stage ${n} seconds`} value={st.seconds} onValue={(v) => onText(setStage(stage, { seconds: v }), null)} />
            </label>
          </div>
          {(["camera", "action", "end"] as const).map((k) => (
            <div key={k} className="scene-stage__row">
              <span className="scene-stage__key" aria-hidden="true">{k === "end" ? "Ends on" : k[0].toUpperCase() + k.slice(1)}</span>
              {field(`Stage ${n} ${k}`, st[k], (c, t) => setStage(stage, { [k]: t })(c))}
            </div>
          ))}
        </div>
      )}

      {shownOptional.map((o) => (
        <div key={o.key} className="scene-card">
          <h3 className="scene-card__head">{o.label}</h3>
          {o.key === "audio" && <p className="scene-hint">{o.hint}</p>}
          {field(o.label, cards[o.key], (c, t) => ({ ...c, [o.key]: t }))}
        </div>
      ))}

      {closedOptional.length > 0 && (
        <div className="scene-more" role="group" aria-label="Add a card">
          {closedOptional.map((o) => (
            <button key={o.key} type="button" className="chip-button" title={o.hint} onClick={() => setOpened((s) => new Set(s).add(o.key))}>
              <Icon name="plus" size={14} />
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
