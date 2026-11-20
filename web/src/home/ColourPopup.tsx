// web/src/home/ColourPopup.tsx
// The Colour card's popup: the palette the video's colour grade should follow.
// A grid of palettes, each a still (or its colours when it has none) over its
// strip of colours; picking one sets picks.palette, which the server words as
// "Colour palette: …" after the prompt. "New palette" pulls the colours out of
// a picture of yours and keeps it in your Library with them.
//
// Built-in palettes ship in cli/director/menu.json; their stills sit in
// runs/palettes/ (never committed). Your own come from /api/palettes.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { api } from "../api/client";
import menu from "../../../cli/director/menu.json";
import { setPick } from "../../../cli/director/picks.mjs";
import { Icon } from "../app/icons";
import { useOnScreen } from "../app/useOnScreen";
import { getDraft, setDraft, type VideoPicks } from "../studio/promptStore";
import { paletteFromFile } from "./paletteFromImage";
import "./colour.css";

export interface Palette {
  id: string;
  label: string;
  colors: string[];
  when?: string;
  still?: string | null;
  own?: boolean;
}

// Stills and your own palettes, fetched once for the page and again after a change.
let fetched: { stills: Record<string, string>; own: Palette[] } = { stills: {}, own: [] };
let asked = false;
const listeners = new Set<() => void>();
export function refreshPalettes() {
  asked = true;
  return api<{ stills?: Record<string, string>; own?: Palette[] }>("/api/palettes")
    .then((v) => {
      fetched = { stills: v?.stills ?? {}, own: (v?.own ?? []).map((p) => ({ ...p, own: true })) };
      for (const l of listeners) l();
    })
    .catch(() => {}); // no server: the built-in palettes still show, as colours
}
function subscribe(l: () => void) {
  if (!asked) void refreshPalettes();
  listeners.add(l);
  return () => listeners.delete(l);
}
/** Every palette: yours first (newest first), then the built-in ones. */
export function usePalettes(): Palette[] {
  const f = useSyncExternalStore(subscribe, () => fetched);
  return useMemo(() => [...f.own, ...menu.palettes.map((p) => ({ ...p, still: f.stills[p.id] ?? null }))], [f]);
}

/** A palette's colours as even bands, for a card or a tile without a still. */
export const bands = (colors: string[]) => `linear-gradient(90deg, ${colors.map((c, i) => `${c} ${(i / colors.length) * 100}% ${((i + 1) / colors.length) * 100}%`).join(", ")})`;

const setPalette = (id: string | undefined) => setDraft({ picks: (setPick(getDraft().picks, "palette", id) ?? {}) as VideoPicks });

function Strip({ colors }: { colors: string[] }) {
  return (
    <span className="pal-strip" aria-hidden="true">
      {colors.map((c, i) => (
        <span key={i} style={{ background: c }} />
      ))}
    </span>
  );
}

function PaletteTile({ p, picked, onRemove }: { p: Palette; picked: boolean; onRemove?(): void }) {
  return (
    <div className="pal-tile">
      <button type="button" className="pal-tile__pick" aria-pressed={picked} title={p.when} onClick={() => setPalette(picked ? undefined : p.id)}>
        <span className="pal-tile__media">
          {p.still ? <img src={p.still} alt="" draggable={false} /> : <span className="pal-tile__bands" style={{ background: bands(p.colors) }} />}
          <Strip colors={p.colors} />
          {picked && (
            <span className="pal-tile__check">
              <Icon name="check" size={12} />
            </span>
          )}
        </span>
        <span className="pal-tile__label">{p.label}</span>
      </button>
      {onRemove && (
        <button type="button" className="pal-tile__remove" aria-label={`Remove ${p.label}`} onClick={onRemove}>
          <Icon name="close" size={12} />
        </button>
      )}
    </div>
  );
}

/** The picture you chose, its colours and a name, before it is saved. */
function NewPalette({ draft, onDone }: { draft: { colors: string[]; picture: string; name: string }; onDone(): void }) {
  const [name, setName] = useState(draft.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const made = await api<Palette>("/api/palettes", { method: "POST", body: { name, colors: draft.colors, picture: draft.picture } });
      await refreshPalettes();
      setPalette(made.id);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };
  return (
    <form
      className="pal-new"
      aria-label="New palette"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <span className="pal-new__media">
        <img src={draft.picture} alt="The picture the palette comes from" />
        <Strip colors={draft.colors} />
      </span>
      <div className="pal-new__side">
        <h3 className="pal-new__title">New palette</h3>
        <p className="pal-new__hint">These {draft.colors.length} colours came from your picture. Name it to keep it with your Library.</p>
        <label className="pal-new__field">
          <span>Name</span>
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        {error && <p className="pal-new__error">{error}</p>}
        <div className="pal-new__actions">
          <button type="button" className="pal-btn" onClick={onDone}>
            Cancel
          </button>
          <button type="submit" className="pal-btn pal-btn--go" disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Save and use"}
          </button>
        </div>
      </div>
    </form>
  );
}

export function ColourPopup({ picks, anchor, onClose }: { picks: VideoPicks; anchor: RefObject<HTMLElement | null>; onClose(): void }) {
  const panel = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useOnScreen(panel, true);
  const palettes = usePalettes();
  const [query, setQuery] = useState("");
  const [draft, setDraftPalette] = useState<{ colors: string[]; picture: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const away = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!panel.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    document.addEventListener("keydown", esc);
    document.addEventListener("mousedown", away);
    return () => {
      document.removeEventListener("keydown", esc);
      document.removeEventListener("mousedown", away);
    };
  }, [onClose, anchor]);

  const q = query.trim().toLowerCase();
  const shown = palettes.filter((p) => !q || p.label.toLowerCase().includes(q) || (p.when ?? "").toLowerCase().includes(q));
  const remove = async (p: Palette) => {
    try {
      await api(`/api/palettes/${encodeURIComponent(p.id)}`, { method: "DELETE" });
      if (getDraft().picks.palette === p.id) setPalette(undefined);
      await refreshPalettes();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div ref={panel} className="cam-pop pal-pop" role="dialog" aria-label="Colour palette">
      <div className="cam-pop__top">
        <h2 className="cam-pop__title">Colour palette</h2>
        <button type="button" className="cam-pop__reset" disabled={!picks.palette} onClick={() => setPalette(undefined)}>
          Reset
        </button>
        <button type="button" className="cam-pop__close" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="pal-body">
        {draft ? (
          <NewPalette draft={draft} onDone={() => setDraftPalette(null)} />
        ) : (
          <>
            <div className="pal-head">
              <div>
                <h3 className="pal-head__title">Set up colour palette</h3>
                <p className="pal-head__hint">The palette the colour grade should follow.</p>
              </div>
              <label className="cam-search">
                <Icon name="look" size={14} />
                <input type="search" placeholder="Search palettes" aria-label="Search palettes" value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
            </div>
            {error && <p className="pal-new__error">{error}</p>}
            <div className="pal-grid">
              {!q && (
                <div className="pal-tile">
                  <button type="button" className="pal-tile__pick pal-tile__pick--new" onClick={() => fileInput.current?.click()}>
                    <span className="pal-tile__media pal-tile__media--new">
                      <span className="pal-plus">
                        <Icon name="plus" size={18} />
                      </span>
                    </span>
                    <span className="pal-tile__label">New palette</span>
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/*"
                    hidden
                    aria-label="Picture for a new palette"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      setError(null);
                      try {
                        const made = await paletteFromFile(file);
                        if (made.colors.length < 2) throw new Error("That picture has too few colours to make a palette.");
                        setDraftPalette({ ...made, name: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 40) || "My palette" });
                      } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                      }
                    }}
                  />
                </div>
              )}
              {shown.map((p) => (
                <PaletteTile key={p.id} p={p} picked={picks.palette === p.id} onRemove={p.own ? () => void remove(p) : undefined} />
              ))}
              {!shown.length && <p className="cam-empty">No palette matches “{query}”.</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
