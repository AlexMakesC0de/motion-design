// web/src/library/LibraryScreen.tsx
// Everything you can @library:, and the sheet maker to add more.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { AssetDetail, AssetSummary } from "../api/types";
import { onStudioEvent } from "../app/useStudio";
import { KIND_ORDER, KIND_PLURAL, kindLabel } from "./kinds";
import { SheetMaker } from "./SheetMaker";
import "./library.css";

type Open = { mode: "new" } | { mode: "edit"; asset: AssetDetail } | null;

const films = (n: number) => (n ? `in ${n} film${n === 1 ? "" : "s"}` : "not used yet");

export function LibraryScreen() {
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [kind, setKind] = useState<string>("all");
  const [open, setOpen] = useState<Open>(null);

  const load = useCallback(() => api<AssetSummary[]>("/api/library").then(setAssets).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);
  // The event carries core's list without covers, so read the full list again.
  useEffect(() => onStudioEvent((e) => e.event === "library" && load()), [load]);

  const edit = (name: string) =>
    api<AssetDetail>(`/api/library/${encodeURIComponent(name)}`)
      .then((asset) => setOpen({ mode: "edit", asset }))
      .catch(() => {});

  const count = (k: string) => assets.filter((a) => a.kind === k).length;
  const shown = kind === "all" ? assets : assets.filter((a) => a.kind === kind);

  return (
    <div className="library" data-open={open !== null}>
      <div className="library__main">
        <header className="library__head">
          <h1>Library</h1>
          <div className="library__filters" role="group" aria-label="Kind">
            <button type="button" className="filter" aria-pressed={kind === "all"} onClick={() => setKind("all")}>
              All <span className="filter__n mono">{assets.length}</span>
            </button>
            {KIND_ORDER.map((k) => (
              <button key={k} type="button" className="filter" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {KIND_PLURAL[k]} <span className="filter__n mono">{count(k)}</span>
              </button>
            ))}
          </div>
        </header>

        <ul className="cards" aria-label="Library">
          <li>
            <button type="button" className="card-new" onClick={() => setOpen({ mode: "new" })}>
              <span className="card-new__plus" aria-hidden="true">
                +
              </span>
              New sheet
              <span className="card-new__hint">character · location · prop</span>
            </button>
          </li>
          {shown.map((a) => (
            <li key={a.name}>
              <button type="button" className="card-item" aria-pressed={open?.mode === "edit" && open.asset.name === a.name} onClick={() => edit(a.name)}>
                {a.hasSheet && a.cover ? <img src={a.cover} alt="" loading="lazy" /> : <span className="card-item__blank">no sheet yet</span>}
                <span className="card-item__name mono">@library:{a.name}</span>
                <span className="card-item__meta">
                  {kindLabel(a.kind)} · {films(a.usedIn?.length ?? 0)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!assets.length && <p className="library__empty">Nothing here yet. Start with a sheet of yourself: + New sheet, Character.</p>}
      </div>

      {open && (
        <SheetMaker
          key={open.mode === "edit" ? open.asset.name : "new"}
          asset={open.mode === "edit" ? open.asset : null}
          onSaved={(asset) => {
            load();
            setOpen({ mode: "edit", asset });
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
