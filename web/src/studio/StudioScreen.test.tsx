import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { StudioScreen } from "./StudioScreen";
import { resetForTests } from "./promptStore";
import { assistantLine, chatSettings, estimate, job, model, routes } from "../test-fixtures";

const older = job({ id: "j-20261031-aaaaaa", createdAt: "2026-10-31T09:00:00.000Z", prompt: "Older take." });
const newer = job({ id: "j-20261031-bbbbbb", createdAt: "2026-10-31T10:00:00.000Z", prompt: "Newer take.", durationS: 5, resolution: "720p" });

beforeEach(() => {
  resetForTests({}, "");
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
        "/api/chat-settings": () => chatSettings({ backend: "codex" }),
        "/api/chat/zed": () => ({ film: "zed", busy: false, entries: [assistantLine("About $0.56.")] }),
      }),
    ),
  );
});

describe("StudioScreen", () => {
  test("opens on the newest film and shows its takes, newest first", async () => {
    render(<StudioScreen />);
    expect(await screen.findByRole("combobox", { name: "Working in" })).toHaveValue("zed");
    const feed = screen.getByRole("region", { name: "Takes" });
    const opens = await within(feed).findAllByRole("button", { name: /Open take/ });
    expect(opens.map((b) => b.getAttribute("aria-label"))).toEqual(["Open take j-20261031-bbbbbb", "Open take j-20261031-aaaaaa"]);
  });

  test("audio models are left out of the model chip", async () => {
    render(<StudioScreen />);
    const chip = await screen.findByRole("combobox", { name: "Model" });
    expect(within(chip).queryByRole("option", { name: "suno-music" })).toBeNull();
  });

  test("Reuse in the viewer fills the prompt bar", async () => {
    render(<StudioScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Open take j-20261031-bbbbbb" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reuse" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("Newer take.");
    expect(screen.getByRole("combobox", { name: "Duration" })).toHaveValue("5");
    expect(screen.getByRole("combobox", { name: "Resolution" })).toHaveValue("720p");
  });

  test("the chat panel works in the film the Studio is on", async () => {
    render(<StudioScreen />);
    const chat = screen.getByRole("complementary", { name: "Chat" });
    expect(await within(chat).findByText("zed")).toHaveClass("chat__film");
    expect(await within(chat).findByText("About $0.56.")).toBeInTheDocument();
  });
});
