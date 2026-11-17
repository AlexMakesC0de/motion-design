// web/src/studio/AttachMenu.tsx
// The dock's "+": a menu that opens upward with two ways in. Upload a picture
// from this computer (saved into the film's refs/ folder), or pick something
// saved in the Library. A row of "Use it as" pills sets the reference's role
// first. Pictures dropped anywhere on the dock arrive the same way as Upload.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, ApiError } from "../api/client";
import type { AssetSummary } from "../api/types";
import { Icon } from "../app/icons";
import { addRef } from "./promptStore";

const ROLE_WORDS: Record<string, string> = {
  identity: "Character",
  style: "Style",
  first_frame: "First frame",
  last_frame: "Last frame",
  motion: "Motion",
};
export const roleWord = (r: string) => ROLE_WORDS[r] ?? r.replace(/_/g, " ");

const ACCEPT = "image/png,image/jpeg,image/webp";

/** Upload one picture into the film's refs/ and add it to the draft under `role`. Returns the run-relative source. */
export async function attachFile(run: string, file: File, role: string) {
  const r = await api<{ source: string }>(`/api/films/${encodeURIComponent(run)}/refs?name=${encodeURIComponent(file.name)}`, { file: { data: file, name: file.name } });
  // The route answers "file:refs/<name>", relative to the film; generate reads paths relative to runs/.
  const source = `${run}/${r.source.replace(/^file:/, "")}`;
  addRef({ source, role });
  return source;
}

type View = "menu" | "library";

export function AttachMenu({ run, assets, roles, onError }: { run: string; assets: AssetSummary[]; roles: string[]; onError(message: string | null): void }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [role, setRole] = useState(roles[0] ?? "");
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const picked = roles.includes(role) ? role : (roles[0] ?? "");

  const close = (focus = true) => {
    setOpen(false);
    setView("menu");
    if (focus) button.current?.focus();
  };

  // A click anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  // Opening moves focus into the menu, onto its first choice.
  useEffect(() => {
    if (open) wrap.current?.querySelector<HTMLElement>(".attach__item, .attach__asset")?.focus();
  }, [open, view]);

  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      if (view === "library") setView("menu");
      else close();
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const items = [...(wrap.current?.querySelectorAll<HTMLElement>(".attach__item, .attach__asset") ?? [])];
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (at < 0 || !items.length) return;
      e.preventDefault();
      items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
    }
  };

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!run) {
      onError("Pick a film to work in first; uploads are kept in its folder.");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await attachFile(run, file, picked);
      close();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const pickAsset = (name: string) => {
    addRef({ source: name, role: picked });
    close();
  };

  return (
    <div className="attach" ref={wrap} onKeyDown={keys}>
      <button
        ref={button}
        type="button"
        className="dock-chip dock-chip--icon attach__button"
        aria-label="Add a reference"
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open || undefined}
        disabled={!roles.length}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name="plus" size={18} />
      </button>
      <input ref={fileInput} className="sr-only" type="file" accept={ACCEPT} tabIndex={-1} aria-label="Picture to upload" onChange={(e) => void upload(e.target.files?.[0])} />

      {open && (
        <div className="attach__panel" data-view={view}>
          {roles.length > 1 && (
            <div className="attach__roles" role="radiogroup" aria-label="Use it as">
              <span className="attach__roles-label">Use it as</span>
              {roles.map((r) => (
                <button key={r} type="button" role="radio" aria-checked={r === picked} className="attach__role" onClick={() => setRole(r)}>
                  {roleWord(r)}
                </button>
              ))}
            </div>
          )}

          {view === "menu" ? (
            <div className="attach__list" role="menu" aria-label="Add a reference">
              <button type="button" role="menuitem" className="attach__item" disabled={busy} onClick={() => fileInput.current?.click()}>
                <span className="attach__tile">
                  <Icon name="upload" size={20} />
                </span>
                <span className="attach__words">
                  <span className="attach__title">{busy ? "Uploading…" : "Upload from your computer"}</span>
                  <span className="attach__text">PNG, JPG or WebP. Or drop a picture on the prompt.</span>
                </span>
              </button>
              <button type="button" role="menuitem" className="attach__item" onClick={() => setView("library")}>
                <span className="attach__tile attach__tile--stack" aria-hidden="true">
                  {assets.slice(0, 3).map((a) => (a.cover ? <img key={a.name} src={a.cover} alt="" /> : <span key={a.name} />))}
                  {!assets.some((a) => a.cover) && <Icon name="library" size={20} />}
                </span>
                <span className="attach__words">
                  <span className="attach__title">From your Library</span>
                  <span className="attach__text">{assets.length ? `${assets.length} saved character${assets.length === 1 ? "" : "s"}, products and places` : "Nothing saved yet"}</span>
                </span>
                <span className="attach__chevron" aria-hidden="true">
                  <Icon name="arrow" size={16} />
                </span>
              </button>
            </div>
          ) : (
            <div className="attach__library">
              <div className="attach__head">
                <button type="button" className="attach__back" aria-label="Back" onClick={() => setView("menu")}>
                  <Icon name="arrow" size={16} />
                </button>
                <span className="attach__head-title">Library</span>
                <a className="attach__manage" href="#/library">
                  Manage
                </a>
              </div>
              {assets.length ? (
                <ul className="attach__grid" role="menu" aria-label="Library">
                  {assets.map((a) => (
                    <li key={a.name} role="none">
                      <button type="button" role="menuitem" className="attach__asset" onClick={() => pickAsset(a.name)}>
                        {a.cover ? <img src={a.cover} alt="" /> : <span className="attach__asset-empty" aria-hidden="true"><Icon name="image" size={18} /></span>}
                        <span className="attach__asset-name">{a.name}</span>
                        <span className="attach__asset-kind">{a.kind}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="attach__empty">
                  Save a character, product or place in the <a href="#/library">Library</a> and it shows up here.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
