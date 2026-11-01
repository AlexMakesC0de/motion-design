// web/src/scene/SaveIntoFilm.tsx
// Create's "Save into film": pick a film or name a new one, and the scene,
// its pictures and its versions' videos are copied there. Create keeps its
// copy. Then the film opens on that scene.
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { api, ApiError } from "../api/client";
import type { FilmSummary, Scene } from "../api/types";
import { sceneHref } from "../app/route";
import { filmSlug } from "../home/slug";

const NEW = "";

export function SaveIntoFilm({ run, scene, onClose }: { run: string; scene: Scene; onClose(): void }) {
  const [films, setFilms] = useState<FilmSummary[] | null>(null);
  const [to, setTo] = useState<string>(NEW);
  const [name, setName] = useState(scene.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    api<FilmSummary[]>("/api/films")
      .then((list) => {
        // Films made in Shard first: an old takes-only folder becomes a Shard film once a scene is saved into it.
        const sorted = [...list].sort((a, b) => Number(a.progress?.legacy ?? true) - Number(b.progress?.legacy ?? true));
        setFilms(sorted);
        const shard = sorted.find((f) => f.progress && !f.progress.legacy);
        if (shard) setTo(shard.run);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);
  useEffect(() => first.current?.focus(), [films]);

  const target = to === NEW ? (films ? filmSlug(name || "film", films.map((f) => f.run)) : "") : to;

  const save = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ film: string; scene: Scene }>(`/api/films/${encodeURIComponent(run)}/scenes/${encodeURIComponent(scene.id)}/copy`, { method: "POST", body: { to: target } });
      onClose();
      window.location.hash = sceneHref(r.film, r.scene.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  };

  const keys = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    onClose();
  };

  const made = scene.versions.length;
  return (
    <div className="ref-chooser__backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="save-into-h" className="ref-chooser save-into" onKeyDown={keys}>
        <header className="ref-chooser__head">
          <h2 id="save-into-h" className="ref-chooser__title">
            Save “{scene.title || "Untitled"}” into a film
          </h2>
          <button type="button" className="button button--quiet" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <p className="save-into__what">
          Copies the scene, its pictures{made ? ` and its ${made === 1 ? "video" : `${made} videos`}` : ""}. It stays in Create too.
        </p>
        <form
          className="save-into__form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="save-into__field">
            <span>Film</span>
            <select ref={first} className="scene-input" value={to} disabled={!films} onChange={(e) => setTo(e.target.value)}>
              <option value={NEW}>New film…</option>
              {(films ?? []).map((f) => (
                <option key={f.run} value={f.run}>
                  {f.run}
                  {f.progress?.legacy ? " (takes only)" : ""}
                </option>
              ))}
            </select>
          </label>
          {to === NEW && (
            <label className="save-into__field">
              <span>New film's name</span>
              <input className="scene-input" value={name} placeholder="What the film is about" onChange={(e) => setName(e.target.value)} />
              {target && <span className="mono save-into__slug">runs/{target}</span>}
            </label>
          )}
          <div className="save-into__actions">
            <button type="button" className="button button--quiet" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="generate" disabled={!target || busy}>
              {busy ? "Saving…" : "Save into film"}
            </button>
          </div>
        </form>
        {error && (
          <p role="alert" className="ref-chooser__error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
