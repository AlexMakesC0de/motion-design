import { describe, test, expect } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PickChip, type PickOption } from "./PickChips";

const moves: PickOption[] = [
  { id: "static", label: "Static", when: "Let the action do the work." },
  { id: "push-in", label: "Push in", when: "Move toward the subject." },
  { id: "pull-out", label: "Pull out", when: "Move away to reveal context." },
];
const speeds: PickOption[] = [
  { id: "slow", label: "Slow", when: "Calm." },
  { id: "fast", label: "Fast", when: "Energy." },
];

function Harness({ start, withSpeeds = false }: { start?: string; withSpeeds?: boolean }) {
  const [value, setValue] = useState(start);
  const [speed, setSpeed] = useState<string | undefined>();
  return (
    <>
      <PickChip
        label="Move"
        scope="Stage 2 move"
        options={moves}
        value={value}
        onPick={(id) => { setValue(id); if (!id || id === "static") setSpeed(undefined); }}
        {...(withSpeeds ? { speeds, speed, onSpeed: setSpeed } : {})}
      />
      <output data-testid="value">{`${value ?? "none"}/${speed ?? "none"}`}</output>
    </>
  );
}
const value = () => screen.getByTestId("value").textContent;

describe("PickChip", () => {
  test("an empty chip opens a list of options with their notes; clicking one picks it and closes", () => {
    render(<Harness />);
    const chip = screen.getByRole("button", { name: "Stage 2 move: none. Choose" });
    expect(chip).toHaveTextContent("Move");
    fireEvent.click(chip);
    const list = screen.getByRole("listbox", { name: "Stage 2 move" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "StaticLet the action do the work.", "Push inMove toward the subject.", "Pull outMove away to reveal context.",
    ]);
    fireEvent.click(within(list).getByRole("option", { name: /Push in/ }));
    expect(value()).toBe("push-in/none");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Stage 2 move: Push in. Change" })).toHaveFocus();
  });

  test("arrow keys move, Enter picks, Escape closes and returns focus", () => {
    render(<Harness />);
    const chip = screen.getByRole("button", { name: "Stage 2 move: none. Choose" });
    fireEvent.click(chip);
    const list = screen.getByRole("listbox");
    expect(list).toHaveFocus();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(within(list).getByRole("option", { name: /Push in/ })).toHaveAttribute("data-active", "true");
    fireEvent.keyDown(list, { key: "Enter" });
    expect(value()).toBe("push-in/none");

    fireEvent.click(screen.getByRole("button", { name: "Stage 2 move: Push in. Change" }));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Stage 2 move: Push in. Change" })).toHaveFocus();
    expect(value()).toBe("push-in/none");
  });

  test("a filled chip marks its option and can be removed", () => {
    render(<Harness start="pull-out" />);
    fireEvent.click(screen.getByRole("button", { name: "Stage 2 move: Pull out. Change" }));
    expect(screen.getByRole("option", { name: /Pull out/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Remove stage 2 move" }));
    expect(value()).toBe("none/none");
    expect(screen.queryByRole("button", { name: "Remove stage 2 move" })).toBeNull();
  });

  test("with speeds, picking a move keeps the list open and shows the speeds; Static hides them", () => {
    render(<Harness withSpeeds />);
    fireEvent.click(screen.getByRole("button", { name: "Stage 2 move: none. Choose" }));
    expect(screen.queryByRole("group", { name: "Stage 2 move speed" })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /Push in/ }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    const speedRow = screen.getByRole("group", { name: "Stage 2 move speed" });
    fireEvent.click(within(speedRow).getByRole("button", { name: "Slow" }));
    expect(value()).toBe("push-in/slow");
    expect(within(speedRow).getByRole("button", { name: "Slow" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Stage 2 move: Push in, slow. Change" })).toBeInTheDocument();
    fireEvent.click(within(speedRow).getByRole("button", { name: "Slow" }));
    expect(value()).toBe("push-in/none");
    fireEvent.click(screen.getByRole("option", { name: /Static/ }));
    expect(value()).toBe("static/none");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("an id the menu no longer has shows as written, so it can be swapped or removed", () => {
    render(<Harness start="moonwalk" />);
    expect(screen.getByRole("button", { name: "Stage 2 move: moonwalk. Change" })).toHaveTextContent("moonwalk");
    expect(screen.getByRole("button", { name: "Remove stage 2 move" })).toBeInTheDocument();
  });
});
