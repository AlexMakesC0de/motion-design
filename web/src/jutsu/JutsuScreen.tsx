// web/src/jutsu/JutsuScreen.tsx
// Openjutsu: one reference video and one character picture make one take.
// Motion transfer has the character perform the video's motion (Kling motion
// control, Standard 2.6 or Pro 3.0); Swap puts the character into the video in
// place of its person (Wan 2.2 Animate Replace). Left: a compact form that fits
// the window, whose pickers open as menus to its right. Right: the Motion
// Library of uploaded clips (with how many takes each made) and the History of
// takes. Prices come from the server, from the clip's own length.
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import type { JobView, JutsuCast, JutsuClip, JutsuEstimate, JutsuGeneration, JutsuLibraryPicture, JutsuModel, JutsuView } from "../api/types";
import { Icon } from "../app/icons";
import { useJobs } from "../studio/useJobs";
import { takeCost, takeStatus, usd } from "../studio/format";
import "./jutsu.css";

type Mode = "motion" | "swap";
type Tier = "standard" | "pro";
type Facing = "video" | "image";
type Panel = "library" | "history";
type Sort = "trending" | "latest";
type MenuId = "tier" | "quality" | "facing" | "cast" | "clip";

const VIDEO_ACCEPT = "video/mp4,video/quicktime";
const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const MODE_WORDS: Record<Mode, string> = { motion: "Motion transfer", swap: "Swap" };
const MODE_HINT: Record<Mode, string> = {
  motion: "Your character performs the video's motion.",
  swap: "Your character replaces the person in the video.",
};
const TIER_WORDS: Record<Tier, string> = { standard: "Standard", pro: "Pro" };
const FACING_WORDS: Record<Facing, string> = { video: "As in the video", image: "As in the picture" };
/** What shared clips will be filed under once people can upload to the Motion Library. */
const CATEGORIES = ["All", "Dance", "Action", "Sports", "Comedy", "Fashion", "Lifestyle"] as const;
type Category = (typeof CATEGORIES)[number];

const seconds = (s: number | null) => (s == null ? "length unknown" : `${s < 10 ? s.toFixed(1) : Math.round(s)}s`);
const mb = (b: number) => `${Math.round(b / 1e6)} MB`;

/** POST one file to the jutsu upload route. */
async function uploadFile(kind: "video" | "image", file: File) {
  return api<{ name: string; media: string | null; durationS?: number | null }>(`/api/jutsu/upload?kind=${kind}&name=${encodeURIComponent(file.name)}`, {
    file: { data: file, name: file.name },
  });
}

/** A menu that opens to the right of the form, beside the row that opened it. Escape or a click elsewhere closes it. */
function SideMenu({ label, onClose, children, wide }: { label: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!box.current?.contains(t) && !t.closest("[data-menu-trigger]")) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    box.current?.querySelector<HTMLElement>("[aria-checked='true'], button")?.focus();
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return (
    <div ref={box} className="jutsu-menu" data-wide={wide || undefined} role="menu" aria-label={label}>
      {children}
    </div>
  );
}

/** One compact settings row: label left, value right, a menu to the side when open. */
function SettingRow({
  label,
  value,
  open,
  onToggle,
  onClose,
  options,
  current,
  onPick,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle(): void;
  onClose(): void;
  options: { value: string; label: string; note?: string }[];
  current: string;
  onPick(v: string): void;
}) {
  return (
    <div className="jutsu-row">
      <button type="button" className="jutsu-row__button" data-menu-trigger aria-haspopup="menu" aria-expanded={open} aria-label={`${label}: ${value}`} onClick={onToggle}>
        <span className="jutsu-row__label">{label}</span>
        <span className="jutsu-row__value">{value}</span>
        <Icon name="arrow" size={14} />
      </button>
      {open && (
        <SideMenu label={label} onClose={onClose}>
          <p className="jutsu-menu__title">{label}</p>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === current}
              className="jutsu-menu__item"
              onClick={() => {
                onPick(o.value);
                onClose();
              }}
            >
              <span>{o.label}</span>
              {o.note && <span className="jutsu-menu__note mono">{o.note}</span>}
              {o.value === current && <Icon name="check" size={14} />}
            </button>
          ))}
        </SideMenu>
      )}
    </div>
  );
}

/** A square input tile: empty it invites a file, filled it shows the file edge to edge. */
function InputTile({
  label,
  icon,
  title,
  hint,
  busy,
  media,
  still,
  caption,
  onOpen,
  onFile,
  onClear,
  trigger,
  children,
}: {
  label: string;
  icon: string;
  title: string;
  hint: string;
  busy: boolean;
  media: string | null;
  still?: boolean;
  caption: ReactNode;
  onOpen(): void;
  onFile(f: File): void;
  onClear(): void;
  trigger?: boolean;
  children?: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };
  return (
    <div className="jutsu-tile" data-over={over || undefined} data-filled={Boolean(media) || undefined} onDragOver={(e) => (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)} onDrop={drop}>
      {media ? (
        <>
          {still ? <img className="jutsu-tile__media" src={media} alt="" /> : <video className="jutsu-tile__media" src={media} muted loop autoPlay playsInline />}
          <button type="button" className="jutsu-tile__swap" data-menu-trigger={trigger || undefined} aria-label={`Change ${label}`} onClick={onOpen}>
            <span className="jutsu-tile__caption">{caption}</span>
          </button>
          <button type="button" className="jutsu-tile__clear" aria-label={`Remove ${label}`} onClick={onClear}>
            <Icon name="close" size={12} />
          </button>
        </>
      ) : (
        <button type="button" className="jutsu-tile__empty" data-menu-trigger={trigger || undefined} disabled={busy} onClick={onOpen} aria-label={`Add ${label}`}>
          <span className="jutsu-tile__icon" aria-hidden="true">
            <Icon name={icon} size={18} />
          </span>
          <span className="jutsu-tile__title">{busy ? "Uploading…" : title}</span>
          <span className="jutsu-tile__hint">{hint}</span>
        </button>
      )}
      {children}
    </div>
  );
}

type CastTab = "uploads" | "influencers" | "library" | "generations";
type LibraryKind = "all" | "character" | "product";
const CAST_TABS: { id: CastTab; label: string }[] = [
  { id: "uploads", label: "Uploads" },
  { id: "influencers", label: "AI Influencer" },
  { id: "library", label: "Library" },
  { id: "generations", label: "Generations" },
];

/** A centred empty state: a coloured icon tile, what will appear, and how. */
export function Empty({ tone, icon, title, children }: { tone: "blue" | "violet" | "pink"; icon: string; title: string; children: ReactNode }) {
  return (
    <div className="jutsu-picker__empty">
      <span className="jutsu-picker__badge" data-tone={tone} aria-hidden="true">
        <Icon name={icon} size={26} />
      </span>
      <p className="jutsu-picker__empty-title">{title}</p>
      <p className="jutsu-picker__empty-text">{children}</p>
    </div>
  );
}

/** One picture to pick, with a caption under it. */
export function Pick({ media, label, caption, picked, onPick, video, meta }: { media: string | null; label: string; caption: string; picked: boolean; onPick(): void; video?: boolean; meta?: string }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={picked} aria-label={label} className="jutsu-picker__pick" onClick={onPick}>
      <span className="jutsu-picker__thumb">
        {media && (video ? <video src={`${media}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" /> : <img src={media} alt="" loading="lazy" />)}
        {meta && <span className="jutsu-picker__meta mono">{meta}</span>}
      </span>
      <span className="jutsu-picker__caption">{caption}</span>
      {picked && (
        <span className="jutsu-picker__check" aria-hidden="true">
          <Icon name="check" size={12} />
        </span>
      )}
    </button>
  );
}

/**
 * The character picker: a roomy panel beside the form with Uploads (and the
 * upload tile), the Library's pictures, and pictures generated in the studio.
 */
function CastPicker({
  uploads,
  library,
  generations,
  current,
  busy,
  onPick,
  onUpload,
  onClose,
}: {
  uploads: JutsuCast[];
  library: JutsuLibraryPicture[];
  generations: JutsuGeneration[];
  current: string | null;
  busy: boolean;
  onPick(ref: string): void;
  onUpload(): void;
  onClose(): void;
}) {
  // Motion transfer wants one clear picture of a person: an influencer's face, never the two-view sheet.
  const influencers = library.filter((p) => p.influencer && p.role !== "sheet");
  const [tab, setTab] = useState<CastTab>(influencers.some((p) => p.ref === current) ? "influencers" : current?.startsWith("@") ? "library" : current?.startsWith("gen:") ? "generations" : library.length ? "library" : "uploads");
  const [kind, setKind] = useState<LibraryKind>("all");
  const shownLibrary = library.filter((p) => kind === "all" || p.kind === kind);
  const kinds = (["all", "character", "product"] as LibraryKind[]).filter((k) => k === "all" || library.some((p) => p.kind === k));
  return (
    <SideMenu label="Choose a character" onClose={onClose} wide>
      <div className="jutsu-picker__top">
        <div className="jutsu-picker__tabs" role="tablist" aria-label="Where the character comes from">
          {CAST_TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="jutsu-picker__tab" onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" className="jutsu-picker__close" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="jutsu-picker__panel">
        {tab === "library" && kinds.length > 1 && (
          <div className="jutsu-picker__bar" role="group" aria-label="Kind">
            {kinds.map((k) => (
              <button key={k} type="button" className="jutsu-picker__chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === "all" ? "All" : k === "character" ? "Characters" : "Products"}
              </button>
            ))}
          </div>
        )}
        {tab === "uploads" && (
          <div className="jutsu-picker__bar">
            <span className="jutsu-picker__count">{uploads.length ? `${uploads.length} uploaded, newest first` : "Pictures you upload here stay here"}</span>
          </div>
        )}

        <div className="jutsu-picker__body">
          {tab === "uploads" && (
            <div className="jutsu-picker__grid">
              <button type="button" className="jutsu-picker__upload" disabled={busy} onClick={onUpload}>
                <span className="jutsu-picker__upload-icon" aria-hidden="true">
                  <Icon name="upload" size={20} />
                </span>
                {busy ? "Uploading…" : "Upload media"}
              </button>
              {uploads.map((c) => (
                <Pick key={c.name} media={c.media} label={`Upload ${c.name}`} caption={c.name} picked={current === c.name} onPick={() => onPick(c.name)} />
              ))}
            </div>
          )}
          {tab === "influencers" &&
            (influencers.length ? (
              <div className="jutsu-picker__grid">
                {influencers.map((p) => (
                  <Pick key={p.ref} media={p.media} label={p.influencer!} caption={p.influencer!} picked={current === p.ref} onPick={() => onPick(p.ref)} />
                ))}
              </div>
            ) : (
              <Empty tone="pink" icon="sheet" title="Your AI influencers will appear here">
                Build one in <a href="#/influencers">AI Influencers</a> and cast them in any take.
              </Empty>
            ))}
          {tab === "library" &&
            (shownLibrary.length ? (
              <div className="jutsu-picker__grid">
                {shownLibrary.map((p) => (
                  <Pick key={p.ref} media={p.media} label={`${p.asset}, picture ${p.n}`} caption={`@${p.asset}${library.filter((x) => x.asset === p.asset).length > 1 ? ` · ${p.n}` : ""}`} picked={current === p.ref} onPick={() => onPick(p.ref)} />
                ))}
              </div>
            ) : (
              <Empty tone="violet" icon="library" title="Your saved characters will appear here">
                Save a face or product in the <a href="#/library">Library</a> to cast it in any take.
              </Empty>
            ))}
          {tab === "generations" &&
            (generations.length ? (
              <div className="jutsu-picker__grid">
                {generations.map((g) => (
                  <Pick key={g.ref} media={g.media} label={`Generated picture from ${g.run}${g.prompt ? `: ${g.prompt.slice(0, 60)}` : ""}`} caption={g.run} picked={current === g.ref} onPick={() => onPick(g.ref)} />
                ))}
              </div>
            ) : (
              <Empty tone="blue" icon="image" title="Your image generations will appear here">
                Make pictures in <a href="#/image">Create Image</a> to cast them here.
              </Empty>
            ))}
        </div>
      </div>
    </SideMenu>
  );
}

const clipLabel = (c: JutsuClip) => `Use the motion of ${c.name}, ${seconds(c.durationS)}${c.uses ? `, used in ${c.uses} take${c.uses === 1 ? "" : "s"}` : ""}`;

/** The reference-video picker: your uploaded clips, newest first, with the upload tile. */
function ClipPicker({ clips, current, busy, onPick, onUpload, onClose }: { clips: JutsuClip[]; current: string | null; busy: boolean; onPick(name: string): void; onUpload(): void; onClose(): void }) {
  const list = [...clips].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  return (
    <SideMenu label="Choose a reference video" onClose={onClose} wide>
      <div className="jutsu-picker__top">
        <div className="jutsu-picker__tabs" role="tablist" aria-label="Where the video comes from">
          <button type="button" role="tab" aria-selected className="jutsu-picker__tab">
            Uploads
          </button>
        </div>
        <button type="button" className="jutsu-picker__close" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="jutsu-picker__panel">
        <div className="jutsu-picker__bar">
          <span className="jutsu-picker__count">{list.length ? `${list.length} uploaded, newest first` : "Videos you upload stay here to use again"}</span>
        </div>
        <div className="jutsu-picker__body">
          <div className="jutsu-picker__grid">
            <button type="button" className="jutsu-picker__upload" disabled={busy} onClick={onUpload}>
              <span className="jutsu-picker__upload-icon" aria-hidden="true">
                <Icon name="upload" size={20} />
              </span>
              {busy ? "Uploading…" : "Upload video"}
            </button>
            {list.map((c) => (
              <Pick key={c.name} video media={c.media} label={clipLabel(c)} caption={c.name} meta={seconds(c.durationS)} picked={current === c.name} onPick={() => onPick(c.name)} />
            ))}
          </div>
        </div>
      </div>
    </SideMenu>
  );
}

/** A take in History: the video when it is done, its state while it runs or after it failed. */
function TakeTile({ job, models, now }: { job: JobView; models: JutsuModel[]; now: number }) {
  const status = takeStatus(job, now);
  const label = models.find((m) => m.id === job.model)?.label ?? job.model;
  const media = job.media[0];
  return (
    <li className="jutsu-take" data-state={status.kind}>
      <div className="jutsu-take__media">
        {status.kind === "done" && media ? (
          <video src={media} controls playsInline preload="metadata" aria-label={`${label} take`} />
        ) : (
          <div className="jutsu-take__state">
            {status.kind === "failed" ? <Icon name="close" size={18} /> : <span className="jutsu-take__pulse" aria-hidden="true" />}
            <span>{"label" in status ? status.label : ""}</span>
            {status.kind === "failed" && <span className="jutsu-take__reason">{status.reason}</span>}
          </div>
        )}
      </div>
      <div className="jutsu-take__line">
        <span>{label}</span>
        <span className="mono">{[job.resolution, job.durationS != null ? `${Number(job.durationS).toFixed(1)}s` : null, takeCost(job)].filter(Boolean).join(" · ")}</span>
      </div>
      {media && status.kind === "done" && (
        <a className="jutsu-take__download" href={media} download aria-label={`Download the ${label} take`}>
          <Icon name="download" size={14} />
        </a>
      )}
    </li>
  );
}

export function JutsuScreen() {
  const [view, setView] = useState<JutsuView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("motion");
  const [tier, setTier] = useState<Tier>("standard");
  const [resolution, setResolution] = useState<string>("720p");
  const [facing, setFacing] = useState<Facing>("video");
  const [video, setVideo] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [promptOn, setPromptOn] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [uploading, setUploading] = useState<"video" | "image" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<JutsuEstimate | null>(null);
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState<MenuId | null>(null);
  const [panel, setPanel] = useState<Panel>("library");
  const [category, setCategory] = useState<Category>("All");
  const [sort, setSort] = useState<Sort>("trending");
  const [now, setNow] = useState(Date.now());
  const videoInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const { jobs } = useJobs("jutsu");
  const closeMenu = useCallback(() => setMenu(null), []);
  const toggle = (id: MenuId) => setMenu((m) => (m === id ? null : id));

  const load = useCallback(
    () =>
      api<JutsuView>("/api/jutsu")
        .then((v) => {
          setView(v);
          setLoadError(null);
        })
        .catch((e) => setLoadError(e instanceof ApiError ? e.message : String(e))),
    [],
  );
  useEffect(() => void load(), [load]);
  // A finished take changes the clips' use counts.
  const finished = jobs.filter((j) => j.state === "succeeded").length;
  useEffect(() => void load(), [finished, load]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const models = view?.models ?? [];
  const model = models.find((m) => m.mode === mode && (mode === "swap" || m.tier === tier)) ?? null;
  // Keep the resolution valid for the model in use.
  useEffect(() => {
    if (model && !model.resolutions.includes(resolution)) setResolution(model.defaultResolution ?? model.resolutions[0]);
  }, [model, resolution]);
  const clip = view?.clips.find((c) => c.name === video) ?? null;
  const library = view?.library ?? [];
  const uploads = view?.cast ?? [];
  const generated = view?.generations.find((g) => g.ref === image) ?? null;
  const castMedia = image?.startsWith("@")
    ? (library.find((p) => p.ref === image)?.media ?? null)
    : generated
      ? generated.media
      : (uploads.find((c) => c.name === image)?.media ?? null);
  const castName = image?.startsWith("@") ? image.slice(1).replace(/#(\d+)$/, " · $1") : generated ? `generated · ${generated.run}` : image;

  // The price and what would refuse it, from the server, whenever an input changes.
  useEffect(() => {
    if (!model || !model.resolutions.includes(resolution)) return;
    const ticket = { live: true };
    const t = setTimeout(() => {
      api<JutsuEstimate>("/api/jutsu/estimate", {
        method: "POST",
        body: { model: model.id, resolution, orientation: model.orientations ? facing : undefined, video: video ?? undefined, image: image ?? undefined },
      })
        .then((e) => ticket.live && setEstimate(e))
        .catch(() => ticket.live && setEstimate(null));
    }, 150);
    return () => {
      ticket.live = false;
      clearTimeout(t);
    };
  }, [model, resolution, facing, video, image]);

  /** A new mode starts at its model's default quality: Swap's 720p is its dearest, not a carry-over. */
  function pickMode(m: Mode) {
    if (m === mode) return;
    setMode(m);
    setMenu(null);
    const next = models.find((x) => x.mode === m && (m === "swap" || x.tier === tier));
    if (next?.defaultResolution) setResolution(next.defaultResolution);
  }

  async function upload(kind: "video" | "image", file: File) {
    setUploading(kind);
    setError(null);
    setMenu(null);
    try {
      const r = await uploadFile(kind, file);
      await load();
      if (kind === "video") setVideo(r.name);
      else setImage(r.name);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setUploading(null);
    }
  }

  async function generate() {
    if (!model || !video || !image) return;
    setSending(true);
    setError(null);
    try {
      await api("/api/jutsu/generate", {
        method: "POST",
        body: { model: model.id, resolution, orientation: model.orientations ? facing : undefined, video, image, prompt: promptOn && model.prompt ? prompt : undefined },
      });
      setPanel("history");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  const blocker = !model
    ? "Models load when the server is running."
    : !model.usable
      ? `No ${model.label} route has a key. Add a kie.ai key in Settings.`
      : !video
        ? "Add a reference video."
        : !image
          ? "Add your character."
          : estimate?.problems.length
            ? estimate.problems[0]
            : estimate && !estimate.withinBudget && estimate.budgetUsd != null
              ? `Over the ${usd(estimate.budgetUsd)} limit for one Openjutsu take. Trim the video or pick a lower quality.`
              : estimate && !estimate.withinPerJob && estimate.perJobUsd != null
                ? `Over your per-job limit of ${usd(estimate.perJobUsd)}. Raise it in Settings.`
                : estimate && !estimate.withinDailyCap
                  ? `Over what is left of today's cap (${usd(estimate.availableTodayUsd)}). Raise it in Settings.`
                  : null;


  const tierModels = models.filter((m) => m.mode === "motion");

  return (
    <div className="jutsu">
      <aside className="jutsu-form" aria-label="Openjutsu">
        <h1 className="jutsu-form__word">OPENJUTSU</h1>

        <div className="jutsu-seg" role="tablist" aria-label="What to make">
          {(["motion", "swap"] as Mode[]).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className="jutsu-seg__tab" title={MODE_HINT[m]} onClick={() => pickMode(m)}>
              <Icon name={m === "motion" ? "play" : "vary"} size={14} />
              {MODE_WORDS[m]}
            </button>
          ))}
        </div>

        <div className="jutsu-tiles">
          <InputTile
            label="reference video"
            icon="video"
            title="Reference video"
            hint={model ? `${model.videoS[0]}–${model.videoS[1]}s, up to ${mb(model.maxVideoBytes)}` : "MP4 or MOV"}
            busy={uploading === "video"}
            media={clip?.media ?? null}
            caption={
              <>
                <span className="jutsu-tile__name">{clip?.name}</span>
                <span className="mono">{clip ? seconds(clip.durationS) : ""}</span>
              </>
            }
            trigger
            onOpen={() => toggle("clip")}
            onFile={(f) => upload("video", f)}
            onClear={() => setVideo(null)}
          />
          {menu === "clip" && (
            <ClipPicker
              clips={view?.clips ?? []}
              current={video}
              busy={uploading === "video"}
              onPick={(name) => {
                setVideo(name);
                setMenu(null);
              }}
              onUpload={() => videoInput.current?.click()}
              onClose={closeMenu}
            />
          )}
          <div className="jutsu-tiles__cast">
            <InputTile
              label="character"
              icon="sheet"
              title="Character"
              hint="Library or upload"
              busy={uploading === "image"}
              media={castMedia}
              still
              trigger
              caption={<span className="jutsu-tile__name">{castName}</span>}
              onOpen={() => toggle("cast")}
              onFile={(f) => upload("image", f)}
              onClear={() => setImage(null)}
            />
            {menu === "cast" && (
              <CastPicker
                uploads={uploads}
                library={library}
                generations={view?.generations ?? []}
                current={image}
                busy={uploading === "image"}
                onPick={(ref) => {
                  setImage(ref);
                  setMenu(null);
                }}
                onUpload={() => imageInput.current?.click()}
                onClose={closeMenu}
              />
            )}
          </div>
        </div>
        <p className="jutsu-form__hint">{mode === "motion" ? "Both should show the head, shoulders and torso." : MODE_HINT.swap}</p>

        <div className="jutsu-settings">
          {model?.prompt && (
            <div className="jutsu-prompt" data-on={promptOn || undefined}>
              <label className="jutsu-row__button jutsu-prompt__row">
                <span className="jutsu-row__label">Prompt</span>
                <input type="checkbox" role="switch" aria-label="Prompt" className="jutsu-switch" checked={promptOn} onChange={(e) => setPromptOn(e.target.checked)} />
              </label>
              {promptOn && (
                <textarea
                  className="jutsu-prompt__text"
                  aria-label="Prompt text"
                  rows={2}
                  maxLength={2500}
                  placeholder="Where it happens, the light, the clothes."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              )}
            </div>
          )}
          {mode === "motion" && (
            <SettingRow
              label="Mode"
              value={TIER_WORDS[tier]}
              open={menu === "tier"}
              onToggle={() => toggle("tier")}
              onClose={closeMenu}
              current={tier}
              onPick={(v) => setTier(v as Tier)}
              options={tierModels.map((m) => ({ value: m.tier, label: `${TIER_WORDS[m.tier]} · ${m.label.replace(/ Motion Control$/, "")}`, note: `from ${usd(Math.min(...Object.values(m.usdPerSecond)))}/s` }))}
            />
          )}
          {model && (
            <SettingRow
              label="Quality"
              value={resolution}
              open={menu === "quality"}
              onToggle={() => toggle("quality")}
              onClose={closeMenu}
              current={resolution}
              onPick={setResolution}
              options={model.resolutions.map((r) => ({ value: r, label: r, note: `${usd(model.usdPerSecond[r] ?? 0)}/s` }))}
            />
          )}
          {model?.orientations && (
            <SettingRow
              label="Faces"
              value={FACING_WORDS[facing]}
              open={menu === "facing"}
              onToggle={() => toggle("facing")}
              onClose={closeMenu}
              current={facing}
              onPick={(v) => setFacing(v as Facing)}
              options={model.orientations.map((o) => ({ value: o, label: FACING_WORDS[o], note: o === "image" ? `videos up to ${model.imageOrientationMaxS}s` : "videos up to 30s" }))}
            />
          )}
        </div>

        {error && (
          <p className="jutsu-form__error" role="alert">
            {error}
          </p>
        )}

        <div className="jutsu-form__foot">
          <p className="jutsu-form__price" aria-live="polite">
            {blocker ? (
              <span className="jutsu-form__why">{blocker}</span>
            ) : estimate?.usd != null ? (
              <span className="jutsu-form__basis">{estimate.basis}</span>
            ) : null}
          </p>
          <button type="button" className="jutsu-go" disabled={Boolean(blocker) || sending || estimate?.usd == null} onClick={generate}>
            {sending ? "Sending…" : estimate?.usd != null && !blocker ? `Generate · ${usd(estimate.usd)}` : "Generate"}
          </button>
        </div>

        <input
          ref={videoInput}
          type="file"
          accept={VIDEO_ACCEPT}
          hidden
          data-testid="video-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload("video", file);
          }}
        />
        <input
          ref={imageInput}
          type="file"
          accept={IMAGE_ACCEPT}
          hidden
          data-testid="image-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload("image", file);
          }}
        />
      </aside>

      <section className="jutsu-main" aria-label={panel === "library" ? "Motion Library" : "History"}>
        <div className="jutsu-main__head">
          <div className="pill-toggle" role="group" aria-label="Show">
            <button type="button" className="pill-toggle__item" aria-pressed={panel === "library"} onClick={() => setPanel("library")}>
              <Icon name="presets" size={16} />
              Motion Library
            </button>
            <button type="button" className="pill-toggle__item" aria-pressed={panel === "history"} onClick={() => setPanel("history")}>
              <Icon name="library" size={16} />
              History
              {jobs.length > 0 && <span className="jutsu-main__count mono">{jobs.length}</span>}
            </button>
          </div>
        </div>

        <div className="jutsu-main__scroll">
          {loadError && (
            <p className="jutsu-form__error" role="alert">
              {loadError}
            </p>
          )}

          {panel === "library" ? (
            <>
              <header className="jutsu-hero">
                <h2>Turn one video into many</h2>
                <p>Keep the motion of a clip you love and recast it with your characters. Shared clips to reuse will live here, filed by category.</p>
              </header>
              <div className="jutsu-filters">
                <div className="jutsu-filters__tabs" role="group" aria-label="Category">
                  {CATEGORIES.map((c) => (
                    <button key={c} type="button" className="jutsu-filters__tab" aria-pressed={category === c} onClick={() => setCategory(c)}>
                      {c}
                    </button>
                  ))}
                </div>
                <div className="jutsu-filters__tabs" role="group" aria-label="Order">
                  {(["trending", "latest"] as Sort[]).map((o) => (
                    <button key={o} type="button" className="jutsu-filters__tab" aria-pressed={sort === o} onClick={() => setSort(o)}>
                      {o === "trending" ? "Trending" : "Latest"}
                    </button>
                  ))}
                </div>
              </div>
              <Empty tone="violet" icon="video" title={category === "All" ? "Shared motion clips will appear here" : `No shared ${category.toLowerCase()} clips yet`}>
                Clips people share will land here to reuse. For now, add your own reference video on the left.
              </Empty>
            </>
          ) : jobs.length ? (
            <ul className="jutsu-grid jutsu-grid--takes" aria-label="Takes">
              {jobs.map((j) => (
                <TakeTile key={j.id} job={j} models={models} now={now} />
              ))}
            </ul>
          ) : (
            <p className="jutsu-empty">No takes yet. Pick a clip and a character, then Generate.</p>
          )}
        </div>
      </section>
    </div>
  );
}
