// web/src/studio/DockMenu.tsx
// The Studio dock's menus: a chip that opens a small panel upward, animated in,
// kept on screen (useOnScreen), closed by a click elsewhere or Escape. DockSelect
// is a listbox of values (resolution, aspect ratio, duration), DockModelSelect
// the model list with each model's line and badge. DockPopover is the bare
// shell the setting cards above the prompt (Look, Camera, Lighting) open.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import type { ModelInfo } from "../api/types";
import { Icon } from "../app/icons";
import { modelBadge, modelBlurb, modelName } from "../app/modelMeta";
import { useOnScreen } from "../app/useOnScreen";

/** Close on a click outside `wrap` or on Escape, while open. */
export function useDismiss(open: boolean, wrap: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && close();
    const esc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, wrap, close]);
}

/** The arrow keys, Home, End and Enter over a listbox of `count` options. */
function listKeys(e: KeyboardEvent, count: number, active: number, setActive: (i: number) => void, choose: (i: number) => void) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    setActive((active + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
  } else if (e.key === "Home" || e.key === "End") {
    e.preventDefault();
    setActive(e.key === "Home" ? 0 : count - 1);
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    choose(active);
  }
}

/** A chip and the listbox it opens upward. Shared by DockSelect and DockModelSelect. */
function DockList<T extends string | number>({
  label,
  chip,
  value,
  options,
  width,
  heading,
  renderOption,
  onChange,
}: {
  label: string;
  chip: ReactNode;
  value: T | null;
  options: T[];
  width?: number;
  heading?: string;
  renderOption: (o: T, selected: boolean) => ReactNode;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useOnScreen(panel, open);
  const close = useRef(() => setOpen(false)).current;
  useDismiss(open, wrap, close);

  useEffect(() => {
    if (open) list.current?.focus({ preventScroll: true });
  }, [open]);

  const choose = (i: number) => {
    if (options[i] != null) onChange(options[i]);
    setOpen(false);
    button.current?.focus();
  };

  if (!options.length) return null;
  return (
    <div className="dmenu" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="dock-chip dmenu__chip"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={label}
        onClick={() => {
          setActive(Math.max(0, options.findIndex((o) => o === value)));
          setOpen((o) => !o);
        }}
      >
        {chip}
        <span className="dmenu__chevron" aria-hidden="true">
          <Icon name="down" size={12} />
        </span>
      </button>
      {open && (
        <div ref={panel} className="dmenu__panel" style={width ? { width } : undefined}>
          {heading && <p className="dmenu__heading">{heading}</p>}
          <ul
            ref={list}
            id={`${id}-list`}
            className="dmenu__list"
            role="listbox"
            aria-label={label.replace(/:.*/, "")}
            tabIndex={-1}
            aria-activedescendant={`${id}-${active}`}
            onKeyDown={(e) => listKeys(e, options.length, active, setActive, choose)}
          >
            {options.map((o, i) => (
              <li
                key={String(o)}
                id={`${id}-${i}`}
                role="option"
                aria-selected={o === value}
                data-active={i === active || undefined}
                className="dmenu__item"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
              >
                {renderOption(o, o === value)}
                <span className="dmenu__check" aria-hidden="true">
                  {o === value && <Icon name="check" size={14} />}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** An aspect ratio drawn as a small frame: 16:9 wide, 9:16 tall. */
export function RatioGlyph({ ratio, max = 14 }: { ratio: string | null; max?: number }) {
  const [w, h] = (ratio ?? "").split(":").map(Number);
  const ok = w > 0 && h > 0;
  const width = ok ? (w >= h ? max : Math.max(5, Math.round((max * w) / h))) : 11;
  const height = ok ? (h >= w ? max : Math.max(5, Math.round((max * h) / w))) : 14;
  return <span className="dmenu__ratio" style={{ width, height }} aria-hidden="true" />;
}

interface DockSelectProps<T extends string | number> {
  label: string;
  icon?: ReactNode;
  value: T | null;
  options: T[];
  format?: (v: T) => string;
  /** What no choice means here. */
  empty?: string;
  /** A picture beside each option (aspect ratios draw their frame). */
  glyph?: (v: T) => ReactNode;
  heading?: string;
  onChange: (v: T) => void;
}

/** A setting chip in the dock (resolution, ratio, duration) and its list. */
export function DockSelect<T extends string | number>({ label, icon, value, options, format = String, empty = "—", glyph, heading, onChange }: DockSelectProps<T>) {
  const shown = value == null ? empty : `${format(value)}${options.includes(value) ? "" : " (not offered)"}`;
  return (
    <DockList
      label={`${label}: ${shown}`}
      heading={heading ?? label}
      value={value}
      options={options}
      onChange={onChange}
      chip={
        <>
          {icon}
          <span className="dock-chip__value">{shown}</span>
        </>
      }
      renderOption={(o) => (
        <>
          {glyph && <span className="dmenu__glyph">{glyph(o)}</span>}
          <span className="dmenu__name">{format(o)}</span>
        </>
      )}
    />
  );
}

/** The model chip: its name and badge; the list shows each model's line. */
export function DockModelSelect({ models, value, onPick, kind }: { models: ModelInfo[]; value: string; onPick: (id: string) => void; kind: "image" | "video" }) {
  const badge = modelBadge(value);
  return (
    <DockList
      label={`Model: ${modelName(value)}`}
      heading={kind === "image" ? "Image models" : "Video models"}
      value={value || null}
      options={models.map((m) => m.id)}
      width={340}
      onChange={onPick}
      chip={
        <>
          <Icon name="model" size={16} />
          <span className="dock-chip__value">{modelName(value)}</span>
          {badge && <span className="dmenu__badge">{badge}</span>}
        </>
      }
      renderOption={(id) => {
        const m = models.find((x) => x.id === id)!;
        const b = modelBadge(id);
        return (
          <>
            <span className="dmenu__tile" aria-hidden="true">
              <Icon name={kind === "image" ? "image" : "video"} size={16} />
            </span>
            <span className="dmenu__words">
              <span className="dmenu__name">
                {modelName(id)}
                {b && <span className="dmenu__badge">{b}</span>}
              </span>
              <span className="dmenu__blurb">{modelBlurb(m)}</span>
            </span>
          </>
        );
      }}
    />
  );
}
