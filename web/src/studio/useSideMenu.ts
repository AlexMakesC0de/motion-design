// web/src/studio/useSideMenu.ts
// A menu that grows out of the right end of the button that opened it, level
// with it, as Openjutsu's do. The panel opts in with a data-side-menus
// attribute; the menu is placed with position: fixed, so a panel that scrolls
// (and so clips what overflows it) cannot cut it off. Outside such a panel,
// or on a narrow screen, the menu keeps its own CSS placement, moved back on
// screen by useOnScreen if that placement runs off the window.
import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useOnScreen } from "../app/useOnScreen";

const MARGIN = 12;
const GAP = 10;
/** Below this width the panels stack and there is no room beside them. */
const MIN_WIDTH = 900;

/** fill: a large picker, as tall as the panel and level with its top, instead of a menu level with the button. */
export function useSideMenu<T extends HTMLElement>(open: boolean, anchor: RefObject<HTMLElement | null>, { fill = false }: { fill?: boolean } = {}) {
  const menu = useRef<T>(null);
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(undefined);
      return;
    }
    const place = () => {
      const a = anchor.current;
      const panel = a?.closest<HTMLElement>("[data-side-menus]");
      if (!a || !panel || window.innerWidth < MIN_WIDTH) {
        setStyle(undefined);
        return;
      }
      const ar = a.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      // A full-height picker stands beside the panel; a menu grows from the button's right end.
      const left = Math.min((fill ? pr.right : ar.right) + GAP, window.innerWidth - (menu.current?.offsetWidth ?? 0) - MARGIN);
      if (fill) {
        setStyle({ position: "fixed", top: pr.top, left, right: "auto", bottom: "auto", height: pr.height, maxHeight: "none" });
        return;
      }
      const height = menu.current?.offsetHeight ?? 0;
      // Level with the button, moved up only as far as it must to stay on screen.
      const top = Math.max(MARGIN, Math.min(ar.top - 8, window.innerHeight - height - MARGIN));
      setStyle({ position: "fixed", top, left, right: "auto", bottom: "auto", maxHeight: window.innerHeight - 2 * MARGIN });
    };
    place();
    window.addEventListener("resize", place);
    // The panel scrolling moves the button; the menu follows it.
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, fill]);

  // Beside the panel the menu can be taller than it was when measured; lift it
  // until its bottom is on screen. Runs before paint, and stops once it fits.
  useLayoutEffect(() => {
    const el = menu.current;
    if (!style || !el) return;
    const r = el.getBoundingClientRect();
    if (r.bottom > window.innerHeight - MARGIN + 0.5) {
      const top = Math.max(MARGIN, window.innerHeight - MARGIN - r.height);
      if (top !== style.top) setStyle({ ...style, top });
    }
  }, [style]);

  useOnScreen(menu, open && !style);

  return { menu, style, side: style ? true : undefined };
}
