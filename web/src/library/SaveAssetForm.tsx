import { useId, useState } from "react";
import { api, ApiError } from "../api/client";
import type { AssetDetail } from "../api/types";

interface Props {
  /** Upload tokens ("incoming:…") or paths inside runs/ ("zed/out.png"). */
  images: string[];
  kinds: string[];
  /** A name to start from, such as the film's. */
  suggestedName?: string;
  onSaved: (asset: AssetDetail) => void;
  onCancel: () => void;
}

/** Name, kind and description for a new asset. Core checks all three and the images. */
export function SaveAssetForm({ images, kinds, suggestedName = "", onSaved, onCancel }: Props) {
  const id = useId();
  const [name, setName] = useState(suggestedName);
  const [kind, setKind] = useState(kinds[0] ?? "");
  const [description, setDescription] = useState("");
  const [replace, setReplace] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onSaved(await api<AssetDetail>("/api/library", { method: "POST", body: { name, kind, description, images, replace } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="save-asset" onSubmit={save} aria-label="Save to library">
      <label htmlFor={`${id}-name`}>Name</label>
      <input id={`${id}-name`} className="mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="zed" autoComplete="off" />
      <p className="save-asset__hint">Lowercase letters, digits and hyphens. You will use it as @{name || "name"}.</p>
      <label htmlFor={`${id}-kind`}>Kind</label>
      <select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value)}>
        {kinds.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-description`}>Description</label>
      <textarea id={`${id}-description`} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Reused word for word in prompts." />
      <label className="save-asset__replace">
        <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace an asset with this name (the old one is kept in its history)
      </label>
      {error && (
        <p className="save-asset__error" role="alert">
          {error}
        </p>
      )}
      <div className="save-asset__actions">
        <button type="submit" className="button" disabled={saving || !name || !description.trim() || !images.length}>
          {saving ? "Saving…" : `Save ${images.length} image${images.length === 1 ? "" : "s"}`}
        </button>
        <button type="button" className="button button--quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
