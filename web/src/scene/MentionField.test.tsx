import { describe, test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MentionField } from "./MentionField";
import type { Ref } from "../api/types";

const items = new Map([["alexandros", { hasSheet: true }], ["maya", { hasSheet: false }]]);

function Harness({ initial, refs0, onChoose = () => {}, onPasteWhole }: { initial: string; refs0: Ref[]; onChoose?: (s: unknown) => void; onPasteWhole?: (c: unknown) => void }) {
  const [value, setValue] = useState(initial);
  const [refs, setRefs] = useState(refs0);
  return (
    <>
      <MentionField label="Goal" value={value} refs={refs} items={items} onChange={(v, r) => { setValue(v); setRefs(r); }} onChoose={onChoose} onPasteWhole={onPasteWhole} />
      <output data-testid="stored">{value}</output>
      <output data-testid="refs">{refs.map((r) => `${r.id}:${r.source ?? "empty"}`).join(",")}</output>
    </>
  );
}

const box = () => screen.getByRole("textbox", { name: "Goal" });

describe("MentionField", () => {
  test("shows stored mentions by position and colours them", () => {
    const { container } = render(<Harness initial="@{r1} jumps with @{r2}" refs0={[{ id: "r1", source: "library:alexandros" }, { id: "r2", source: null }]} />);
    expect(box()).toHaveValue("@image1 jumps with @image2");
    const marks = container.querySelectorAll("mark.mention");
    expect([...marks].map((m) => [m.textContent, m.getAttribute("data-state")])).toEqual([["@image1", "linked"], ["@image2", "missing"]]);
  });

  test("pasting a Higgsfield-style prompt makes bound mentions and empty slots", () => {
    render(<Harness initial="" refs0={[]} />);
    fireEvent.paste(box(), { clipboardData: { getData: () => "[@image2] walks past @Image 1", files: [] } });
    fireEvent.change(box(), { target: { value: "[@image2] walks past @Image 1" } });
    expect(screen.getByTestId("refs")).toHaveTextContent("r1:empty,r2:empty");
    expect(screen.getByTestId("stored")).toHaveTextContent("@{r2} walks past @{r1}");
    expect(box()).toHaveValue("@image2 walks past @image1");
  });

  test("each missing mention gets a fix button named for screen readers", () => {
    const onChoose = vi.fn();
    render(<Harness initial="@{r1} and @library:maya and @library:ghost" refs0={[{ id: "r1", source: null }]} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("button", { name: "image 1, no picture yet, choose one" }));
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ kind: "image", refId: "r1" }));
    expect(screen.getByRole("button", { name: "maya, no sheet yet" })).toHaveTextContent("Make its sheet");
    expect(screen.getByRole("button", { name: "ghost, not in the Library" })).toHaveTextContent("Make @library:ghost");
  });

  test("clicking inside a red mention opens the chooser", () => {
    const onChoose = vi.fn();
    render(<Harness initial="go @{r1}" refs0={[{ id: "r1", source: null }]} onChoose={onChoose} />);
    const t = box() as HTMLTextAreaElement;
    t.setSelectionRange(5, 5);
    fireEvent.click(t);
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ n: 1 }));
  });

  test("typing @ opens the mention menu; Enter inserts", () => {
    render(<Harness initial="" refs0={[{ id: "r1", source: "library:alexandros" }]} />);
    const t = box() as HTMLTextAreaElement;
    fireEvent.change(t, { target: { value: "@", selectionStart: 1 } });
    const menu = screen.getByRole("listbox", { name: "Mention" });
    expect(menu).toHaveTextContent("@image1");
    fireEvent.keyDown(t, { key: "Enter" });
    expect(screen.getByTestId("stored")).toHaveTextContent("@{r1}");
  });

  test("pasting a whole sectioned prompt hands it to the scene", () => {
    const onPasteWhole = vi.fn();
    render(<Harness initial="" refs0={[]} onPasteWhole={onPasteWhole} />);
    fireEvent.paste(box(), { clipboardData: { getData: () => "[GOAL]\nHe jumps.\n\n[SCENE]\nAlps.", files: [] } });
    expect(onPasteWhole).toHaveBeenCalledWith(expect.objectContaining({ goal: "He jumps.", scene: "Alps." }));
  });
});
