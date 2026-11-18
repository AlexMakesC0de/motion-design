import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { LookInfo, LooksView, PresetDetail, PresetInfo } from "../api/types";
import { applyLook, applyPreset, getDraft } from "../studio/promptStore";
import { swatchStyle } from "../studio/LookPicker";
import "./presets.css";

type Tab = "looks" | "templates";
const PICK_WORDS: Record<string, string> = { move: "Move", speed: "Speed", size: "Shot", angle: "Angle", lens: "Lens", light: "Light" };
const idWords = (id: string) => id.replace(/-/g, " ");

function LookCard({ look, inUse }: { look: LookInfo; inUse: boolean }) {
  return (
    <li className="look" data-in-use={inUse || undefined}>
      <div className="look__swatch" style={swatchStyle(look)}>
        <span className="look__category">{look.category}</span>
      </div>
      <div className="look__body">
        <h3>{look.title}</h3>
        <p className="look__tagline">{look.tagline}</p>
        <p className="look__best">{look.bestFor}</p>
        <ul className="look__picks" aria-label={`${look.title}'s camera`}>
          {Object.entries(look.picks).map(([k, v]) => (
            <li key={k}>
              <span>{PICK_WORDS[k] ?? k}</span> {idWords(v)}
            </li>
          ))}
        </ul>
        <details className="look__words">
          <summary>What it adds to your prompt</summary>
          <p>
            <b>Look:</b> {look.look}
          </p>
          <p>
            <b>Pacing:</b> {look.pacing}
          </p>
          <p>
            <b>Sound:</b> {look.sound}
          </p>
        </details>
        <button
          type="button"
          className="button button--light"
          aria-label={`Use ${look.title} in Video`}
          onClick={() => {
            applyLook(look);
            window.location.hash = "#/video";
          }}
        >
          {inUse ? "In use · open Video" : "Use in Video"}
        </button>
      </div>
    </li>
  );
}

/** Looks (short styles added after your prompt) and ad templates (whole films to rewrite for your subject). */
export function PresetsScreen() {
  const [tab, setTab] = useState<Tab>("looks");
  const [looks, setLooks] = useState<LooksView | null>(null);
  const [presets, setPresets] = useState<PresetInfo[] | null>(null);
  const [category, setCategory] = useState("All");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inUse = getDraft().look;

  useEffect(() => {
    api<LooksView>("/api/looks")
      .then(setLooks)
      .catch((e: ApiError) => setError(e.message));
    api<PresetInfo[]>("/api/presets")
      .then(setPresets)
      .catch((e: ApiError) => setError(e.message));
  }, []);

  async function use(id: string) {
    setBusy(id);
    setError(null);
    try {
      const p = await api<PresetDetail>(`/api/presets/${encodeURIComponent(id)}`);
      applyPreset(p);
      window.location.hash = "#/video";
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const shown = looks ? (category === "All" ? looks.looks : looks.looks.filter((l) => l.category === category)) : [];

  return (
    <div className="presets">
      <header className="presets__head">
        <h1>Looks</h1>
        <div className="presets__tabs" role="tablist" aria-label="Looks or ad templates">
          <button type="button" role="tab" aria-selected={tab === "looks"} className="presets__tab" onClick={() => setTab("looks")}>
            Looks <span className="presets__n mono">{looks?.looks.length ?? ""}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === "templates"} className="presets__tab" onClick={() => setTab("templates")}>
            Ad templates <span className="presets__n mono">{presets?.length ?? ""}</span>
          </button>
        </div>
        <p>
          {tab === "looks"
            ? "A look is a style for your shot: it sets the camera chips and adds a line each for colour and texture, pacing and sound after your prompt. Your prompt stays yours, on any model."
            : "Each template is the whole prompt of one published ad, written for that brand and for Higgsfield's models. It replaces your prompt; rewrite every line for your subject before you generate, and keep it under your model's length (Seedance takes 6,000 characters, Kling 2,500)."}
        </p>
      </header>
      {error && (
        <p className="presets__error" role="alert">
          {error}
        </p>
      )}

      {tab === "looks" && looks && (
        <>
          <div className="presets__filters" role="group" aria-label="Category">
            {["All", ...looks.categories].map((c) => (
              <button key={c} type="button" className="filter" aria-pressed={category === c} onClick={() => setCategory(c)}>
                {c}
              </button>
            ))}
          </div>
          <ul className="looks__grid" aria-label="Looks">
            {shown.map((l) => (
              <LookCard key={l.id} look={l} inUse={inUse === l.id} />
            ))}
          </ul>
        </>
      )}

      {tab === "templates" && (
        <>
          <ul className="presets__grid" aria-label="Ad templates">
            {(presets ?? []).map((p) => (
              <li key={p.id} className="preset">
                {p.still ? (
                  <img className="preset__still" src={p.still} alt={`${p.title}: a frame of its source video`} loading="lazy" />
                ) : (
                  <div className="preset__still preset__still--text" aria-hidden="true">
                    {p.title}
                  </div>
                )}
                <div className="preset__body">
                  <h2>{p.title}</h2>
                  {p.tagline && <p className="preset__tagline">{p.tagline}</p>}
                  <p className="preset__spec mono">
                    {[p.model ?? "no route", p.durationS != null ? `${p.durationS}s` : null, p.aspectRatio].filter(Boolean).join(" · ")}
                  </p>
                  {p.bestFor && <p className="preset__best">{p.bestFor}</p>}
                  <button type="button" className="button" disabled={!p.hasPrompt || busy === p.id} onClick={() => use(p.id)} aria-label={`Use ${p.title}`}>
                    {busy === p.id ? "Opening…" : "Start from this prompt"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {presets && !presets.length && <p className="presets__empty">No templates found.</p>}
        </>
      )}
    </div>
  );
}
