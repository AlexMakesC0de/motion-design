import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LibraryScreen } from "./LibraryScreen";
import { routes } from "../test-fixtures";

const list = [
  { name: "alexandros", kind: "character", description: "Alex.", imageCount: 3, hasSheet: false, updatedAt: "", cover: "/media/library/alexandros/1.png", usedIn: ["skydive"] },
  { name: "jumpsuit", kind: "product", description: "A jumpsuit.", imageCount: 1, hasSheet: true, updatedAt: "", cover: "/media/library/jumpsuit/1.png", usedIn: [] },
  { name: "alley", kind: "location", description: "An alley.", imageCount: 1, hasSheet: true, updatedAt: "", cover: "/media/library/alley/1.png", usedIn: ["a", "b"] },
];
const alexandros = {
  name: "alexandros", kind: "character", description: "Alex.", keep: null, createdAt: "", updatedAt: "",
  images: [{ n: 1, role: "source", file: "1.png", width: 1, height: 1, bytes: 1, mime: "image/png", url: "/media/library/alexandros/1.png" }],
  usedIn: ["skydive"], takes: [],
};

beforeEach(() => {
  window.location.hash = "#/library";
  vi.stubGlobal(
    "fetch",
    vi.fn(
      routes({
        "/api/library": () => list,
        "/api/library/alexandros": () => alexandros,
        "/api/library/sheet-prompt": () => ({ prompt: "A three-panel character reference sheet…" }),
      }),
    ),
  );
});

describe("LibraryScreen", () => {
  test("a visit from a scene offers the way back to it, and leaving the Library forgets it", async () => {
    sessionStorage.setItem("shard.back", JSON.stringify({ hash: "#/films/boat/scenes/s2", label: "the scene" }));
    const { unmount } = render(<LibraryScreen newName="skipper" />);
    expect(await screen.findByRole("link", { name: "← Back to the scene" })).toHaveAttribute("href", "#/films/boat/scenes/s2");
    unmount();
    expect(sessionStorage.getItem("shard.back")).toBeNull();
    render(<LibraryScreen />);
    await screen.findByRole("list", { name: "Library" });
    expect(screen.queryByRole("link", { name: /Back to/ })).toBeNull();
  });

  test("cards show @library:name, the kind as people say it, and whether there is a sheet", async () => {
    render(<LibraryScreen />);
    const grid = await screen.findByRole("list", { name: "Library" });
    expect(await within(grid).findByText("@library:jumpsuit")).toHaveClass("mono");
    expect(within(grid).getByText(/^Prop ·/)).toBeInTheDocument();
    expect(within(grid).getByText("no sheet yet")).toBeInTheDocument();
    expect(within(grid).getByText(/in 2 films/)).toBeInTheDocument();
  });

  test("tabs filter by kind and show counts", async () => {
    render(<LibraryScreen />);
    const grid = await screen.findByRole("list", { name: "Library" });
    await within(grid).findByText("@library:alley");
    fireEvent.click(screen.getByRole("button", { name: /Props\s*1/ }));
    expect(within(grid).queryByText("@library:alley")).toBeNull();
    expect(within(grid).getByText("@library:jumpsuit")).toBeInTheDocument();
  });

  test("+ New sheet opens the sheet maker; a card opens it for that item", async () => {
    render(<LibraryScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /New sheet/ }));
    expect(screen.getByRole("dialog", { name: "New sheet" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /@library:alexandros/ }));
    expect(await screen.findByRole("dialog", { name: "@library:alexandros" })).toBeInTheDocument();
  });

  test("newName opens New sheet with the Name filled in", async () => {
    render(<LibraryScreen newName="maya" />);
    expect(await screen.findByRole("dialog", { name: "New sheet" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("maya");
  });

  test("Remove asks first, saying where it is used and that it can be put back", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        routes({
          "/api/library": () => list,
          "/api/library/alexandros": (init) => {
            calls.push(init?.method ?? "GET");
            return init?.method === "DELETE" ? { name: "alexandros", trashed: ".trash/alexandros-20261101T102030Z" } : alexandros;
          },
          "/api/library/sheet-prompt": () => ({ prompt: "" }),
        }),
      ),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<LibraryScreen item="alexandros" />);
    const panel = await screen.findByRole("dialog", { name: "@library:alexandros" });
    fireEvent.click(within(panel).getByRole("button", { name: "Remove @library:alexandros from the Library" }));
    expect(confirm).toHaveBeenLastCalledWith(
      "Remove @library:alexandros? It is used in 1 film; scenes that mention it will show it in red. Its files move to library/.trash, so it can be put back.",
    );
    expect(calls).not.toContain("DELETE");
    fireEvent.click(within(panel).getByRole("button", { name: "Remove @library:alexandros from the Library" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "@library:alexandros" })).toBeNull());
    expect(calls).toContain("DELETE");
    confirm.mockRestore();
  });

  test("the sheet maker floats over the grid and Esc or the dimmed page closes it", async () => {
    const { container } = render(<LibraryScreen />);
    const card = await screen.findByRole("button", { name: /@library:alexandros/ });
    fireEvent.click(card);
    const pop = await screen.findByRole("dialog", { name: "@library:alexandros" });
    expect(pop).toHaveAttribute("aria-modal", "true");
    expect(container.querySelector(".library")).not.toHaveAttribute("data-open");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(card).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: /New sheet/ }));
    fireEvent.mouseDown(container.querySelector(".library-pop__scrim")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("item opens that item's sheet", async () => {
    render(<LibraryScreen item="alexandros" />);
    expect(await screen.findByRole("dialog", { name: "@library:alexandros" })).toBeInTheDocument();
  });
});
