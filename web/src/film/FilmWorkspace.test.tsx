// web/src/film/FilmWorkspace.test.tsx
import { describe, test, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { FilmWorkspace } from "./FilmWorkspace";
import { errorResponse, job, routes, task, toolLine } from "../test-fixtures";
import { emitForTests } from "../app/useStudio";
import { getRun, resetForTests } from "../studio/promptStore";
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
  resetForTests({}, "old-film");
});

const progressCalls = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.filter(([u]) => String(u) === "/api/films/boat/progress").length;

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

  test("progress is read again for this film's job, task and chat tool events, and on hello, but not for another film's", async () => {
    const fetch = vi.fn(routes({ "/api/films/boat/progress": () => progress() }));
    vi.stubGlobal("fetch", fetch);
    render(<FilmWorkspace slug="boat" step="references" />);
    await screen.findByRole("heading", { name: "References" });
    expect(progressCalls(fetch)).toBe(1);

    act(() => {
      emitForTests({ event: "job", data: job({ run: "other" }) });
      emitForTests({ event: "task", data: task({ run: "other", state: "done" }) });
      emitForTests({ event: "task", data: task({ run: "boat", state: "running" }) });
      emitForTests({ event: "chat", data: { film: "other", busy: false, entry: toolLine() } });
      emitForTests({ event: "chat", data: { film: "boat", busy: true, entry: toolLine({ state: "running" }) } });
    });
    expect(progressCalls(fetch)).toBe(1);

    act(() => emitForTests({ event: "job", data: job({ run: "boat" }) }));
    expect(progressCalls(fetch)).toBe(2);
    act(() => emitForTests({ event: "task", data: task({ run: "boat", state: "done" }) }));
    expect(progressCalls(fetch)).toBe(3);
    act(() => emitForTests({ event: "chat", data: { film: "boat", busy: false, entry: toolLine() } }));
    expect(progressCalls(fetch)).toBe(4);
    act(() => emitForTests({ event: "hello", data: { at: "2026-10-31T10:00:00.000Z" } }));
    expect(progressCalls(fetch)).toBe(5);
  });

  test("an error clears when a later read succeeds", async () => {
    let fail = true;
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/boat/progress": () => (fail ? errorResponse(500, "Server hiccup.") : progress()) })));
    render(<FilmWorkspace slug="boat" step="references" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Server hiccup.");
    fail = false;
    act(() => emitForTests({ event: "hello", data: { at: "2026-10-31T10:00:00.000Z" } }));
    expect(await screen.findByRole("heading", { name: "References" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("an older answer that arrives late does not replace a newer one", async () => {
    const answers: ((r: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => answers.push(resolve))),
    );
    render(<FilmWorkspace slug="boat" step="references" />);
    await waitFor(() => expect(answers).toHaveLength(1));
    act(() => emitForTests({ event: "job", data: job({ run: "boat" }) }));
    await waitFor(() => expect(answers).toHaveLength(2));
    await act(async () => answers[1](new Response(JSON.stringify(progress({ next: { text: "Newer", step: "shots" } })))));
    expect(await screen.findByRole("link", { name: "Newer" })).toBeInTheDocument();
    await act(async () => answers[0](new Response(JSON.stringify(progress({ next: { text: "Older", step: "shots" } })))));
    expect(screen.getByRole("link", { name: "Newer" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Older" })).toBeNull();
  });

  test("Create is pointed at the film only once its progress loads", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/boat/progress": () => progress() })));
    render(<FilmWorkspace slug="boat" step="references" />);
    expect(getRun()).toBe("old-film");
    await screen.findByRole("heading", { name: "References" });
    expect(getRun()).toBe("boat");
  });

  test("a film whose progress fails does not become Create's film", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/gone/progress": () => errorResponse(400, 'No run "gone".', { code: 3 }) })));
    render(<FilmWorkspace slug="gone" step="shots" />);
    await screen.findByRole("alert");
    expect(getRun()).toBe("old-film");
  });
});
