import { describe, test, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FilmPage, shotOrder } from "./FilmPage";
import { emitForTests } from "../app/useStudio";
import { film, filmFile, finishInfo, job, routes, task } from "../test-fixtures";

describe("shotOrder", () => {
  test("keeps the last assembly's order, then adds new takes oldest first", () => {
    const files = [
      filmFile({ name: "a.mp4", modified: "2026-10-31T10:00:00.000Z" }),
      filmFile({ name: "b.mp4", modified: "2026-10-31T10:01:00.000Z" }),
      filmFile({ name: "c.mp4", modified: "2026-10-31T10:02:00.000Z" }),
      filmFile({ name: "film.mp4", origin: "film" }),
      filmFile({ name: "still.png", kind: "image" }),
    ];
    expect(shotOrder(files, ["c.mp4", "gone.mp4", "a.mp4"])).toEqual(["c.mp4", "a.mp4", "b.mp4"]);
  });
});

describe("FilmPage", () => {
  test("lists the takes as shots that move up and down and can be left out", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/zed": () => film() })));
    render(<FilmPage slug="zed" />);
    const shots = await screen.findByRole("list", { name: "Shots" });
    const names = () =>
      within(shots)
        .getAllByRole("listitem")
        .map((li) => li.querySelector(".mono")?.textContent);
    expect(names()).toEqual(["out.mp4", "out-2.mp4"]);
    expect(screen.getByRole("button", { name: "Move out.mp4 up" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move out.mp4 down" }));
    expect(names()).toEqual(["out-2.mp4", "out.mp4"]);
    expect(screen.getByRole("button", { name: "Move out.mp4 down" })).toBeDisabled();
    const use = screen.getByRole("checkbox", { name: "Use out-2.mp4" });
    expect(use).toBeChecked();
    fireEvent.click(use);
    expect(use).not.toBeChecked();
    expect(screen.getByText("1 of 2 shots chosen")).toBeInTheDocument();
  });

  test("Assemble takes the chosen shots in the order shown", async () => {
    const fetch = vi.fn(
      routes({
        "/api/films/zed": () => film(),
        "/api/finish": () => finishInfo(),
        "/api/tasks": () => [],
        "/api/films/zed/assemble": () => ({ task: task() }),
      }),
    );
    vi.stubGlobal("fetch", fetch);
    render(<FilmPage slug="zed" />);
    fireEvent.click(await screen.findByRole("button", { name: "Move out.mp4 down" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Use out.mp4" }));
    fireEvent.click(await screen.findByRole("button", { name: "Assemble" }));
    await waitFor(() => expect(fetch.mock.calls.some(([p]) => String(p) === "/api/films/zed/assemble")).toBe(true));
    const [, init] = fetch.mock.calls.find(([p]) => String(p) === "/api/films/zed/assemble")!;
    expect(JSON.parse(String(init!.body)).shots).toEqual(["out-2.mp4"]);
  });

  test("shows a take's cost from its job, in mono", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/zed": () => film({ files: [filmFile({ job: job({ actualUsd: 0.5 }) })] }) })));
    render(<FilmPage slug="zed" />);
    const cost = await screen.findByText("$0.50");
    expect(cost).toHaveClass("mono");
  });

  test("each shot says which take it is: model, duration, ratio and the prompt on one line", async () => {
    const take = job({ model: "minimax-h3", durationS: 6, aspectRatio: "9:16", prompt: "Ink drop blooms into the Zethus wordmark" });
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/zed": () => film({ files: [filmFile({ job: take }), filmFile({ name: "out-2.mp4", url: "/media/runs/zed/out-2.mp4", modified: "2026-10-31T10:05:00.000Z" })] }) })));
    render(<FilmPage slug="zed" />);
    const shots = await screen.findByRole("list", { name: "Shots" });
    const [first, second] = within(shots).getAllByRole("listitem");
    const detail = within(first).getByText("minimax-h3 · 6s · 9:16").closest("p")!;
    expect(detail).toHaveClass("shot__detail", "mono");
    expect(detail).toHaveTextContent("minimax-h3 · 6s · 9:16 · Ink drop blooms into the Zethus wordmark");
    expect(detail).toHaveAttribute("title", "Ink drop blooms into the Zethus wordmark");
    // A file with no job record has nothing to add, and its name is still the first mono text.
    expect(second.querySelector(".shot__detail")).toBeNull();
    expect(second.querySelector(".mono")).toHaveTextContent("out-2.mp4");
  });

  test("gives every output a player and a download link", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/zed": () => film() })));
    render(<FilmPage slug="zed" />);
    const outputs = await screen.findByRole("list", { name: "Outputs" });
    const item = within(outputs).getByRole("listitem");
    expect(item.querySelector("video")).toHaveAttribute("src", "/media/runs/zed/film.mp4");
    expect(item.querySelector("video")).toHaveAttribute("controls");
    const link = within(item).getByRole("link", { name: "Download film.mp4" });
    expect(link).toHaveAttribute("href", "/media/runs/zed/film.mp4");
    expect(link).toHaveAttribute("download", "film.mp4");
  });

  test("says so when nothing is finished yet", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/zed": () => film({ files: [filmFile()] }) })));
    render(<FilmPage slug="zed" />);
    expect(await screen.findByText(/Nothing finished yet/)).toBeInTheDocument();
  });

  test("reads the film again when a take lands in it", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/zed": () => (++calls === 1 ? film({ files: [filmFile()] }) : film()) })));
    render(<FilmPage slug="zed" />);
    await screen.findByText("out.mp4");
    act(() => emitForTests({ event: "job", data: job({ run: "other" }) }));
    act(() => emitForTests({ event: "job", data: job({ state: "succeeded" }) }));
    expect(await screen.findByText("out-2.mp4")).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  test("shows core's message for a film that does not exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(routes({ "/api/films/nope": () => new Response(JSON.stringify({ error: { code: 3, message: "No run named nope." } }), { status: 400 }) })),
    );
    render(<FilmPage slug="nope" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No run named nope.");
  });
});
