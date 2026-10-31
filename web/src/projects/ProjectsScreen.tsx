// web/src/projects/ProjectsScreen.tsx
// Every film, to find one, see where it is stuck and jump back in. A film is
// finished once its Finish step is done. A film with no progress (a folder the
// tools cannot name) is neither in progress nor finished: it shows under All only.
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type { FilmSummary } from "../api/types";
import { FilmCard } from "./FilmCard";
import "./projects.css";

type Filter = "all" | "progress" | "finished";
type Sort = "edited" | "name" | "spent";

const finished = (f: FilmSummary) => f.progress?.steps.finish === "done";
const inProgress = (f: FilmSummary) => f.progress !== null && !finished(f);

export function ProjectsScreen() {
  const [films, setFilms] = useState<FilmSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("edited");
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<"grid" | "list">("grid");

  useEffect(() => {
    api<FilmSummary[]>("/api/films")
      .then(setFilms)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  const counts = useMemo(() => {
    const all = films ?? [];
    return { all: all.length, finished: all.filter(finished).length, progress: all.filter(inProgress).length };
  }, [films]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (films ?? [])
      .filter((f) => (filter === "all" ? true : filter === "finished" ? finished(f) : inProgress(f)))
      .filter((f) => !q || f.run.toLowerCase().includes(q));
    // Films without progress have nothing spent to rank: they sort last.
    const by: Record<Sort, (a: FilmSummary, b: FilmSummary) => number> = {
      edited: (a, b) => b.modified.localeCompare(a.modified),
      name: (a, b) => a.run.localeCompare(b.run),
      spent: (a, b) => (b.progress?.spentUsd ?? -1) - (a.progress?.spentUsd ?? -1),
    };
    return [...list].sort(by[sort]);
  }, [films, filter, sort, query]);

  const reveal = (slug: string) => {
    api(`/api/films/${encodeURIComponent(slug)}/reveal`, { method: "POST", body: {} }).catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  };

  const tabs: { id: Filter; label: string }[] = [
    { id: "all", label: `All ${counts.all}` },
    { id: "progress", label: `In progress ${counts.progress}` },
    { id: "finished", label: `Finished ${counts.finished}` },
  ];

  return (
    <div className="projects">
      <header className="projects__head">
        <h1>Projects</h1>
        <div className="projects__filters" role="group" aria-label="Show">
          {tabs.map((t) => (
            <button key={t.id} type="button" className="projects__filter" aria-pressed={filter === t.id} onClick={() => setFilter(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <input className="projects__search" type="search" aria-label="Search films" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="projects__sort" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="edited">Last edited</option>
          <option value="name">Name</option>
          <option value="spent">Most spent</option>
        </select>
        <button type="button" className="button button--quiet" aria-pressed={layout === "list"} onClick={() => setLayout(layout === "grid" ? "list" : "grid")}>
          {layout === "grid" ? "List view" : "Grid view"}
        </button>
        <a className="generate projects__new" href="#/">
          + New film
        </a>
      </header>
      {error && (
        <p className="projects__error" role="alert">
          {error}
        </p>
      )}
      {films && films.length === 0 && (
        <p className="projects__none">
          No films yet. <a href="#/">Start a film</a>
        </p>
      )}
      {shown.length > 0 && (
        <div className="projects__grid" data-layout={layout}>
          {shown.map((f) => (
            <FilmCard key={f.run} film={f} onReveal={reveal} />
          ))}
        </div>
      )}
    </div>
  );
}
