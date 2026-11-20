// Picks: a scene's choices from the director's menu (cli/director/menu.json).
// A stage picks a move, a speed, a shot size and an angle; a scene picks a
// lens and a light. Each pick is a menu id.
//
// Browser-safe like mentions.mjs: no imports, so the studio page uses the same
// rules as the server. Callers pass `pick(group, id)`, which returns a menu
// entry and decides what an unknown id does.

/** A stage's pick → the menu group it chooses from. */
export const STAGE_PICKS = { move: "moves", speed: "speeds", size: "sizes", angle: "angles" };
/** A scene's pick → the menu group it chooses from. */
export const SCENE_PICKS = { lens: "lenses", light: "lights" };

const cap = (s) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : "");

/** Menu entries → "close-up, low angle". Missing ones are skipped. */
export const framingWords = (entries) => entries.filter(Boolean).map((e) => e.words).join(", ");

/** "the camera slowly pushes in". The speed is optional, and Static has none. */
export function cameraWords(move, speed = null) {
  if (!move) return "";
  if (move.id === "static") return "the camera holds still";
  return ["the camera", speed?.words, move.words].filter(Boolean).join(" ");
}

/** A stage's picks as one sentence: "Close-up, low angle; the camera slowly pushes in." Empty when there are none. */
export function stageWords(picks, pick) {
  if (!picks) return "";
  const framing = framingWords([picks.size && pick("sizes", picks.size), picks.angle && pick("angles", picks.angle)]);
  const camera = picks.move ? cameraWords(pick("moves", picks.move), picks.speed ? pick("speeds", picks.speed) : null) : "";
  const body = [framing, camera].filter(Boolean).join("; ");
  return body ? `${cap(body)}.` : "";
}

/** One lens or light entry as a sentence: "Warm, low golden-hour sunlight." */
export const pickSentence = (entry) => (entry ? `${cap(entry.words)}.` : "");

/**
 * Set, swap or (with no id) remove one pick. Removing the move, or picking
 * Static, removes the speed too. Returns undefined when nothing is left, so an
 * empty picks object is never stored.
 */
export function setPick(picks, key, id) {
  const next = { ...(picks ?? {}) };
  if (id) next[key] = id;
  else delete next[key];
  if (key === "move" && (!id || id === "static")) delete next.speed;
  return Object.keys(next).length ? next : undefined;
}

const some = (picks) => Boolean(picks && Object.keys(picks).length);
/** Whether the cards hold any pick, on the scene or on a stage. */
export const hasPicks = (cards) => some(cards.picks) || cards.stages.some((s) => some(s.picks));

/**
 * #move tags in a prompt: "She turns, #whip-pan to the door." Each tag names a
 * move on the menu, so several moves can sit in one prompt, in order. `ids` is
 * the menu's moves (or bare ids); a move answers to its tag and its id, and the
 * longest name the tag starts with wins ("#dolly-in-slow" is #dolly-in followed
 * by "-slow"). A # inside a word ("C#") is not a tag. Each hit gives the move id.
 */
export function findMoveTags(text, ids) {
  // A move is typed by its tag (#arc-left) or, for older prompts, its id (#orbit-left).
  const known = new Map();
  for (const x of ids) {
    if (typeof x === "string") known.set(x, x);
    else for (const name of [x.id, x.tag]) if (name) known.set(name, x.id);
  }
  const out = [];
  for (const m of text.matchAll(/(^|[^\w&#])#([a-z0-9][a-z0-9-]*)/gi)) {
    let name = m[2].toLowerCase();
    while (name && !known.has(name)) name = name.replace(/-?[^-]*$/, "");
    if (!name) continue;
    const start = m.index + m[1].length;
    out.push({ start, end: start + 1 + name.length, id: known.get(name) });
  }
  return out;
}

/** The prompt with each #move tag written out: "#push-in on her" → "the camera pushes in on her". A tag that starts a sentence is capitalised. */
export function expandMoveTags(text, moves) {
  const tags = findMoveTags(text, moves);
  let out = "";
  let at = 0;
  for (const t of tags) {
    const before = text.slice(0, t.start);
    const words = cameraWords(moves.find((m) => m.id === t.id));
    out += text.slice(at, t.start) + (/(^|[.!?]\s+|\n\s*)$/.test(before) ? cap(words) : words);
    at = t.end;
  }
  return out + text.slice(at);
}
