import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LibraryScreen } from "./LibraryScreen";
import { getDraft, resetForTests } from "../studio/promptStore";
import { job, routes } from "../test-fixtures";

const list = [
  { name: "zed", kind: "character", description: "Zed.", imageCount: 2, updatedAt: "", cover: "/media/library/zed/1.png", usedIn: ["zethus-hero"] },
  { name: "warm", kind: "style", description: "Warm light.", imageCount: 1, updatedAt: "", cover: null, usedIn: [] },
];
const zed = {
  name: "zed",
  kind: "character",
  description: "Zed, the mascot.",
  createdAt: "",
  updatedAt: "",
  images: [{ n: 1, file: "1.png", width: 512, height: 512, bytes: 10, mime: "image/png", url: "/media/library/zed/1.png" }],
  usedIn: ["zethus-hero"],
  takes: [job({ id: "j-20261031-cccccc", run: "zethus-hero" })],
};

function stub(extra: Record<string, (init?: RequestInit) => unknown> = {}) {
  const fetchMock = vi.fn(
    routes({
      "/api/library": () => list,
      "/api/vocab": () => ({ kinds: ["character", "product", "location", "style"], roles: ["identity", "style", "first_frame"] }),
      "/api/library/zed": () => zed,
      ...extra,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  resetForTests({}, "zed");
  window.location.hash = "#/library";
});

describe("LibraryScreen", () => {
  test("shows each asset's @name and filters by kind", async () => {
    stub();
    render(<LibraryScreen />);
    const grid = await screen.findByRole("list", { name: "Assets" });
    expect(await within(grid).findByText("@zed")).toHaveClass("mono");
    expect(within(grid).getByText("@warm")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "style" }));
    expect(within(grid).queryByText("@zed")).toBeNull();
    expect(within(grid).getByText("@warm")).toBeInTheDocument();
  });

  test("a refused drop shows core's reason", async () => {
    const refusal = () => new Response(JSON.stringify({ error: { code: 3, field: "file", message: "clip.mp4 is not an image file (checked by its content, not its name)." } }), { status: 400 });
    stub({ "/api/library/incoming": refusal });
    render(<LibraryScreen />);
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
    fireEvent.drop(screen.getByLabelText("Drop images here"), { dataTransfer: { files: [file] } });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("clip.mp4 is not an image file");
    // Nothing is savable: no "Save 0" button, and the refusal gets the card's width.
    expect(screen.queryByRole("button", { name: /as an asset/ })).toBeNull();
    expect(alert.closest("li")).toHaveAttribute("data-state", "refused");
  });

  test("an accepted drop saves as an asset with its upload token", async () => {
    const fetchMock = stub({ "/api/library/incoming": () => ({ token: "incoming:" + "a".repeat(32) + ".png", name: "zed.png", kind: "image", mime: "image/png", bytes: 3, width: 1, height: 1 }) });
    render(<LibraryScreen />);
    fireEvent.drop(screen.getByLabelText("Drop images here"), { dataTransfer: { files: [new File(["x"], "zed.png", { type: "image/png" })] } });
    fireEvent.click(await screen.findByRole("button", { name: "Save 1 as an asset" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "zed" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Zed, the mascot." } });
    fireEvent.click(screen.getByRole("button", { name: "Save 1 image" }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[0] === "/api/library" && c[1]?.method === "POST");
      expect(JSON.parse(post![1]!.body as string)).toMatchObject({ name: "zed", kind: "character", images: ["incoming:" + "a".repeat(32) + ".png"] });
    });
  });

  test("an asset's panel lists its films and takes, and Use in prompt adds an @asset chip", async () => {
    stub();
    render(<LibraryScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /@zed/ }));
    const panel = await screen.findByRole("region", { name: "@zed" });
    expect(within(panel).getByText("zethus-hero")).toBeInTheDocument();
    expect(within(panel).getByText(/seedance-2-5 · 4s · 480p/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Use in prompt" }));
    expect(getDraft().refs).toEqual([{ source: "zed", role: "identity" }]);
    expect(window.location.hash).toBe("#/create");
  });
});
