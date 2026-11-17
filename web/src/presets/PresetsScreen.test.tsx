import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PresetsScreen } from "./PresetsScreen";
import { getDraft, resetForTests } from "../studio/promptStore";
import { routes } from "../test-fixtures";

const kt = { id: "kinetic-typography", title: "Kinetic typography", tagline: "Let the words do the moving.", bestFor: null, durationS: 15, aspectRatio: "16:9", model: "minimax-h3", fidelity: "native", hasPrompt: true, still: "/media/presets/kinetic-typography.png" };
const plain = { ...kt, id: "plain", title: "Plain", still: null };

beforeEach(() => {
  resetForTests({}, "zed");
  window.location.hash = "#/presets";
  vi.stubGlobal(
    "fetch",
    vi.fn(routes({ "/api/presets": () => [kt, plain], "/api/presets/kinetic-typography": () => ({ ...kt, prompt: "SOURCE PROMPT" }) })),
  );
});

describe("PresetsScreen", () => {
  test("a preset with a still shows it; one without gets a text card", async () => {
    render(<PresetsScreen />);
    expect(await screen.findByAltText("Kinetic typography: a frame of its source video")).toHaveAttribute("src", "/media/presets/kinetic-typography.png");
    expect(screen.getAllByText("Plain")).toHaveLength(2); // the text card and the heading
    expect(screen.getAllByText("minimax-h3 · 15s · 16:9")[0]).toHaveClass("mono");
  });

  test("Use this fills the prompt bar from the shared store and opens Video", async () => {
    render(<PresetsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Use Kinetic typography" }));
    await waitFor(() => expect(window.location.hash).toBe("#/video"));
    expect(getDraft()).toMatchObject({ prompt: "SOURCE PROMPT", model: "minimax-h3", durationS: 15, aspectRatio: "16:9", preset: "kinetic-typography" });
  });
});
