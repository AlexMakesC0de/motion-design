import { useEffect, useState, type CSSProperties } from "react";
import { api, ApiError } from "../api/client";
import type { BoardShot, BoardView, DirectorMenu, MenuEntry } from "../api/types";
import { usd } from "../studio/format";
import { Inspector } from "./Inspector";
import { loadMenu } from "./useBoard";
import "./storyboard.css";

const label = (menu: DirectorMenu | null, group: string, id: string | undefined) => menu?.menu[group]?.find((e: MenuEntry) => e.id === id)?.label ?? id ?? "";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Where a shot stands, in a few words under its still. */
function shotState(s: BoardShot): { text: string; tone: "quiet" | "busy" | "ok" | "bad" } {
  if (s.filming.length) return { text: "Filming…", tone: "busy" };
  if (s.take) {
    if (s.review?.verdict === "pass") return { text: "Take passed", tone: "ok" };
    if (s.review?.verdict === "redo") return { text: "Take needs a redo", tone: "bad" };
    return { text: "Take ready to review", tone: "ok" };
  }
  if (s.failed) return { text: `Take ${s.failed.state === "failed-confirmed-free" ? "failed, not charged" : "failed"}`, tone: "bad" };
  if (s.stills.some((x) => ["reserved", "sending", "submitted"].includes(x.state))) return { text: "Still on its way…", tone: "busy" };
  if (s.continuesFrom) return { text: `Starts on ${s.continuesFrom}'s last frame`, tone: "quiet" };
  if (!s.still) return { text: "No still yet", tone: "quiet" };
  return { text: s.stillStale ? "Still is from before the last change" : "Still ready", tone: s.stillStale ? "bad" : "quiet" };
}

/** The idea, sent to the chat as a request to plan the film. */
function PlanThis({ film, onPlan }: { film: string; onPlan: (text: string) => void }) {
  const [idea, setIdea] = useState("");
  return (
    <form
      className="plan-this"
      onSubmit={(e) => {
        e.preventDefault();
        if (!idea.trim()) return;
        onPlan(`Plan this film (${film}): ${idea.trim()}`);
        setIdea("");
      }}
    >
      <h2 className="plan-this__title">What is the film?</h2>
      <p className="plan-this__hint">Say it in your own words: what it is for, who it is for, how long. The director in the chat turns it into a brief and a shot plan, with a still for every shot, before anything is filmed.</p>
      <textarea className="plan-this__text" aria-label="The idea" rows={4} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="A 15 second ad: Zed helps a stressed founder clear the inbox, calm at the end." />
      <button type="submit" className="button" disabled={!idea.trim()}>
        Plan this
      </button>
    </form>
  );
}

function BriefCard({ board, menu }: { board: BoardView; menu: DirectorMenu | null }) {
  const b = board.brief!;
  const look = board.plan?.look;
  const sound = [b.sound?.music && "music", b.sound?.voice && "voice", b.sound?.sfx && "effects"].filter(Boolean).join(", ");
  return (
    <dl className="brief-card">
      <div>
        <dt>Takeaway</dt>
        <dd>{b.takeaway}</dd>
      </div>
      {b.audience && (
        <div>
          <dt>For</dt>
          <dd>{b.audience}</dd>
        </div>
      )}
      <div>
        <dt>Format</dt>
        <dd className="mono">
          {b.durationS}s · {b.aspectRatio} · {label(menu, "filmTypes", b.filmType)}
          {sound ? ` · ${sound}` : ""}
        </dd>
      </div>
      {look && (
        <div>
          <dt>Look</dt>
          <dd>
            {look.filmLook}, {look.palette}, key light from the {look.keyLightSide}
          </dd>
        </div>
      )}
    </dl>
  );
}

/**
 * Auto-redo for this film: off, or on with the total its takes may cost,
 * first takes and redos together. Switching on asks for that total first.
 */
function AutoRedo({ film, board, apply }: { film: string; board: BoardView; apply: (b: BoardView) => void }) {
  const p = board.production;
  const [asking, setAsking] = useState(false);
  const [total, setTotal] = useState(() => String(Math.max(1, Math.ceil(board.cost.filmUsd * 1.5))));
  const [failure, setFailure] = useState<string | null>(null);
  async function save(on: boolean) {
    setFailure(null);
    try {
      apply(await api<BoardView>(`/api/films/${encodeURIComponent(film)}/production`, { method: "PUT", body: on ? { auto_redo: true, max_usd: Number(total) } : { auto_redo: false } }));
      setAsking(false);
    } catch (e) {
      setFailure(e instanceof ApiError ? e.message : String(e));
    }
  }
  if (p.autoRedo) {
    return (
      <span className="auto-redo">
        <span>
          Auto-redo on · takes <span className="mono">{usd(p.takesSpentUsd)}</span> of <span className="mono">{usd(p.maxUsd ?? 0)}</span>
        </span>
        <button type="button" className="button button--quiet" onClick={() => save(false)}>
          Turn off
        </button>
        {failure && <span className="go__bad">{failure}</span>}
      </span>
    );
  }
  if (!asking) {
    return (
      <button type="button" className="button button--quiet" onClick={() => setAsking(true)}>
        Auto-redo off
      </button>
    );
  }
  return (
    <form
      className="auto-redo"
      onSubmit={(e) => {
        e.preventDefault();
        save(true);
      }}
    >
      <label>
        A take judged redo is filmed again, twice at most, while all the takes stay within{" "}
        <span className="auto-redo__usd">
          $<input className="mono" type="number" min={0.5} step={0.5} value={total} onChange={(e) => setTotal(e.target.value)} aria-label="Most the takes may cost, in dollars" />
        </span>
      </label>
      <button type="submit" className="button" disabled={!(Number(total) > 0)}>
        Turn on
      </button>
      <button type="button" className="button button--quiet" onClick={() => setAsking(false)}>
        Cancel
      </button>
      {failure && <span className="go__bad">{failure}</span>}
    </form>
  );
}

/**
 * The storyboard (layout A): the brief, a timeline with each shot as wide as
 * it is long, the still strip, the inspector for the chosen shot, and the
 * buttons that spend: stills (cents each) and Film all, which asks once more
 * with the total before anything is filmed.
 */
export function Storyboard({ film, board, error, apply, onPlan }: { film: string; board: BoardView | null; error: string | null; apply: (b: BoardView) => void; onPlan: (text: string) => void }) {
  const [menu, setMenu] = useState<DirectorMenu | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    loadMenu().then(setMenu).catch(() => {});
  }, []);
  useEffect(() => {
    setSelected(null);
    setConfirming(false);
    setFailure(null);
  }, [film]);

  if (error) return <p className="board__error">{error}</p>;
  if (!board) return <p className="board__empty">Loading the storyboard…</p>;
  if (!board.plan) {
    return (
      <section className="board" aria-label="Storyboard">
        {board.brief && <BriefCard board={board} menu={menu} />}
        <PlanThis film={film} onPlan={onPlan} />
      </section>
    );
  }

  const plan = board.plan;
  const shots = board.shots;
  const current = shots.find((s) => s.id === selected) ?? shots[0];
  const costOf = (id: string) => board.cost.shots.find((c) => c.id === id);
  const total = plan.shots.reduce((t, s) => t + s.durationS, 0);
  const { left, queue, check } = board;
  const allTaken = shots.every((s) => s.take);
  const blocked = check.errors.length > 0;
  const working = Boolean(queue && !queue.stopped);

  async function act(path: string, body: unknown, after?: (r: any) => void) {
    setBusy(true);
    setFailure(null);
    try {
      const r = await api<any>(path, { method: "POST", body });
      if (r?.board) apply(r.board);
      after?.(r);
    } catch (e) {
      setFailure(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const base = `/api/films/${encodeURIComponent(film)}`;
  const maxUsd = Math.ceil(left.takesUsd * 100) / 100;

  const frame = board.brief?.aspectRatio?.replace(":", " / ");

  return (
    <section className="board" aria-label="Storyboard" style={frame ? ({ "--frame": frame } as CSSProperties) : undefined}>
      {board.brief && <BriefCard board={board} menu={menu} />}

      <div className="timeline" role="group" aria-label={`Timeline, ${total}s`}>
        {shots.map((s) => (
          <button
            key={s.id}
            type="button"
            className="timeline__shot"
            style={{ flexGrow: s.durationS }}
            aria-pressed={s.id === current.id}
            aria-label={`${s.id}, ${s.durationS} seconds`}
            onClick={() => setSelected(s.id)}
          />
        ))}
      </div>

      <div className="board__body">
        <ol className="strip" aria-label="Shots">
          {shots.map((s) => {
            const p = plan.shots.find((x) => x.id === s.id)!;
            const state = shotState(s);
            const c = costOf(s.id);
            return (
              <li key={s.id}>
                <button type="button" className="shot-card" aria-pressed={s.id === current.id} onClick={() => setSelected(s.id)} aria-label={`${s.id}: ${p.action}`}>
                  <span className="shot-card__frame" data-stale={s.stillStale || undefined}>
                    {s.stillUrl ? <img src={s.stillUrl} alt="" /> : <span className="shot-card__none">{s.continuesFrom ? `continues from ${s.continuesFrom}` : "no still"}</span>}
                    <span className="shot-card__tag mono">
                      {s.id} · {label(menu, "sizes", p.size)}
                    </span>
                  </span>
                  <span className="shot-card__row">
                    <span className="shot-card__model mono">{p.model ?? "no model"}</span>
                    <span className="shot-card__cost mono">{c?.takeUsd != null ? usd(c.takeUsd) : "no price"}</span>
                  </span>
                  <span className="shot-card__why">{p.why}</span>
                  <span className="shot-card__state" data-tone={state.tone}>
                    {state.text}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <Inspector key={`${film}/${current.id}/${plan.version}`} film={film} board={board} shot={current} menu={menu} apply={apply} />
      </div>

      <div className="go">
        <p className="go__sum">
          {plural(shots.filter((s) => s.still).length, "still")} of {shots.filter((s) => !s.continuesFrom).length} · {plural(shots.filter((s) => s.take).length, "take")} of {shots.length} · {total}s of {board.brief?.durationS ?? "?"}s
          {check.errors.length > 0 && <span className="go__bad"> · {plural(check.errors.length, "error")}, fix in the inspector or the chat</span>}
          {check.warnings.length > 0 && <span className="go__warn"> · {plural(check.warnings.length, "warning")}</span>}
        </p>
        {queue?.stopped && (
          <p className="go__stopped" role="alert">
            Stopped{queue.stopped.shot ? ` at ${queue.stopped.shot}` : ""}: {queue.stopped.message}
          </p>
        )}
        {working && <p className="go__working">{queue!.kind === "stills" ? `Making the style still first; ${queue!.waiting.join(", ")} follow once it lands.` : "Filming. Shots that continue from another start once its take lands."}</p>}
        {failure && (
          <p className="go__stopped" role="alert">
            {failure}
          </p>
        )}
        <div className="go__actions">
          <AutoRedo film={film} board={board} apply={apply} />
          {working && (
            <button type="button" className="button" disabled={busy} onClick={() => act(`${base}/stop`, {})}>
              Stop
            </button>
          )}
          {left.stills.length > 0 && (
            <button type="button" className="button" disabled={busy || blocked || working} onClick={() => act(`${base}/stills`, {})}>
              Make {plural(left.stills.length, "still")} <span className="mono">{usd(left.stillsUsd)}</span>
            </button>
          )}
          {allTaken && (
            <button type="button" className="button" disabled={busy} onClick={() => act(`${base}/cut`, {})}>
              Cut the film
            </button>
          )}
          {left.takes.length > 0 &&
            (confirming ? (
              <span className="go__confirm">
                <span>
                  Film {plural(left.takes.length, "shot")} for up to <span className="mono">{usd(maxUsd)}</span>?
                </span>
                <button
                  type="button"
                  className="generate"
                  disabled={busy}
                  onClick={() => act(`${base}/film`, { max_usd: maxUsd }, () => setConfirming(false))}
                >
                  Film
                </button>
                <button type="button" className="button button--quiet" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button type="button" className="generate" disabled={busy || blocked || working || left.stills.length > 0} onClick={() => setConfirming(true)} title={left.stills.length ? "Every shot needs its still first." : undefined}>
                Film all {left.takes.length} <span className="mono">{usd(left.takesUsd)}</span>
              </button>
            ))}
        </div>
      </div>

      {board.cut?.url && (
        <figure className="board__cut">
          <video src={board.cut.url} controls preload="metadata" aria-label={`The cut, ${board.cut.out}`} />
          <figcaption className="mono">
            {board.cut.out} · {board.cut.totalS}s
          </figcaption>
        </figure>
      )}
    </section>
  );
}
