// web/src/film/FilmWorkspace.test.tsx
import { describe, test, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { FilmWorkspace } from "./FilmWorkspace";
import { errorResponse, job, routes, task, toolLine } from "../test-fixtures";
import { emitForTests } from "../app/useStudio";
import { getRun, resetForTests } from "../studio/promptStore";
import type { FilmProgress } from "../api/types";

const progress = (over: Partial<FilmProgress> = {}): FilmProgress => ({
  step: "scenes",
  steps: { idea: "done", references: "done", scenes: "current", finish: "todo" },
  next: { text: "Draft scenes 2 and 3", step: "scenes" },
  counts: { scenes: 3, versions: 1, chosen: 1, outputs: 0 },
  spentUsd: 0.38,
  legacy: false,
  ...over,
});

const cards = { goal: "", scene: "", stages: [], style: "", audio: "" };
const scene = (id: string, over: Record<string, unknown> = {}) => ({ id, title: `Scene ${id}`, durationS: 8, ratio: "16:9", refs: [], cards, versions: [], chosen: null, ...over });
/** The film's routes: progress, its scenes and the Library. */
const film = (p: () => unknown = () => progress(), scenes: unknown[] = [], library: unknown[] = []) => ({
  "/api/films/boat/progress": p,
  "/api/films/boat/scenes": () => ({ idea: { text: "A boat at dawn", ratio: "16:9", lengthS: 20 }, scenes }),
  "/api/library": () => library,
});

beforeEach(() => {
  window.location.hash = "";
  resetForTests({}, "old-film");
});

const progressCalls = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.filter(([u]) => String(u) === "/api/films/boat/progress").length;

describe("FilmWorkspace", () => {
  test("with no step, goes to the film's current step", async () => {
    vi.stubGlobal("fetch", vi.fn(routes(film())));
    render(<FilmWorkspace slug="boat" step={null} />);
    await waitFor(() => expect(window.location.hash).toBe("#/films/boat/scenes"));
  });

  test("the step bar is Idea, References, Scenes, Finish; every step is a link and the one you are on is marked", async () => {
    vi.stubGlobal("fetch", vi.fn(routes(film())));
    render(<FilmWorkspace slug="boat" step="references" />);
    const bar = await screen.findByRole("list", { name: "Steps" });
    expect(within(bar).getAllByRole("link").map((a) => a.textContent)).toEqual(["Idea", "Cast", "3Scenes", "4Finish"]);
    expect(within(bar).getByRole("link", { name: /Idea/ })).toHaveAttribute("href", "#/films/boat/idea");
    expect(within(bar).getByRole("link", { name: /Cast/ })).toHaveAttribute("aria-current", "step");
  });

  test("References lists each Library item the scenes use, with a way to make a missing sheet", async () => {
    const scenes = [scene("s1", { cards: { ...cards, goal: "@library:skipper waves to @library:alex" } }), scene("s2", { refs: [{ id: "r1", source: "library:alex" }] })];
    const library = [{ name: "alex", kind: "character", description: "", imageCount: 1, hasSheet: true, cover: "/media/library/alex.png", updatedAt: "" }];
    vi.stubGlobal("fetch", vi.fn(routes(film(() => progress(), scenes, library))));
    render(<FilmWorkspace slug="boat" step="references" />);
    const list = await screen.findByRole("list", { name: "Library items" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector(".refs-row__name")?.textContent)).toEqual(["@library:skipper", "@library:alex"]);
    expect(within(rows[0]).getByText(/not in the Library/)).toBeInTheDocument();
    expect(within(rows[1]).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["#/films/boat/scenes/s1", "#/films/boat/scenes/s2"]);
    within(rows[0]).getByRole("button", { name: "Make @library:skipper" }).click();
    expect(window.location.hash).toBe("#/library/new/skipper");
    expect(JSON.parse(sessionStorage.getItem("shard.back") ?? "null")).toEqual({ hash: "#/", label: "Cast" });
  });

  test("Idea shows the idea and the scene list with the total against the target", async () => {
    vi.stubGlobal("fetch", vi.fn(routes(film(() => progress(), [scene("s1", { title: "Harbour", durationS: 6 }), scene("s2", { title: "Sail" })]))));
    render(<FilmWorkspace slug="boat" step="idea" />);
    const box = await screen.findByRole("textbox", { name: "What is the film about?" });
    await waitFor(() => expect(box).toHaveValue("A boat at dawn"));
    expect(await screen.findByRole("textbox", { name: "Scene 1 title" })).toHaveValue("Harbour");
    expect(screen.getByText("14s planned")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next: Cast" })).toHaveAttribute("href", "#/films/boat/references");
  });

  test("an unknown film says so", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(routes({ "/api/films/gone/progress": () => new Response(JSON.stringify({ error: { message: 'No run "gone".' } }), { status: 404 }) })),
    );
    render(<FilmWorkspace slug="gone" step="scenes" />);
    expect(await screen.findByRole("alert")).toHaveTextContent('No run "gone".');
  });

  test("progress is read again for this film's job, task and chat tool events, and on hello, but not for another film's", async () => {
    const fetch = vi.fn(routes(film()));
    vi.stubGlobal("fetch", fetch);
    render(<FilmWorkspace slug="boat" step="references" />);
    await screen.findByRole("heading", { name: "Cast & props" });
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
    vi.stubGlobal("fetch", vi.fn(routes(film(() => (fail ? errorResponse(500, "Server hiccup.") : progress())))));
    render(<FilmWorkspace slug="boat" step="references" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Server hiccup.");
    fail = false;
    act(() => emitForTests({ event: "hello", data: { at: "2026-10-31T10:00:00.000Z" } }));
    expect(await screen.findByRole("heading", { name: "Cast & props" })).toBeInTheDocument();
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
    await act(async () => answers[1](new Response(JSON.stringify(progress({ next: { text: "Newer", step: "scenes" } })))));
    expect(await screen.findByRole("link", { name: "Newer" })).toBeInTheDocument();
    await act(async () => answers[0](new Response(JSON.stringify(progress({ next: { text: "Older", step: "scenes" } })))));
    expect(screen.getByRole("link", { name: "Newer" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Older" })).toBeNull();
  });

  test("Create is pointed at the film only once its progress loads", async () => {
    vi.stubGlobal("fetch", vi.fn(routes(film())));
    render(<FilmWorkspace slug="boat" step="references" />);
    expect(getRun()).toBe("old-film");
    await screen.findByRole("heading", { name: "Cast & props" });
    expect(getRun()).toBe("boat");
  });

  test("a film whose progress fails does not become Create's film", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/gone/progress": () => errorResponse(400, 'No run "gone".', { code: 3 }) })));
    render(<FilmWorkspace slug="gone" step="scenes" />);
    await screen.findByRole("alert");
    expect(getRun()).toBe("old-film");
  });
});
