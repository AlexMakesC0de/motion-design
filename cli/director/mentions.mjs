// Mentions in a scene's text. Browser-safe: the studio page imports this file
// too, so what the editor colours green is exactly what generation accepts.
//
// Stored text binds image mentions to ref ids ("@{r2}"), so reordering or
// removing refs renumbers them; the editor shows them by position ("@image2").
// Library mentions are stored as typed ("@library:alexandros").

export const MAX_REFS = 9;
const NAME = "[a-z0-9][a-z0-9-]{0,80}";
export const IMAGE = /@image(\d+)\b/g;
export const STORED = /@\{(r\d+)\}/g;
export const LIBRARY = new RegExp(`@library:(${NAME})`, "g");
// What people paste: [@image2], @Image 2, <<<image_2>>>, [Image 2], @image2.
const PASTED_IMAGE = /\[@image(\d+)\]|<<<image_(\d+)>>>|\[image (\d+)\]|(?<![\w.])@image ?(\d+)\b/gi;
const PASTED_LIBRARY = new RegExp(`\\[@library:(${NAME})\\]`, "g");

export function normalizeMentions(text) {
  return text.replace(PASTED_LIBRARY, "@library:$1").replace(PASTED_IMAGE, (_m, a, b, c, d) => `@image${Number(a ?? b ?? c ?? d)}`);
}

export function nextRefId(refs) {
  let n = 1;
  while (refs.some((r) => r.id === `r${n}`)) n += 1;
  return `r${n}`;
}

export function refLabel(ref) {
  if (!ref?.source) return "empty";
  if (ref.source.startsWith("library:")) return ref.source.slice("library:".length);
  return ref.source.split("/").pop();
}

export function toDisplay(stored, refs) {
  return stored.replace(STORED, (m, id) => {
    const i = refs.findIndex((r) => r.id === id);
    return i < 0 ? m : `@image${i + 1}`;
  });
}

/**
 * Display text → stored text. Without settle (each keystroke) it only binds
 * numbers that exist. With settle (paste, leaving the field) it also
 * normalises pasted forms and adds empty slots up to the highest number.
 */
export function toStored(display, refs, { settle = false } = {}) {
  let text = settle ? normalizeMentions(display) : display;
  let out = refs;
  if (settle) {
    const highest = Math.max(0, ...[...text.matchAll(IMAGE)].map((m) => Number(m[1])));
    if (highest <= MAX_REFS && highest > out.length) {
      out = [...out];
      while (out.length < highest) out.push({ id: nextRefId(out), source: null });
    }
  }
  text = text.replace(IMAGE, (m, n) => {
    const r = out[Number(n) - 1];
    return r ? `@{${r.id}}` : m;
  });
  return { text, refs: out };
}

function refState(ref, items) {
  if (!ref.source) return "no picture yet";
  if (ref.source.startsWith("library:")) {
    const name = refLabel(ref);
    const item = items.get(name);
    if (!item) return `${name} is not in the Library`;
    if (!item.hasSheet) return `${name} has no sheet yet`;
  }
  return null;
}

/** Every mention in display text, linked or missing, for the overlay and the status line. */
export function mentionSpans(display, refs, items) {
  const spans = [];
  for (const m of display.matchAll(IMAGE)) {
    const n = Number(m[1]);
    const ref = refs[n - 1];
    const reason = ref ? refState(ref, items) : `there is no image ${n} in this scene`;
    spans.push({
      start: m.index, end: m.index + m[0].length, kind: "image", n, refId: ref?.id ?? null,
      state: reason ? "missing" : "linked", reason,
      label: reason ? `image ${n}, ${reason}, choose one` : `image ${n}, ${refLabel(ref)}`,
    });
  }
  for (const m of display.matchAll(LIBRARY)) {
    const name = m[1];
    const item = items.get(name);
    const reason = !item ? "not in the Library" : !item.hasSheet ? "no sheet yet" : null;
    spans.push({
      start: m.index, end: m.index + m[0].length, kind: "library", name, refId: null,
      state: reason ? "missing" : "linked", reason,
      label: reason ? `${name}, ${reason}` : `${name}, from the Library`,
    });
  }
  return spans.sort((a, b) => a.start - b.start);
}

export function cardTexts(cards) {
  return [cards.goal, cards.scene, ...cards.stages.flatMap((s) => [s.camera, s.action, s.end]), cards.style, cards.audio];
}

export function mapCardTexts(cards, fn) {
  return {
    ...cards,
    goal: fn(cards.goal),
    scene: fn(cards.scene),
    stages: cards.stages.map((s) => ({ ...s, camera: fn(s.camera), action: fn(s.action), end: fn(s.end) })),
    style: fn(cards.style),
    audio: fn(cards.audio),
  };
}

/** Drop a ref; its mentions become its name in plain words. */
export function removeRef(scene, id) {
  const ref = scene.refs.find((r) => r.id === id);
  const word = ref?.source ? refLabel(ref) : "the image";
  return {
    ...scene,
    refs: scene.refs.filter((r) => r.id !== id),
    cards: mapCardTexts(scene.cards, (t) => t.replaceAll(`@{${id}}`, word)),
  };
}

/** Attach each mentioned Library item that is not attached yet. */
export function attachLibraryMentions(scene) {
  const refs = [...scene.refs];
  for (const t of cardTexts(scene.cards)) {
    for (const m of t.matchAll(LIBRARY)) {
      const source = `library:${m[1]}`;
      if (refs.length < MAX_REFS && !refs.some((r) => r.source === source)) refs.push({ id: nextRefId(refs), source });
    }
  }
  return refs.length === scene.refs.length ? scene : { ...scene, refs };
}

/** The Library items a scene uses, attached or mentioned, each once, attached first. */
export function libraryNames(scene) {
  const names = scene.refs.flatMap((r) => (r.source?.startsWith("library:") ? [r.source.slice("library:".length)] : []));
  for (const t of cardTexts(scene.cards)) for (const m of t.matchAll(LIBRARY)) names.push(m[1]);
  return [...new Set(names)];
}

// Cards and pasted prompts live here, not in scenes.mjs, because the page needs them too.
export const emptyCards = () => ({ goal: "", scene: "", stages: [], style: "", audio: "" });

const SECTION = /^\[(GOAL|REFERENCES|SCENE|VISUAL STYLE|AUDIO|MAINTAIN CONSISTENCY|STAGE (\d+) \| (\d+)\s*[–-]\s*(\d+) SECONDS \| ([^\]]+))\]\s*$/i;

/** A whole prompt in Dan's sections → cards, or null when the text has no sections. */
export function parseDanPrompt(raw) {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  if (!lines.some((l) => SECTION.test(l.trim()))) return null;
  const cards = emptyCards();
  let target = null;
  const body = [];
  const flush = () => {
    const t = body.splice(0).join("\n").trim();
    if (!target) return;
    if (target.stage) {
      for (const line of t.split("\n")) {
        const m = line.match(/^(Camera|Action|End):\s*(.*)$/i);
        if (m) target.stage[m[1].toLowerCase()] = m[2].trim();
        else if (line.trim()) target.stage.action = [target.stage.action, line.trim()].filter(Boolean).join(" ");
      }
    } else if (target.key) cards[target.key] = t;
  };
  for (const line of lines) {
    const m = line.trim().match(SECTION);
    if (!m) {
      body.push(line);
      continue;
    }
    flush();
    const head = m[1].toUpperCase();
    if (m[2]) {
      const stage = { title: titleCase(m[5].trim()), seconds: Math.max(1, Number(m[4]) - Number(m[3])), camera: "", action: "", end: "" };
      cards.stages.push(stage);
      target = { stage };
    } else {
      target = { key: { GOAL: "goal", SCENE: "scene", "VISUAL STYLE": "style", AUDIO: "audio" }[head] ?? null };
    }
  }
  flush();
  return cards;
}

const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
