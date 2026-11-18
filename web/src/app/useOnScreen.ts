// web/src/app/useOnScreen.ts
// The rule for every dropdown, menu and popover: it never runs off the window.
// A popup keeps its own CSS placement; if that puts any part of it past an edge,
// it is moved back in just far enough (12px from the edge), and one taller than
// the window is capped at the window's height and scrolls. Menus beside a side
// panel get the same from useSideMenu; everything else uses this.
import { useLayoutEffect, type RefObject } from "react";

const MARGIN = 12;

export function useOnScreen(ref: RefObject<HTMLElement | null>, active: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    let capped = false;
    const fit = () => {
      el.style.translate = "";
      if (capped) {
        el.style.maxHeight = "";
        el.style.overflowY = "";
        capped = false;
      }
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const room = vh - 2 * MARGIN;
      if (r.height > room) {
        el.style.maxHeight = `${room}px`;
        el.style.overflowY = "auto";
        capped = true;
      }
      const h = Math.min(r.height, room);
      let dy = 0;
      if (r.top + h > vh - MARGIN) dy = vh - MARGIN - h - r.top;
      if (r.top + dy < MARGIN) dy = MARGIN - r.top;
      let dx = 0;
      if (r.right > vw - MARGIN) dx = vw - MARGIN - r.right;
      if (r.left + dx < MARGIN) dx = MARGIN - r.left;
      if (dx || dy) el.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
    };
    fit();
    // Content that loads in (a list filling up) can make it taller after it opened.
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    watch?.observe(el);
    window.addEventListener("resize", fit);
    return () => {
      watch?.disconnect();
      window.removeEventListener("resize", fit);
      el.style.translate = "";
      if (capped) {
        el.style.maxHeight = "";
        el.style.overflowY = "";
      }
    };
  }, [ref, active]);
}
