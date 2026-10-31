// web/src/home/HomeScreen.tsx
// Where you land: one box to start a film (its words become the brief's
// takeaway and its folder name), and your four most recent films.
import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { DirectorMenu, FilmSummary } from "../api/types";
import { filmHref } from "../app/route";
import { FilmCard } from "../projects/FilmCard";
import { filmSlug } from "./slug";
import "../projects/projects.css";
import "./home.css";

// The server validates the brief (cli/director/brief.mjs): whole seconds 1-120,
// one of the menu's aspects, one of its film types. These lengths and the
// defaults below are all inside that.
const LENGTHS = [6, 8, 10, 15, 20, 30];
const ASPECTS = ["16:9", "9:16", "1:1", "21:9"];
const FILM_TYPES = [{ id: "live-action", label: "Live-action look" }];

export function HomeScreen() {
  // null until /api/films answers: the new film's folder name is made unique against this list.
  const [films, setFilms] = useState<FilmSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [menu, setMenu] = useState<DirectorMenu | null>(null);
  const [text, setText] = useState("");
  const [aspect, setAspect] = useState("16:9");
  const [length, setLength] = useState(15);
  const [type, setType] = useState("live-action");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<FilmSummary[]>("/api/films")
      .then(setFilms)
      .catch((e) => setListError(`Couldn't load your films, so a new one can't be named yet: ${e instanceof ApiError ? e.message : String(e)}`));
    api<DirectorMenu>("/api/director/menu").then(setMenu).catch(() => {});
  }, []);

  async function start() {
    const takeaway = text.trim();
    if (!takeaway || busy || !films) return;
    setBusy(true);
    setError(null);
    const brief = { takeaway, durationS: length, aspectRatio: aspect, filmType: type };
    // create: true makes the server refuse (409, exists) rather than write over a film already at that name.
    const save = (slug: string) => api(`/api/films/${slug}/brief`, { method: "PUT", body: { brief, create: true } }).then(() => slug);
    const taken = (e: unknown) => e instanceof ApiError && e.status === 409 && e.detail.exists === true;
    let slug = filmSlug(takeaway, films.map((f) => f.run));
    try {
      try {
        await save(slug);
      } catch (e) {
        if (!taken(e)) throw e;
        // The name was taken since the list loaded (another tab, the chat, or something the list does not show): read it again, try once more.
        const fresh = await api<FilmSummary[]>("/api/films");
        setFilms(fresh);
        slug = await save(filmSlug(takeaway, [...fresh.map((f) => f.run), slug]));
      }
      window.location.hash = filmHref(slug, "brief");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="home">
      <form
        className="home__start"
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        <h1 className="home__title">What are we making?</h1>
        <textarea
          className="home__text"
          aria-label="What is the film about?"
          placeholder="A 15-second film about… one or two sentences"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="home__chips">
          <select aria-label="Aspect ratio" value={aspect} onChange={(e) => setAspect(e.target.value)}>
            {(menu?.aspects ?? ASPECTS).map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <select aria-label="Length" value={length} onChange={(e) => setLength(Number(e.target.value))}>
            {LENGTHS.map((s) => (
              <option key={s} value={s}>
                {s}s
              </option>
            ))}
          </select>
          <select aria-label="Film type" value={type} onChange={(e) => setType(e.target.value)}>
            {(menu?.menu.filmTypes ?? FILM_TYPES).map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <a className="home__preset" href="#/presets">
            Start from a preset
          </a>
          <button type="submit" className="generate home__go" disabled={!text.trim() || busy || !films}>
            Start film
          </button>
        </div>
        {(error ?? listError) && (
          <p className="home__error" role="alert">
            {error ?? listError}
          </p>
        )}
      </form>

      {films && films.length > 0 && (
        <section className="home__recent" aria-labelledby="recent-h">
          <div className="home__recent-head">
            <h2 id="recent-h">Recent films</h2>
            <a href="#/projects">See all projects</a>
          </div>
          <div className="projects__grid">
            {films.slice(0, 4).map((f) => (
              <FilmCard key={f.run} film={f} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
