import { describe, test, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { FilmsScreen } from "./FilmsScreen";
import { routes } from "../test-fixtures";

const films = [
  { run: "zed", modified: "2026-10-31T10:09:00.000Z", files: 5, takes: 2, cover: { kind: "video", url: "/media/runs/zed/film.mp4" } },
  { run: "old-stuff", modified: "2026-10-20T08:00:00.000Z", files: 0, takes: 0, cover: null },
];

describe("FilmsScreen", () => {
  test("lists each run folder as a link to its film page, with its cover and take count", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => films })));
    render(<FilmsScreen />);
    const zed = await screen.findByRole("link", { name: /zed/ });
    expect(zed).toHaveAttribute("href", "#/films/zed");
    expect(within(zed).getByText("2 takes")).toBeInTheDocument();
    expect(zed.querySelector("video")).toHaveAttribute("src", "/media/runs/zed/film.mp4");
    const old = screen.getByRole("link", { name: /old-stuff/ });
    expect(within(old).getByText("0 takes")).toBeInTheDocument();
    expect(old.querySelector("video, img")).toBeNull();
  });

  test("says where films come from when there are none", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => [] })));
    render(<FilmsScreen />);
    expect(await screen.findByText(/No films yet/)).toBeInTheDocument();
  });

  test("opens the film page when the route names a film", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/zed": () => ({ run: "zed", prompt: null, files: [], order: [] }) })));
    render(<FilmsScreen slug="zed" />);
    expect(await screen.findByRole("heading", { name: "zed" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All films" })).toHaveAttribute("href", "#/films");
  });
});
