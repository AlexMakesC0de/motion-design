// web/src/library/SheetMaker.tsx
// Make a Library sheet the ChatGPT way: fill a few fields, copy the prompt,
// make the image in ChatGPT, bring it back. Never spends kie credits.
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { AssetDetail, IncomingFile } from "../api/types";
import { Icon } from "../app/icons";
import { KIND_ORDER, kindLabel } from "./kinds";

interface Props {
  /** null: a new item. Otherwise the item being edited. */
  asset: AssetDetail | null;
  onSaved: (asset: AssetDetail) => void;
  onClose: () => void;
  /** The item was removed from the Library. */
  onRemoved?: () => void;
  /** Fills the Name of a new item, when the mention that sent you here named it. */
  initialName?: string;
}

const message = (e: unknown) => (e instanceof ApiError ? e.message : String(e));
const upload = (file: File) => api<IncomingFile>("/api/library/incoming", { file: { data: file, name: file.name } });

export function SheetMaker({ asset, onSaved, onClose, onRemoved, initialName = "" }: Props) {
  const id = useId();
  const editing = asset !== null;
  const [kind, setKind] = useState(asset?.kind ?? "character");
  const [name, setName] = useState(asset?.name ?? initialName);
  const [description, setDescription] = useState(asset?.description ?? "");
  const [outfit, setOutfit] = useState("");
  const [view, setView] = useState("");
  const [keep, setKeep] = useState(asset?.keep ?? "");
  const [sources, setSources] = useState<string[]>([]); // upload tokens, new items only
  const [sheetToken, setSheetToken] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const pickSources = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);
  // Opening moves focus into the popup, so Tab starts inside it.
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);

  const existingSources = asset?.images.filter((im) => im.role === "source") ?? [];
  const sheet = asset?.images.find((im) => im.role === "sheet") ?? null;
  const photos = editing ? existingSources.length : sources.length;

  // The prompt follows the fields; core writes it. A hand-edited prompt is left alone.
  useEffect(() => {
    if (editingPrompt) return;
    setCopied(false);
    if (!description.trim()) {
      setPrompt("");
      return;
    }
    const q = new URLSearchParams({ kind, description, outfit, view, photos: String(photos) });
    let live = true;
    const t = setTimeout(() => {
      api<{ prompt: string }>(`/api/library/sheet-prompt?${q}`)
        .then((r) => live && setPrompt(r.prompt))
        .catch(() => {});
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [kind, description, outfit, view, photos, editingPrompt]);

  async function copy() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
  }

  async function saveNew(token: string) {
    if (!name.trim() || !description.trim()) {
      setError("Give it a name and say what it is, then save.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const images = [{ src: token, role: "sheet" }, ...sources.map((s) => ({ src: s, role: "source" }))];
      onSaved(await api<AssetDetail>("/api/library", { method: "POST", body: { name: name.trim(), kind, description, keep, images } }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function takeSheet(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const { token } = await upload(file);
      if (asset) {
        setBusy(true);
        onSaved(await api<AssetDetail>(`/api/library/${encodeURIComponent(asset.name)}/sheet`, { method: "POST", body: { image: token } }));
      } else {
        setSheetToken(token);
        await saveNew(token);
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function takeSources(files: FileList | null) {
    if (!files) return;
    setError(null);
    try {
      const tokens: string[] = [];
      for (const file of Array.from(files).slice(0, 3 - sources.length)) tokens.push((await upload(file)).token);
      setSources((s) => [...s, ...tokens]);
    } catch (e) {
      setError(message(e));
    }
  }

  async function saveChanges() {
    if (!asset) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api<AssetDetail>(`/api/library/${encodeURIComponent(asset.name)}`, { method: "PATCH", body: { kind, description, keep } }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!asset) return;
    const films = asset.usedIn.length;
    const used = films ? ` It is used in ${films} film${films === 1 ? "" : "s"}; scenes that mention it will show it in red.` : "";
    if (!window.confirm(`Remove @library:${asset.name}?${used} Its files move to library/.trash, so it can be put back.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/library/${encodeURIComponent(asset.name)}`, { method: "DELETE" });
      onRemoved?.();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  // ⌘V while the panel is open pastes the sheet.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        takeSheet(file);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  return (
    <section ref={panel} tabIndex={-1} className="sheet-maker" role="dialog" aria-modal="true" aria-label={asset ? `@library:${asset.name}` : "New sheet"}>
      <header className="sheet-maker__head">
        <div className="sheet-maker__heading">
          <h2 className="sheet-maker__title">{asset ? <span className="mono">@library:{asset.name}</span> : "New sheet"}</h2>
          <p className="sheet-maker__sub">{asset ? `${kindLabel(asset.kind)} · ${sheet ? "has a sheet" : "no sheet yet"}` : "Write the prompt here, make the image in ChatGPT, bring it back."}</p>
        </div>
        <button type="button" className="sheet-maker__close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </header>

      {sheet?.url && (
        <figure className="sheet-maker__hero">
          <img src={sheet.url} alt={`Sheet for ${asset?.name}`} />
        </figure>
      )}

      <div className="seg" role="radiogroup" aria-label="Kind">
        {KIND_ORDER.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className="seg__item" onClick={() => setKind(k)}>
            {kindLabel(k)}
          </button>
        ))}
      </div>

      <label className="field__label" htmlFor={`${id}-name`}>Name</label>
      <input id={`${id}-name`} className="field mono" value={name} readOnly={editing} onChange={(e) => setName(e.target.value)} placeholder="maya" autoComplete="off" />
      <p className="field__hint">
        You will write it as <span className="mono">@library:{name || "name"}</span>.
      </p>

      <label className="field__label" htmlFor={`${id}-what`}>What it is</label>
      <textarea
        id={`${id}-what`}
        className="field"
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={kind === "location" ? "an empty back alley with colourful graffiti" : "build, hair, face, overall vibe"}
      />

      {kind === "character" && (
        <>
          <label className="field__label" htmlFor={`${id}-outfit`}>Outfit, head to toe</label>
          <input id={`${id}-outfit`} className="field" value={outfit} onChange={(e) => setOutfit(e.target.value)} />
        </>
      )}
      {kind === "location" && (
        <>
          <label className="field__label" htmlFor={`${id}-view`}>Camera view</label>
          <input id={`${id}-view`} className="field" value={view} onChange={(e) => setView(e.target.value)} placeholder="3/4 wide-angle" />
        </>
      )}

      <p className="field__label">Reference photos (optional; you attach these in ChatGPT)</p>
      <div className="sheet-maker__photos">
        {existingSources.map((im) => (im.url ? <img key={im.n} src={im.url} alt={`Source photo ${im.n}`} /> : null))}
        {!editing &&
          sources.map((t, i) => (
            <span key={t} className="sheet-maker__photo mono">
              photo {i + 1}
            </span>
          ))}
        {!editing && sources.length < 3 && (
          <button type="button" className="sheet-maker__add" onClick={() => pickSources.current?.click()}>
            + Add photo
          </button>
        )}
        <input
          ref={pickSources}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(e) => {
            takeSources(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <label className="field__label" htmlFor={`${id}-keep`}>When a scene uses it, keep</label>
      <input
        id={`${id}-keep`}
        className="field"
        value={keep}
        onChange={(e) => setKeep(e.target.value)}
        placeholder={kind === "character" ? "exact face, hair and glasses" : "colours, shape and markings"}
      />

      {editing && (
        <button type="button" className="button" disabled={busy} onClick={saveChanges}>
          Save changes
        </button>
      )}

      <ol className="sheet-maker__steps">
        <li>
          <h3 className="sheet-maker__step">Copy the prompt</h3>
          {editingPrompt ? (
            <textarea className="field sheet-maker__prompt" aria-label="Prompt" rows={8} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          ) : (
            <p className="sheet-maker__prompt">{prompt || "Say what it is to see the prompt."}</p>
          )}
          <div className="sheet-maker__actions">
            <button type="button" className="generate" disabled={!prompt} onClick={copy}>
              Copy prompt for ChatGPT
            </button>
            <button type="button" className="button button--quiet" disabled={!prompt} onClick={() => setEditingPrompt((v) => !v)}>
              {editingPrompt ? "Back to the written prompt" : "Edit prompt"}
            </button>
          </div>
          {copied && (
            <p className="field__hint" role="status">
              Copied. Paste it into ChatGPT.
            </p>
          )}
        </li>
        <li>
          <h3 className="sheet-maker__step">Paste it into ChatGPT</h3>
          <p className="field__hint">Attach your photos there too. Make a few; images cost you nothing there.</p>
        </li>
        <li>
          <h3 className="sheet-maker__step">{sheet ? "Replace the sheet" : "Bring the best one back"}</h3>
          <div
            className="sheet-maker__drop"
            data-over={over}
            role="region"
            aria-label="Drop the sheet here"
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              takeSheet(e.dataTransfer.files[0]);
            }}
          >
            <strong>Drop the image here</strong>, paste it (⌘V) or{" "}
            <button type="button" className="sheet-maker__pick" onClick={() => pick.current?.click()}>
              choose a file
            </button>
            <input
              ref={pick}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                takeSheet(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          {busy && (
            <p className="field__hint" role="status">
              Saving…
            </p>
          )}
          {!editing && sheetToken && error && (
            <button type="button" className="button" onClick={() => saveNew(sheetToken)}>
              Save sheet
            </button>
          )}
        </li>
      </ol>
      {error && (
        <p className="sheet-maker__error" role="alert">
          {error}
        </p>
      )}
      {editing && (
        <button type="button" className="sheet-maker__remove" aria-label={`Remove @library:${asset.name} from the Library`} disabled={busy} onClick={remove}>
          Remove from Library
        </button>
      )}
    </section>
  );
}
