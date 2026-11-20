import { describe, test, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SheetMaker } from "./SheetMaker";
import { routes } from "../test-fixtures";
import type { AssetDetail } from "../api/types";

const token = "incoming:" + "b".repeat(32) + ".png";
const saved: AssetDetail = {
  name: "jumpsuit", kind: "product", description: "A neon green jumpsuit.", keep: "the chest logo", createdAt: "", updatedAt: "",
  images: [{ n: 1, role: "sheet", file: "1.png", width: 900, height: 300, bytes: 3, mime: "image/png", url: "/media/library/jumpsuit/1.png" }],
  usedIn: [], takes: [],
};

function stub(extra: Record<string, (init?: RequestInit) => unknown> = {}) {
  const fetchMock = vi.fn(
    routes({
      "/api/library/sheet-prompt": () => ({ prompt: "Two views of the same object: FRONT view on the left…" }),
      "/api/library/incoming": () => ({ token, name: "sheet.png", kind: "image", mime: "image/png", bytes: 3, width: 900, height: 300 }),
      "/api/library": () => saved,
      ...extra,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("SheetMaker", () => {
  test("shows the filled prompt and copies it for ChatGPT", async () => {
    const fetchMock = stub();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<SheetMaker asset={null} onSaved={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Prop" }));
    fill("Name", "jumpsuit");
    fill("What it is", "A neon green jumpsuit");
    fireEvent.click(screen.getByRole("tab", { name: "ChatGPT (free)" }));
    expect(await screen.findByText(/Two views of the same object/)).toBeInTheDocument();
    const call = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith("/api/library/sheet-prompt"));
    expect(call).toContain("kind=product");
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt for ChatGPT" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Two views of the same object: FRONT view on the left…"));
    expect(await screen.findByText("Copied. Paste it into ChatGPT.")).toBeInTheDocument();
  });

  test("dropping the sheet saves the asset with the sheet first and the keep line", async () => {
    const fetchMock = stub();
    const onSaved = vi.fn();
    render(<SheetMaker asset={null} onSaved={onSaved} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Prop" }));
    fill("Name", "jumpsuit");
    fill("What it is", "A neon green jumpsuit");
    fill("When a scene uses it, keep", "the chest logo");
    fireEvent.click(screen.getByRole("tab", { name: "I have one" }));
    fireEvent.drop(screen.getByLabelText("Drop the sheet here"), { dataTransfer: { files: [new File(["x"], "sheet.png", { type: "image/png" })] } });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    const post = fetchMock.mock.calls.find((c) => c[0] === "/api/library" && c[1]?.method === "POST");
    expect(JSON.parse(post![1]!.body as string)).toEqual({
      name: "jumpsuit", kind: "product", description: "A neon green jumpsuit", keep: "the chest logo", heightCm: null,
      images: [{ src: token, role: "sheet" }],
    });
  });

  test("a sheet dropped before the name is filled waits, with the reason", async () => {
    stub();
    render(<SheetMaker asset={null} onSaved={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "I have one" }));
    fireEvent.drop(screen.getByLabelText("Drop the sheet here"), { dataTransfer: { files: [new File(["x"], "sheet.png", { type: "image/png" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Give it a name and say what it is, then save.");
    expect(screen.getByRole("button", { name: "Save sheet" })).toBeInTheDocument();
  });

  test("editing: the sheet comes first, Save changes sends a PATCH, a new sheet goes to /sheet", async () => {
    const fetchMock = stub({ "/api/library/jumpsuit": () => saved, "/api/library/jumpsuit/sheet": () => saved });
    render(<SheetMaker asset={saved} onSaved={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("img", { name: "Sheet for jumpsuit" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy prompt for ChatGPT" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    fill("When a scene uses it, keep", "the logo and the black panels");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      const p = fetchMock.mock.calls.find((c) => c[0] === "/api/library/jumpsuit" && c[1]?.method === "PATCH");
      expect(JSON.parse(p![1]!.body as string)).toEqual({ kind: "product", description: "A neon green jumpsuit.", keep: "the logo and the black panels", heightCm: null });
    });
    fireEvent.click(screen.getByRole("button", { name: /Replace the sheet/ }));
    fireEvent.drop(screen.getByLabelText("Drop the sheet here"), { dataTransfer: { files: [new File(["x"], "s.png", { type: "image/png" })] } });
    await waitFor(() => {
      const s = fetchMock.mock.calls.find((c) => c[0] === "/api/library/jumpsuit/sheet");
      expect(JSON.parse(s![1]!.body as string)).toEqual({ image: token });
    });
  });

  test("a character's height shows in feet too and is saved with the item", async () => {
    const alex: AssetDetail = { ...saved, name: "alex", kind: "character", description: "A man in a suit.", heightCm: 183 };
    const fetchMock = stub({ "/api/library/alex": () => alex });
    render(<SheetMaker asset={alex} onSaved={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText("Height")).toHaveValue("183");
    expect(screen.getByText(/6 ft 0 in/)).toBeInTheDocument();
    fill("Height", "178");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      const p = fetchMock.mock.calls.find((c) => c[0] === "/api/library/alex" && c[1]?.method === "PATCH");
      expect(JSON.parse(p![1]!.body as string).heightCm).toBe("178");
    });
  });

  test("a prop has no height field", () => {
    stub();
    render(<SheetMaker asset={saved} onSaved={() => {}} onClose={() => {}} />);
    expect(screen.queryByLabelText("Height")).toBeNull();
  });

  test("the text boxes grow with their text instead of being dragged", () => {
    stub();
    render(<SheetMaker asset={null} onSaved={() => {}} onClose={() => {}} />);
    const box = screen.getByLabelText("What it is");
    expect(box.tagName).toBe("TEXTAREA");
    expect(box).toHaveClass("field--grow");
    Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => 96 });
    fill("What it is", "A tall man.\nShort dark hair.\nGlasses.");
    expect(box.style.height).toBe("96px");
  });

  test("Make it here spends only on the click, with the price on the button, and the finished sheet is kept on request", async () => {
    const offer = { ...saved, kind: "character", images: [{ ...saved.images[0], role: "source" as const }], makeSheet: { model: "nano-banana-2", usd: 0.06 } };
    const job = { id: "job-1", state: "succeeded", model: "nano-banana-2", media: ["/media/runs/library/sheet.png"], updatedAt: "2", error: null };
    const made = { ...offer, sheetJob: job, sheetJobKept: false };
    const fetchMock = stub({ "/api/library/jumpsuit/make-sheet": () => made, "/api/library/jumpsuit/adopt": () => ({ ...made, sheetJobKept: true }) });
    const onSaved = vi.fn();
    const { rerender } = render(<SheetMaker asset={offer as AssetDetail} onSaved={onSaved} onClose={() => {}} />);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("make-sheet"))).toBe(false);
    fill("Outfit, head to toe", "a green jumpsuit");
    fireEvent.click(screen.getByRole("button", { name: "Make the sheet · $0.06" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(made));
    const post = fetchMock.mock.calls.find((c) => c[0] === "/api/library/jumpsuit/make-sheet");
    expect(JSON.parse(post![1]!.body as string)).toEqual({ outfit: "a green jumpsuit" });
    rerender(<SheetMaker asset={made as unknown as AssetDetail} onSaved={onSaved} onClose={() => {}} />);
    expect(screen.getByRole("img", { name: "The new sheet" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep this sheet" }));
    await waitFor(() => {
      const keep = fetchMock.mock.calls.find((c) => c[0] === "/api/library/jumpsuit/adopt");
      expect(JSON.parse(keep![1]!.body as string)).toEqual({ job: "job-1" });
    });
  });
});
