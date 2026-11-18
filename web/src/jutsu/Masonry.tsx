import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Masonry: items of any shape stacked in columns with no gaps. Each item goes
 * to the shortest column so far, in order, so the newest or most used stay near
 * the top. The column count follows the width (at least `minColumn` pixels).
 * `ratio` is width / height of each tile's picture.
 */
export function Masonry<T>({
  items,
  ratio,
  keyOf,
  render,
  label,
  minColumn,
  gap = 16,
  footer = 0,
  className,
}: {
  items: T[];
  ratio(item: T): number;
  keyOf(item: T): string;
  render(item: T): ReactNode;
  label: string;
  minColumn: number;
  gap?: number;
  /** The height of the strip under each tile, in column widths (0 when there is none). */
  footer?: number;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(1);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const fit = () => setCount(Math.max(1, Math.floor((el.clientWidth + gap) / (minColumn + gap))));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [minColumn, gap]);

  const columns: T[][] = Array.from({ length: count }, () => []);
  const heights = new Array<number>(count).fill(0);
  for (const item of items) {
    const r = ratio(item);
    let shortest = 0;
    for (let i = 1; i < count; i++) if (heights[i] < heights[shortest] - 0.01) shortest = i;
    columns[shortest].push(item);
    heights[shortest] += 1 / (r > 0 && Number.isFinite(r) ? r : 1) + footer;
  }

  return (
    <div ref={box} role="list" aria-label={label} className={`masonry${className ? ` ${className}` : ""}`} style={{ gap }}>
      {columns.map((col, i) => (
        <div key={i} role="none" className="masonry__col" style={{ gap }}>
          {col.map((item) => (
            <div key={keyOf(item)} role="none" className="masonry__cell">
              {render(item)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** "9:16" → 0.5625; anything else (adaptive, null) → null. */
export function ratioOf(text: string | null | undefined): number | null {
  const m = (text ?? "").match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const r = Number(m[1]) / Number(m[2]);
  return r > 0 && Number.isFinite(r) ? r : null;
}
