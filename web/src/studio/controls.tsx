// The pieces the Image and Video pages build their prompt controls from:
// the reference picker and chips, Image's settings chips (native selects),
// Video's settings cards and model menu (listboxes that open beside the panel,
// driven by the arrow keys, Enter and Escape), and the messages that say why
// Generate is off.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useSideMenu } from "./useSideMenu";
import type { AssetSummary, ModelInfo } from "../api/types";
import { Icon } from "../app/icons";
import { modelBadge, modelBlurb, modelName } from "../app/modelMeta";
import { usd } from "./format";
import { addRef, removeRef, type RefDraft } from "./promptStore";
import type { Generate } from "./useGenerate";

/** A labelled native select's options: the current value first when the model does not offer it. */
function Options<T extends string | number>({ value, options, format, empty }: { value: T | null; options: T[]; format: (v: T) => string; empty: string }) {
  return (
    <>
      {value == null && <option value="">{empty}</option>}
      {value != null && !options.includes(value) && <option value={String(value)}>{format(value)} (not offered)</option>}
      {options.map((o) => (
        <option key={String(o)} value={String(o)}>
          {format(o)}
        </option>
      ))}
    </>
  );
}

interface SelectProps<T extends string | number> {
  label: string;
  value: T | null;
  options: T[];
  format?: (v: T) => string;
  /** What no choice means here. */
  empty?: string;
  onChange: (v: T) => void;
}

function pick<T extends string | number>(options: T[], raw: string, onChange: (v: T) => void) {
  const hit = options.find((o) => String(o) === raw);
  if (hit != null) onChange(hit);
}

/** The arrow keys, Home, End, Enter and Escape over a listbox of `count` options. */
function listKeys(e: KeyboardEvent, count: number, active: number, setActive: (i: number) => void, choose: (i: number) => void, close: () => void) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    setActive((active + (e.key === "ArrowDown" ? 1 : count - 1)) % count);
  } else if (e.key === "Home" || e.key === "End") {
    e.preventDefault();
    setActive(e.key === "Home" ? 0 : count - 1);
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    choose(active);
  } else if (e.key === "Escape") {
    e.preventDefault();
    close();
  }
}

/** Video's settings card: the label above the value and a chevron; its list opens beside the panel. */
export function SelectCard<T extends string | number>({ label, value, options, format = String, empty = "—", onChange }: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const { menu, style, side } = useSideMenu<HTMLUListElement>(open, button);

  useEffect(() => {
    if (!open) return;
    menu.current?.focus({ preventScroll: true });
    const away = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open, menu]);

  if (!options.length) return null;
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const choose = (i: number) => {
    if (options[i] != null) onChange(options[i]);
    close();
  };
  const shown = value == null ? empty : `${format(value)}${options.includes(value) ? "" : " (not offered)"}`;
  return (
    <div className="select-card" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="field-card field-card--button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={`${label}: ${shown}`}
        onClick={() => {
          setActive(Math.max(0, options.findIndex((o) => o === value)));
          setOpen((o) => !o);
        }}
      >
        <span className="field-card__label">{label}</span>
        <span className="field-card__value">{shown}</span>
        <span className="field-card__chevron">
          <Icon name="down" size={16} />
        </span>
      </button>
      {open && (
        <ul
          ref={menu}
          id={`${id}-list`}
          className="select-menu"
          data-side={side}
          style={style}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={(e) => listKeys(e, options.length, active, setActive, choose, close)}
          onBlur={(e) => {
            if (e.relatedTarget && !wrap.current?.contains(e.relatedTarget as Node)) setOpen(false);
          }}
        >
          {options.map((o, i) => (
            <li key={String(o)} id={`${id}-${i}`} role="option" aria-selected={o === value} data-active={i === active || undefined} className="select-menu__item" onMouseEnter={() => setActive(i)} onClick={() => choose(i)}>
              <span>{format(o)}</span>
              {o === value && <Icon name="check" size={16} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Image's settings chip: an icon and the value, with the native select laid over it. */
export function SelectChip<T extends string | number>({ label, icon, value, options, format = String, empty = "—", onChange, chevron = false }: SelectProps<T> & { icon?: ReactNode; chevron?: boolean }) {
  if (!options.length) return null;
  return (
    <label className="dock-chip">
      {icon}
      <span className="dock-chip__value">{value == null ? empty : format(value)}</span>
      {chevron && (
        <span className="dock-chip__chevron">
          <Icon name="down" size={14} />
        </span>
      )}
      <select className="dock-chip__select" aria-label={label} value={value == null ? "" : String(value)} onChange={(e) => pick(options, e.target.value, onChange)}>
        <Options value={value} options={options} format={format} empty={empty} />
      </select>
    </label>
  );
}

/** Video's model card: opens a list of the page's models, each with its line and badge. */
export function ModelMenu({ models, value, onPick }: { models: ModelInfo[]; value: string; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const badge = modelBadge(value);
  const placed = useSideMenu<HTMLUListElement>(open, button);

  useEffect(() => {
    if (!open) return;
    list.current?.focus({ preventScroll: true });
    const away = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const choose = (m: ModelInfo) => {
    onPick(m.id);
    close();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : models.length - 1)) % models.length);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : models.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (models[active]) choose(models[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  if (!models.length) return null;
  return (
    <div className="model-card" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="field-card field-card--button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        onClick={() => {
          setActive(Math.max(0, models.findIndex((m) => m.id === value)));
          setOpen((o) => !o);
        }}
      >
        <span className="field-card__label">Model</span>{" "}
        <span className="field-card__value">
          {modelName(value)}
          {badge && <span className="model-badge">{badge}</span>}
        </span>
        <span className="field-card__chevron">
          <Icon name="down" size={16} />
        </span>
      </button>
      {open && (
        <ul
          ref={(el) => {
            list.current = el;
            placed.menu.current = el;
          }}
          id={`${id}-list`}
          className="model-menu"
          data-side={placed.side}
          style={placed.style}
          role="listbox" aria-label="Video models" tabIndex={-1} aria-activedescendant={`${id}-${active}`} onKeyDown={keys}>
          {models.map((m, i) => (
            <li
              key={m.id}
              id={`${id}-${i}`}
              role="option"
              aria-selected={m.id === value}
              data-active={i === active || undefined}
              className="model-menu__item"
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(m)}
            >
              <span className="model-menu__tile" data-badge={modelBadge(m.id) ?? undefined}>
                <Icon name="model" />
                {modelBadge(m.id) && <span className="model-menu__badge">{modelBadge(m.id)}</span>}
              </span>
              <span className="model-menu__words">
                <span className="model-menu__name">{modelName(m.id)}</span>{" "}
                <span className="model-menu__blurb">{modelBlurb(m)}</span>
              </span>
              {m.id === value && (
                <span className="model-menu__check">
                  <Icon name="check" size={18} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Pick a Library item and the role the model takes it as. */
export function RefPicker({ assets, roles, onDone }: { assets: AssetSummary[]; roles: string[]; onDone: () => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const pickedName = name || assets[0]?.name || "";
  const pickedRole = role || roles[0] || "";
  if (!assets.length) {
    return (
      <div className="ref-picker" role="group" aria-label="Add a reference">
        <p className="ref-picker__empty">
          Save something in the <a href="#/library">Library</a> first.
        </p>
        <button type="button" className="ref-picker__quiet" onClick={onDone}>
          Close
        </button>
      </div>
    );
  }
  return (
    <div className="ref-picker" role="group" aria-label="Add a reference">
      <select aria-label="Asset" className="ref-picker__select mono" value={pickedName} onChange={(e) => setName(e.target.value)}>
        {assets.map((a) => (
          <option key={a.name} value={a.name}>
            @{a.name}
          </option>
        ))}
      </select>
      <select aria-label="Role" className="ref-picker__select mono" value={pickedRole} onChange={(e) => setRole(e.target.value)}>
        {roles.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="ref-picker__add"
        disabled={!pickedName || !pickedRole}
        onClick={() => {
          addRef({ source: pickedName, role: pickedRole });
          onDone();
        }}
      >
        Add
      </button>
      <button type="button" className="ref-picker__quiet" onClick={onDone}>
        Cancel
      </button>
    </div>
  );
}

/** The references on the draft, each removable. */
export function RefChips({ refs, assets }: { refs: RefDraft[]; assets: AssetSummary[] }) {
  if (!refs.length) return null;
  return (
    <ul className="ref-chips" aria-label="References">
      {refs.map((r, i) => {
        // A Library item shows its cover; an uploaded picture (a path inside runs/) shows itself.
        const upload = r.source.includes("/") && !r.source.includes("://");
        const cover = upload ? `/media/runs/${r.source.split("/").map(encodeURIComponent).join("/")}` : assets.find((a) => a.name === r.source)?.cover;
        const shown = upload ? r.source.split("/").pop() : `@${r.source}`;
        return (
          <li key={`${r.source}:${r.role}`} className="ref-chip">
            {cover ? <img className="ref-chip__cover" src={cover} alt="" /> : <span className="ref-chip__cover" aria-hidden="true" />}
            <span className="mono">{shown}</span>
            <span className="ref-chip__role">{r.role}</span>
            <button type="button" className="ref-chip__remove" aria-label={`Remove ${shown} ${r.role}`} onClick={() => removeRef(i)}>
              <Icon name="close" size={14} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Why Generate is off, a failed submit, and the code-5 hold, right above the button. */
export function GenerateMessages({ g, reasonId }: { g: Generate; reasonId: string }) {
  return (
    <>
      {g.reason && (
        <p id={reasonId} className="gen-msg gen-msg--reason" role="status">
          {g.reason}
          {g.lift != null && (
            <button type="button" className="gen-msg__lift" onClick={g.liftBudget}>
              Allow {usd(g.lift)} for this job
            </button>
          )}
        </p>
      )}
      {g.failure && (
        <p className="gen-msg gen-msg--failure" role="alert">
          {g.failure}
        </p>
      )}
      {g.unsure && (
        <div className="gen-msg gen-msg--failure gen-msg--unsure" role="alert">
          <p>{g.unsure}</p>
          <button type="button" className="button button--quiet" onClick={g.dismissUnsure}>
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}

/** The preset note under the prompt: the source prompt is to adapt, not to send as is. */
export function PresetNote({ preset, title }: { preset: string | null; title?: string }) {
  if (!preset) return null;
  return (
    <p className="preset-note">
      From the look <span className="mono">{title ?? preset}</span>: this is its source prompt. Adapt it to your subject before generating.
    </p>
  );
}
