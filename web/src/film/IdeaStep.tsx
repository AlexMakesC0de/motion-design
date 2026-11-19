// web/src/film/IdeaStep.tsx
// A film's Idea: what it is about, the ratio and length it aims for, and its
// scene list (titles and seconds) to edit, reorder and delete. "Plan scenes
// with chat" hands the idea to the chat, which answers through save_idea.
import { useEffect, useState } from "react";
import { DURATION, RATIOS } from "../../../cli/director/scene-shape.mjs";
import type { Idea, Scene } from "../api/types";
import { Icon } from "../app/icons";
import { filmHref, sceneHref, STEPS } from "../app/route";
import { LooseInput } from "../scene/SceneCards";
import { useScenes } from "../scene/useScenes";

const TARGETS = [8, 10, 15, 20, 30, 45, 60, 90, 120];
const GELS = ["--gel-1", "--gel-3", "--gel-2", "--gel-4"];

/** The chat's request: the idea in the user's words, and the limits a scene list must keep. */
export function planRequest(idea: Idea) {
  const aims = [idea.ratio, idea.lengthS ? `about ${idea.lengthS}s in total` : null].filter(Boolean).join(", ");
  return `Plan the scenes for this film and save them with save_idea (titles and lengths, ${DURATION.min} to ${DURATION.max} seconds each)${aims ? `, ${aims}` : ""}: ${idea.text}`;
}

/** 0s, then every 5s, then the total. */
function ticks(total: number): number[] {
  const out = [0];
  for (let t = 5; t < total - 2; t += 5) out.push(t);
  if (total > 0) out.push(total);
  return out;
}

/** `lengthS` is the edit's length: what the film runs once the shots are trimmed. Null before any shot has a take. */
export function IdeaStep({ slug, onChange, lengthS: editS = null }: { slug: string; onChange?: () => void; lengthS?: number | null }) {
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
  const planned = scenes.reduce((n, s) => n + s.durationS, 0);
  // Once there is an edit, the film runs as long as the edit; the shots' own lengths are only what was filmed.
  const total = editS != null && editS > 0 ? Math.round(editS * 10) / 10 : planned;
  const over = Math.round((total - lengthS) * 10) / 10;
  const nextLabel = STEPS[STEPS.findIndex((x) => x.id === "idea") + 1]?.label ?? "";

  const run = (p: Promise<unknown>) =>
    p.then(() => onChange?.()).catch((e: Error) => setNote(e.message));

  const keep = () => {
    if (!current.text) return;
    setNote(null);
    run(saveIdea(current).then(() => setSaved(true)));
  };

  const plan = () => {
    if (!current.text) return;
    // No chat in the studio: the request goes to the clipboard, for Claude Code or Codex over MCP (save_idea).
    run(
      (changed ? saveIdea(current) : Promise.resolve())
        .then(() => navigator.clipboard?.writeText(planRequest(current)))
        .then(() => setNote("Copied. Paste it into Claude Code or Codex with Shard's MCP server connected; the scenes appear here.")),
    );
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
      <h2 id="idea-h" className="idea__title">What's the film?</h2>
      <p className="idea__sub">Who, where, what happens. Then split it into shots.</p>
      <form
        className="idea__prompt"
        onSubmit={(e) => {
          e.preventDefault();
          keep();
        }}
      >
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
          <label className="chip-select">
            <span>Shape</span>
            <select aria-label="Ratio" value={ratio} onChange={(e) => (setRatio(e.target.value), setSaved(false))}>
              {RATIOS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="chip-select">
            <span>Length</span>
            <select aria-label="Total length" value={lengthS} onChange={(e) => (setLengthS(Number(e.target.value)), setSaved(false))}>
              {[...new Set([...TARGETS, lengthS])].sort((a, b) => a - b).map((s) => (
                <option key={s} value={s}>
                  {s}s
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="button button--quiet" disabled={!current.text || !changed}>
            {saved && !changed ? "Saved" : "Save idea"}
          </button>
          <button type="button" className="button idea__plan" disabled={!current.text} onClick={plan}>
            <Icon name="terminal" size={16} />
            Copy plan for Claude Code
          </button>
        </div>
      </form>

      {(error ?? note) && (
        <p className="film-step__error" role="alert">
          {error ?? note}
        </p>
      )}

      <div className="idea__budget">
        <h2 className="idea__subtitle">Shots</h2>
        <span className="mono idea__total">
          {total === planned ? `${total}s planned` : `${total}s in the edit · ${planned}s filmed`}
        </span>
        {over > 0 && (
          <>
            <span className="idea__over">
              <i aria-hidden="true" />
              {over}s longer than the {lengthS}s you set
            </span>
            {total === planned && TARGETS.includes(total) && (
              <button type="button" className="button button--quiet" onClick={() => (setLengthS(total), setSaved(false))}>
                Make it {total}s
              </button>
            )}
          </>
        )}
      </div>

      {loading ? (
        <p className="film-step__loading">Loading shots…</p>
      ) : (
        <>
          {scenes.length === 0 && <p className="idea__empty">No shots yet. Plan them in Claude Code, or add one.</p>}
          <div className="idea__ruler" style={{ "--n": scenes.length } as React.CSSProperties}>
            <ol className="idea__lane" aria-label="Scenes">
              {scenes.map((s, i) => {
                const staged = s.cards.stages.length > 0;
                return (
                  <li key={s.id} className="idea__blk" style={{ flexGrow: s.durationS, "--g": `var(${GELS[i % GELS.length]})` } as React.CSSProperties}>
                    <div className="idea__hd">
                      <span className="mono idea__n">{i + 1}</span>
                      <LooseInput className="idea__name" aria-label={`Scene ${i + 1} title`} placeholder="Untitled" value={s.title} onValue={(t) => retitle(s, t)} />
                    </div>
                    <div className="idea__tools">
                      <button type="button" className="idea__tool" aria-label={`Move scene ${i + 1} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>
                        <Icon name="up" size={14} />
                      </button>
                      <button type="button" className="idea__tool" aria-label={`Move scene ${i + 1} later`} disabled={i === scenes.length - 1} onClick={() => move(i, 1)}>
                        <Icon name="down" size={14} />
                      </button>
                      <button type="button" className="idea__tool" aria-label={`Delete scene ${i + 1}`} onClick={() => drop(s, i + 1)}>
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                    <div className="idea__bt">
                      <span className="idea__stepper" title={staged ? "Set by its stages in the Shots step" : undefined}>
                        <button type="button" aria-label={`Shorter scene ${i + 1}`} disabled={staged || s.durationS <= DURATION.min} onClick={() => retime(s, s.durationS - 1)}>
                          <Icon name="minus" size={14} />
                        </button>
                        <span className="mono" aria-label={`Scene ${i + 1} length`}>{s.durationS}s</span>
                        <button type="button" aria-label={`Longer scene ${i + 1}`} disabled={staged || s.durationS >= DURATION.max} onClick={() => retime(s, s.durationS + 1)}>
                          <Icon name="plus" size={14} />
                        </button>
                      </span>
                      <a className="idea__open" href={sceneHref(slug, s.id)} aria-label={`Open scene ${i + 1}`}>
                        Open <Icon name="arrow" size={14} />
                      </a>
                    </div>
                  </li>
                );
              })}
              <li className="idea__addcell">
                <button type="button" className="idea__add" onClick={add}>
                  <Icon name="plus" size={16} />
                  Shot
                </button>
              </li>
            </ol>
            {planned > lengthS && (
              <span className="idea__limit" aria-hidden="true" style={{ left: `calc((100% - 120px - var(--n) * 8px) * ${lengthS / planned})` }}>
                <span>{lengthS}s</span>
              </span>
            )}
          </div>
          <div className="idea__ticks mono" aria-hidden="true">
            {ticks(planned).map((t) => (
              <span key={t}>{t}s</span>
            ))}
          </div>
        </>
      )}

      <div className="idea__foot">
        <span className="idea__tip">Nothing here costs money.</span>
        <a className="button button--light button--lg idea__next" href={filmHref(slug, "references")}>
          Next: {nextLabel}
          <Icon name="arrow" size={16} />
        </a>
      </div>
    </section>
  );
}
