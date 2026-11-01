import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { StudioScreen } from "./StudioScreen";
import { resetForTests } from "./promptStore";
import { estimate, job, model, routes } from "../test-fixtures";

const older = job({ id: "j-20261031-aaaaaa", createdAt: "2026-10-31T09:00:00.000Z", prompt: "Older take." });
const newer = job({ id: "j-20261031-bbbbbb", createdAt: "2026-10-31T10:00:00.000Z", prompt: "Newer take.", durationS: 5, resolution: "720p" });

beforeEach(() => {
  resetForTests({}, "");
  localStorage.removeItem("shard.createTab");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      routes({
        "/api/runs": () => [{ run: "zed", modified: "", files: 2, takes: 2 }],
        "/api/models": () => [model(), model({ id: "suno-music", capability: "audio" })],
        "/api/library": () => [],
        "/api/vocab": () => ({ kinds: ["character"], roles: ["identity"] }),
        "/api/jobs": () => [newer, older],
        "/api/estimate": () => estimate(),
      }),
    ),
  );
});

describe("Create's tabs", () => {
  test("Scene is the default tab and shows the scene editor for Create's own run", async () => {
    render(<StudioScreen />);
    expect(screen.getByRole("tab", { name: "Scene" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Quick take" })).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByRole("textbox", { name: "Prompt" })).toBeNull();
    const asked = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(asked).toContain("/api/films/create/scenes");
  });

  test("Quick take still shows the prompt bar, and the choice is remembered", async () => {
    const { unmount } = render(<StudioScreen />);
    fireEvent.click(screen.getByRole("tab", { name: "Quick take" }));
    expect(await screen.findByRole("textbox", { name: "Prompt" })).toBeInTheDocument();
    expect(localStorage.getItem("shard.createTab")).toBe("quick");
    unmount();
    render(<StudioScreen />);
    expect(screen.getByRole("tab", { name: "Quick take" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("textbox", { name: "Prompt" })).toBeInTheDocument();
  });
});

describe("StudioScreen, Quick take", () => {
  beforeEach(() => localStorage.setItem("shard.createTab", "quick"));

  test("opens on the newest film and shows its takes, newest first", async () => {
    render(<StudioScreen />);
    expect(await screen.findByRole("combobox", { name: "Working in" })).toHaveValue("zed");
    const feed = screen.getByRole("region", { name: "Takes" });
    const opens = await within(feed).findAllByRole("button", { name: /^Open / });
    expect(opens.map((b) => b.getAttribute("aria-label"))).toEqual(["Open seedance-2-5 5s take: Newer take.", "Open seedance-2-5 4s take: Older take."]);
  });

  test("audio models are left out of the model chip", async () => {
    render(<StudioScreen />);
    const chip = await screen.findByRole("combobox", { name: "Model" });
    expect(within(chip).queryByRole("option", { name: "suno-music" })).toBeNull();
  });

  test("Reuse in the viewer fills the prompt bar", async () => {
    render(<StudioScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Open seedance-2-5 5s take: Newer take." }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reuse" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("Newer take.");
    expect(screen.getByRole("combobox", { name: "Duration" })).toHaveValue("5");
    expect(screen.getByRole("combobox", { name: "Resolution" })).toHaveValue("720p");
  });

  test("takes only: no storyboard switch and no chat of its own (the chat is the drawer)", async () => {
    render(<StudioScreen />);
    expect(await screen.findByRole("combobox", { name: "Working in" })).toHaveValue("zed");
    expect(screen.queryByRole("group", { name: "View" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Chat" })).toBeNull();
  });
});
