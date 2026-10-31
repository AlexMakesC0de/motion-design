import { useState } from "react";
import { api, ApiError } from "../api/client";
import type { BoardShot, BoardView, DirectorMenu, RedoResult, ReviewFrames, Shot } from "../api/types";
import { usd } from "../studio/format";

/** The menu fields a shot is framed with, in the order a cinematographer reads them. */
const FIELDS: { key: keyof Shot | "move.type" | "move.speed"; label: string; group: string }[] = [
  { key: "size", label: "Size", group: "sizes" },
  { key: "angle", label: "Angle", group: "angles" },
  { key: "lens", label: "Lens", group: "lenses" },
  { key: "depth", label: "Depth", group: "depths" },
  { key: "move.type", label: "Move", group: "moves" },
  { key: "move.speed", label: "Speed", group: "speeds" },
  { key: "light", label: "Light", group: "lights" },
  { key: "screenDirection", label: "Screen direction", group: "screenDirections" },
  { key: "cut", label: "Cut to next", group: "cuts" },
  { key: "job", label: "Job", group: "jobs" },
];

type Draft = Shot & { checksText: string };
const draftOf = (s: Shot): Draft => ({ ...s, move: { ...s.move }, checksText: s.checks.join("\n") });
const read = (d: Draft, key: string) => (key === "move.type" ? d.move.type : key === "move.speed" ? (d.move.speed ?? "") : String((d as any)[key] ?? ""));

/** Only the fields that changed, in the shape update_shot takes. */
function changesOf(before: Shot, d: Draft): Partial<Shot> {
  const out: Record<string, unknown> = {};
  for (const k of ["size", "angle", "lens", "depth", "light", "screenDirection", "cut", "job", "model", "stillModel", "action", "why"] as const) {
    if ((d[k] ?? "") !== (before[k] ?? "")) out[k] = d[k];
  }
  if (d.durationS !== before.durationS) out.durationS = d.durationS;
  if (d.move.type !== before.move.type || (d.move.speed ?? "") !== (before.move.speed ?? "")) out.move = d.move.type === "static" ? { type: "static" } : { ...d.move };
  const checks = d.checksText.split("\n").map((c) => c.trim()).filter(Boolean);
  if (checks.join("\n") !== before.checks.join("\n")) out.checks = checks;
  return out as Partial<Shot>;
}

/** The take's frames and the verdict on it: each check passed or not, with a note. */
function ReviewPanel({ film, shot, frames, onSaved, onClose }: { film: string; shot: BoardShot; frames: ReviewFrames; onSaved: (b: BoardView, redo: RedoResult | null) => void; onClose: () => void }) {
  const [checks, setChecks] = useState(() => frames.checks.map((check) => ({ check, ok: true, note: "" })));
  const [failure, setFailure] = useState<string | null>(null);
  async function save(verdict: "pass" | "redo") {
    try {
      const review = { take: frames.take, verdict, checks: checks.map((c) => ({ check: c.check, ok: c.ok, ...(c.note.trim() ? { note: c.note.trim() } : {}) })) };
      const r = await api<BoardView & { redo: RedoResult | null }>(`/api/films/${encodeURIComponent(film)}/shots/${shot.id}/review`, { method: "PUT", body: { review } });
      onSaved(r, r.redo ?? null);
      onClose();
    } catch (e) {
      setFailure(e instanceof ApiError ? e.message : String(e));
    }
  }
  return (
    <div className="review" aria-label={`Review of ${frames.take}`} role="group">
      <img className="review__sheet" src={frames.sheetUrl} alt={`Contact sheet of ${frames.take}`} />
      <ul className="review__checks">
        {checks.map((c, i) => (
          <li key={c.check}>
            <label>
              <input type="checkbox" checked={c.ok} onChange={(e) => setChecks((list) => list.map((x, j) => (j === i ? { ...x, ok: e.target.checked } : x)))} /> {c.check}
            </label>
            {!c.ok && <input className="review__note" aria-label={`What is wrong: ${c.check}`} value={c.note} onChange={(e) => setChecks((list) => list.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />}
          </li>
        ))}
      </ul>
      {failure && <p className="inspector__error">{failure}</p>}
      <div className="inspector__actions">
        <button type="button" className="button" onClick={() => save("pass")} disabled={checks.some((c) => !c.ok)}>
          Pass
        </button>
        <button type="button" className="button" onClick={() => save("redo")}>
          Needs a redo
        </button>
        <button type="button" className="button button--quiet" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/**
 * One shot in full: every menu field as a select, its models, its words and
 * checks, what the checker says about it, its stills and its take. Saving
 * goes through update_shot's rules, so a change that breaks the plan is
 * refused with the reason and nothing is saved.
 */
export function Inspector({ film, board, shot, menu, apply }: { film: string; board: BoardView; shot: BoardShot; menu: DirectorMenu | null; apply: (b: BoardView) => void }) {
  const plan = board.plan!;
  const before = plan.shots.find((s) => s.id === shot.id)!;
  const [draft, setDraft] = useState<Draft>(() => draftOf(before));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmTake, setConfirmTake] = useState(false);
  const [frames, setFrames] = useState<ReviewFrames | null>(null);
  const [redo, setRedo] = useState<RedoResult | null>(null);
  const base = `/api/films/${encodeURIComponent(film)}`;
  const changes = changesOf(before, draft);
  const dirty = Object.keys(changes).length > 0;
  const findings = [...board.check.errors.map((f) => ({ ...f, tone: "bad" })), ...board.check.warnings.map((f) => ({ ...f, tone: "warn" }))].filter((f) => f.shot === shot.id);
  const cost = board.cost.shots.find((c) => c.id === shot.id);
  const blocked = board.check.errors.length > 0;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setFailure(null);
    try {
      await fn();
    } catch (e) {
      setFailure(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const post = (path: string, body: unknown = {}) => run(async () => {
    const r = await api<any>(`${base}${path}`, { method: "POST", body });
    apply(r.board ?? r);
  });

  return (
    <aside className="inspector" aria-label={`Shot ${shot.id}`}>
      <h3 className="inspector__title">
        {shot.id} · {before.durationS}s
      </h3>
      <form
        className="inspector__form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!dirty) return;
          run(async () => apply(await api<BoardView>(`${base}/shots/${shot.id}`, { method: "PUT", body: { changes } })));
        }}
      >
        <label className="inspector__field inspector__field--wide">
          <span>Action</span>
          <textarea rows={3} value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} />
        </label>
        <label className="inspector__field">
          <span>Length (s)</span>
          <input type="number" min={0.5} step={0.5} value={draft.durationS} onChange={(e) => setDraft({ ...draft, durationS: Number(e.target.value) })} />
        </label>
        {FIELDS.map((f) => {
          const options = menu?.menu[f.group] ?? [];
          const value = read(draft, f.key);
          if (f.key === "move.speed" && draft.move.type === "static") return null;
          return (
            <label key={f.key} className="inspector__field">
              <span>{f.label}</span>
              <select
                value={value}
                onChange={(e) => {
                  const v = e.target.value;
                  if (f.key === "move.type") setDraft({ ...draft, move: { type: v, speed: v === "static" ? undefined : (draft.move.speed ?? "slow") } });
                  else if (f.key === "move.speed") setDraft({ ...draft, move: { ...draft.move, speed: v } });
                  else setDraft({ ...draft, [f.key]: v });
                }}
              >
                {!options.some((o) => o.id === value) && <option value={value}>{value || "—"}</option>}
                {options.map((o) => (
                  <option key={o.id} value={o.id} title={o.when}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        <label className="inspector__field">
          <span>Film on</span>
          <select value={draft.model ?? ""} onChange={(e) => setDraft({ ...draft, model: e.target.value })}>
            {!draft.model && <option value="">—</option>}
            {(menu?.videoModels ?? [{ id: draft.model ?? "", label: draft.model ?? "" }]).map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        </label>
        <label className="inspector__field">
          <span>Still on</span>
          <select value={draft.stillModel ?? ""} onChange={(e) => setDraft({ ...draft, stillModel: e.target.value })}>
            {!draft.stillModel && <option value="">—</option>}
            {(menu?.imageModels ?? [{ id: draft.stillModel ?? "", label: draft.stillModel ?? "" }]).map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        </label>
        <label className="inspector__field inspector__field--wide">
          <span>Why</span>
          <textarea rows={2} value={draft.why} onChange={(e) => setDraft({ ...draft, why: e.target.value })} />
        </label>
        <label className="inspector__field inspector__field--wide">
          <span>Checks, one per line</span>
          <textarea rows={3} value={draft.checksText} onChange={(e) => setDraft({ ...draft, checksText: e.target.value })} />
        </label>
        {before.modelReason && <p className="inspector__reason">{before.modelReason}</p>}
        <ul className="inspector__findings" aria-label="Checker">
          {findings.length === 0 && <li data-tone="ok">The checker has nothing on this shot.</li>}
          {findings.map((f) => (
            <li key={`${f.rule}-${f.message}`} data-tone={f.tone}>
              {f.message}
            </li>
          ))}
        </ul>
        {dirty && (
          <div className="inspector__actions">
            <button type="submit" className="button" disabled={busy}>
              Save shot
            </button>
            <button type="button" className="button button--quiet" onClick={() => setDraft(draftOf(before))}>
              Undo changes
            </button>
          </div>
        )}
      </form>

      {failure && (
        <p className="inspector__error" role="alert">
          {failure}
        </p>
      )}

      <section className="inspector__media" aria-label="Stills">
        <h4>Stills</h4>
        {shot.continuesFrom ? (
          <p className="inspector__hint">This shot starts on the last frame of {shot.continuesFrom}'s take, so it has no still of its own.</p>
        ) : (
          <>
            {shot.stills.filter((x) => x.url).length > 0 && (
              <ul className="inspector__stills">
                {shot.stills
                  .filter((x) => x.url)
                  .map((x) => (
                    <li key={x.jobId}>
                      <button
                        type="button"
                        className="inspector__still"
                        aria-pressed={x.file === shot.still}
                        aria-label={`Use ${x.file}${x.stale ? " (from before the last change)" : ""}`}
                        disabled={busy || x.file === shot.still}
                        onClick={() => post(`/shots/${shot.id}/use`, { still: x.file })}
                      >
                        <img src={x.url!} alt="" />
                      </button>
                    </li>
                  ))}
              </ul>
            )}
            <button type="button" className="button" disabled={busy || blocked} onClick={() => post(`/shots/${shot.id}/still`)}>
              {shot.still ? "New still" : "Make the still"} <span className="mono">{cost?.stillUsd != null ? usd(cost.stillUsd) : ""}</span>
            </button>
          </>
        )}
      </section>

      <section className="inspector__media" aria-label="Take">
        <h4>Take</h4>
        {shot.takeUrl && <video className="inspector__take" src={shot.takeUrl} controls preload="metadata" aria-label={`Take ${shot.take}`} />}
        {shot.failed && <p className="inspector__error">The last take {shot.failed.state === "failed-confirmed-free" ? "failed and was not charged" : "failed"}: {shot.failed.error ?? "no message"}</p>}
        {shot.review && (
          <p className="inspector__verdict" data-verdict={shot.review.verdict}>
            {shot.review.verdict === "pass" ? "Passed" : "Needs a redo"}
            {shot.review.checks.filter((c) => !c.ok).map((c) => ` · ${c.note ?? c.check}`)}
          </p>
        )}
        <div className="inspector__actions">
          {shot.take && !frames && (
            <button type="button" className="button" disabled={busy} onClick={() => run(async () => setFrames(await api<ReviewFrames>(`${base}/shots/${shot.id}/review`, { method: "POST", body: {} })))}>
              Review
            </button>
          )}
          {!shot.filming.length &&
            (confirmTake ? (
              <span className="go__confirm">
                <span>
                  {shot.take ? "Film it again" : "Film it"} for about <span className="mono">{cost?.takeUsd != null ? usd(cost.takeUsd) : "?"}</span>?
                </span>
                <button type="button" className="generate" disabled={busy} onClick={() => post(`/shots/${shot.id}/take`).then(() => setConfirmTake(false))}>
                  Film
                </button>
                <button type="button" className="button button--quiet" onClick={() => setConfirmTake(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button type="button" className="button" disabled={busy || blocked || (!shot.still && !shot.continuesFrom)} onClick={() => setConfirmTake(true)}>
                {shot.take || shot.failed ? "Film again" : "Film this shot"} <span className="mono">{cost?.takeUsd != null ? usd(cost.takeUsd) : ""}</span>
              </button>
            ))}
        </div>
        {!shot.still && !shot.continuesFrom && !shot.take && <p className="inspector__hint">Make the still first: the take starts from it.</p>}
        {redo && (
          <p className={redo.submitted ? "inspector__hint" : "inspector__error"} role="status">
            {redo.submitted ? `Auto-redo: filming ${shot.id} again (redo ${redo.redo} of 2), about ${usd(redo.estimateUsd ?? 0)}.` : `Auto-redo held back: ${redo.reason}`}
          </p>
        )}
        {frames && (
          <ReviewPanel
            film={film}
            shot={shot}
            frames={frames}
            onSaved={(b, r) => {
              apply(b);
              setRedo(r);
            }}
            onClose={() => setFrames(null)}
          />
        )}
      </section>
    </aside>
  );
}
