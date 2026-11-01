import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import type { AssetSummary } from "../api/types";
import { kindLabel } from "../library/kinds";
import "./scene.css";

export interface RefChooserProps {
  /** Which slot this fills: the picture for @image<n>. */
  n: number;
  library: AssetSummary[];
  onPick(source: string): void;
  /** Stores a picture in the film and resolves to its source ("file:refs/<name>"). */
  onUpload(file: File): Promise<string>;
  onClose(): void;
}

/** Choose a picture for a slot: a Library item (its sheet), an uploaded file, or a pasted picture. */
export function RefChooser({ n, library, onPick, onUpload, onClose }: RefChooserProps) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);

  // Focus moves in on open and back to where it came from on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    searchBox.current?.focus();
    return () => before?.focus?.();
  }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const found = library.filter((a) => !q || `${a.name} ${a.description} ${a.kind}`.toLowerCase().includes(q));
    // Sheets first; the sort is stable, so each group keeps the Library's order.
    return [...found].sort((a, b) => Number(!!b.hasSheet) - Number(!!a.hasSheet));
  }, [library, search]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onPick(await onUpload(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const paste = (e: ClipboardEvent) => {
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
    if (!file) return; // plain text pastes into the search box as usual
    e.preventDefault();
    void upload(file);
  };

  const keys = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    onClose();
  };

  return (
    <div className="ref-chooser__backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={`Choose a picture for @image${n}`} className="ref-chooser" onKeyDown={keys} onPaste={paste}>
        <header className="ref-chooser__head">
          <h2 className="ref-chooser__title">Choose a picture for <span className="mono">@image{n}</span></h2>
          <button type="button" className="button button--quiet" aria-label="Close" onClick={onClose}>×</button>
        </header>

        <input ref={searchBox} type="search" className="field ref-chooser__search" aria-label="Search the Library" placeholder="Search the Library" value={search} onChange={(e) => setSearch(e.target.value)} />

        <ul className="ref-chooser__cards" aria-label="Library">
          {shown.map((a) => (
            <li key={a.name}>
              <button type="button" className="ref-chooser__card" disabled={!a.hasSheet} onClick={() => onPick(`library:${a.name}`)}>
                {a.hasSheet && a.cover ? <img src={a.cover} alt="" loading="lazy" /> : <span className="ref-chooser__blank" aria-hidden="true" />}
                <span className="ref-chooser__name mono">@library:{a.name}</span>
                <span className="ref-chooser__meta">{kindLabel(a.kind)}{a.hasSheet ? "" : " · no sheet yet"}</span>
              </button>
            </li>
          ))}
        </ul>
        {!shown.length && <p className="ref-chooser__empty">{library.length ? "Nothing in the Library matches." : "The Library is empty. Upload a picture instead."}</p>}

        <div className="ref-chooser__upload">
          <label htmlFor={`${id}-file`}>Upload a picture</label>
          <input id={`${id}-file`} type="file" accept="image/*" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
          <span className="ref-chooser__hint">or paste one (⌘V)</span>
        </div>
        {error && <p role="alert" className="ref-chooser__error">{error}</p>}
      </div>
    </div>
  );
}
