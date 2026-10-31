// web/src/projects/ProjectsScreen.test.tsx
import { describe, test, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { ProjectsScreen } from "./ProjectsScreen";
import { routes } from "../test-fixtures";
import type { FilmProgress, FilmSummary } from "../api/types";

const prog = (over: Partial<FilmProgress>): FilmProgress => ({
  step: "shots",
  steps: { brief: "done", references: "done", shots: "current", finish: "locked" },
  next: { text: "Film s2 and s3", step: "shots" },
  counts: { shots: 3, stills: 3, takes: 1, outputs: 0 },
  spentUsd: 0.42,
  legacy: false,
  ...over,
});

const films: FilmSummary[] = [
  { run: "boat", modified: "2026-10-31T12:00:00.000Z", files: 6, takes: 3, cover: null, progress: prog({}) },
  {
    run: "rainy-coffee",
    modified: "2026-10-31T09:00:00.000Z",
    files: 9,
    takes: 6,
    cover: { kind: "video", url: "/media/runs/rainy-coffee/film.mp4" },
    progress: prog({ step: "finish", steps: { brief: "done", references: "done", shots: "done", finish: "done" }, next: { text: "Watch the film", step: "finish" }, spentUsd: 0.64 }),
  },
  // A folder the tools cannot name: no progress. It counts under All only.
  { run: "Old Stuff", modified: "2026-10-01T09:00:00.000Z", files: 1, takes: 1, cover: null, progress: null },
];

describe("ProjectsScreen", () => {
  test("one card per film, naming its next step as a link into the film", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => films })));
    render(<ProjectsScreen />);
    const boat = await screen.findByRole("article", { name: "boat" });
    expect(within(boat).getByRole("link", { name: "Next: Film s2 and s3" })).toHaveAttribute("href", "#/films/boat/shots");
    expect(within(boat).getByText("$0.42 spent")).toBeInTheDocument();
    expect(within(boat).getByRole("list", { name: "Steps" })).toBeInTheDocument();
  });

  test("filters by In progress and Finished, with counts; a film without progress is under All only", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => films })));
    render(<ProjectsScreen />);
    await screen.findByRole("article", { name: "boat" });
    expect(screen.getByRole("button", { name: "All 3" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finished 1" }));
    expect(screen.queryByRole("article", { name: "boat" })).toBeNull();
    expect(screen.getByRole("article", { name: "rainy-coffee" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "In progress 1" }));
    expect(screen.getByRole("article", { name: "boat" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "rainy-coffee" })).toBeNull();
    expect(screen.queryByRole("article", { name: "Old Stuff" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "All 3" }));
    expect(screen.getByRole("article", { name: "Old Stuff" })).toBeInTheDocument();
  });

  test("search narrows by name, and sort by spent puts the costliest first", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => films })));
    render(<ProjectsScreen />);
    await screen.findByRole("article", { name: "boat" });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), { target: { value: "spent" } });
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["rainy-coffee", "boat", "Old Stuff"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search films" }), { target: { value: "rain" } });
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["rainy-coffee"]);
  });

  test("Show in Finder posts to reveal", async () => {
    const fetchMock = vi.fn(routes({ "/api/films": () => films, "/api/films/boat/reveal": () => ({ revealed: "boat" }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProjectsScreen />);
    const boat = await screen.findByRole("article", { name: "boat" });
    fireEvent.click(within(boat).getByRole("button", { name: "Show in Finder: boat" }));
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/films/boat/reveal") && init?.method === "POST")).toBe(true);
  });

  test("no films: says so and offers to start one", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => [] })));
    render(<ProjectsScreen />);
    expect(await screen.findByText(/No films yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a film" })).toHaveAttribute("href", "#/");
  });

  test("each step marker tells a screen reader its state", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => films })));
    render(<ProjectsScreen />);
    const boat = await screen.findByRole("article", { name: "boat" });
    const steps = within(within(boat).getByRole("list", { name: "Steps" })).getAllByRole("listitem");
    expect(steps.map((li) => li.textContent)).toEqual(["Brief, done", "References, done", "Shots, current", "Finish, locked"]);
  });

  test("the Finder button's name starts with its visible text", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => films })));
    render(<ProjectsScreen />);
    const boat = await screen.findByRole("article", { name: "boat" });
    const button = within(boat).getByRole("button", { name: "Show in Finder: boat" });
    expect(button).toHaveTextContent(/^Show in Finder$/);
  });

  test("a card counts its shots and takes, leaving out what is zero", async () => {
    const fresh: FilmSummary = { ...films[0], run: "fresh", progress: prog({ counts: { shots: 2, stills: 0, takes: 0, outputs: 0 } }) };
    const empty: FilmSummary = { ...films[0], run: "empty", progress: prog({ counts: { shots: 0, stills: 0, takes: 0, outputs: 0 } }) };
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => [...films, fresh, empty] })));
    render(<ProjectsScreen />);
    expect(within(await screen.findByRole("article", { name: "boat" })).getByText("3 shots · 1 take")).toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "fresh" })).getByText("2 shots")).toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "empty" })).queryByText(/shot|take/)).toBeNull();
  });

  test("a search that matches nothing says so", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => films })));
    render(<ProjectsScreen />);
    await screen.findByRole("article", { name: "boat" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search films" }), { target: { value: "zzz" } });
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByText("No films match.")).toBeInTheDocument();
    expect(screen.queryByText(/No films yet/)).toBeNull();
  });
});
