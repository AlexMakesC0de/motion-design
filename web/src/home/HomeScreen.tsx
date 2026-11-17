// web/src/home/HomeScreen.tsx
// Where you land: one box to start a film (its words become the film's idea
// and its folder name), and your four most recent films.
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import { RATIOS } from "../../../cli/director/scene-shape.mjs";
import type { FilmSummary, PresetDetail, PresetInfo } from "../api/types";
import { Icon } from "../app/icons";
import { applyPreset } from "../studio/promptStore";
import { filmHref } from "../app/route";
import { FilmCard } from "../projects/FilmCard";
import { filmSlug } from "./slug";
import "../projects/projects.css";
import "./home.css";

// The server checks the idea (saveIdea in cli/director/scenes.mjs): a scene ratio, and a total length of whole seconds.
const LENGTHS = [8, 10, 15, 20, 30, 45, 60, 90, 120];

// One full sentence per idea chip; clicking one fills the box with it.
const IDEAS: { label: string; text: string }[] = [
  { label: "Pizza at 3am", text: "A guy gets woken up at 3am by a pizza he never ordered. Dry comedy, shot like a thriller." },
  { label: "Launch film for my app", text: "A 20-second launch film for my app: one tired person, one messy task, then the app clears it in a single tap." },
  { label: "Rainy café, seamless loop", text: "A rainy café window at dusk, steam rising from a cup, drops sliding down the glass, built to loop without a visible cut." },
  { label: "First skydive, POV", text: "A first skydive from the jumper's point of view: the door opens, the ground drops away, and the scream turns into a laugh." },
];

export function HomeScreen() {
  // null until /api/films answers: the new film's folder name is made unique against this list.
  const [films, setFilms] = useState<FilmSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [aspect, setAspect] = useState("16:9");
  const [length, setLength] = useState(15);
  const [presets, setPresets] = useState<PresetInfo[] | null>(null);
  const [look, setLook] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<FilmSummary[]>("/api/films")
      .then(setFilms)
      .catch((e) => setListError(`Couldn't load your films, so a new one can't be named yet: ${e instanceof ApiError ? e.message : String(e)}`));
    // The looks are optional decoration for the page: a failed load just leaves the row out.
    api<PresetInfo[]>("/api/presets")
      .then(setPresets)
      .catch(() => setPresets([]));
  }, []);

  function useIdea(label: string) {
    const pool = IDEAS.map((i) => i.text);
    const chosen = label === "Surprise me" ? pool[Math.floor(Math.random() * pool.length)] : IDEAS.find((i) => i.label === label)?.text;
    if (!chosen) return;
    setText(chosen);
    textRef.current?.focus();
  }

  async function start() {
    const takeaway = text.trim();
    if (!takeaway || busy || !films) return;
    setBusy(true);
    setError(null);
    const idea = { text: takeaway, ratio: aspect, lengthS: length };
    // create: true makes the server refuse (409, exists) rather than write over a film already at that name.
    const save = (slug: string) => api(`/api/films/${slug}/idea`, { method: "PUT", body: { idea, create: true } }).then(() => slug);
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
      // The film's idea has no look field, so a chosen look goes where the Presets screen sends one: the Create prompt bar.
      if (look) await api<PresetDetail>(`/api/presets/${encodeURIComponent(look)}`).then(applyPreset).catch(() => {});
      window.location.hash = filmHref(slug, "idea");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  }

  const chosen = presets?.find((p) => p.id === look) ?? null;
  const recent = films?.slice(0, 4) ?? [];

  return (
    <div className="home">
      <h1 className="home__title">What are we making?</h1>
      <p className="home__sub">Say it in a sentence. You'll get a scene plan before anything costs money.</p>
      <form
        className="home__start"
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        <div className="home__prompt">
          <textarea
            ref={textRef}
            className="home__text"
            aria-label="What is the film about?"
            placeholder="A 15-second film about… one or two sentences"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="home__chips">
            <label className="chip-select">
              Shape
              <select value={aspect} onChange={(e) => setAspect(e.target.value)} aria-label="Aspect ratio">
                {RATIOS.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
            <label className="chip-select">
              Length
              <select value={length} onChange={(e) => setLength(Number(e.target.value))} aria-label="Length">
                {LENGTHS.map((s) => (
                  <option key={s} value={s}>
                    {s}s
                  </option>
                ))}
              </select>
            </label>
            {chosen && (
              <button type="button" className="home__look-chip" aria-label={`Look: ${chosen.title}. Remove`} onClick={() => setLook(null)}>
                {chosen.still && <img src={chosen.still} alt="" />}
                {chosen.title}
                <Icon name="close" size={14} />
              </button>
            )}
            <button type="submit" className="button button--light button--lg home__go" disabled={!text.trim() || busy || !films}>
              Plan my film <Icon name="arrow" size={16} />
            </button>
          </div>
        </div>
        {(error ?? listError) && (
          <p className="home__error" role="alert">
            {error ?? listError}
          </p>
        )}
        <div className="home__ideas">
          {[...IDEAS.map((i) => i.label), "Surprise me"].map((label) => (
            <button key={label} type="button" className="home__idea" onClick={() => useIdea(label)}>
              {label}
            </button>
          ))}
        </div>
      </form>

      {presets && presets.length > 0 && (
        <section className="home__section" aria-labelledby="looks-h">
          <div className="home__section-head">
            <h2 id="looks-h">Pick a look</h2>
            <a href="#/presets">All {presets.length} looks</a>
          </div>
          <div className="home__looks">
            {presets.map((p) => (
              <button key={p.id} type="button" className="home__look" aria-pressed={look === p.id} onClick={() => setLook(look === p.id ? null : p.id)}>
                <span className="home__look-thumb">{p.still && <img src={p.still} alt="" loading="lazy" />}</span>
                <span className="home__look-name">{p.title}</span>
                {p.tagline && <span className="home__look-tag">{p.tagline}</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="home__section home__recent" aria-labelledby="recent-h">
          <div className="home__section-head">
            <h2 id="recent-h">Keep going</h2>
            <a href="#/projects">All films</a>
          </div>
          <div className="home__films">
            {recent.map((f) => (
              <FilmCard key={f.run} film={f} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
