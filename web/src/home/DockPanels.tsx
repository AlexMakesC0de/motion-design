// web/src/home/DockPanels.tsx
// What the Studio's setting cards open, and the references inside the prompt
// box. Look is a grid of the Looks' previews; Camera is four tabs (move, shot
// size, angle, lens) over one list of options with their "when to use it"
// notes; Lighting is that list alone. Every list starts with Auto, which
// clears the pick and leaves it to the AI.
import { useCallback, useEffect, useRef, useState } from "react";
import { useOnScreen } from "../app/useOnScreen";
import { useDismiss } from "../studio/DockMenu";
import menu from "../../../cli/director/menu.json";
import { setPick } from "../../../cli/director/picks.mjs";
import type { AssetSummary, LookInfo } from "../api/types";
import { Icon } from "../app/icons";
import { roleWord } from "../studio/AttachMenu";
import { swatchStyle } from "../studio/LookPicker";
import { applyLook, clearLook, getDraft, removeRef, setDraft, setRefRole, type RefDraft, type VideoPicks } from "../studio/promptStore";

interface Option {
  id: string;
  label: string;
  when: string;
}

type PickKey = "move" | "size" | "angle" | "lens" | "light" | "speed";
const pick = (key: PickKey, id: string | undefined) => setDraft({ picks: (setPick(getDraft().picks, key, id) ?? {}) as VideoPicks });

/** Auto, then the options; picking the chosen one again goes back to Auto. */
function OptionList({ label, options, value, onPick }: { label: string; options: Option[]; value: string | undefined; onPick(id: string | undefined): void }) {
  return (
    <ul className="xopts" aria-label={label}>
      <li>
        <button type="button" className="xopts__item" aria-pressed={!value} onClick={() => onPick(undefined)}>
          <span className="xopts__words">
            <span className="xopts__name">Auto</span>
            <span className="xopts__when">The AI picks from the prompt</span>
          </span>
          {!value && <Icon name="check" size={14} />}
        </button>
      </li>
      {options.map((o) => (
        <li key={o.id}>
          <button type="button" className="xopts__item" aria-pressed={value === o.id} onClick={() => onPick(value === o.id ? undefined : o.id)}>
            <span className="xopts__words">
              <span className="xopts__name">{o.label}</span>
              <span className="xopts__when">{o.when}</span>
            </span>
            {value === o.id && <Icon name="check" size={14} />}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function LookPanel({ looks, chosen, onDone }: { looks: LookInfo[]; chosen: LookInfo | null; onDone(): void }) {
  return (
    <div className="xpanel xpanel--wide">
      <p className="xpanel__head">Look</p>
      <ul className="xlooks" aria-label="Looks">
        <li>
          <button
            type="button"
            className="xlooks__item"
            aria-pressed={!chosen}
            onClick={() => {
              clearLook(chosen);
              onDone();
            }}
          >
            <span className="xlooks__art xlooks__art--auto">
              <Icon name="look" size={20} />
            </span>
            <span className="xlooks__title">Auto</span>
          </button>
        </li>
        {looks.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              className="xlooks__item"
              aria-pressed={chosen?.id === l.id}
              title={l.tagline}
              onClick={() => {
                applyLook(l);
                onDone();
              }}
            >
              <span className="xlooks__art" style={l.still ? undefined : swatchStyle(l)}>
                {l.still && <img src={l.still} alt="" loading="lazy" />}
              </span>
              <span className="xlooks__title">{l.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LightPanel({ picks }: { picks: VideoPicks }) {
  return (
    <div className="xpanel">
      <p className="xpanel__head">Lighting</p>
      <OptionList label="Lighting" options={menu.lights} value={picks.light} onPick={(id) => pick("light", id)} />
    </div>
  );
}

/** A reference's picture and the name shown for it: a Library item's cover, or an uploaded picture inside runs/. */
export function refView(r: RefDraft, assets: AssetSummary[]) {
  const upload = r.source.includes("/") && !r.source.includes("://");
  const cover = upload ? `/media/runs/${r.source.split("/").map(encodeURIComponent).join("/")}` : (assets.find((a) => a.name === r.source)?.cover ?? null);
  const shown = upload ? (r.source.split("/").pop() ?? r.source) : `@${r.source}`;
  return { cover, shown };
}

/** The references on the draft, inside the prompt box: a picture, the name, the role (click to change it), and remove. */
export function RefStrip({ refs, assets, roles }: { refs: RefDraft[]; assets: AssetSummary[]; roles: string[] }) {
  if (!refs.length) return null;
  return (
    <ul className="xrefs" aria-label="References">
      {refs.map((r, i) => {
        const { cover, shown } = refView(r, assets);
        const next = roles.length > 1 ? roles[(roles.indexOf(r.role) + 1) % roles.length] : null;
        return (
          <li key={`${r.source}:${r.role}`} className="xrefs__item">
            {cover ? <img className="xrefs__media" src={cover} alt="" /> : <span className="xrefs__media" aria-hidden="true" />}
            <span className="xrefs__words">
              <span className="xrefs__name">{shown}</span>
              {next ? (
                <button type="button" className="xrefs__role" title={`Use as ${roleWord(next).toLowerCase()} instead`} aria-label={`${shown} is used as ${roleWord(r.role).toLowerCase()}; change to ${roleWord(next).toLowerCase()}`} onClick={() => setRefRole(i, next)}>
                  {roleWord(r.role)}
                </button>
              ) : (
                <span className="xrefs__role">{roleWord(r.role)}</span>
              )}
            </span>
            <button type="button" className="xrefs__remove" aria-label={`Remove ${shown} ${r.role}`} onClick={() => removeRef(i)}>
              <Icon name="close" size={10} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The prompt's +: attach a picture to this take, or make a new Library item to use again. */
export function AddMenu({ disabled, busy, onAttach }: { disabled: boolean; busy: boolean; onAttach(): void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, wrap, close);
  useOnScreen(panel, open);
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>(".xaddmenu__item")?.focus();
  }, [open]);
  return (
    <div className="dmenu" ref={wrap}>
      <button
        type="button"
        className="dock-chip dock-chip--icon xadd"
        aria-label="Add"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="plus" size={16} />
      </button>
      {open && (
        <div ref={panel} className="dmenu__panel xaddmenu" role="menu" aria-label="Add">
          <button
            type="button"
            role="menuitem"
            className="xaddmenu__item"
            disabled={disabled}
            title={disabled ? "This model takes no references" : undefined}
            onClick={() => {
              setOpen(false);
              onAttach();
            }}
          >
            <span className="dmenu__tile" aria-hidden="true">
              <Icon name="upload" size={16} />
            </span>
            <span className="dmenu__words">
              <span className="dmenu__name">Attach a picture</span>
              <span className="dmenu__blurb">From your computer, for this take only</span>
            </span>
          </button>
          <a role="menuitem" className="xaddmenu__item" href="#/library/new">
            <span className="dmenu__tile" aria-hidden="true">
              <Icon name="library" size={16} />
            </span>
            <span className="dmenu__words">
              <span className="dmenu__name">New Library asset</span>
              <span className="dmenu__blurb">A character, product or place to @mention again</span>
            </span>
          </a>
        </div>
      )}
    </div>
  );
}
