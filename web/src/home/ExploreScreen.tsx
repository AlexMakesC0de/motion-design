// web/src/home/ExploreScreen.tsx
// Studio, where you land: a page for making takes, driven by chat. You describe a
// scene in one big prompt bar; the AI you connected in Settings plans the
// take (model, look, camera, lighting, Library references) with Shard's free
// tools and fills the bar; the green Generate button shows the price, and
// only pressing it spends. Everything the AI sets stays yours to change by
// hand, and with no AI connected the bar still works on its own. Chats and
// takes live in the "explore" run (EXPLORE_RUN in cli/lib/run.mjs). Each visit
// starts a new conversation; the panel at the left lists the earlier ones,
// which you can open, archive (kept, listed in Settings) or delete.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import menu from "../../../cli/director/menu.json";
import { setPick } from "../../../cli/director/picks.mjs";
import { api } from "../api/client";
import type { AssetSummary, ChatEntry, ChatSettingsView, JobView, LookInfo, ModelInfo, Proposal } from "../api/types";
import { Icon } from "../app/icons";
import { modelName, sortModels } from "../app/modelMeta";
import { useOnScreen } from "../app/useOnScreen";
import { ConnectionForm, connectionShort } from "../chat/ConnectionForm";
import { ToolStep } from "../chat/ToolStep";
import { useChat } from "../chat/useChat";
import { onStudioEvent } from "../app/useStudio";
import { Conversations, newConversationId, type Conversation } from "../studio/Conversations";
import { PickChip } from "../scene/PickChips";
import { GenerateMessages, RefChips, RefPicker, SelectChip } from "../studio/controls";
import { swatchStyle } from "../studio/LookPicker";
import { typicalSeconds, usd } from "../studio/format";
import { addRef, applyLook, clearLook, fitToModel, getDraft, setDraft, type VideoPicks } from "../studio/promptStore";
import { TakeTile } from "../studio/TakeTile";
import { TakeViewer } from "../studio/TakeViewer";
import { useGenerate } from "../studio/useGenerate";
import { useJobs, useNow } from "../studio/useJobs";
import { useStudioData } from "../studio/useStudioData";
import "../chat/chat.css";
import "../studio/studio.css";
import "../studio/image.css";
import "../scene/scene.css";
import "./explore.css";

/** Explore's run (EXPLORE_RUN in cli/lib/run.mjs, which the page cannot import). */
export const EXPLORE_RUN = "explore";
export const MAX_COUNT = 4;
/** A Studio conversation as the server lists it (GET /api/explore/chats). */
export interface StudioChat {
  id: string;
  title: string;
  messages: number;
  startedAt: string;
  updatedAt: string;
  archived: boolean;
}

type Kind = "image" | "video";

/** The bar as the AI reads it with each message (barLine on the server turns it into one line). */
export function barOf(kind: Kind, count: number) {
  const d = getDraft();
  return {
    kind,
    model: d.model,
    aspectRatio: d.aspectRatio,
    durationS: d.durationS,
    resolution: d.resolution,
    look: d.look,
    picks: d.picks,
    refs: d.refs,
    sound: !d.soundOff,
    count,
  };
}

/**
 * The newest proposal already put in the bar, kept in localStorage so going
 * away and back, or reloading the page, never applies it again over your edits.
 */
const APPLIED_KEY = "shard.explore.appliedProposal";
function readApplied(): string | null {
  try {
    return localStorage.getItem(APPLIED_KEY);
  } catch {
    return null;
  }
}
function writeApplied(id: string) {
  try {
    localStorage.setItem(APPLIED_KEY, id);
  } catch {
    // Storage blocked: the proposal may fill the bar again after a reload.
  }
}
export const resetExploreForTests = () => {
  try {
    localStorage.removeItem(APPLIED_KEY);
  } catch {
    // nothing kept
  }
};

/** The newest tool step that proposed a take. */
export const latestProposal = (entries: ChatEntry[]) =>
  [...entries].reverse().find((e): e is Extract<ChatEntry, { kind: "tool" }> & { proposal: Proposal } => e.kind === "tool" && e.state === "done" && Boolean(e.proposal)) ?? null;

/** Fill the bar from a proposal: the AI's choices, kept to what the model takes. */
export function applyProposal(p: Proposal, models: ModelInfo[]) {
  const m = models.find((x) => x.id === p.model && x.capability === p.kind);
  if (!m) return false;
  const d = getDraft();
  const fit = fitToModel(m, {
    ...d,
    durationS: p.durationS ?? d.durationS,
    aspectRatio: p.aspectRatio ?? d.aspectRatio,
    resolution: p.resolution ?? d.resolution,
    refs: p.refs,
  });
  setDraft({
    ...fit,
    prompt: p.prompt,
    picks: (p.kind === "video" ? p.picks : {}) as VideoPicks,
    look: p.kind === "video" ? p.look : null,
    soundOff: p.kind === "video" ? !p.sound : false,
    preset: null,
  });
  return true;
}

/** The role a Library item gets when @-mentioned: a character or product is who/what is in the shot, a place sets its style. */
function roleFor(asset: AssetSummary, roles: string[]) {
  const want = asset.kind === "location" || asset.kind === "style" ? "style" : "identity";
  return roles.includes(want) ? want : (roles[0] ?? want);
}

/** The `@word` the caret is at the end of, or null. */
function mentionAt(text: string, caret: number) {
  const m = text.slice(0, caret).match(/(^|\s)@([a-z0-9-]*)$/i);
  return m ? { word: m[2].toLowerCase(), start: caret - m[2].length - 1 } : null;
}

/** A setting card above the prompt (References, Look, Camera, Lighting): its name, its value, and a panel it opens. */
function SettingCard({ label, value, art, disabled, note, children }: { label: string; value: string; art: ReactNode; disabled?: boolean; note?: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useOnScreen(panel, open);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="xcard-wrap" ref={wrap}>
      <button type="button" className="xcard" aria-expanded={open} disabled={disabled} title={disabled ? note : undefined} onClick={() => setOpen(!open)}>
        <span className="xcard__art" aria-hidden="true">
          {art}
        </span>
        <span className="xcard__words">
          <span className="xcard__label">{label}</span>
          <span className="xcard__value">{disabled ? (note ?? "—") : value}</span>
        </span>
      </button>
      {open && (
        <div className="xcard__panel" ref={panel} role="group" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function ThreadEntry({ entry }: { entry: ChatEntry }) {
  switch (entry.kind) {
    case "user":
      return <li className="xthread__user">{entry.text}</li>;
    case "assistant":
      return (
        <li className="xthread__ai" aria-busy={entry.streaming}>
          {entry.text}
        </li>
      );
    case "tool":
      if (entry.proposal) {
        const p = entry.proposal;
        return (
          <li className="xthread__plan">
            <span className="xthread__plan-head">
              <Icon name="check" size={14} /> Filled the bar: {modelName(p.model)}
              {p.durationS ? `, ${p.durationS}s` : ""}
              {p.aspectRatio ? `, ${p.aspectRatio}` : ""}
              {p.count > 1 ? `, ${p.count} takes` : ""}
            </span>
            {p.estimateUsd != null && (
              <span className="xthread__plan-cost mono">
                {usd(p.estimateUsd)} a take
                {p.count > 1 && p.totalUsd != null ? ` · ${usd(p.totalUsd)} in all` : ""}
              </span>
            )}
            {p.problems.length > 0 && <span className="xthread__plan-problem">{p.problems.join(" ")}</span>}
          </li>
        );
      }
      return (
        <li className="xthread__step">
          <ToolStep entry={entry} />
        </li>
      );
    case "notice":
      return (
        <li className="chat__notice" data-tone={entry.tone}>
          {entry.text}
        </li>
      );
  }
}

export function ExploreScreen() {
  const { models, assets, vocab, looks, loadRuns } = useStudioData();
  const { jobs, error: jobsError, reload } = useJobs(EXPLORE_RUN);
  const now = useNow();
  const [convo, setConvo] = useState(newConversationId);
  const [chats, setChats] = useState<StudioChat[]>([]);
  const chat = useChat(`${EXPLORE_RUN}:${convo}`, `/api/explore/chats/${convo}`);
  const [settings, setSettings] = useState<ChatSettingsView | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [count, setCount] = useState(1);
  // Until you switch, Explore makes what the bar's model makes (a picture after Image, say), else video.
  const [chosenKind, setKind] = useState<Kind | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [making, setMaking] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLDivElement>(null);

  const settled = () => {
    loadRuns();
    reload();
  };
  const kind: Kind = chosenKind ?? (models.find((m) => m.id === getDraft().model)?.capability === "image" ? "image" : "video");
  const g = useGenerate({
    models,
    capability: kind,
    roles: vocab.roles,
    run: EXPLORE_RUN,
    onSubmitted: settled,
    onUncertain: settled,
    extra: { thread: convo },
  });
  const { draft, model } = g;

  // The open conversations, read again whenever a turn starts or ends.
  const loadChats = () =>
    api<StudioChat[]>("/api/explore/chats")
      .then((list) => setChats(Array.isArray(list) ? list : []))
      .catch(() => {});
  useEffect(() => {
    loadChats();
    return onStudioEvent((e) => {
      if (e.event === "hello" || (e.event === "chat" && typeof e.data.film === "string" && e.data.film.startsWith(`${EXPLORE_RUN}:`) && !e.data.entry)) loadChats();
    });
  }, []);

  async function archive(c: Conversation) {
    await api(`/api/explore/chats/${c.id}/archived`, { method: "PUT", body: { archived: true } }).catch(() => {});
    if (c.id === convo) setConvo(newConversationId());
    loadChats();
  }

  async function remove(c: Conversation) {
    if (!window.confirm(`Delete “${c.title}” for good? It can't be brought back. Archive keeps it instead.`)) return;
    await api(`/api/explore/chats/${c.id}`, { method: "DELETE" }).catch(() => {});
    if (c.id === convo) setConvo(newConversationId());
    loadChats();
  }

  useEffect(() => {
    api<ChatSettingsView>("/api/chat-settings")
      .then(setSettings)
      .catch(() => {});
  }, []);

  // The bar follows the AI: the newest proposal fills it, once.
  const plan = latestProposal(chat.entries);
  useEffect(() => {
    if (!plan || plan.id === readApplied() || !models.length) return;
    if (!applyProposal(plan.proposal, models)) return;
    writeApplied(plan.id);
    setKind(plan.proposal.kind);
    setCount(Math.min(MAX_COUNT, Math.max(1, plan.proposal.count)));
  }, [plan, models]);

  // The prompt grows with its text up to a seventh of the window, then scrolls,
  // so a long prompt the AI wrote leaves the conversation above it in view.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const cap = Math.max(72, Math.round(window.innerHeight / 7));
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
    el.style.overflowY = el.scrollHeight > cap ? "auto" : "hidden";
  }, [draft.prompt]);

  const allTakes = jobs.filter((j) => j.capability === "image" || j.capability === "video");
  const takes = allTakes.filter((j) => j.thread === convo);
  const convos: Conversation[] = chats.map((c) => {
    const made = allTakes.filter((j) => j.thread === c.id);
    return {
      id: c.id,
      title: c.title,
      takes: made,
      updatedAt: made[0]?.createdAt && made[0].createdAt > c.updatedAt ? made[0].createdAt : c.updatedAt,
      cover: made.find((t) => t.state === "succeeded" && t.media[0])?.media[0] ?? null,
      meta: `${c.messages} ${c.messages === 1 ? "message" : "messages"}${made.length ? ` · ${made.length} ${made.length === 1 ? "take" : "takes"}` : ""}`,
    };
  });
  // Takes made in a conversation with no chat (Generate pressed without asking the AI) are listed too, by their prompt.
  for (const t of allTakes) {
    if (!t.thread || convos.some((c) => c.id === t.thread)) continue;
    const made = allTakes.filter((j) => j.thread === t.thread);
    const first = made.at(-1)!;
    convos.push({
      id: t.thread,
      title: first.prompt?.replace(/\s+/g, " ").trim() || "Untitled",
      takes: made,
      updatedAt: made[0].updatedAt ?? made[0].createdAt,
      cover: made.find((j) => j.state === "succeeded" && j.media[0])?.media[0] ?? null,
      meta: `${made.length} ${made.length === 1 ? "take" : "takes"}`,
      fixed: true,
    });
  }
  convos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.entries.length, takes.length]);

  const connected = settings?.backend != null;
  const via = settings ? connectionShort(settings) : null;
  const video = kind === "video";
  const chosenLook: LookInfo | null = looks.looks.find((l) => l.id === draft.look) ?? null;
  const each = g.estimate?.estimateUsd ?? null;
  const total = each != null ? each * count : null;
  const price = total != null ? usd(total) : g.price;
  const cameraWords = [
    menu.moves.find((o) => o.id === draft.picks.move),
    menu.sizes.find((o) => o.id === draft.picks.size),
    menu.angles.find((o) => o.id === draft.picks.angle),
    menu.lenses.find((o) => o.id === draft.picks.lens),
  ]
    .filter((o) => o != null)
    .map((o) => o.label);
  const light = menu.lights.find((o) => o.id === draft.picks.light)?.label ?? null;
  const pageModels = useMemo(() => sortModels(models.filter((m) => m.capability === kind)), [models, kind]);
  const open: JobView | null = takes.find((j) => j.id === openId) ?? null;

  // @ in the prompt: the Library items whose names start with what follows.
  const mention = mentionAt(draft.prompt, caret);
  const matches = mention ? assets.filter((a) => a.name.startsWith(mention.word)).slice(0, 6) : [];

  function chooseMention(a: AssetSummary) {
    if (!mention) return;
    const text = `${draft.prompt.slice(0, mention.start)}${a.name}${draft.prompt.slice(caret)}`;
    setDraft({ prompt: text });
    addRef({ source: a.name, role: roleFor(a, g.roleChoices) });
    const at = mention.start + a.name.length;
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(at, at);
      setCaret(at);
    });
  }

  function switchKind(next: Kind) {
    if (next === kind) return;
    setKind(next);
    const first = sortModels(models.filter((m) => m.capability === next))[0];
    if (first) setDraft(fitToModel(first, getDraft()));
  }

  async function ask() {
    const text = draft.prompt.trim();
    if (!text || chat.busy) return;
    if (!connected) return setShowConnect(true);
    if (await chat.send(text, { bar: barOf(kind, count) })) loadChats();
  }

  // Generate: `count` takes, one after another, each at the price shown. A refusal stops the rest.
  async function generate() {
    setMaking(true);
    try {
      for (let i = 0; i < count; i++) if (!(await g.generate())) break;
    } finally {
      setMaking(false);
    }
  }

  const empty = !chat.entries.length && !takes.length;
  // The hero shows the Look previews only, never your own takes.
  const pictures = looks.looks.map((l) => l.still).filter((s): s is string => Boolean(s)).slice(0, 3);

  return (
    <div className="explore">
      <Conversations
        list={convos}
        current={convo}
        now={now}
        onPick={(id) => {
          setConvo(id);
          setOpenId(null);
        }}
        onNew={() => {
          setConvo(newConversationId());
          setOpenId(null);
          box.current?.focus();
        }}
        onArchive={archive}
        onDelete={remove}
      />
      <div className="explore__body" ref={body}>
        {empty ? (
          <div className="explore-hero">
            <div className="explore-hero__cards" aria-hidden="true">
              {[0, 1, 2].map((i) =>
                pictures[i] ? (
                  <img key={i} className="explore-hero__card" src={pictures[i]} alt="" />
                ) : (
                  <span key={i} className="explore-hero__card" style={looks.looks[i] ? swatchStyle(looks.looks[i]) : undefined} />
                ),
              )}
            </div>
            <h1 className="display explore-hero__title">
              Describe it. <span className="explore-hero__accent">Shard directs it.</span>
            </h1>
            <p className="explore-hero__sub">The AI picks the model, look, camera and light and fills the bar. You see the price before anything is made.</p>
          </div>
        ) : (
          <div className="xthread">
            <div className="xthread__head">
              <h1 className="xthread__title">{chats.find((c) => c.id === convo)?.title ?? "Studio"}</h1>
            </div>
            <ol className="xthread__log" aria-label="Messages">
              {chat.entries.map((e) => (
                <ThreadEntry key={e.id} entry={e} />
              ))}
            </ol>
            {jobsError && <p className="feed__error">{jobsError}</p>}
            {takes.length > 0 && (
              <section className="xthread__takes" aria-label="Takes made here">
                <h2 className="xthread__takes-title">Made here</h2>
                <div className="feed__grid">
                  {takes.map((j) => (
                    <TakeTile key={j.id} job={j} now={now} expectedS={typicalSeconds(jobs, j.model, j.capability)} onOpen={(job) => setOpenId(job.id)} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {(showConnect || chat.connect) && settings && (
        <section className="explore-connect" aria-label="Connect an AI">
          <div className="explore-connect__head">
            <p>{chat.connect && chat.error ? chat.error : "Connect the AI that plans your scenes. It never spends kie credits: only Generate does."}</p>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                setShowConnect(false);
                chat.setConnect(false);
              }}
            >
              Close
            </button>
          </div>
          <ConnectionForm
            initial={settings}
            onSaved={(next) => {
              setSettings(next);
              setShowConnect(false);
              chat.setConnect(false);
            }}
          />
        </section>
      )}

      <section className="explore-dock" aria-label="Prompt">
        <div className="explore-kind" role="group" aria-label="Make">
          <button type="button" className="explore-kind__item" aria-pressed={kind === "image"} onClick={() => switchKind("image")}>
            <Icon name="image" size={18} />
            Image
          </button>
          <button type="button" className="explore-kind__item" aria-pressed={kind === "video"} onClick={() => switchKind("video")}>
            <Icon name="video" size={18} />
            Video
          </button>
        </div>

        <div className="explore-dock__col">
          <div className="xcards">
            <SettingCard label="References" value={draft.refs.length ? `${draft.refs.length} added` : "Auto"} art={<Icon name="refs" size={16} />}>
              {(close) => (
                <>
                  <RefChips refs={draft.refs} assets={assets} />
                  <RefPicker assets={assets} roles={g.roleChoices} onDone={close} />
                </>
              )}
            </SettingCard>
            <SettingCard
              label="Look"
              value={chosenLook?.title ?? "Auto"}
              art={chosenLook ? <span className="xcard__swatch" style={swatchStyle(chosenLook)} /> : <Icon name="look" size={16} />}
              disabled={!video}
              note="Video only"
            >
              {(close) => (
                <ul className="xlooks" aria-label="Looks">
                  <li>
                    <button
                      type="button"
                      className="xlooks__item"
                      aria-pressed={!draft.look}
                      onClick={() => {
                        clearLook(chosenLook);
                        close();
                      }}
                    >
                      <span className="xlooks__swatch" />
                      Auto
                    </button>
                  </li>
                  {looks.looks.map((l) => (
                    <li key={l.id}>
                      <button
                        type="button"
                        className="xlooks__item"
                        aria-pressed={draft.look === l.id}
                        onClick={() => {
                          applyLook(l);
                          close();
                        }}
                      >
                        <span className="xlooks__swatch" style={swatchStyle(l)} />
                        {l.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </SettingCard>
            <SettingCard label="Camera" value={cameraWords.length ? cameraWords.join(" · ") : "Auto"} art={<Icon name="camera" size={16} />} disabled={!video} note="Video only">
              {() => (
                <div className="pick-row">
                  <PickChip
                    label="Move"
                    scope="Move"
                    options={menu.moves}
                    value={draft.picks.move}
                    onPick={(id) =>
                      setDraft({
                        picks: setPick(getDraft().picks, "move", id) ?? {},
                      })
                    }
                    speeds={menu.speeds}
                    speed={draft.picks.speed}
                    onSpeed={(id) =>
                      setDraft({
                        picks: setPick(getDraft().picks, "speed", id) ?? {},
                      })
                    }
                  />
                  <PickChip
                    label="Shot size"
                    scope="Shot size"
                    options={menu.sizes}
                    value={draft.picks.size}
                    onPick={(id) =>
                      setDraft({
                        picks: setPick(getDraft().picks, "size", id) ?? {},
                      })
                    }
                  />
                  <PickChip
                    label="Angle"
                    scope="Angle"
                    options={menu.angles}
                    value={draft.picks.angle}
                    onPick={(id) =>
                      setDraft({
                        picks: setPick(getDraft().picks, "angle", id) ?? {},
                      })
                    }
                  />
                  <PickChip
                    label="Lens"
                    scope="Lens"
                    options={menu.lenses}
                    value={draft.picks.lens}
                    onPick={(id) =>
                      setDraft({
                        picks: setPick(getDraft().picks, "lens", id) ?? {},
                      })
                    }
                  />
                </div>
              )}
            </SettingCard>
            <SettingCard label="Lighting" value={light ?? "Auto"} art={<Icon name="light" size={16} />} disabled={!video} note="Video only">
              {() => (
                <div className="pick-row">
                  <PickChip
                    label="Lighting"
                    scope="Lighting"
                    options={menu.lights}
                    value={draft.picks.light}
                    onPick={(id) =>
                      setDraft({
                        picks: setPick(getDraft().picks, "light", id) ?? {},
                      })
                    }
                  />
                </div>
              )}
            </SettingCard>
            <a className="explore-via" href="#/settings">
              {via ? `AI: ${via}` : "No AI connected"}
            </a>
          </div>

          <div className="explore-dock__main">
            <div className="explore-box">
              <textarea
                ref={box}
                className="dock__text"
                aria-label="Describe your scene"
                placeholder="Describe your scene. Type @ to add a character, product or place from your Library."
                rows={2}
                value={draft.prompt}
                onChange={(e) => {
                  setDraft({ prompt: e.target.value });
                  setCaret(e.target.selectionStart ?? e.target.value.length);
                }}
                onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
                onKeyDown={(e) => {
                  if (matches.length && (e.key === "Enter" || e.key === "Tab")) {
                    e.preventDefault();
                    chooseMention(matches[0]);
                  } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void ask();
                  }
                }}
              />
              {matches.length > 0 && (
                <ul className="xmention" role="listbox" aria-label="Library items">
                  {matches.map((a) => (
                    <li key={a.name} role="option" aria-selected={false}>
                      <button type="button" className="xmention__item" onMouseDown={(e) => e.preventDefault()} onClick={() => chooseMention(a)}>
                        {a.cover ? <img src={a.cover} alt="" /> : <span className="xmention__dot" />}
                        <span className="mono">@{a.name}</span>
                        <span className="xmention__kind">{a.kind}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <GenerateMessages g={g} reasonId="explore-generate-reason" />
              {chat.error && !chat.connect && (
                <p className="gen-msg gen-msg--failure" role="alert">
                  {chat.error}
                </p>
              )}
              <div className="dock__chips">
                {chat.busy ? (
                  <button type="button" className="dock-chip explore-ask" onClick={chat.stop}>
                    <Icon name="pause" size={16} /> Stop
                  </button>
                ) : (
                  <button type="button" className="dock-chip explore-ask" disabled={!draft.prompt.trim()} onClick={() => void ask()} title={connected ? `Plan it with ${via}` : "Connect an AI first"}>
                    <Icon name="chat" size={16} /> {connected ? "Plan with AI" : "Connect an AI"}
                  </button>
                )}
                <SelectChip label="Model" icon={<Icon name="model" size={16} />} value={draft.model || null} options={pageModels.map((m) => m.id)} format={modelName} chevron onChange={g.pickModel} />
                {model && (
                  <SelectChip
                    label="Resolution"
                    icon={<Icon name="image" size={16} />}
                    value={draft.resolution}
                    options={model.resolutionOptions}
                    empty="default"
                    onChange={(resolution) => setDraft({ resolution, budgetUsd: null })}
                  />
                )}
                {model && (
                  <SelectChip
                    label="Aspect ratio"
                    icon={<span className="ratio-glyph" aria-hidden="true" />}
                    value={draft.aspectRatio}
                    options={model.aspectRatios}
                    onChange={(aspectRatio) => setDraft({ aspectRatio })}
                  />
                )}
                {model && video && (
                  <SelectChip
                    label="Duration"
                    icon={<Icon name="play" size={16} />}
                    value={draft.durationS}
                    options={model.durationsS}
                    format={(s) => `${s}s`}
                    onChange={(durationS) => setDraft({ durationS, budgetUsd: null })}
                  />
                )}
                {model && video && model.audioOff && (
                  <button type="button" className="dock-chip" aria-pressed={!draft.soundOff} onClick={() => setDraft({ soundOff: !draft.soundOff })}>
                    {draft.soundOff ? "Sound off" : "Sound on"}
                  </button>
                )}
                <span className="xcount" role="group" aria-label="Takes">
                  <button type="button" className="xcount__step" aria-label="One take fewer" disabled={count <= 1} onClick={() => setCount(count - 1)}>
                    <Icon name="minus" size={14} />
                  </button>
                  <span className="xcount__value mono" aria-live="polite">
                    {count}/{MAX_COUNT}
                  </span>
                  <button type="button" className="xcount__step" aria-label="One take more" disabled={count >= MAX_COUNT} onClick={() => setCount(count + 1)}>
                    <Icon name="plus" size={14} />
                  </button>
                </span>
              </div>
            </div>
            <button type="button" className="dock__generate" disabled={g.disabled || making} aria-describedby={g.reason ? "explore-generate-reason" : undefined} onClick={() => void generate()}>
              <span className="dock__generate-label">{g.sending || making ? "Sending…" : "Generate"}</span> <span className="dock__generate-price mono">{price}</span>
            </button>
          </div>
        </div>
      </section>
      {open && <TakeViewer job={open} kinds={vocab.kinds} now={now} onClose={() => setOpenId(null)} />}
    </div>
  );
}
