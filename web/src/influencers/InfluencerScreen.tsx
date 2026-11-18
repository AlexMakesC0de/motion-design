// web/src/influencers/InfluencerScreen.tsx
// The AI influencer builder. Pick the look as chips, make four face options,
// keep one under a name: it is saved as a Library character with its persona
// and a reference sheet is made from it. The sheet is kept with one more click,
// so a bad sheet never replaces the face. Every price comes from the server.
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Influencer, InfluencerView, JobView } from "../api/types";
import { Icon } from "../app/icons";
import { useJobs } from "../studio/useJobs";
import { usd } from "../studio/format";
import { Empty } from "../jutsu/JutsuScreen";
import "../jutsu/jutsu.css";
import "./influencers.css";

type Panel = "faces" | "influencers";
const message = (e: unknown) => (e instanceof ApiError ? e.message : String(e));
const FAILED = new Set(["failed-charged", "failed-unconfirmed", "failed-confirmed-free", "refused"]);
const phase = (job: JobView | undefined) => (!job ? "pending" : job.state === "succeeded" && job.media[0] ? "done" : FAILED.has(job.state) ? "failed" : "pending");

/** One face option: making, failed, or a picture to pick. */
function FaceTile({ job, index, total, picked, onPick }: { job: JobView | undefined; index: number; total: number; picked: boolean; onPick(): void }) {
  const p = phase(job);
  if (p === "done") {
    return (
      <li className="inf-face">
        <button type="button" className="inf-face__button" aria-pressed={picked} aria-label={`Face ${index + 1} of ${total}`} onClick={onPick}>
          <img src={job!.media[0]} alt="" />
          {picked && (
            <span className="inf-face__check" aria-hidden="true">
              <Icon name="check" size={14} /> Picked
            </span>
          )}
        </button>
      </li>
    );
  }
  return (
    <li className="inf-face" data-phase={p}>
      <span className="inf-face__state">{p === "failed" ? (job?.state === "failed-confirmed-free" || job?.state === "refused" ? "Failed, not charged" : "Failed") : "Making…"}</span>
    </li>
  );
}

/** A saved influencer: their sheet (or face), and what is next for the sheet. */
function InfluencerCard({ inf, job, sheetUsd, busy, onKeep, onRemake }: { inf: Influencer; job: JobView | undefined; sheetUsd: number; busy: boolean; onKeep(): void; onRemake(): void }) {
  const p = inf.sheetJobId ? phase(job) : null;
  const fresh = p === "done" && !inf.sheetJobKept;
  const picture = fresh ? job!.media[0] : (inf.sheet ?? inf.face);
  return (
    <li className="inf-card" aria-label={inf.displayName}>
      <div className="inf-card__media" data-sheet={Boolean(inf.sheet || fresh) || undefined}>
        {picture && <img src={picture} alt="" />}
        {p === "pending" && <span className="inf-card__badge">Making the sheet…</span>}
        {fresh && <span className="inf-card__badge">New sheet</span>}
      </div>
      <div className="inf-card__body">
        <p className="inf-card__name">{inf.displayName}</p>
        <p className="inf-card__words">{inf.description}</p>
        <div className="inf-card__actions">
          {fresh && (
            <button type="button" className="inf-button inf-button--solid" disabled={busy} onClick={onKeep}>
              Keep sheet
            </button>
          )}
          {p !== "pending" && (
            <button type="button" className="inf-button" disabled={busy} onClick={onRemake}>
              {inf.sheet || fresh ? "Make again" : "Make sheet"} · {usd(sheetUsd)}
            </button>
          )}
          {inf.sheet && !fresh && (
            <a className="inf-button" href="#/jutsu">
              Use in Openjutsu
            </a>
          )}
        </div>
        {p === "failed" && <p className="inf-card__note">The last sheet failed.</p>}
      </div>
    </li>
  );
}

export function InfluencerScreen() {
  const [view, setView] = useState<InfluencerView | null>(null);
  const [traits, setTraits] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState("");
  const [name, setName] = useState("");
  const [words, setWords] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("faces");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { jobs } = useJobs("influencers");

  const load = useCallback(
    () =>
      api<InfluencerView>("/api/influencers")
        .then((v) => setView(v))
        .catch((e) => setError(message(e))),
    [],
  );
  useEffect(() => void load(), [load]);
  // A new job or a finished one changes the batches and the cards.
  const settled = jobs.filter((j) => j.state === "succeeded" || FAILED.has(j.state)).length;
  useEffect(() => void load(), [jobs.length, settled, load]);

  // The words the chips make, from the server, so what you read is what is sent.
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api<{ description: string }>("/api/influencers/describe", { method: "POST", body: { traits, extra } })
        .then((r) => live && setWords(r.description))
        .catch(() => {});
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [traits, extra]);

  const byId = new Map(jobs.map((j) => [j.id, j]));
  const pickedJob = picked ? byId.get(picked) : undefined;
  const canPick = phase(pickedJob) === "done";

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const makeFaces = () =>
    act(async () => {
      const r = await api<{ jobs: string[]; warnings: string[] }>("/api/influencers/faces", { method: "POST", body: { traits, extra } });
      if (r.warnings.length) setNote(r.warnings.join(" "));
      setPicked(null);
      setPanel("faces");
      await load();
    });

  const keepFace = () =>
    act(async () => {
      const r = await api<{ warnings: string[] }>("/api/influencers", { method: "POST", body: { name, face: picked } });
      if (r.warnings.length) setNote(r.warnings.join(" "));
      setPicked(null);
      setName("");
      setPanel("influencers");
      await load();
    });

  const remake = (inf: Influencer) =>
    act(async () => {
      await api(`/api/influencers/${encodeURIComponent(inf.name)}/sheet`, { method: "POST" });
      await load();
    });

  const keepSheet = (inf: Influencer) =>
    act(async () => {
      await api(`/api/influencers/${encodeURIComponent(inf.name)}/adopt`, { method: "POST", body: { job: inf.sheetJobId } });
      await load();
    });

  const toggle = (trait: string, option: string) => setTraits((t) => ({ ...t, [trait]: t[trait] === option ? "" : option }));
  const facesLabel = view ? `Make ${view.faces} faces · ${usd(view.facesUsd)}` : "Make faces";
  const influencers = view?.influencers ?? [];
  const batches = view?.batches ?? [];

  return (
    <div className="jutsu">
      <aside className="jutsu-form inf-form" aria-label="AI influencer builder">
        <h1 className="jutsu-form__word">AI INFLUENCER</h1>

        <div className="inf-form__scroll">
          <label className="inf-field">
            <span className="inf-field__label">Name</span>
            <input className="inf-field__input" value={name} maxLength={60} placeholder="Mira" onChange={(e) => setName(e.target.value)} />
          </label>

          {view?.traits.map((t) => (
            <div key={t.id} className="inf-trait" role="group" aria-label={t.label}>
              <span className="inf-field__label">{t.label}</span>
              <div className="inf-chips">
                {t.options.map((o) => (
                  <button key={o.id} type="button" className="inf-chip" aria-pressed={traits[t.id] === o.id} onClick={() => toggle(t.id, o.id)}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <label className="inf-field">
            <span className="inf-field__label">Anything else</span>
            <textarea className="inf-field__input inf-field__text" aria-label="Anything else" rows={2} maxLength={300} placeholder="Freckles, round glasses, a small nose ring." value={extra} onChange={(e) => setExtra(e.target.value)} />
          </label>
        </div>

        {words && traits.gender && (
          <p className="inf-form__words">
            <span>Described as</span> {words}
          </p>
        )}
        {error && (
          <p className="jutsu-form__error" role="alert">
            {error}
          </p>
        )}
        {note && <p className="inf-form__note">{note}</p>}

        <div className="jutsu-form__foot">
          {canPick ? (
            <>
              <button type="button" className="jutsu-go" disabled={busy || !name.trim()} onClick={keepFace}>
                {name.trim() ? `Save ${name.trim()} · make sheet · ${usd(view?.sheetUsd ?? 0)}` : "Name them to save this face"}
              </button>
              <button type="button" className="inf-button inf-button--wide" disabled={busy} onClick={makeFaces}>
                Make {view?.faces ?? 4} more faces · {usd(view?.facesUsd ?? 0)}
              </button>
            </>
          ) : (
            <button type="button" className="jutsu-go" disabled={busy || !traits.gender} onClick={makeFaces}>
              {busy ? "Sending…" : traits.gender ? facesLabel : "Pick a gender to start"}
            </button>
          )}
        </div>
      </aside>

      <section className="jutsu-main" aria-label={panel === "faces" ? "Faces" : "Your influencers"}>
        <div className="jutsu-main__head">
          <div className="pill-toggle" role="group" aria-label="Show">
            <button type="button" className="pill-toggle__item" aria-pressed={panel === "faces"} onClick={() => setPanel("faces")}>
              <Icon name="sheet" size={16} />
              Faces
            </button>
            <button type="button" className="pill-toggle__item" aria-pressed={panel === "influencers"} onClick={() => setPanel("influencers")}>
              <Icon name="library" size={16} />
              Your influencers
              {influencers.length > 0 && <span className="jutsu-main__count mono">{influencers.length}</span>}
            </button>
          </div>
        </div>

        <div className="jutsu-main__scroll">
          {panel === "faces" ? (
            batches.length ? (
              batches.map((b) => (
                <section key={b.batch} className="inf-batch" aria-label={`Faces: ${b.description ?? b.batch}`}>
                  <p className="inf-batch__words">{b.description}</p>
                  <ul className="inf-faces">
                    {b.jobIds.map((id, i) => (
                      <FaceTile key={id} job={byId.get(id)} index={i} total={b.jobIds.length} picked={picked === id} onPick={() => setPicked(picked === id ? null : id)} />
                    ))}
                  </ul>
                </section>
              ))
            ) : (
              <Empty tone="pink" icon="sheet" title="Your face options will appear here">
                Pick the look on the left, then make {view?.faces ?? 4} faces to choose from.
              </Empty>
            )
          ) : influencers.length ? (
            <ul className="inf-cards" aria-label="Your influencers">
              {influencers.map((inf) => (
                <InfluencerCard key={inf.name} inf={inf} job={inf.sheetJobId ? byId.get(inf.sheetJobId) : undefined} sheetUsd={view?.sheetUsd ?? 0} busy={busy} onKeep={() => keepSheet(inf)} onRemake={() => remake(inf)} />
              ))}
            </ul>
          ) : (
            <Empty tone="violet" icon="library" title="Your influencers will appear here">
              Pick a face you like and give it a name. It is saved in the Library with a reference sheet, ready for films and Openjutsu.
            </Empty>
          )}
        </div>
      </section>
    </div>
  );
}
