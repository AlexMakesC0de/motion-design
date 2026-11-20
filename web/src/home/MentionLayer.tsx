// web/src/home/MentionLayer.tsx
// The prompt's @mentions, made visible. The textarea's own text is transparent
// (its caret and selection are not); this layer sits behind it with the same
// text, font and wrapping, and paints each @name that is a Library item in the
// accent colour. Clicking one opens a small card over it: the item's picture,
// its kind, whether it is attached and as what, and a way to open it.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { AssetSummary } from "../api/types";
import { Icon } from "../app/icons";
import { libraryItemHref } from "../app/route";
import { useOnScreen } from "../app/useOnScreen";
import { roleWord } from "../studio/AttachMenu";
import { getDraft, setDraft, type RefDraft } from "../studio/promptStore";
import { findMoveTags } from "../../../cli/director/picks.mjs";
import { CameraScene, MOVE_IDS, moveById, tagOf } from "./CameraPopup";

/** The prompt without one tag, and the space it leaves. */
function untagAt(text: string, t: Mention) {
  return `${text.slice(0, t.start).replace(/ $/, "")}${text.slice(t.end).replace(/^ (?=[\s.,;!?]|$)/, "")}`.replace(/^ +/, "");
}

export interface Mention {
  start: number;
  end: number;
  name: string;
  /** An @Library item, or a #camera move. */
  kind?: "asset" | "move";
}

/** Every @name in `text` that names a Library item. */
export function findMentions(text: string, assets: AssetSummary[]): Mention[] {
  const names = new Set(assets.map((a) => a.name.toLowerCase()));
  const out: Mention[] = [];
  for (const m of text.matchAll(/@([a-z0-9][a-z0-9-]*)/gi)) {
    // "@mara-" or "@mara-'s": the longest Library name the word starts with.
    let name = m[1].toLowerCase();
    while (name && !names.has(name)) name = name.replace(/-?[^-]*$/, "");
    if (name) out.push({ start: m.index, end: m.index + 1 + name.length, name });
  }
  return out;
}

/** The @mentions and, when moves count (video), the #move tags, in order. */
export function findTokens(text: string, assets: AssetSummary[], moves: boolean): Mention[] {
  const tags: Mention[] = moves ? findMoveTags(text, MOVE_IDS).map((t) => ({ start: t.start, end: t.end, name: t.id, kind: "move" as const })) : [];
  return [...findMentions(text, assets).map((m) => ({ ...m, kind: "asset" as const })), ...tags].sort((a, b) => a.start - b.start);
}

export function MentionLayer({
  text,
  assets,
  refs,
  box,
  moves = false,
  onAttach,
}: {
  moves?: boolean;
  text: string;
  assets: AssetSummary[];
  refs: RefDraft[];
  box: RefObject<HTMLTextAreaElement | null>;
  onAttach(name: string): void;
}) {
  const mirror = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [peek, setPeek] = useState<{ mention: Mention; left: number; bottom: number } | null>(null);
  const mentions = findTokens(text, assets, moves);
  useOnScreen(card, peek != null);

  // The layer scrolls with the textarea.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const sync = () => mirror.current && (mirror.current.scrollTop = el.scrollTop);
    el.addEventListener("scroll", sync);
    return () => el.removeEventListener("scroll", sync);
  }, [box]);
  useLayoutEffect(() => {
    if (mirror.current && box.current) mirror.current.scrollTop = box.current.scrollTop;
  });

  // A click that lands inside a mention opens its card, placed over the word.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const up = () => {
      const at = el.selectionStart;
      if (at !== el.selectionEnd) return setPeek(null);
      const hit = findTokens(el.value, assets, moves).find((m) => at > m.start && at < m.end);
      const word = hit && mirror.current?.querySelector<HTMLElement>(`[data-at="${hit.start}"]`);
      const wrap = mirror.current?.parentElement;
      if (!hit || !word || !wrap) return setPeek(null);
      const w = word.getBoundingClientRect();
      const r = wrap.getBoundingClientRect();
      setPeek({ mention: hit, left: w.left - r.left, bottom: r.bottom - w.top + 6 });
    };
    const typed = () => setPeek(null);
    el.addEventListener("mouseup", up);
    el.addEventListener("input", typed);
    return () => {
      el.removeEventListener("mouseup", up);
      el.removeEventListener("input", typed);
    };
  }, [box, assets, moves]);

  useEffect(() => {
    if (!peek) return;
    const away = (e: MouseEvent) => !card.current?.contains(e.target as Node) && e.target !== box.current && setPeek(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPeek(null);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [peek, box]);

  const parts: ReactNode[] = [];
  let at = 0;
  for (const m of mentions) {
    parts.push(text.slice(at, m.start));
    // A #move is always "attached": it is written into what the model reads.
    const attached = m.kind === "move" || refs.some((r) => r.source === m.name);
    parts.push(
      <mark key={m.start} className={m.kind === "move" ? "xprompt__at xprompt__tag" : "xprompt__at"} data-at={m.start} data-attached={attached || undefined}>
        {text.slice(m.start, m.end)}
      </mark>,
    );
    at = m.end;
  }
  // A trailing newline needs a character after it to take up its line.
  parts.push(`${text.slice(at)}\u200b`);

  const move = peek?.mention.kind === "move" ? moveById(peek.mention.name) : null;
  const asset = peek && !move ? assets.find((a) => a.name === peek.mention.name) : null;
  const ref = peek ? refs.find((r) => r.source === peek.mention.name) : null;
  return (
    <>
      <div ref={mirror} className="xprompt__mirror" aria-hidden="true">
        {parts}
      </div>
      {peek && move && (
        <div ref={card} className="xpeek" style={{ left: peek.left, bottom: peek.bottom }} role="dialog" aria-label={`#${move.id}`}>
          <span className="xpeek__media xpeek__media--scene">
            <CameraScene move={move.id} />
          </span>
          <div className="xpeek__words">
            <span className="xpeek__name">#{tagOf(move.id)}</span>
            <span className="xpeek__kind xpeek__kind--plain">Camera move · {move.label}</span>
            <span className="xpeek__text">{move.when}</span>
            <span className="xpeek__state" data-attached>
              <Icon name="check" size={12} /> Sent as “the camera {move.id === "static" ? "holds still" : move.words}”
            </span>
            <span className="xpeek__actions">
              <button
                type="button"
                className="xpeek__button"
                onClick={() => {
                  setDraft({ prompt: untagAt(getDraft().prompt, peek.mention) });
                  setPeek(null);
                }}
              >
                Remove
              </button>
            </span>
          </div>
        </div>
      )}
      {peek && asset && (
        <div ref={card} className="xpeek" style={{ left: peek.left, bottom: peek.bottom }} role="dialog" aria-label={`@${asset.name}`}>
          {asset.cover ? <img className="xpeek__media" src={asset.cover} alt="" /> : <span className="xpeek__media" aria-hidden="true" />}
          <div className="xpeek__words">
            <span className="xpeek__name">@{asset.name}</span>
            <span className="xpeek__kind">{asset.persona?.displayName ? `${asset.persona.displayName} · ` : ""}{asset.kind}</span>
            {asset.description && <span className="xpeek__text">{asset.description}</span>}
            <span className="xpeek__state" data-attached={ref ? true : undefined}>
              {ref ? (
                <>
                  <Icon name="check" size={12} /> Attached as {roleWord(ref.role).toLowerCase()}
                </>
              ) : (
                "Not attached: the model won't see it"
              )}
            </span>
            <span className="xpeek__actions">
              {!ref && (
                <button
                  type="button"
                  className="xpeek__button xpeek__button--primary"
                  onClick={() => {
                    onAttach(asset.name);
                    setPeek(null);
                  }}
                >
                  Attach
                </button>
              )}
              <a className="xpeek__button" href={libraryItemHref(asset.name)}>
                Open in Library
              </a>
            </span>
          </div>
        </div>
      )}
    </>
  );
}
