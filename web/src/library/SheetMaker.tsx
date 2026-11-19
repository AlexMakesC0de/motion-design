// web/src/library/SheetMaker.tsx
// One Library item in the popup: its sheet first, then its details, with Save
// and Remove fixed along the bottom. A sheet comes one of three ways: made
// here on kie (priced on the button, spent only on that click), a picture you
// already have, or the free ChatGPT prompt. An item that has a sheet shows it
// and keeps the ways to replace it folded away.
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { api, ApiError } from "../api/client";
import type { AssetDetail, IncomingFile, JobView } from "../api/types";
import { Icon } from "../app/icons";
import { onStudioEvent } from "../app/useStudio";
import { usd } from "../studio/format";
import { KIND_ORDER, kindLabel } from "./kinds";
import { VoicePanel } from "./VoicePanel";

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

type Way = "make" | "upload" | "chatgpt";
type Offer = { model: string; usd: number } | null;

const message = (e: unknown) => (e instanceof ApiError ? e.message : String(e));
const upload = (file: File) => api<IncomingFile>("/api/library/incoming", { file: { data: file, name: file.name } });
const FAILED = new Set(["failed-charged", "failed-unconfirmed", "failed-confirmed-free", "refused"]);
const phase = (job: JobView) => (job.state === "succeeded" && job.media[0] ? "done" : FAILED.has(job.state) ? "failed" : "making");

/** A textarea that grows a row at a time with its text; nobody drags it. */
function useGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}

function GrowField({ id, value, onChange, placeholder, label }: { id: string; value: string; onChange(v: string): void; placeholder?: string; label?: string }) {
  const box = useRef<HTMLTextAreaElement>(null);
  useGrow(box, value);
  return <textarea ref={box} id={id} aria-label={label} className="field field--grow" rows={1} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

export function SheetMaker({ asset, onSaved, onClose, onRemoved, initialName = "" }: Props) {
  const id = useId();
  const editing = asset !== null;
  const existingSources = asset?.images.filter((im) => im.role === "source") ?? [];
  const sheet = asset?.images.find((im) => im.role === "sheet") ?? null;

  const [kind, setKind] = useState(asset?.kind ?? "character");
  const [name, setName] = useState(asset?.name ?? initialName);
  const [description, setDescription] = useState(asset?.description ?? "");
  const [keep, setKeep] = useState(asset?.keep ?? "");
  const [outfit, setOutfit] = useState("");
  const [view, setView] = useState("");
  const [sources, setSources] = useState<string[]>([]); // upload tokens, new items only
  const [sheetToken, setSheetToken] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [newOffer, setNewOffer] = useState<Offer>(null);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  // An item with a sheet keeps the ways to replace it folded away.
  const [replacing, setReplacing] = useState(!sheet);
  const offer: Offer = editing ? (asset.makeSheet ?? null) : kind === "style" ? null : newOffer;
  const [way, setWay] = useState<Way>(offer || !editing ? "make" : "upload");
  const [job, setJob] = useState<JobView | null>(asset?.sheetJob ?? null);
  const pick = useRef<HTMLInputElement>(null);
  const pickSources = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);

  const photos = editing ? existingSources.length : sources.length;
  const kept = Boolean(asset?.sheetJobKept && job && asset.sheetJob?.id === job.id);
  const jobPhase = job && !kept ? phase(job) : null;
  const dirty = editing && (kind !== asset.kind || description !== asset.description || keep !== (asset.keep ?? ""));
  const noSheetKind = kind === "style";
  const shownWay: Way = noSheetKind && way === "make" ? "upload" : way;

  // Opening moves focus into the popup, so Tab starts inside it.
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);

  // A saved item brings its latest sheet job; the stream keeps it live.
  useEffect(() => setJob(asset?.sheetJob ?? null), [asset]);
  useEffect(
    () =>
      onStudioEvent((e) => {
        if (e.event === "job") setJob((held) => (held && e.data.id === held.id && e.data.updatedAt >= held.updatedAt ? e.data : held));
      }),
    [],
  );

  // The ChatGPT prompt (and, for a new item, the price of making it here) follows the fields; core writes it.
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
      api<{ prompt: string; makeSheet?: Offer }>(`/api/library/sheet-prompt?${q}`)
        .then((r) => {
          if (!live) return;
          setPrompt(r.prompt);
          setNewOffer(r.makeSheet ?? null);
        })
        .catch(() => {});
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [kind, description, outfit, view, photos, editingPrompt]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const missing = () => (!name.trim() || !description.trim() ? "Give it a name and say what it is, then save." : null);

  /** A new item, saved with the sheet first (when there is one) and its photos after. */
  async function create(token: string | null) {
    const images = [...(token ? [{ src: token, role: "sheet" }] : []), ...sources.map((s) => ({ src: s, role: "source" }))];
    return api<AssetDetail>("/api/library", { method: "POST", body: { name: name.trim(), kind, description, keep, images } });
  }

  async function saveNew(token: string | null = sheetToken) {
    const why = missing() ?? (!token && !sources.length ? "Add a sheet or at least one photo, then save." : null);
    if (why) {
      setError(why);
      return;
    }
    await run(async () => onSaved(await create(token)));
  }

  async function takeSheet(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const { token } = await upload(file);
      if (asset) await run(async () => onSaved(await api<AssetDetail>(`/api/library/${encodeURIComponent(asset.name)}/sheet`, { method: "POST", body: { image: token } })));
      else {
        setSheetToken(token);
        await saveNew(token);
      }
    } catch (e) {
      setError(message(e));
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

  /** Spends: one image job on kie. A new item is saved first, with its photos. */
  async function makeHere() {
    if (!editing) {
      const why = missing() ?? (!sources.length ? "Add at least one photo of them first; the sheet is made from it." : null);
      if (why) {
        setError(why);
        return;
      }
    }
    await run(async () => {
      const target = editing ? asset.name : (await create(null)).name;
      onSaved(await api<AssetDetail>(`/api/library/${encodeURIComponent(target)}/make-sheet`, { method: "POST", body: { outfit } }));
    });
  }

  const keepMade = () =>
    job && asset && run(async () => onSaved(await api<AssetDetail>(`/api/library/${encodeURIComponent(asset.name)}/adopt`, { method: "POST", body: { job: job.id } })));

  const saveChanges = () =>
    asset && run(async () => onSaved(await api<AssetDetail>(`/api/library/${encodeURIComponent(asset.name)}`, { method: "PATCH", body: { kind, description, keep } })));

  async function remove() {
    if (!asset) return;
    const films = asset.usedIn.length;
    const used = films ? ` It is used in ${films} film${films === 1 ? "" : "s"}; scenes that mention it will show it in red.` : "";
    if (!window.confirm(`Remove @library:${asset.name}?${used} Its files move to library/.trash, so it can be put back.`)) return;
    await run(async () => {
      await api(`/api/library/${encodeURIComponent(asset.name)}`, { method: "DELETE" });
      onRemoved?.();
    });
  }

  async function copy() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
  }

  // ⌘V while the popup is open pastes the sheet.
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

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      takeSheet(e.dataTransfer.files[0]);
    },
  };

  const price = offer ? ` · ${usd(offer.usd)}` : "";
  const outfitField = kind === "character" && (
    <>
      <label className="field__label" htmlFor={`${id}-outfit`}>Outfit, head to toe</label>
      <GrowField id={`${id}-outfit`} value={outfit} onChange={setOutfit} placeholder="white tee, light blue jeans, white sneakers" />
    </>
  );

  return (
    <section ref={panel} tabIndex={-1} className="sheet-maker" role="dialog" aria-modal="true" aria-label={asset ? `@library:${asset.name}` : "New sheet"}>
      <header className="sheet-maker__head">
        <div className="sheet-maker__heading">
          <h2 className="sheet-maker__title">{asset ? <span className="mono">@library:{asset.name}</span> : "New sheet"}</h2>
          <p className="sheet-maker__sub">{asset ? `${kindLabel(asset.kind)} · ${sheet ? "has a sheet" : "no sheet yet"}` : "Say what it is, then make or add its sheet."}</p>
        </div>
        <button type="button" className="sheet-maker__close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </header>

      <div className="sheet-maker__body">
        {/* The sheet, first. */}
        {sheet?.url && (
          <figure className="sheet-maker__hero" data-over={over} {...dropProps}>
            <img src={sheet.url} alt={`Sheet for ${asset?.name}`} />
          </figure>
        )}

        {job && jobPhase && (
          <div className="sheet-made" data-phase={jobPhase} role="status">
            {jobPhase === "making" && (
              <p className="sheet-made__note">
                <span className="sheet-made__spin" aria-hidden="true" /> Making the sheet on {job.model}… about a minute.
              </p>
            )}
            {jobPhase === "done" && (
              <>
                <img className="sheet-made__img" src={job.media[0]} alt="The new sheet" />
                <p className="sheet-made__note">Face only in the close-up, oval over the front face, same outfit in all three? Keep it; the old sheet goes to history.</p>
                <div className="sheet-maker__actions">
                  <button type="button" className="button button--light" disabled={busy} onClick={keepMade}>
                    Keep this sheet
                  </button>
                  {offer && (
                    <button type="button" className="button" disabled={busy} onClick={makeHere}>
                      Make again{price}
                    </button>
                  )}
                </div>
              </>
            )}
            {jobPhase === "failed" && (
              <p className="sheet-made__note sheet-made__note--bad">
                The sheet did not come back{job.error ? `: ${job.error}` : "."} {job.state === "failed-confirmed-free" || job.state === "refused" ? "Nothing was spent." : ""}
              </p>
            )}
          </div>
        )}

        {sheet && !replacing ? (
          <button type="button" className="sheet-maker__replace" onClick={() => setReplacing(true)}>
            <Icon name="plus" size={14} /> Replace the sheet
          </button>
        ) : (
          <div className="sheet-get" role="group" aria-label={sheet ? "Replace the sheet" : "Get the sheet"}>
            <div className="sheet-get__top">
              <p className="sheet-get__title">{sheet ? "Replace the sheet" : "The sheet"}</p>
              {sheet && (
                <button type="button" className="sheet-get__fold" onClick={() => setReplacing(false)}>
                  Cancel
                </button>
              )}
            </div>
            <div className="seg seg--tight" role="tablist" aria-label="How to get the sheet">
              {(["make", "upload", "chatgpt"] as Way[])
                .filter((w) => w !== "make" || !noSheetKind)
                .map((w) => (
                  <button key={w} type="button" role="tab" aria-selected={shownWay === w} className="seg__item" onClick={() => setWay(w)}>
                    {w === "make" ? "Make it here" : w === "upload" ? "I have one" : "ChatGPT (free)"}
                  </button>
                ))}
            </div>

            {shownWay === "make" && (
              <div className="sheet-get__panel">
                <p className="field__hint">
                  Three panels from {editing ? "its photos" : "the photos you add below"} and what it is: face close-up, full body front with the face covered, full body back. One image job on kie; nothing is spent until you press the button.
                </p>
                {outfitField}
                <button type="button" className="generate sheet-get__go" disabled={busy || jobPhase === "making" || !description.trim()} onClick={makeHere}>
                  {jobPhase === "making" ? "Making…" : `${editing ? "Make the sheet" : "Save and make the sheet"}${price}`}
                </button>
              </div>
            )}

            {shownWay === "upload" && (
              <div className="sheet-get__panel">
                <div className="sheet-maker__drop" data-over={over} role="region" aria-label="Drop the sheet here" {...dropProps}>
                  <strong>Drop the sheet here</strong>, paste it (⌘V) or{" "}
                  <button type="button" className="sheet-maker__pick" onClick={() => pick.current?.click()}>
                    choose a file
                  </button>
                </div>
                {!editing && sheetToken && error && (
                  <button type="button" className="button" onClick={() => saveNew(sheetToken)}>
                    Save sheet
                  </button>
                )}
              </div>
            )}

            {shownWay === "chatgpt" && (
              <div className="sheet-get__panel">
                {outfitField}
                {kind === "location" && (
                  <>
                    <label className="field__label" htmlFor={`${id}-view`}>Camera view</label>
                    <input id={`${id}-view`} className="field" value={view} onChange={(e) => setView(e.target.value)} placeholder="3/4 wide-angle" />
                  </>
                )}
                {editingPrompt ? (
                  <GrowField id={`${id}-prompt`} label="Prompt" value={prompt} onChange={setPrompt} />
                ) : (
                  <p className="sheet-maker__prompt">{prompt || "Say what it is below to see the prompt."}</p>
                )}
                <div className="sheet-maker__actions">
                  <button type="button" className="button" disabled={!prompt} onClick={copy}>
                    Copy prompt for ChatGPT
                  </button>
                  <button type="button" className="button button--quiet" disabled={!prompt} onClick={() => setEditingPrompt((v) => !v)}>
                    {editingPrompt ? "Back to the written prompt" : "Edit prompt"}
                  </button>
                </div>
                <p className="field__hint" role={copied ? "status" : undefined}>
                  {copied ? "Copied. Paste it into ChatGPT." : "Paste it into ChatGPT with your photos, then bring the image back under I have one."}
                </p>
              </div>
            )}
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
        )}

        {asset && asset.kind === "character" && <VoicePanel asset={asset} onSaved={onSaved} />}

        {/* The details. */}
        <div className="sheet-maker__details">
          <p className="sheet-maker__section">Details</p>
          <div className="seg seg--tight" role="radiogroup" aria-label="Kind">
            {KIND_ORDER.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className="seg__item" onClick={() => setKind(k)}>
                {kindLabel(k)}
              </button>
            ))}
          </div>

          {!editing && (
            <>
              <label className="field__label" htmlFor={`${id}-name`}>Name</label>
              <input id={`${id}-name`} className="field mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="maya" autoComplete="off" />
              <p className="field__hint">
                You will write it as <span className="mono">@library:{name || "name"}</span>.
              </p>
            </>
          )}

          <label className="field__label" htmlFor={`${id}-what`}>What it is</label>
          <GrowField
            id={`${id}-what`}
            value={description}
            onChange={setDescription}
            placeholder={kind === "location" ? "an empty back alley with colourful graffiti" : "build, hair, face, overall vibe"}
          />

          <p className="field__label">Photos {editing ? "" : "(the sheet is made from these)"}</p>
          <div className="sheet-maker__photos">
            {existingSources.map((im) => (im.url ? <img key={im.n} src={im.url} alt={`Source photo ${im.n}`} /> : null))}
            {editing && !existingSources.length && <span className="field__hint">None. The sheet stands in for them.</span>}
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
          <GrowField id={`${id}-keep`} value={keep} onChange={setKeep} placeholder={kind === "character" ? "exact face, hair and glasses" : "colours, shape and markings"} />
        </div>
      </div>

      <footer className="sheet-maker__foot">
        {error && (
          <p className="sheet-maker__error" role="alert">
            {error}
          </p>
        )}
        {busy && (
          <p className="field__hint" role="status">
            Saving…
          </p>
        )}
        <div className="sheet-maker__foot-row">
          {editing ? (
            <button type="button" className="button button--danger" aria-label={`Remove @library:${asset.name} from the Library`} disabled={busy} onClick={remove}>
              Remove from Library
            </button>
          ) : (
            <button type="button" className="button button--quiet" onClick={onClose}>
              Cancel
            </button>
          )}
          {editing ? (
            <button type="button" className="button button--light button--lg" disabled={busy || !dirty} onClick={saveChanges}>
              Save changes
            </button>
          ) : (
            <button type="button" className="button button--light button--lg" disabled={busy} onClick={() => saveNew()}>
              Save to Library
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}
