// web/src/film/IdeaStep.test.tsx
import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { App } from "../app/App";
import { resetChatForTests } from "../chat/chatStore";
import { resetForTests } from "../studio/promptStore";
import { chatSettings, routes } from "../test-fixtures";

let calls: { path: string; method: string; body: unknown }[] = [];
function stub(table: Record<string, (init?: RequestInit) => unknown>) {
  calls = [];
  const inner = routes(table);
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ path: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return inner(input, init);
    }),
  );
}
const sent = (path: string, method = "POST") => calls.filter((c) => c.path === path && c.method === method);

const progress = {
  step: "idea",
  steps: { idea: "current", references: "todo", scenes: "todo", finish: "todo" },
  next: { text: "Plan the scenes", step: "idea" },
  counts: { scenes: 0, versions: 0, chosen: 0, outputs: 0 },
  spentUsd: 0,
  legacy: false,
};

describe("a film's Idea step in the shell", () => {
  beforeEach(() => {
    resetForTests({}, "");
    localStorage.clear();
    resetChatForTests();
  });

  test("an old Brief link lands on Idea; Copy plan for Claude Code copies the request", async () => {
    stub({
      "/api/films/zed/progress": () => progress,
      "/api/films/zed/scenes": () => ({ idea: { text: "A calm inbox", ratio: "9:16", lengthS: 20 }, scenes: [] }),
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    window.location.hash = "#/films/zed/brief";
    const { unmount } = render(<App />);
    await waitFor(() => expect(window.location.hash).toBe("#/films/zed/idea"));
    const box = await screen.findByRole("textbox", { name: "What is the film about?" });
    await waitFor(() => expect(box).toHaveValue("A calm inbox"));
    fireEvent.click(screen.getByRole("button", { name: "Copy plan for Claude Code" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toMatch(/^Plan the scenes for this film and save them with save_idea/);
    expect(text).toMatch(/9:16, about 20s in total: A calm inbox$/);
    expect(await screen.findByText(/Paste it into Claude Code or Codex/)).toBeInTheDocument();
    expect(sent("/api/films/zed/idea", "PUT")).toHaveLength(0); // the idea had not changed, so nothing was saved first
    unmount();
    window.location.hash = "";
  });
});
