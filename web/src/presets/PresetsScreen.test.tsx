import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PresetsScreen } from "./PresetsScreen";
import { getDraft, resetForTests } from "../studio/promptStore";
import { looksView, routes } from "../test-fixtures";

const kt = { id: "kinetic-typography", title: "Kinetic typography", tagline: "Let the words do the moving.", bestFor: null, durationS: 15, aspectRatio: "16:9", model: "minimax-h3", fidelity: "native", hasPrompt: true, still: "/media/presets/kinetic-typography.png" };
const plain = { ...kt, id: "plain", title: "Plain", still: null };

beforeEach(() => {
  resetForTests({}, "zed");
  window.location.hash = "#/presets";
  vi.stubGlobal(
    "fetch",
    vi.fn(routes({ "/api/looks": () => looksView, "/api/presets": () => [kt, plain], "/api/presets/kinetic-typography": () => ({ ...kt, prompt: "SOURCE PROMPT" }) })),
  );
});

describe("PresetsScreen", () => {
  test("Looks come first, by category, each saying what it adds; Use in Video sets the look and its chips", async () => {
    render(<PresetsScreen />);
    const grid = await screen.findByRole("list", { name: "Looks" });
    expect(within(grid).getByRole("heading", { name: "Neo-noir night" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("group", { name: "Category" })).getByRole("button", { name: "Social" }));
    expect(within(grid).queryByRole("heading", { name: "Neo-noir night" })).toBeNull();
    expect(within(grid).getByText("Shot on a phone.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use Phone selfie in Video" }));
    expect(window.location.hash).toBe("#/video");
    expect(getDraft()).toMatchObject({ look: "phone-selfie", picks: { size: "medium-close-up", move: "handheld" } });
  });

  test("an ad template with a still shows it; one without gets a text card", async () => {
    render(<PresetsScreen />);
    fireEvent.click(await screen.findByRole("tab", { name: /Ad templates/ }));
    expect(await screen.findByAltText("Kinetic typography: a frame of its source video")).toHaveAttribute("src", "/media/presets/kinetic-typography.png");
    expect(screen.getAllByText("Plain")).toHaveLength(2); // the text card and the heading
    expect(screen.getAllByText("minimax-h3 · 15s · 16:9")[0]).toHaveClass("mono");
  });

  test("Start from this prompt fills the prompt bar from the shared store and opens Video", async () => {
    render(<PresetsScreen />);
    fireEvent.click(await screen.findByRole("tab", { name: /Ad templates/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Use Kinetic typography" }));
    await waitFor(() => expect(window.location.hash).toBe("#/video"));
    expect(getDraft()).toMatchObject({ prompt: "SOURCE PROMPT", model: "minimax-h3", durationS: 15, aspectRatio: "16:9", preset: "kinetic-typography", look: null });
  });
});
