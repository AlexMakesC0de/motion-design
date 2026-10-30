import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

beforeEach(() => {
  window.location.hash = "";
});

describe("App", () => {
  test("shows the six tabs and marks the current one", () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));
    render(<App />);
    for (const name of ["Studio", "Library", "Presets", "Films", "Spend", "Settings"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Studio" })).toHaveAttribute("aria-current", "page");
  });

  test("each built tab shows its screen; the rest keep their placeholder", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));
    window.location.hash = "#/presets";
    const { unmount } = render(<App />);
    expect(screen.getByRole("heading", { name: "Presets" })).toBeInTheDocument();
    unmount();
    window.location.hash = "#/spend";
    render(<App />);
    expect(screen.getByRole("heading", { name: "Spend" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Jobs" })).toBeInTheDocument();
    expect(screen.queryByText("Daily totals and every job will show here.")).toBeNull();
  });

  test("#/films/<name> opens that film's page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));
    window.location.hash = "#/films/zed";
    render(<App />);
    expect(screen.getByRole("heading", { name: "zed" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Films" })).toHaveAttribute("aria-current", "page");
  });

  test("the Studio is the default screen, with its prompt bar", () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));
    render(<App />);
    expect(screen.getByRole("textbox", { name: "Prompt" })).toBeInTheDocument();
  });

  test("shows the server-down banner when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("npm run studio");
  });
});
