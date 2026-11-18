// One pick from the director's menu, as a chip. Empty it reads "+ Move";
// filled it shows the option's name and a remove button. The chip opens a
// listbox of the group's options, each with the menu's "when to use it" note.
// A chip given `speeds` (the Move chip) shows them above the list once a
// moving move is picked, and stays open after a pick so the speed can be set.
import { useSideMenu } from "../studio/useSideMenu";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../app/icons";

export interface PickOption {
  id: string;
  label: string;
  when: string;
}

export interface PickChipProps {
  /** The chip's word when empty: "Move". */
  label: string;
  /** Whose pick this is, used in every accessible name: "Stage 2 move". */
  scope: string;
  options: PickOption[];
  value: string | undefined;
  onPick(id: string | undefined): void;
  speeds?: PickOption[];
  speed?: string;
  onSpeed?(id: string | undefined): void;
}

const lower = (s: string) => `${s[0].toLowerCase()}${s.slice(1)}`;

export function PickChip({ label, scope, options, value, onPick, speeds, speed, onSpeed }: PickChipProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLSpanElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const uid = useId();
  // Inside a panel with data-side-menus (Create Video), the list opens beside the panel.
  const placed = useSideMenu<HTMLDivElement>(open, chip);

  const chosen = options.find((o) => o.id === value);
  const speedChosen = speeds?.find((o) => o.id === speed);
  // An id the menu no longer has is shown as written.
  const name = value ? `${chosen?.label ?? value}${speedChosen ? ` · ${speedChosen.label.toLowerCase()}` : ""}` : null;
  const moving = Boolean(speeds && value && value !== "static");

  const close = (focus = true) => {
    setOpen(false);
    if (focus) chip.current?.focus();
  };

  // Opening starts on the chosen option and moves focus into the list.
  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.id === value)));
    list.current?.focus({ preventScroll: true });
    // Only on opening: a pick that keeps the list open must not move the highlight.
  }, [open]);

  // The highlighted option stays in view as the arrow keys move through a long list.
  useEffect(() => {
    // Scrolls the list only, never the panel behind it.
    const el = open && options[active] ? document.getElementById(`${uid}-${options[active].id}`) : null;
    const box = list.current;
    if (!el || !box) return;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.top < b.top) box.scrollTop -= b.top - r.top;
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
  }, [open, active, options, uid]);

  // A click anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const choose = (id: string) => {
    onPick(id);
    // The Move chip stays open on a moving move, so its speed can be set next.
    if (!speeds || id === "static") close();
  };

  const keys = (e: KeyboardEvent) => {
    const last = options.length - 1;
    const go = (i: number) => {
      e.preventDefault();
      setActive(Math.max(0, Math.min(last, i)));
    };
    if (e.key === "ArrowDown") go(active + 1);
    else if (e.key === "ArrowUp") go(active - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(last);
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (options[active]) choose(options[active].id);
    }
  };
  // Escape closes from anywhere in the pick: the chip, the speed buttons or the list.
  const escape = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !open) return;
    e.stopPropagation();
    close();
  };

  return (
    <span
      className="pick"
      ref={wrap}
      onKeyDown={escape}
      // Tabbing out to another control closes the list; a click elsewhere is handled above.
      onBlur={(e) => {
        if (open && e.relatedTarget && !wrap.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        ref={chip}
        className="chip-button pick__chip"
        data-filled={value ? "true" : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={name ? `${scope}: ${name}. Change` : `${scope}: none. Choose`}
        onClick={() => setOpen((o) => !o)}
      >
        {!value && <Icon name="plus" size={14} />}
        {name ?? label}
      </button>
      {value && (
        <button type="button" className="pick__remove" aria-label={`Remove ${lower(scope)}`} title="Remove" onClick={() => onPick(undefined)}>
          <Icon name="close" size={12} />
        </button>
      )}
      {open && (
        <div className="pick-pop" ref={placed.menu} data-side={placed.side} style={placed.style}>
          {moving && speeds && (
            <div className="pick-pop__speeds" role="group" aria-label={`${scope} speed`}>
              {speeds.map((s) => (
                <button key={s.id} type="button" className="pill-toggle__item" title={s.when} aria-pressed={speed === s.id} onClick={() => onSpeed?.(speed === s.id ? undefined : s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <ul
            ref={list}
            className="pick-pop__list"
            role="listbox"
            tabIndex={0}
            aria-label={scope}
            aria-activedescendant={options[active] ? `${uid}-${options[active].id}` : undefined}
            onKeyDown={keys}
          >
            {options.map((o, i) => (
              <li
                key={o.id}
                id={`${uid}-${o.id}`}
                role="option"
                className="pick-pop__option"
                aria-selected={o.id === value}
                data-active={i === active ? "true" : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o.id)}
              >
                <span className="pick-pop__label">{o.label}</span>
                <span className="pick-pop__when">{o.when}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}
