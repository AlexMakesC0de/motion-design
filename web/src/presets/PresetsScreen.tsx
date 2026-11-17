import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { PresetDetail, PresetInfo } from "../api/types";
import { applyPreset } from "../studio/promptStore";
import "./presets.css";

/** The motion-design preset gallery. "Use this" fills the prompt bar and opens Create. */
export function PresetsScreen() {
  const [presets, setPresets] = useState<PresetInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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

  return (
    <div className="presets">
      <header className="presets__head">
        <h1>Looks</h1>
        <p>Each preset starts from a published source prompt. Use this puts that prompt and its model, length and ratio in the prompt bar; adapt it to your subject before you generate.</p>
      </header>
      {error && (
        <p className="presets__error" role="alert">
          {error}
        </p>
      )}
      <ul className="presets__grid" aria-label="Presets">
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
              {p.fidelity && <p className="preset__fidelity">{p.fidelity === "native" ? "Runs on the model its prompt was written for" : "Adaptation: written for another model"}</p>}
              {p.bestFor && <p className="preset__best">{p.bestFor}</p>}
              <button type="button" className="button" disabled={!p.hasPrompt || busy === p.id} onClick={() => use(p.id)} aria-label={`Use ${p.title}`}>
                {busy === p.id ? "Opening…" : "Use this"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {presets && !presets.length && <p className="presets__empty">No presets found.</p>}
    </div>
  );
}
