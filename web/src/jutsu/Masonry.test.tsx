import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Masonry, ratioOf } from "./Masonry";

type Item = { id: string; r: number };

describe("Masonry", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("puts each item in the shortest column, so mixed shapes stack without gaps", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
    // A tall clip, then two wide ones, then another: the wide ones fill the
    // second column while the tall one holds the first.
    const items: Item[] = [
      { id: "tall", r: 9 / 16 },
      { id: "wide-a", r: 16 / 9 },
      { id: "wide-b", r: 16 / 9 },
      { id: "next", r: 1 },
    ];
    render(<Masonry items={items} label="Clips" minColumn={480} gap={20} ratio={(i) => i.r} keyOf={(i) => i.id} render={(i) => <div role="listitem">{i.id}</div>} />);
    const list = screen.getByRole("list", { name: "Clips" });
    const cols = list.querySelectorAll(".masonry__col");
    expect(cols).toHaveLength(2);
    expect(within(cols[0] as HTMLElement).getAllByRole("listitem").map((n) => n.textContent)).toEqual(["tall"]);
    expect(within(cols[1] as HTMLElement).getAllByRole("listitem").map((n) => n.textContent)).toEqual(["wide-a", "wide-b", "next"]);
    vi.restoreAllMocks();
  });

  it("reads ratios like 9:16 and ignores adaptive", () => {
    expect(ratioOf("9:16")).toBeCloseTo(0.5625);
    expect(ratioOf("16:9")).toBeCloseTo(1.778);
    expect(ratioOf("adaptive")).toBeNull();
    expect(ratioOf(null)).toBeNull();
  });
});
