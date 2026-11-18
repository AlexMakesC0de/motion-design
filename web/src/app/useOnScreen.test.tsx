import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOnScreen } from "./useOnScreen";

function Pop({ open }: { open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useOnScreen(ref, open);
  return <div ref={ref} data-testid="pop" />;
}

const box = (top: number, left: number, height: number, width: number) =>
  ({ top, left, height, width, bottom: top + height, right: left + width, x: left, y: top, toJSON() {} }) as DOMRect;

describe("useOnScreen", () => {
  afterEach(() => vi.restoreAllMocks());

  it("moves a menu that drops below the window back up, 12px from the bottom", () => {
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(900);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1440);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(box(700, 300, 320, 300));
    const { getByTestId } = render(<Pop open />);
    // 700 + 320 = 1020, past 900 - 12: up by 132.
    expect(getByTestId("pop").style.translate).toBe("0px -132px");
  });

  it("caps a menu taller than the window and lets it scroll", () => {
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(600);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1440);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(box(100, 300, 900, 300));
    const pop = render(<Pop open />).getByTestId("pop");
    expect(pop.style.maxHeight).toBe("576px");
    expect(pop.style.overflowY).toBe("auto");
    expect(pop.style.translate).toBe("0px -88px");
  });

  it("leaves a menu that fits alone, and undoes its changes when it closes", () => {
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(900);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1440);
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(box(100, 300, 200, 300));
    const { getByTestId, rerender } = render(<Pop open />);
    expect(getByTestId("pop").style.translate).toBe("");
    rect.mockReturnValue(box(800, 1300, 200, 300));
    rerender(<Pop open={false} />);
    rerender(<Pop open />);
    expect(getByTestId("pop").style.translate).toBe("-172px -112px");
    rerender(<Pop open={false} />);
    expect(getByTestId("pop").style.translate).toBe("");
  });
});
