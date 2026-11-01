// web/src/film/IdeaStep.tsx
// A film's Idea: what it is about, the ratio and length it aims for, and its
// scene list (titles and seconds) to edit, reorder and delete. "Plan scenes
// with chat" hands the idea to the chat, which answers through save_idea.
import { useEffect, useState } from "react";
import { DURATION, RATIOS } from "../../../cli/director/scene-shape.mjs";
import type { Idea, Scene } from "../api/types";
import { filmHref, sceneHref } from "../app/route";
import { sendToChat } from "../chat/chatStore";
import { LooseInput } from "../scene/SceneCards";
import { useScenes } from "../scene/useScenes";

const TARGETS = [8, 10, 15, 20, 30, 45, 60, 90, 120];
const SECONDS = Array.from({ length: DURATION.max - DURATION.min + 1 }, (_, i) => DURATION.min + i);

/** The chat's request: the idea in the user's words, and the limits a scene list must keep. */
export function planRequest(idea: Idea) {
  const aims = [idea.ratio, idea.lengthS ? `about ${idea.lengthS}s in total` : null].filter(Boolean).join(", ");
  return `Plan the scenes for this film and save them with save_idea (titles and lengths, ${DURATION.min} to ${DURATION.max} seconds each)${aims ? `, ${aims}` : ""}: ${idea.text}`;
}

export function IdeaStep({ slug, onChange }: { slug: string; onChange?: () => void }) {
  const { idea, scenes, loading, error, save, remove, order, saveIdea, create } = useScenes(slug);
  const [text, setText] = useState("");
  const [ratio, setRatio] = useState("16:9");
  const [lengthS, setLengthS] = useState<number>(15);
  const [note, setNote] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // The form follows the stored idea when it loads or the chat changes it.
  useEffect(() => {
    if (!idea) return;
    setText(idea.text);
    if (idea.ratio) setRatio(idea.ratio);
    if (idea.lengthS) setLengthS(idea.lengthS);
  }, [idea]);

  const current: Idea = { text: text.trim(), ratio, lengthS };
  const changed = !idea || idea.text !== current.text || idea.ratio !== ratio || idea.lengthS !== lengthS;
  const total = scenes.reduce((n, s) => n + s.durationS, 0);

  const run = (p: Promise<unknown>) =>
    p.then(() => onChange?.()).catch((e: Error) => setNote(e.message));

  const keep = () => {
    if (!current.text) return;
    setNote(null);
    run(saveIdea(current).then(() => setSaved(true)));
  };

  const plan = () => {
    if (!current.text) return;
    run((changed ? saveIdea(current) : Promise.resolve()).then(() => sendToChat(planRequest(current))));
  };

  const retitle = (s: Scene, title: string) => save({ ...s, title });
  const retime = (s: Scene, durationS: number) => save({ ...s, durationS });
  const move = (i: number, by: -1 | 1) => {
    const ids = scenes.map((s) => s.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    run(order(ids));
  };
  const drop = (s: Scene, n: number) => {
    const made = s.versions.length ? ` Its ${s.versions.length === 1 ? "video stays" : `${s.versions.length} videos stay`} on disk.` : "";
    if (!window.confirm(`Delete scene ${n}, "${s.title || "Untitled"}"?${made}`)) return;
    run(remove(s.id));
  };
  const add = () => run(create({ title: `Scene ${scenes.length + 1}`, durationS: 8, ratio }));

  return (
    <section className="idea" aria-labelledby="idea-h">
      <form
        className="idea__box"
        onSubmit={(e) => {
          e.preventDefault();
          keep();
        }}
      >
        <h2 id="idea-h" className="idea__title">What are we making?</h2>
        <textarea
          className="idea__text"
          aria-label="What is the film about?"
          placeholder="One or two sentences: who, where, what happens"
          rows={3}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSaved(false);
          }}
        />
        <div className="idea__chips">
          <select aria-label="Ratio" value={ratio} onChange={(e) => (setRatio(e.target.value), setSaved(false))}>
            {RATIOS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <select aria-label="Total length" value={lengthS} onChange={(e) => (setLengthS(Number(e.target.value)), setSaved(false))}>
            {[...new Set([...TARGETS, lengthS])].sort((a, b) => a - b).map((s) => (
              <option key={s} value={s}>
                {s}s
              </option>
            ))}
          </select>
          <button type="submit" className="button" disabled={!current.text || !changed}>
            {saved && !changed ? "Saved" : "Save idea"}
          </button>
          <button type="button" className="generate idea__plan" disabled={!current.text} onClick={plan}>
            Plan scenes with chat
          </button>
        </div>
      </form>

      {(error ?? note) && (
        <p className="film-step__error" role="alert">
          {error ?? note}
        </p>
      )}

      <div className="idea__scenes">
        <div className="idea__scenes-head">
          <h2 className="idea__subtitle">Scenes</h2>
          <span className="mono idea__total" data-over={total > lengthS ? "true" : undefined}>
            {total}s of {lengthS}s
          </span>
        </div>
        {loading ? (
          <p className="film-step__loading">Loading scenes…</p>
        ) : scenes.length === 0 ? (
          <p className="idea__empty">No scenes yet. Plan them with chat, or add one.</p>
        ) : (
          <ol className="idea__list" aria-label="Scenes">
            {scenes.map((s, i) => (
              <li key={s.id} className="idea__row">
                <span className="mono idea__n">{i + 1}</span>
                <LooseInput className="scene-input idea__name" aria-label={`Scene ${i + 1} title`} placeholder="Untitled" value={s.title} onValue={(t) => retitle(s, t)} />
                {s.cards.stages.length ? (
                  <span className="mono idea__secs" title="Set by its stages in the Scenes step">
                    {s.durationS}s
                  </span>
                ) : (
                  <select className="scene-input idea__secs" aria-label={`Scene ${i + 1} length`} value={s.durationS} onChange={(e) => retime(s, Number(e.target.value))}>
                    {SECONDS.map((n) => (
                      <option key={n} value={n}>
                        {n}s
                      </option>
                    ))}
                  </select>
                )}
                <a className="button button--quiet" href={sceneHref(slug, s.id)}>
                  Open
                </a>
                <button type="button" className="button button--quiet" aria-label={`Move scene ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  Up
                </button>
                <button type="button" className="button button--quiet" aria-label={`Move scene ${i + 1} down`} disabled={i === scenes.length - 1} onClick={() => move(i, 1)}>
                  Down
                </button>
                <button type="button" className="button button--quiet" aria-label={`Delete scene ${i + 1}`} onClick={() => drop(s, i + 1)}>
                  Delete
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="idea__foot">
          <button type="button" className="button" onClick={add}>
            + Add a scene
          </button>
          <a className="idea__next" href={filmHref(slug, "references")}>
            Next: References →
          </a>
        </div>
      </div>
    </section>
  );
}
