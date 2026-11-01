// web/src/home/HomeScreen.test.tsx
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { HomeScreen } from "./HomeScreen";
import { errorResponse, routes } from "../test-fixtures";
import type { FilmSummary } from "../api/types";

const film = (run: string, modified: string): FilmSummary => ({ run, modified, files: 1, takes: 1, cover: null, progress: null });

// As /api/films returns them: newest first.
const films = [
  film("film-e", "2026-10-31T10:00:00.000Z"),
  film("film-d", "2026-10-30T10:00:00.000Z"),
  film("film-c", "2026-10-29T10:00:00.000Z"),
  film("film-b", "2026-10-28T10:00:00.000Z"),
  film("film-a", "2026-10-27T10:00:00.000Z"),
];

// The shape of GET /api/director/menu (only the fields Home reads, plus the rest of the real ones).
const entry = (id: string, label: string) => ({ id, label, chapter: `${id}.md`, when: "" });
const menu = {
  menu: {
    filmTypes: [entry("product-ui", "Product ad with UI"), entry("live-action", "Live-action look"), entry("character", "Character animation"), entry("product-hero", "Product hero")],
  },
  groups: ["filmTypes"],
  aspects: ["16:9", "9:16", "1:1", "21:9"],
  maxFilmS: 120,
  videoModels: [],
  imageModels: [],
};

beforeEach(() => {
  window.location.hash = "";
});

describe("HomeScreen", () => {
  test("shows the four newest films and a link to all projects", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => films, "/api/director/menu": () => menu })));
    render(<HomeScreen />);
    const recent = await screen.findByRole("region", { name: "Recent films" });
    await waitFor(() => expect(within(recent).getAllByRole("article")).toHaveLength(4));
    expect(within(recent).getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["film-e", "film-d", "film-c", "film-b"]);
    expect(screen.getByRole("link", { name: "See all projects" })).toHaveAttribute("href", "#/projects");
  });

  test("Start film saves the idea under a slug from its words and opens it on Idea", async () => {
    // The first four words are "rain on glass a", so that name is taken and the new film gets -2.
    const put = vi.fn(() => ({}));
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => [film("rain-on-glass-a", "2026-10-31T10:00:00.000Z")], "/api/director/menu": () => menu, "/api/films/rain-on-glass-a-2/idea": put })));
    render(<HomeScreen />);
    await screen.findByRole("article", { name: "rain-on-glass-a" }); // the film list has loaded
    fireEvent.change(await screen.findByRole("textbox", { name: "What is the film about?" }), { target: { value: "Rain on glass, a cup going cold" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Length" }), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Start film" }));
    await waitFor(() => expect(window.location.hash).toBe("#/films/rain-on-glass-a-2/idea"));
    const body = JSON.parse(String((put.mock.calls[0] as unknown as [RequestInit])[0].body));
    expect(body).toEqual({ idea: { text: "Rain on glass, a cup going cold", ratio: "16:9", lengthS: 8 }, create: true });
  });

  test("Start film waits for the film list, which its name must not clash with", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/director/menu": () => menu }))); // /api/films never answers
    render(<HomeScreen />);
    fireEvent.change(screen.getByRole("textbox", { name: "What is the film about?" }), { target: { value: "Rain on glass" } });
    await new Promise((r) => setTimeout(r, 20)); // the list never answers
    expect(screen.getByRole("button", { name: "Start film" })).toBeDisabled();
  });

  test("a film list that fails to load says so, and Start film stays off", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => errorResponse(500, "disk full"), "/api/director/menu": () => menu })));
    render(<HomeScreen />);
    fireEvent.change(screen.getByRole("textbox", { name: "What is the film about?" }), { target: { value: "Rain on glass" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your films, so a new one can't be named yet: disk full");
    expect(screen.getByRole("button", { name: "Start film" })).toBeDisabled();
  });

  test("Start film waits for words", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => [], "/api/director/menu": () => menu })));
    render(<HomeScreen />);
    expect(await screen.findByRole("button", { name: "Start film" })).toBeDisabled();
  });

  test("a name taken since the list loaded: reads the list again and starts the film under the next free name", async () => {
    let lists = 0;
    const taken = vi.fn(() => errorResponse(409, "runs/rain-on-glass already exists; a new film needs a name of its own.", { exists: true }));
    const put = vi.fn(() => ({}));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        routes({
          // Another tab made rain-on-glass after this page read the list.
          "/api/films": () => (++lists === 1 ? [] : [film("rain-on-glass", "2026-10-31T10:00:00.000Z")]),
          "/api/director/menu": () => menu,
          "/api/films/rain-on-glass/idea": taken,
          "/api/films/rain-on-glass-2/idea": put,
        }),
      ),
    );
    render(<HomeScreen />);
    const box = screen.getByRole("textbox", { name: "What is the film about?" });
    fireEvent.change(box, { target: { value: "Rain on glass" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Start film" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Start film" }));
    await waitFor(() => expect(window.location.hash).toBe("#/films/rain-on-glass-2/idea"));
    expect(taken).toHaveBeenCalledTimes(1);
    expect(lists).toBe(2);
    expect(JSON.parse(String((put.mock.calls[0] as unknown as [RequestInit])[0].body)).create).toBe(true);
  });

  test("refused twice: says why and stays on Home", async () => {
    const taken = (slug: string) => () => errorResponse(409, `runs/${slug} already exists; a new film needs a name of its own.`, { exists: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        routes({
          "/api/films": () => [],
          "/api/director/menu": () => menu,
          "/api/films/rain-on-glass/idea": taken("rain-on-glass"),
          "/api/films/rain-on-glass-2/idea": taken("rain-on-glass-2"),
        }),
      ),
    );
    render(<HomeScreen />);
    fireEvent.change(screen.getByRole("textbox", { name: "What is the film about?" }), { target: { value: "Rain on glass" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Start film" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Start film" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("runs/rain-on-glass-2 already exists");
    expect(window.location.hash).toBe("");
    expect(screen.getByRole("button", { name: "Start film" })).toBeEnabled();
  });
});
