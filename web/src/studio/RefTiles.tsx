// web/src/studio/RefTiles.tsx
// Video's references, laid out like Openjutsu's inputs: a large tile to add
// one, then each reference as a picture tile with its role. Adding opens a
// roomy picker beside the panel: AI influencers and the Library, with the
// role chosen as chips along the top.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { AssetSummary } from "../api/types";
import { Icon } from "../app/icons";
import { Empty, Pick } from "../jutsu/JutsuScreen";
import { addRef, removeRef, type RefDraft } from "./promptStore";
import { useSideMenu } from "./useSideMenu";
import "../jutsu/jutsu.css";

type Tab = "influencers" | "library";
type Kind = "all" | "character" | "product" | "location" | "style";
const KIND_WORDS: Record<Kind, string> = { all: "All", character: "Characters", product: "Products", location: "Locations", style: "Styles" };
const roleWords = (r: string) => (r[0]?.toUpperCase() ?? "") + r.slice(1).replace(/_/g, " ");

/** A reference's picture and the name shown for it: a Library item's cover, or an uploaded picture inside runs/. */
function refView(r: RefDraft, assets: AssetSummary[]) {
  const upload = r.source.includes("/") && !r.source.includes("://");
  const cover = upload ? `/media/runs/${r.source.split("/").map(encodeURIComponent).join("/")}` : (assets.find((a) => a.name === r.source)?.cover ?? null);
  const shown = upload ? (r.source.split("/").pop() ?? r.source) : `@${r.source}`;
  return { cover, shown };
}

/**
 * Openjutsu's picker for a reference: AI influencers and the Library, the role
 * as chips along the top. `onUpload` adds a tile that picks a picture from this
 * computer; `className` places it (the Studio dock opens it upward).
 */
export function RefPickerPanel({
  assets,
  roles,
  refs,
  onClose,
  anchor,
  className,
  onUpload,
  uploading,
}: {
  assets: AssetSummary[];
  roles: string[];
  refs: RefDraft[];
  onClose(): void;
  anchor: RefObject<HTMLElement | null>;
  className?: string;
  onUpload?(role: string): void;
  uploading?: boolean;
}) {
  const influencers = assets.filter((a) => a.persona);
  const others = assets.filter((a) => !a.persona);
  const [tab, setTab] = useState<Tab>(influencers.length ? "influencers" : "library");
  const [role, setRole] = useState(roles[0] ?? "");
  const [kind, setKind] = useState<Kind>("all");
  const { menu, style, side } = useSideMenu<HTMLDivElement>(true, anchor, { fill: true });
  const kinds = (["all", "character", "product", "location", "style"] as Kind[]).filter((k) => k === "all" || others.some((a) => a.kind === k));
  const shown = (tab === "influencers" ? influencers : others.filter((a) => kind === "all" || a.kind === kind));

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
    <div ref={menu} className={`ref-pop${className ? ` ${className}` : ""}`} data-side={side} style={style} role="menu" aria-label="Add a reference">
      <div className="jutsu-picker__top">
        <div className="jutsu-picker__tabs" role="tablist" aria-label="Where the reference comes from">
          {(["influencers", "library"] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className="jutsu-picker__tab" onClick={() => setTab(t)}>
              {t === "influencers" ? "AI Influencer" : "Library"}
            </button>
          ))}
        </div>
        <button type="button" className="jutsu-picker__close" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="jutsu-picker__panel">
        <div className="jutsu-picker__bar" role="group" aria-label="Role">
          <span className="jutsu-picker__count">As</span>
          {roles.map((r) => (
            <button key={r} type="button" className="jutsu-picker__chip" aria-pressed={role === r} onClick={() => setRole(r)}>
              {roleWords(r)}
            </button>
          ))}
        </div>
        {tab === "library" && kinds.length > 2 && (
          <div className="jutsu-picker__bar" role="group" aria-label="Kind">
            {kinds.map((k) => (
              <button key={k} type="button" className="jutsu-picker__chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {KIND_WORDS[k]}
              </button>
            ))}
          </div>
        )}
        <div className="jutsu-picker__body">
          {shown.length || (onUpload && tab === "library") ? (
            <div className="jutsu-picker__grid">
              {onUpload && tab === "library" && (
                <button type="button" className="jutsu-picker__upload" disabled={uploading} onClick={() => onUpload(role)}>
                  <span className="jutsu-picker__upload-icon" aria-hidden="true">
                    <Icon name="upload" size={20} />
                  </span>
                  {uploading ? "Uploading…" : "From your computer"}
                </button>
              )}
              {shown.map((a) => (
                <Pick
                  key={a.name}
                  media={a.cover ?? null}
                  label={`${a.persona?.displayName ?? `@${a.name}`} as ${roleWords(role).toLowerCase()}`}
                  caption={a.persona?.displayName ?? `@${a.name}`}
                  picked={refs.some((r) => r.source === a.name && r.role === role)}
                  onPick={() => {
                    addRef({ source: a.name, role });
                    onClose();
                  }}
                />
              ))}
            </div>
          ) : tab === "influencers" ? (
            <Empty tone="pink" icon="sheet" title="Your AI influencers will appear here">
              Build one in <a href="#/influencers">AI Influencers</a> and cast them in any shot.
            </Empty>
          ) : (
            <Empty tone="violet" icon="library" title="Your Library will appear here">
              Save a character, product, place or style in the <a href="#/library">Library</a>.
            </Empty>
          )}
        </div>
      </div>
    </div>
  );
}

/** The references on the draft as tiles, and the tile that adds one. */
export function RefTiles({ refs, assets, roles }: { refs: RefDraft[]; assets: AssetSummary[]; roles: string[] }) {
  const [open, setOpen] = useState(false);
  const add = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const none = !roles.length;
  return (
    <section className="ref-tiles" aria-label="References">
      {refs.length ? (
        <ul className="ref-tiles__grid">
          {refs.map((r, i) => {
            const { cover, shown } = refView(r, assets);
            return (
              <li key={`${r.source}:${r.role}`} className="ref-tile">
                {cover ? <img className="ref-tile__media" src={cover} alt="" /> : <span className="ref-tile__media" aria-hidden="true" />}
                <span className="ref-tile__caption">
                  <span className="ref-tile__name">{shown}</span>
                  <span className="ref-tile__role">{roleWords(r.role)}</span>
                </span>
                <button type="button" className="ref-tile__remove" aria-label={`Remove ${shown} ${r.role}`} onClick={() => removeRef(i)}>
                  <Icon name="close" size={12} />
                </button>
              </li>
            );
          })}
          <li className="ref-tile ref-tile--add">
            <button ref={add} type="button" className="ref-tile__add" aria-label="Add reference" aria-expanded={open} disabled={none} onClick={() => setOpen((o) => !o)}>
              <Icon name="plus" size={18} />
            </button>
          </li>
        </ul>
      ) : (
        <button ref={add} type="button" className="ref-tiles__empty" aria-expanded={open} disabled={none} onClick={() => setOpen((o) => !o)} aria-label="Add references">
          <span className="ref-tiles__icon" aria-hidden="true">
            <Icon name="sheet" size={18} />
          </span>
          <span className="ref-tiles__title">Add references</span>
          <span className="ref-tiles__hint">{none ? "This model takes no references" : "AI influencers or your Library, as a role the model takes"}</span>
        </button>
      )}
      {open && <RefPickerPanel assets={assets} roles={roles} refs={refs} anchor={add} onClose={close} />}
    </section>
  );
}
