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
    fireEvent.drop(screen.getByLabelText("Drop the sheet here"), { dataTransfer: { files: [new File(["x"], "sheet.png", { type: "image/png" })] } });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    const post = fetchMock.mock.calls.find((c) => c[0] === "/api/library" && c[1]?.method === "POST");
    expect(JSON.parse(post![1]!.body as string)).toEqual({
      name: "jumpsuit", kind: "product", description: "A neon green jumpsuit", keep: "the chest logo",
      images: [{ src: token, role: "sheet" }],
    });
  });

  test("a sheet dropped before the name is filled waits, with the reason", async () => {
    stub();
    render(<SheetMaker asset={null} onSaved={() => {}} onClose={() => {}} />);
    fireEvent.drop(screen.getByLabelText("Drop the sheet here"), { dataTransfer: { files: [new File(["x"], "sheet.png", { type: "image/png" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Give it a name and say what it is, then save.");
    expect(screen.getByRole("button", { name: "Save sheet" })).toBeInTheDocument();
  });

  test("editing: the name is fixed, Save changes sends a PATCH, a new sheet goes to /sheet", async () => {
    const fetchMock = stub({ "/api/library/jumpsuit": () => saved, "/api/library/jumpsuit/sheet": () => saved });
    render(<SheetMaker asset={saved} onSaved={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText("Name")).toHaveAttribute("readonly");
    fill("When a scene uses it, keep", "the logo and the black panels");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      const p = fetchMock.mock.calls.find((c) => c[0] === "/api/library/jumpsuit" && c[1]?.method === "PATCH");
      expect(JSON.parse(p![1]!.body as string)).toEqual({ kind: "product", description: "A neon green jumpsuit.", keep: "the logo and the black panels" });
    });
    fireEvent.drop(screen.getByLabelText("Drop the sheet here"), { dataTransfer: { files: [new File(["x"], "s.png", { type: "image/png" })] } });
    await waitFor(() => {
      const s = fetchMock.mock.calls.find((c) => c[0] === "/api/library/jumpsuit/sheet");
      expect(JSON.parse(s![1]!.body as string)).toEqual({ image: token });
    });
  });
});
