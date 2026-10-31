import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { AssetDetail, AssetSummary, IncomingFile, Vocab } from "../api/types";
import { onStudioEvent } from "../app/useStudio";
import { takeCost, takeSpec } from "../studio/format";
import { addRef, setRun } from "../studio/promptStore";
import { SaveAssetForm } from "./SaveAssetForm";
import "./library.css";

interface Drop {
  id: number;
  name: string;
  preview: string | null;
  token: string | null;
  error: string | null;
}

const objectUrl = (file: File) => (typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null);
let nextDrop = 1;

function goToCreate() {
  window.location.hash = "#/create";
}

/** One asset: its images, where it was used, and a way into the prompt bar. */
function AssetPanel({ name, roles, onClose }: { name: string; roles: string[]; onClose: () => void }) {
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState("");

  useEffect(() => {
    setAsset(null);
    api<AssetDetail>(`/api/library/${encodeURIComponent(name)}`)
      .then(setAsset)
      .catch((e: ApiError) => setError(e.message));
  }, [name]);

  if (error) return <p className="asset-panel__error" role="alert">{error}</p>;
  if (!asset) return <p className="asset-panel__loading">Loading @{name}…</p>;
  const pickedRole = role || (asset.kind === "style" && roles.includes("style") ? "style" : roles.includes("identity") ? "identity" : (roles[0] ?? ""));

  return (
    <section className="asset-panel" aria-label={`@${asset.name}`}>
      <header className="asset-panel__head">
        <h2 className="mono">@{asset.name}</h2>
        <button type="button" className="button button--quiet" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <p className="asset-panel__kind">{asset.kind}</p>
      <p className="asset-panel__description">{asset.description}</p>
      <div className="asset-panel__images">
        {asset.images.map((im) =>
          im.url ? <img key={im.n} src={im.url} alt={`${asset.name}#${im.n}`} title={`${asset.name}#${im.n} · ${im.width ?? "?"}×${im.height ?? "?"}`} /> : null,
        )}
      </div>
      <div className="asset-panel__use">
        <label htmlFor="asset-role">Role</label>
        <select id="asset-role" className="mono" value={pickedRole} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button"
          disabled={!pickedRole}
          onClick={() => {
            addRef({ source: asset.name, role: pickedRole });
            goToCreate();
          }}
        >
          Use in prompt
        </button>
      </div>
      <h3>Used in</h3>
      {asset.usedIn.length ? <p className="mono asset-panel__runs">{asset.usedIn.join(", ")}</p> : <p className="asset-panel__none">Not used in a film yet.</p>}
      <h3>Takes</h3>
      {asset.takes.length ? (
        <ul className="asset-panel__takes">
          {asset.takes.map((t) => (
            <li key={t.id}>
              <span className="mono">
                {takeSpec(t)} · <span className="asset-panel__cost">{takeCost(t)}</span> · {t.state}
              </span>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => {
                  setRun(t.run);
                  goToCreate();
                }}
              >
                Show in {t.run}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="asset-panel__none">No takes have used it yet.</p>
      )}
    </section>
  );
}

export function LibraryScreen() {
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [vocab, setVocab] = useState<Vocab>({ kinds: [], roles: [] });
  const [kind, setKind] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [drops, setDrops] = useState<Drop[]>([]);
  const [saving, setSaving] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api<AssetSummary[]>("/api/library").then(setAssets).catch(() => {}), []);
  useEffect(() => {
    load();
    api<Vocab>("/api/vocab").then(setVocab).catch(() => {});
  }, [load]);
  // The event carries core's list without covers, so read the full list again.
  useEffect(() => onStudioEvent((e) => e.event === "library" && load()), [load]);

  const update = (id: number, patch: Partial<Drop>) => setDrops((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  async function take(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const id = nextDrop++;
      setDrops((list) => [...list, { id, name: file.name, preview: objectUrl(file), token: null, error: null }]);
      try {
        const r = await api<IncomingFile>("/api/library/incoming", { file: { data: file, name: file.name } });
        update(id, { token: r.token });
      } catch (e) {
        update(id, { error: e instanceof ApiError ? e.message : String(e) });
      }
    }
  }

  const clearDrops = () => {
    drops.forEach((d) => d.preview && URL.revokeObjectURL?.(d.preview));
    setDrops([]);
    setSaving(false);
  };

  const ready = drops.filter((d) => d.token).map((d) => d.token as string);
  const shown = kind === "all" ? assets : assets.filter((a) => a.kind === kind);

  return (
    <div className="library">
      <header className="library__head">
        <h1>Library</h1>
        <div className="library__filters" role="group" aria-label="Kind">
          {["all", ...vocab.kinds].map((k) => (
            <button key={k} type="button" className="filter" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k}
            </button>
          ))}
        </div>
      </header>

      <div
        className="drop"
        data-over={over}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
        role="region"
        aria-label="Drop images here"
      >
        <p>
          Drop PNG, JPEG or WebP images here, or{" "}
          <button type="button" className="drop__pick" onClick={() => input.current?.click()}>
            choose files
          </button>
          . Each asset holds 1 to 4 images.
        </p>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) take(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {drops.length > 0 && (
        <section className="tray" aria-label="Dropped files">
          <ul className="tray__list">
            {drops.map((d) => (
              <li key={d.id} className="tray__item" data-state={d.error ? "refused" : d.token ? "ready" : "sending"}>
                {d.preview && !d.error && <img src={d.preview} alt="" />}
                <span className="tray__name mono">{d.name}</span>
                {d.error && <span role="alert" className="tray__error">{d.error}</span>}
                {!d.error && !d.token && <span className="tray__status">checking…</span>}
              </li>
            ))}
          </ul>
          <div className="tray__actions">
            {ready.length > 0 && (
              <button type="button" className="button" disabled={ready.length > 4} onClick={() => setSaving(true)}>
                Save {ready.length} as an asset
              </button>
            )}
            <button type="button" className="button button--quiet" onClick={clearDrops}>
              Clear
            </button>
            {ready.length > 4 && <span className="tray__note">An asset holds at most 4 images. Clear and drop fewer.</span>}
          </div>
          {saving && (
            <SaveAssetForm
              images={ready}
              kinds={vocab.kinds}
              onSaved={(a) => {
                clearDrops();
                load();
                setOpen(a.name);
              }}
              onCancel={() => setSaving(false)}
            />
          )}
        </section>
      )}

      <div className="library__body">
        <ul className="assets" aria-label="Assets">
          {shown.map((a) => (
            <li key={a.name}>
              <button type="button" className="asset" aria-pressed={open === a.name} onClick={() => setOpen(a.name)}>
                {a.cover ? <img src={a.cover} alt="" loading="lazy" /> : <span className="asset__blank" aria-hidden="true" />}
                <span className="asset__name mono">@{a.name}</span>
                <span className="asset__meta">
                  {a.kind} · {a.imageCount} image{a.imageCount === 1 ? "" : "s"}
                  {a.usedIn?.length ? ` · ${a.usedIn.length} film${a.usedIn.length === 1 ? "" : "s"}` : ""}
                </span>
              </button>
            </li>
          ))}
          {!shown.length && <li className="assets__empty">{assets.length ? `No ${kind} assets yet.` : "No assets yet. Drop images above to save your first."}</li>}
        </ul>
        {open && <AssetPanel name={open} roles={vocab.roles} onClose={() => setOpen(null)} />}
      </div>
    </div>
  );
}
