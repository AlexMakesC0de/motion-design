// web/src/studio/LookPicker.tsx
// Video's look: a card showing the chosen look (its colours, its name), or an
// empty slot. Choosing opens a roomy picker beside the panel, by category,
// like the reference picker. A look fills the camera chips and adds a line
// each for the look, the pacing and the sound after the prompt.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { LookInfo, LooksView } from "../api/types";
import { Icon } from "../app/icons";
import { applyLook, clearLook } from "./promptStore";
import { useSideMenu } from "./useSideMenu";
import "../jutsu/jutsu.css";

/** A look's preview picture, over its three colours as a soft diagonal wash (shown alone until a picture is made). */
export const swatchStyle = (l: Pick<LookInfo, "swatch" | "still">): CSSProperties => {
  const wash = `radial-gradient(120% 90% at 85% 10%, ${l.swatch[2]} 0%, transparent 55%), linear-gradient(135deg, ${l.swatch[0]} 0%, ${l.swatch[1]} 100%)`;
  return l.still ? { background: `url("${l.still}") center / cover no-repeat, ${wash}` } : { background: wash };
};

function Picker({ data, chosen, anchor, onClose }: { data: LooksView; chosen: string | null; anchor: RefObject<HTMLElement | null>; onClose(): void }) {
  const [category, setCategory] = useState("All");
  const { menu, style, side } = useSideMenu<HTMLDivElement>(true, anchor, { fill: true });
  const shown = category === "All" ? data.looks : data.looks.filter((l) => l.category === category);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose, menu, anchor]);

  return (
    <div ref={menu} className="ref-pop look-pop" data-side={side} style={style} role="menu" aria-label="Choose a look">
      <div className="jutsu-picker__top">
        <p className="look-pop__title">Looks</p>
        <button type="button" className="jutsu-picker__close" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="jutsu-picker__panel">
        <div className="jutsu-picker__bar" role="group" aria-label="Category">
          {["All", ...data.categories].map((c) => (
            <button key={c} type="button" className="jutsu-picker__chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="jutsu-picker__body">
          <div className="look-grid">
            {shown.map((l) => (
              <button
                key={l.id}
                type="button"
                role="menuitemradio"
                aria-checked={chosen === l.id}
                aria-label={`${l.title}: ${l.tagline}`}
                className="look-tile"
                onClick={() => {
                  applyLook(l);
                  onClose();
                }}
              >
                <span className="look-tile__swatch" style={swatchStyle(l)} aria-hidden="true" />
                <span className="look-tile__name">{l.title}</span>
                <span className="look-tile__tag">{l.tagline}</span>
                <span className="look-tile__best">{l.bestFor}</span>
                {chosen === l.id && (
                  <span className="jutsu-picker__check" aria-hidden="true">
                    <Icon name="check" size={12} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The look card at the top of Video's panel. */
export function LookCard({ data, chosen, model }: { data: LooksView; chosen: string | null; model: string }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const look = data.looks.find((l) => l.id === chosen) ?? null;
  return (
    <div className="look-slot">
      {look ? (
        <div className="look-card" style={swatchStyle(look)}>
          <div className="look-card__tools">
            <button ref={anchor} type="button" className="look-card__change" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              Change
            </button>
            <button type="button" className="look-card__remove" aria-label={`Remove the look ${look.title}`} title="Remove the look" onClick={() => clearLook(look)}>
              <Icon name="close" size={14} />
            </button>
          </div>
          <div className="look-card__words">
            <p className="look-card__title">{look.title}</p>
            <p className="look-card__model">{model}</p>
          </div>
        </div>
      ) : (
        <button ref={anchor} type="button" className="look-card look-card--empty" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label="Add a look">
          <span className="look-card__plus" aria-hidden="true">
            <Icon name="plus" size={16} />
          </span>
          <span className="look-card__empty-words">
            <span className="look-card__empty-title">Add a look</span>
            <span className="look-card__empty-hint">Optional: a style for the camera, colour, pacing and sound.</span>
          </span>
        </button>
      )}
      {open && <Picker data={data} chosen={chosen} anchor={anchor} onClose={close} />}
    </div>
  );
}
