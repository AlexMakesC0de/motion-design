// web/src/film/FilmWorkspace.test.tsx
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { FilmWorkspace } from "./FilmWorkspace";
import { routes } from "../test-fixtures";
import type { FilmProgress } from "../api/types";

const progress = (over: Partial<FilmProgress> = {}): FilmProgress => ({
  step: "shots",
  steps: { brief: "done", references: "done", shots: "current", finish: "locked" },
  next: { text: "Film s2 and s3", step: "shots" },
  counts: { shots: 3, stills: 3, takes: 1, outputs: 0 },
  spentUsd: 0.38,
  legacy: false,
  ...over,
});

beforeEach(() => {
  window.location.hash = "";
});

describe("FilmWorkspace", () => {
  test("with no step, goes to the film's current step", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/boat/progress": () => progress() })));
    render(<FilmWorkspace slug="boat" step={null} />);
    await waitFor(() => expect(window.location.hash).toBe("#/films/boat/shots"));
  });

  test("the step bar is an ordered list: done and current steps are links, a locked one says why", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/boat/progress": () => progress() })));
    render(<FilmWorkspace slug="boat" step="references" />);
    const bar = await screen.findByRole("list", { name: "Steps" });
    expect(within(bar).getByRole("link", { name: /Brief/ })).toHaveAttribute("href", "#/films/boat/brief");
    expect(within(bar).getByRole("link", { name: /References/ })).toHaveAttribute("aria-current", "step");
    expect(within(bar).queryByRole("link", { name: /Finish/ })).toBeNull();
    expect(within(bar).getByText("Finish").closest("li")).toHaveAttribute("title", "Locked: Film s2 and s3 first.");
  });

  test("References says it is coming and points to Shots", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/boat/progress": () => progress() })));
    render(<FilmWorkspace slug="boat" step="references" />);
    expect(await screen.findByRole("heading", { name: "References" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Shots" })).toHaveAttribute("href", "#/films/boat/shots");
  });

  test("an unknown film says so", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(routes({ "/api/films/gone/progress": () => new Response(JSON.stringify({ error: { message: 'No run "gone".' } }), { status: 404 }) })),
    );
    render(<FilmWorkspace slug="gone" step="shots" />);
    expect(await screen.findByRole("alert")).toHaveTextContent('No run "gone".');
  });
});
