import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, ReactNode, SyntheticEvent } from "react";
import { mentionSpans, parseDanPrompt, refLabel, toDisplay, toStored } from "../../../cli/director/mentions.mjs";
import type { Cards, Ref, Span } from "../api/types";
import "./scene.css";

export interface MentionFieldProps {
  /** The accessible name; the card around the field shows the heading. */
  label: string;
  /** Stored text: image mentions are bound to ref ids ("@{r2}"). */
  value: string;
  refs: Ref[];
  /** Library items by name, to tell a linked @library: mention from a missing one. */
  items: Map<string, { hasSheet: boolean }>;
  onChange(stored: string, refs: Ref[]): void;
  /** A missing mention was clicked, or its fix button pressed. */
  onChoose(span: Span): void;
  /** The pasted text was a whole prompt in Dan's sections; the paste is cancelled. */
  onPasteWhole?(cards: Cards): void;
  rows?: number;
}

interface Option { id: string; insert: string; text: string }

/** The `@word` the caret is at the end of, or null. */
function wordAt(display: string, caret: number) {
  const m = display.slice(0, caret).match(/(^|[\s(\[])@([A-Za-z0-9:-]*)$/);
  return m ? m[2].toLowerCase() : null;
}

function optionsFor(query: string, refs: Ref[], items: MentionFieldProps["items"]): Option[] {
  const images = refs.flatMap((r, i): Option[] => {
    const word = `image${i + 1}`;
    if (query && !word.startsWith(query) && !refLabel(r).toLowerCase().includes(query)) return [];
    return [{ id: word, insert: `@${word}`, text: `@${word} · ${refLabel(r)}` }];
  });
  const library = [...items.keys()]
    .filter((name) => !query || `library:${name}`.includes(query) || name.includes(query))
    .slice(0, 8)
    .map((name): Option => ({ id: `library-${name}`, insert: `@library:${name}`, text: `@library:${name}` }));
  return [...images, ...library];
}

/** What the fix button for a missing mention says. */
function fixText(span: Span) {
  if (span.kind === "image") return `Choose @image${span.n}`;
  return span.reason === "no sheet yet" ? "Make its sheet" : `Make @library:${span.name}`;
}

const spanKey = (s: Span) => (s.kind === "image" ? `image${s.n}` : `library:${s.name}`);

/**
 * A prompt box that knows its mentions: linked ones are green, missing ones
 * red with a fix. The text area has transparent text over a mirror that draws
 * the same text, so the caret and selection are the browser's own.
 */
export function MentionField({ label, value, refs, items, onChange, onChoose, onPasteWhole, rows = 4 }: MentionFieldProps) {
  const display = useMemo(() => toDisplay(value, refs), [value, refs]);
  const spans = useMemo(() => mentionSpans(display, refs, items), [display, refs, items]);
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  // Set by a paste: the next change also normalises pasted forms and adds empty slots.
  const settleNext = useRef(false);
  // Where the caret goes after the next render, when we changed the text under it.
  const wantCaret = useRef<number | null>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    const el = input.current;
    if (wantCaret.current !== null && el) {
      if (document.activeElement === el) el.setSelectionRange(wantCaret.current, wantCaret.current);
      wantCaret.current = null;
    }
  });

  const query = caret === null ? null : wordAt(display, caret);
  const options = useMemo(() => (query === null ? [] : optionsFor(query, refs, items)), [query, refs, items]);
  const open = options.length > 0 && !dismissed;
  const at = Math.min(active, Math.max(0, options.length - 1));

  const here = caret === null ? undefined : spans.find((s) => s.start <= caret && caret <= s.end);
  const missing = spans.filter((s, i) => s.state === "missing" && spans.findIndex((o) => spanKey(o) === spanKey(s)) === i);

  const commit = (text: string, nextRefs: Ref[]) => {
    if (text !== value || nextRefs !== refs) onChange(text, nextRefs);
  };

  const change = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const raw = e.target.value;
    const settle = settleNext.current;
    settleNext.current = false;
    const next = toStored(raw, refs, { settle });
    const shown = toDisplay(next.text, next.refs);
    const pos = e.target.selectionStart ?? raw.length;
    if (shown !== raw) wantCaret.current = Math.max(0, pos + shown.length - raw.length);
    setCaret(wantCaret.current ?? pos);
    setDismissed(false);
    setActive(0);
    commit(next.text, next.refs);
  };

  const paste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const cards = onPasteWhole ? parseDanPrompt(e.clipboardData.getData("text")) : null;
    if (cards && onPasteWhole) {
      e.preventDefault();
      onPasteWhole(cards);
      return;
    }
    settleNext.current = true;
  };

  const blur = () => {
    setDismissed(true);
    const next = toStored(display, refs, { settle: true });
    commit(next.text, next.refs);
  };

  const track = (e: SyntheticEvent<HTMLTextAreaElement>) => setCaret(e.currentTarget.selectionStart);

  const click = (e: SyntheticEvent<HTMLTextAreaElement>) => {
    const pos = e.currentTarget.selectionStart;
    setCaret(pos);
    const hit = spans.find((s) => s.start <= pos && pos <= s.end);
    if (hit?.state === "missing") onChoose(hit);
  };

  const insert = (o: Option) => {
    const el = input.current;
    const pos = el?.selectionStart ?? caret ?? display.length;
    const start = pos - ((query ?? "").length + 1);
    const shown = `${display.slice(0, start)}${o.insert} ${display.slice(pos)}`;
    const next = toStored(shown, refs);
    wantCaret.current = start + o.insert.length + 1;
    setCaret(wantCaret.current);
    setActive(0);
    commit(next.text, next.refs);
    // The text may be the same as before (the stored form hides which words were typed), so a render is not guaranteed.
    el?.setSelectionRange(wantCaret.current, wantCaret.current);
  };

  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((at + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insert(options[at]);
    } else if (e.key === "Escape") {
      // A dialog around the field must not close too.
      e.preventDefault();
      e.stopPropagation();
      setDismissed(true);
    }
  };

  // The mirror shows the text with each mention marked; a final newline needs a
  // character after it or the mirror is a line shorter than the text area.
  const parts: ReactNode[] = [];
  let from = 0;
  spans.forEach((s, i) => {
    parts.push(display.slice(from, s.start));
    parts.push(<mark key={i} className="mention" data-state={s.state}>{display.slice(s.start, s.end)}</mark>);
    from = s.end;
  });
  parts.push(display.slice(from), display.endsWith("\n") ? " " : "");

  return (
    <div className="mention-field">
      <div className="mention-field__box">
        <div ref={mirror} className="mention-field__mirror" aria-hidden="true">
          {parts}
        </div>
        <textarea
          ref={input}
          className="mention-field__input"
          aria-label={label}
          rows={rows}
          value={display}
          spellCheck={false}
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-activedescendant={open ? `${menuId}-${options[at].id}` : undefined}
          onChange={change}
          onPaste={paste}
          onBlur={blur}
          onSelect={track}
          onKeyUp={track}
          onClick={click}
          onKeyDown={keys}
          onScroll={(e) => { if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop; }}
        />
        {open && (
          <ul id={menuId} role="listbox" aria-label="Mention" className="mention-field__menu">
            {options.map((o, i) => (
              <li
                key={o.id}
                id={`${menuId}-${o.id}`}
                role="option"
                aria-selected={i === at}
                className="mention-field__option"
                // Before blur, or the field closes the menu before the click lands.
                onMouseDown={(e) => { e.preventDefault(); insert(o); }}
              >
                {o.text}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mention-field__status" role="status">
        {here && <span>{here.label}</span>}
        {missing.map((s) => (
          <button key={spanKey(s)} type="button" className="mention-field__fix" aria-label={s.label} onClick={() => onChoose(s)}>
            {fixText(s)}
          </button>
        ))}
      </div>
    </div>
  );
}
