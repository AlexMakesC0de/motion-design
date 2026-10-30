import { useState } from "react";
import type { RunSummary } from "../api/types";

// Mirrors core's run slug rule for instant feedback; the server checks it again.
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const NEW = "__new__";

/** "Working in": the run folder new takes are filed in. A new film's folder is made by its first take. */
export function FilmPicker({ runs, run, onChange }: { runs: RunSummary[]; run: string; onChange: (run: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [slug, setSlug] = useState("");
  const valid = SLUG.test(slug);
  const known = runs.some((r) => r.run === run);

  if (adding) {
    return (
      <form
        className="film-picker"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onChange(slug);
          setAdding(false);
          setSlug("");
        }}
      >
        <label className="film-picker__label" htmlFor="new-film">
          New film
        </label>
        <input id="new-film" className="mono" value={slug} onChange={(e) => setSlug(e.target.value.trim())} placeholder="zethus-hero" autoFocus autoComplete="off" />
        <button type="submit" className="button" disabled={!valid}>
          Start
        </button>
        <button type="button" className="button button--quiet" onClick={() => setAdding(false)}>
          Cancel
        </button>
        {slug && !valid && <span className="film-picker__hint">Lowercase letters, digits and hyphens.</span>}
      </form>
    );
  }

  return (
    <div className="film-picker">
      <label className="film-picker__label" htmlFor="film">
        Working in
      </label>
      <select id="film" className="mono" value={run} onChange={(e) => (e.target.value === NEW ? setAdding(true) : onChange(e.target.value))}>
        {!run && <option value="">Pick a film</option>}
        {run && !known && <option value={run}>{run} (new)</option>}
        {runs.map((r) => (
          <option key={r.run} value={r.run}>
            {r.run}
          </option>
        ))}
        <option value={NEW}>New film…</option>
      </select>
    </div>
  );
}
