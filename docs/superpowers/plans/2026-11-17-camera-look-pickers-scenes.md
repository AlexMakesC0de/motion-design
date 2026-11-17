# Camera and look pickers in Scenes: implementation plan (part 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a scene, pick the camera move, speed, shot size and angle of each stage, and the scene's lens and lighting, from the director's menu. The picks are saved as chips and written into the prompt.

**Architecture:**
- **One picks module**, `cli/director/picks.mjs`, in plain browser-safe JS with no imports. It names which picks exist, turns menu entries into prompt words, and edits a picks object. The page, the scene compiler and `wording.mjs` all use it, so a move is worded the same everywhere.
- **Storage:** an optional `picks` object on each stage (`move`, `speed`, `size`, `angle`) and on the scene's cards (`lens`, `light`), holding ids from `cli/director/menu.json`. `scenes.mjs` checks them on save. A scene with no picks is stored exactly as today.
- **Prompt:** `compileScene` in `cli/director/scene.mjs` writes the picks' words before the typed words of the Camera line, the `[SCENE]` section and the `[VISUAL STYLE]` section.
- **Page:** a new `web/src/scene/PickChips.tsx` (one chip with a listbox popover), placed in `SceneCards.tsx`. The page imports `menu.json` directly.
- **Agents:** the MCP `save_scene` tool accepts the same picks.

**Tech Stack:**
- Node 20+ ESM, tested with `node:test`.
- React 19, Vite and Vitest with Testing Library.
- MCP server with zod schemas.

**Spec:** [docs/superpowers/specs/2026-11-17-camera-look-pickers-design.md](../specs/2026-11-17-camera-look-pickers-design.md). This plan covers its "Order of work" steps 1 to 4. Step 5 (the Create Video page, `kie video --pick`, MCP `generate_video`) is part 2 and gets its own plan.

**Decided while planning (2026-11-17):**
- **Picking a move keeps the list open** so the speed can be set in the same visit. Every other chip closes on a pick. Escape or a click elsewhere closes the move list.
- **Removing one pick through MCP:** `save_scene` merges `cards.picks` by key, and a key sent as `null` is removed.
- **Pasting a whole prompt over a scene that has only chips** now asks first, like it does over written cards.
- **A pick the menu no longer has** is reported by `compileScene` as a problem (the menu's own message), not thrown, so the prompt preview still opens.

**Repo rules for every task:**
- Work on a branch: `git switch -c camera-look-pickers` before Task 1.
- Stage explicit paths only, and run `git diff --cached --stat` before each commit.
- Never stage `.gstack/`, `web/tsconfig.tsbuildinfo`, `transcript` or `.superpowers/`.
- Never use `git stash`.
- End each commit message with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## File map

| File | Change | What it is for |
|---|---|---|
| `cli/director/picks.mjs` | create | Which picks exist, their words, editing a picks object |
| `cli/director/picks.d.mts` | create | Types for the page |
| `cli/director/mentions.d.mts` | modify | `Stage.picks`, `Cards.picks` |
| `cli/director/wording.mjs` | modify | Use `picks.mjs` for camera and framing words |
| `cli/director/scenes.mjs` | modify | Check picks on save |
| `cli/director/scene.mjs` | modify | Write picks into the prompt |
| `mcp/scenes.mjs` | modify | `save_scene` takes picks |
| `web/tsconfig.json` | modify | Allow importing `menu.json` |
| `web/src/api/types.ts` | modify | Re-export the pick types |
| `web/src/scene/PickChips.tsx` | create | One chip and its list |
| `web/src/scene/SceneCards.tsx` | modify | Chips on the stage, Scene and Style cards |
| `web/src/scene/SceneScreen.tsx` | modify | Ask before a paste replaces chips |
| `web/src/scene/scene.css` | modify | Chip and list styles |
| `tests/director-picks.test.mjs` | create | The picks module |
| `tests/scenes.test.mjs`, `tests/scene-compile.test.mjs` | modify | Saving and compiling picks |
| `mcp/tests/scenes.test.mjs` | modify | `save_scene` with picks |
| `web/src/scene/PickChips.test.tsx` | create | The chip |
| `web/src/scene/SceneScreen.test.tsx` | modify | Chips in the editor |
| `web/README.md`, `mcp/README.md` | modify | Say the chips exist |

---

### Task 1: The picks module, and `wording.mjs` on top of it

**Files:**
- Create: `cli/director/picks.mjs`, `cli/director/picks.d.mts`, `tests/director-picks.test.mjs`
- Modify: `cli/director/mentions.d.mts:2-3`, `cli/director/wording.mjs:1-27`

- [ ] **Step 1: Write the failing test**

Create `tests/director-picks.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadMenu, entry } from "../cli/director/menu.mjs";
import { STAGE_PICKS, SCENE_PICKS, cameraWords, framingWords, stageWords, pickSentence, setPick, hasPicks } from "../cli/director/picks.mjs";

const menu = loadMenu();
const pick = (group, id) => entry(menu, group, id);

describe("picks", () => {
  test("every pick names a group the menu has", () => {
    for (const group of [...Object.values(STAGE_PICKS), ...Object.values(SCENE_PICKS)]) assert.ok(Array.isArray(menu[group]), group);
  });

  test("camera words: static holds still, speed is optional", () => {
    assert.equal(cameraWords(pick("moves", "static"), pick("speeds", "slow")), "the camera holds still");
    assert.equal(cameraWords(pick("moves", "push-in")), "the camera pushes in");
    assert.equal(cameraWords(pick("moves", "push-in"), pick("speeds", "slow")), "the camera slowly pushes in");
    assert.equal(cameraWords(null), "");
  });

  test("framing words join what is there", () => {
    assert.equal(framingWords([pick("sizes", "close-up"), null, pick("angles", "low")]), "close-up, low angle");
    assert.equal(framingWords([]), "");
  });

  test("a stage's line: framing, then camera, as one sentence", () => {
    assert.equal(stageWords({ move: "push-in", speed: "slow", size: "close-up", angle: "low" }, pick), "Close-up, low angle; the camera slowly pushes in.");
    assert.equal(stageWords({ size: "close-up" }, pick), "Close-up.");
    assert.equal(stageWords({ move: "static" }, pick), "The camera holds still.");
    assert.equal(stageWords({}, pick), "");
    assert.equal(stageWords(undefined, pick), "");
  });

  test("a lens or light as a sentence", () => {
    assert.equal(pickSentence(pick("lights", "golden-hour")), "Warm, low golden-hour sunlight.");
    assert.equal(pickSentence(pick("lenses", "85mm")), "85mm portrait lens.");
    assert.equal(pickSentence(null), "");
  });

  test("setPick adds, swaps and removes; losing the move loses the speed", () => {
    assert.deepEqual(setPick(undefined, "move", "push-in"), { move: "push-in" });
    assert.deepEqual(setPick({ move: "push-in", speed: "slow" }, "move", "orbit-left"), { move: "orbit-left", speed: "slow" });
    assert.deepEqual(setPick({ move: "push-in", speed: "slow", size: "wide" }, "move", "static"), { move: "static", size: "wide" });
    assert.deepEqual(setPick({ move: "push-in", speed: "slow", size: "wide" }, "move", undefined), { size: "wide" });
    assert.equal(setPick({ size: "wide" }, "size", undefined), undefined);
  });

  test("hasPicks sees a pick on the cards or on any stage", () => {
    const cards = { goal: "", scene: "", stages: [{ title: "", seconds: 4, camera: "", action: "", end: "" }], style: "", audio: "" };
    assert.equal(hasPicks(cards), false);
    assert.equal(hasPicks({ ...cards, picks: { light: "neon" } }), true);
    assert.equal(hasPicks({ ...cards, stages: [{ ...cards.stages[0], picks: { move: "static" } }] }), true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test tests/director-picks.test.mjs`
Expected: FAIL with `Cannot find module '.../cli/director/picks.mjs'`.

- [ ] **Step 3: Write `cli/director/picks.mjs`**

```js
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
```

- [ ] **Step 4: Add the types**

In `cli/director/mentions.d.mts`, replace lines 2-3:

```ts
export type StagePicks = { move?: string; speed?: string; size?: string; angle?: string };
export type ScenePicks = { lens?: string; light?: string };
export type Stage = { title: string; seconds: number; camera: string; action: string; end: string; picks?: StagePicks };
export type Cards = { goal: string; scene: string; stages: Stage[]; style: string; audio: string; picks?: ScenePicks };
```

Create `cli/director/picks.d.mts`:

```ts
import type { Cards, ScenePicks, StagePicks } from "./mentions.mjs";
export type MenuEntry = { id: string; label: string; words: string; when: string; hailuo?: string };
type Maybe = MenuEntry | null | undefined | false | "";
export const STAGE_PICKS: Record<keyof StagePicks, string>;
export const SCENE_PICKS: Record<keyof ScenePicks, string>;
export function framingWords(entries: Maybe[]): string;
export function cameraWords(move: MenuEntry | null | undefined, speed?: MenuEntry | null): string;
export function stageWords(picks: StagePicks | null | undefined, pick: (group: string, id: string) => MenuEntry): string;
export function pickSentence(entry: MenuEntry | null | undefined): string;
export function setPick<P extends StagePicks | ScenePicks>(picks: P | undefined, key: keyof P & string, id: string | undefined): P | undefined;
export function hasPicks(cards: Cards): boolean;
```

- [ ] **Step 5: Run the new test**

Run: `node --test tests/director-picks.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 6: Use the module in `wording.mjs`**

In `cli/director/wording.mjs`, add the import after line 2:

```js
import { cameraWords, framingWords } from "./picks.mjs";
```

Replace the three lines that build `move`, `camera` and `framing` (lines 25-27) with:

```js
  const move = pick("moves", shot.move.type);
  const camera = cameraWords(move, shot.move.type === "static" ? null : pick("speeds", shot.move.speed));
  const framing = framingWords([pick("sizes", shot.size), pick("angles", shot.angle), pick("lenses", shot.lens), pick("depths", shot.depth)]);
```

- [ ] **Step 7: Check the wording did not change**

Run: `node --test tests/director-wording.test.mjs tests/director-picks.test.mjs`
Expected: PASS. The golden wording tests are untouched and still pass, which proves the text is the same.

- [ ] **Step 8: Commit**

```bash
git add cli/director/picks.mjs cli/director/picks.d.mts cli/director/mentions.d.mts cli/director/wording.mjs tests/director-picks.test.mjs
git diff --cached --stat
git commit -m "Picks module: camera and framing words in one place, shared with the shot wording"
```

---

### Task 2: Save picks on a scene

**Files:**
- Modify: `cli/director/scenes.mjs:4-9` (imports), `:41-46` (inside `clean`)
- Test: `tests/scenes.test.mjs`

- [ ] **Step 1: Write the failing tests**

In `tests/scenes.test.mjs`, add inside `describe("scenes.json", …)`, after the "bad scenes are refused" test:

```js
  test("picks are kept on the stage and on the cards; an empty picks is not stored", () => {
    const stage = { title: "Open", seconds: 4, camera: "", action: "", end: "" };
    const s = saveScene("p1", {
      ...base(),
      cards: { ...base().cards, picks: { light: "golden-hour", lens: "" }, stages: [{ ...stage, picks: { move: "push-in", speed: "slow", size: "close-up" } }, { ...stage, picks: {} }] },
    });
    assert.deepEqual(s.cards.picks, { light: "golden-hour" });
    assert.deepEqual(s.cards.stages[0].picks, { move: "push-in", speed: "slow", size: "close-up" });
    assert.equal("picks" in s.cards.stages[1], false);
    const plain = saveScene("p1", base());
    assert.equal("picks" in plain.cards, false);
  });

  test("bad picks are refused, naming what the menu has", () => {
    const stage = (picks) => ({ ...base(), cards: { ...base().cards, stages: [{ title: "", seconds: 4, camera: "", action: "", end: "", picks }] } });
    assert.throws(() => saveScene("p2", stage({ move: "moonwalk" })), /"moonwalk" is not on the director's moves menu\. Choose one of: static, push-in/);
    assert.throws(() => saveScene("p2", stage({ lens: "85mm" })), /Stage 1 has no "lens" pick\. It takes: move, speed, size, angle\./);
    assert.throws(() => saveScene("p2", stage({ speed: "slow" })), /Stage 1: a speed needs a move other than static\./);
    assert.throws(() => saveScene("p2", stage({ move: "static", speed: "slow" })), /a speed needs a move other than static/);
    assert.throws(() => saveScene("p2", { ...base(), cards: { ...base().cards, picks: { light: "moonbeam" } } }), /not on the director's lights menu/);
    assert.throws(() => saveScene("p2", { ...base(), cards: { ...base().cards, picks: "golden-hour" } }), /The scene's picks must be an object\./);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/scenes.test.mjs`
Expected: the two new tests FAIL (the first with `undefined !== { light: 'golden-hour' }`, the second with "Missing expected exception").

- [ ] **Step 3: Check picks in `clean`**

In `cli/director/scenes.mjs`, add two imports after the `mentions.mjs` import (line 7):

```js
import { loadMenu, entry } from "./menu.mjs";
import { STAGE_PICKS, SCENE_PICKS } from "./picks.mjs";
```

Add this function above `clean`:

```js
/**
 * A picks object, checked against the menu. `groups` is STAGE_PICKS or
 * SCENE_PICKS; `where` starts the message ("Stage 2", "The scene"). Empty
 * values are dropped. Returns null when nothing is picked.
 */
function cleanPicks(input, groups, where) {
  if (input == null) return null;
  if (typeof input !== "object" || Array.isArray(input)) throw bad("picks", `${where === "The scene" ? "The scene's" : `${where}'s`} picks must be an object.`);
  const menu = loadMenu();
  const out = {};
  for (const [key, id] of Object.entries(input)) {
    if (id == null || id === "") continue;
    if (!groups[key]) throw bad("picks", `${where} has no "${key}" pick. It takes: ${Object.keys(groups).join(", ")}.`);
    entry(menu, groups[key], id); // refuses an unknown id, naming the menu's own
    out[key] = id;
  }
  if (out.speed && (!out.move || out.move === "static")) throw bad("picks", `${where}: a speed needs a move other than static.`);
  return Object.keys(out).length ? out : null;
}
```

In `clean`, replace the `stages` and `cards` lines (the `.map` over `c.stages` through `const cards = …`) with:

```js
  const stages = (c.stages ?? []).map((s, i) => {
    if (!Number.isInteger(s.seconds) || s.seconds < 1) throw bad("stages", `Stage ${i + 1} must last at least 1 second.`);
    const stage = { title: text(s.title, "title").trim(), seconds: s.seconds, camera: text(s.camera, "camera"), action: text(s.action, "action"), end: text(s.end, "end") };
    const picks = cleanPicks(s.picks, STAGE_PICKS, `Stage ${i + 1}`);
    return picks ? { ...stage, picks } : stage;
  });
  const cards = { goal: text(c.goal, "goal"), scene: text(c.scene, "scene"), stages, style: text(c.style, "style"), audio: text(c.audio, "audio") };
  const scenePicks = cleanPicks(c.picks, SCENE_PICKS, "The scene");
  if (scenePicks) cards.picks = scenePicks;
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/scenes.test.mjs`
Expected: PASS, every test.

- [ ] **Step 5: Commit**

```bash
git add cli/director/scenes.mjs tests/scenes.test.mjs
git diff --cached --stat
git commit -m "Scenes keep picks from the director's menu, checked on save"
```

---

### Task 3: Write picks into the prompt

**Files:**
- Modify: `cli/director/scene.mjs:3-6` (imports), `:28` (signature), `:64-65` ("says"), `:87-98` (sections)
- Test: `tests/scene-compile.test.mjs`

- [ ] **Step 1: Write the failing tests**

In `tests/scene-compile.test.mjs`, add inside `describe("compileScene", …)`:

```js
  test("picks are written before the typed words of their line", () => {
    const s = scene();
    s.cards.picks = { light: "golden-hour", lens: "85mm" };
    s.cards.stages[0].picks = { move: "push-in", speed: "slow", size: "close-up", angle: "low" };
    const { prompt, problems } = compileScene(s, { film: "sky", library });
    assert.deepEqual(problems, []);
    assert.match(prompt, /\[SCENE\]\nWarm, low golden-hour sunlight\. Over the Alps\.\n/);
    assert.match(prompt, /\nCamera: Close-up, low angle; the camera slowly pushes in\. Behind him, framed like \[Image 2\]\n/);
    assert.match(prompt, /\nCamera: Facing him\.\n/);
    assert.match(prompt, /\[VISUAL STYLE\]\n85mm portrait lens\. Film grain\.\n/);
  });

  test("picks with empty boxes still make their line and section", () => {
    const s = scene({ refs: [] });
    s.cards = { goal: "", scene: "", style: "", audio: "", picks: { light: "neon", lens: "24mm" }, stages: [{ title: "", seconds: 8, camera: "", action: "", end: "", picks: { move: "static" } }] };
    const { prompt, problems } = compileScene(s, { film: "sky", library });
    assert.deepEqual(problems, []);
    assert.equal(prompt, [
      "[SCENE]", `${cap(light("neon"))}.`, "",
      "[STAGE 1 | 0–8 SECONDS | STAGE 1]", "Camera: The camera holds still.", "",
      "[VISUAL STYLE]", `${cap(lens("24mm"))}.`, "",
      "[MAINTAIN CONSISTENCY]", "Keep every person, product and place exactly as in their reference images in every stage.",
    ].join("\n"));
  });

  test("a pick the menu no longer has is a problem, not a crash", () => {
    const s = scene();
    s.cards.stages[0].picks = { move: "moonwalk" };
    const { problems } = compileScene(s, { film: "sky", library });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /"moonwalk" is not on the director's moves menu/);
  });
```

Add these helpers under the existing `const scene = …` at the top of the file, and the import beside the others:

```js
import { loadMenu, entry } from "../cli/director/menu.mjs";
```

```js
const cap = (s) => `${s[0].toUpperCase()}${s.slice(1)}`;
const light = (id) => entry(loadMenu(), "lights", id).words;
const lens = (id) => entry(loadMenu(), "lenses", id).words;
```

The existing first test ("Dan's sections, in order…") is the guard that a scene with no picks compiles to the same text as before. Leave it unchanged.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/scene-compile.test.mjs`
Expected: the three new tests FAIL (no pick words in the prompt; the second also reports "Write the Goal, or what happens in a stage, first.").

- [ ] **Step 3: Compile the picks**

In `cli/director/scene.mjs`, add after the `mentions.mjs` import:

```js
import { loadMenu, entry } from "./menu.mjs";
import { stageWords, pickSentence, hasPicks } from "./picks.mjs";
```

Change the signature to take an optional menu:

```js
export function compileScene(input, { film, library, refToken = DEFAULT_REF_TOKEN, limits = null, sizeOf = () => null, menu = loadMenu() }) {
```

Replace the `says` line and its `if`:

```js
  const says = [scene.cards.goal, scene.cards.scene, ...scene.cards.stages.flatMap((s) => [s.camera, s.action])].some((t) => t?.trim()) || hasPicks(scene.cards);
  if (!says) problems.push("Write the Goal, or what happens in a stage, first.");
```

Directly under `const c = scene.cards;`, add:

```js
  // A pick's words. An id the menu no longer has becomes a problem and no words.
  const pick = (group, id) => entry(menu, group, id);
  const words = (fn) => {
    try {
      return fn();
    } catch (err) {
      problems.push(err.message);
      return "";
    }
  };
  const lead = (first, typed) => [first, typed].filter(Boolean).join(" ");
  const lightWords = words(() => (c.picks?.light ? pickSentence(pick("lights", c.picks.light)) : ""));
  const lensWords = words(() => (c.picks?.lens ? pickSentence(pick("lenses", c.picks.lens)) : ""));
```

Replace the `section("SCENE", …)` line, the stage loop's `lines` line, and the `section("VISUAL STYLE", …)` line:

```js
  section("SCENE", lead(lightWords, render(c.scene)));
  const times = stageTimes(scene);
  c.stages.forEach((s, i) => {
    const camera = lead(words(() => stageWords(s.picks, pick)), render(s.camera));
    const lines = [["Camera", camera], ["Action", render(s.action)], ["End", render(s.end)]].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    out.push(`[STAGE ${i + 1} | ${times[i].fromS}–${times[i].toS} SECONDS | ${(s.title || `Stage ${i + 1}`).toUpperCase()}]`, ...lines, "");
  });
  section("VISUAL STYLE", lead(lensWords, render(c.style)));
```

`const unique = [...new Set(problems)]` stays the last step, so problems pushed by `words` are included.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/scene-compile.test.mjs`
Expected: PASS, every test, including the unchanged first one.

- [ ] **Step 5: Run the whole CLI suite**

Run: `npm test`
Expected: PASS. Nothing else builds scene prompts, so no other test changes.

- [ ] **Step 6: Commit**

```bash
git add cli/director/scene.mjs tests/scene-compile.test.mjs
git diff --cached --stat
git commit -m "Scene prompts carry the picked move, framing, lens and light"
```

---

### Task 4: MCP `save_scene` takes picks

**Files:**
- Modify: `mcp/scenes.mjs:38-44` (`Stage` schema), `:105-146` (`save_scene`)
- Test: `mcp/tests/scenes.test.mjs`

- [ ] **Step 1: Write the failing test**

In `mcp/tests/scenes.test.mjs`, add as the last test inside the `describe`. It uses its own film, `picks`, so the tests before it are unaffected:

```js
  test("save_scene keeps picks, words them in the prompt, merges them by key and refuses an id the menu lacks", async () => {
    const r = await call(client, "save_scene", {
      run: "picks", title: "Box",
      cards: { goal: "She opens the box.", picks: { light: "golden-hour" }, stages: [{ title: "Open", seconds: 4, camera: "on her hands", action: "", end: "", picks: { move: "push-in", speed: "slow", size: "close-up" } }] },
    });
    ok(r);
    assert.deepEqual(data(r).cards.picks, { light: "golden-hour" });
    assert.deepEqual(data(r).cards.stages[0].picks, { move: "push-in", speed: "slow", size: "close-up" });

    const p = await call(client, "get_scene_prompt", { run: "picks", id: "s1" });
    ok(p);
    assert.match(data(p).prompt, /\[SCENE\]\nWarm, low golden-hour sunlight\.\n/);
    assert.match(data(p).prompt, /\nCamera: Close-up; the camera slowly pushes in\. on her hands\n/);

    const added = await call(client, "save_scene", { run: "picks", id: "s1", cards: { picks: { lens: "85mm" } } });
    assert.deepEqual(data(added).cards.picks, { light: "golden-hour", lens: "85mm" });
    const removed = await call(client, "save_scene", { run: "picks", id: "s1", cards: { picks: { light: null } } });
    assert.deepEqual(data(removed).cards.picks, { lens: "85mm" });

    const bad = await call(client, "save_scene", { run: "picks", id: "s1", cards: { picks: { light: "moonbeam" } } });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /not on the director's lights menu/);
  });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:mcp`
Expected: the new test FAILS. The schema strips the unknown `picks` keys, so `data(r).cards.picks` is `undefined`.

- [ ] **Step 3: Add picks to the schemas**

In `mcp/scenes.mjs`, replace the `Stage` schema:

```js
  const pickId = (what) => z.string().nullable().optional().describe(`${what} An id from get_menu; null removes it.`);
  const Stage = z.object({
    title: z.string(),
    seconds: z.number().int().min(1),
    camera: z.string(),
    action: z.string(),
    end: z.string(),
    picks: z
      .object({ move: pickId("The camera move."), speed: pickId("How fast the move is; needs a move other than static."), size: pickId("The shot size."), angle: pickId("The camera angle.") })
      .optional()
      .describe("This stage's camera, chosen from the director's menu. Its words are written before `camera` in the prompt."),
  });
```

In `save_scene`, add `picks` to the `cards` object schema, after `audio`:

```js
            picks: z
              .object({ lens: pickId("The scene's lens."), light: pickId("The scene's lighting.") })
              .optional()
              .describe("The scene's lens and lighting, chosen from the director's menu. Merged by key."),
```

Change the tool's description. Replace the sentence `"cards merge by key (goal, scene, stages, style, audio), and stages, when given, replace the whole list. " +` with:

```js
        "cards merge by key (goal, scene, stages, style, audio, picks), and stages, when given, replace the whole list. " +
        "A stage's picks (move, speed, size, angle) and the cards' picks (lens, light) are ids from get_menu; prefer a pick over typing the same move in words. " +
```

- [ ] **Step 4: Merge the cards' picks by key**

In the `save_scene` handler, replace the `merged` expression:

```js
      const picks = cards?.picks ? { ...(before?.cards.picks ?? {}), ...cards.picks } : undefined;
      const sent = picks ? { ...cards, picks } : (cards ?? {});
      const merged = before
        ? { ...before, ...given, cards: { ...before.cards, ...sent } }
        : { title: "", ratio: "16:9", refs: [], ...given, cards: { goal: "", scene: "", stages: [], style: "", audio: "", ...sent } };
```

A key sent as `null` survives the merge as `null`, and `cleanPicks` in `scenes.mjs` drops it. That is how one pick is removed.

- [ ] **Step 5: Run the tests**

Run: `npm run test:mcp`
Expected: PASS, every test.

- [ ] **Step 6: Commit**

```bash
git add mcp/scenes.mjs mcp/tests/scenes.test.mjs
git diff --cached --stat
git commit -m "MCP save_scene takes picks from the director's menu"
```

---

### Task 5: The chip

**Files:**
- Create: `web/src/scene/PickChips.tsx`, `web/src/scene/PickChips.test.tsx`
- Modify: `web/src/scene/scene.css` (append), `web/src/api/types.ts:519`, `web/tsconfig.json`

- [ ] **Step 1: Write the failing test**

Create `web/src/scene/PickChips.test.tsx`:

```tsx
import { describe, test, expect } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PickChip, type PickOption } from "./PickChips";

const moves: PickOption[] = [
  { id: "static", label: "Static", when: "Let the action do the work." },
  { id: "push-in", label: "Push in", when: "Move toward the subject." },
  { id: "pull-out", label: "Pull out", when: "Move away to reveal context." },
];
const speeds: PickOption[] = [
  { id: "slow", label: "Slow", when: "Calm." },
  { id: "fast", label: "Fast", when: "Energy." },
];

function Harness({ start, withSpeeds = false }: { start?: string; withSpeeds?: boolean }) {
  const [value, setValue] = useState(start);
  const [speed, setSpeed] = useState<string | undefined>();
  return (
    <>
      <PickChip
        label="Move"
        scope="Stage 2 move"
        options={moves}
        value={value}
        onPick={(id) => { setValue(id); if (!id || id === "static") setSpeed(undefined); }}
        {...(withSpeeds ? { speeds, speed, onSpeed: setSpeed } : {})}
      />
      <output data-testid="value">{`${value ?? "none"}/${speed ?? "none"}`}</output>
    </>
  );
}
const value = () => screen.getByTestId("value").textContent;

describe("PickChip", () => {
  test("an empty chip opens a list of options with their notes; clicking one picks it and closes", () => {
    render(<Harness />);
    const chip = screen.getByRole("button", { name: "Stage 2 move: none. Choose" });
    expect(chip).toHaveTextContent("Move");
    fireEvent.click(chip);
    const list = screen.getByRole("listbox", { name: "Stage 2 move" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "StaticLet the action do the work.", "Push inMove toward the subject.", "Pull outMove away to reveal context.",
    ]);
    fireEvent.click(within(list).getByRole("option", { name: /Push in/ }));
    expect(value()).toBe("push-in/none");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Stage 2 move: Push in. Change" })).toHaveFocus();
  });

  test("arrow keys move, Enter picks, Escape closes and returns focus", () => {
    render(<Harness />);
    const chip = screen.getByRole("button", { name: "Stage 2 move: none. Choose" });
    fireEvent.click(chip);
    const list = screen.getByRole("listbox");
    expect(list).toHaveFocus();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(within(list).getByRole("option", { name: /Push in/ })).toHaveAttribute("data-active", "true");
    fireEvent.keyDown(list, { key: "Enter" });
    expect(value()).toBe("push-in/none");

    fireEvent.click(screen.getByRole("button", { name: "Stage 2 move: Push in. Change" }));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Stage 2 move: Push in. Change" })).toHaveFocus();
    expect(value()).toBe("push-in/none");
  });

  test("a filled chip marks its option and can be removed", () => {
    render(<Harness start="pull-out" />);
    fireEvent.click(screen.getByRole("button", { name: "Stage 2 move: Pull out. Change" }));
    expect(screen.getByRole("option", { name: /Pull out/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Remove stage 2 move" }));
    expect(value()).toBe("none/none");
    expect(screen.queryByRole("button", { name: "Remove stage 2 move" })).toBeNull();
  });

  test("with speeds, picking a move keeps the list open and shows the speeds; Static hides them", () => {
    render(<Harness withSpeeds />);
    fireEvent.click(screen.getByRole("button", { name: "Stage 2 move: none. Choose" }));
    expect(screen.queryByRole("group", { name: "Stage 2 move speed" })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /Push in/ }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    const speedRow = screen.getByRole("group", { name: "Stage 2 move speed" });
    fireEvent.click(within(speedRow).getByRole("button", { name: "Slow" }));
    expect(value()).toBe("push-in/slow");
    expect(within(speedRow).getByRole("button", { name: "Slow" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Stage 2 move: Push in, slow. Change" })).toBeInTheDocument();
    fireEvent.click(within(speedRow).getByRole("button", { name: "Slow" }));
    expect(value()).toBe("push-in/none");
    fireEvent.click(screen.getByRole("option", { name: /Static/ }));
    expect(value()).toBe("static/none");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("an id the menu no longer has shows as written, so it can be swapped or removed", () => {
    render(<Harness start="moonwalk" />);
    expect(screen.getByRole("button", { name: "Stage 2 move: moonwalk. Change" })).toHaveTextContent("moonwalk");
    expect(screen.getByRole("button", { name: "Remove stage 2 move" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm --prefix web run test:page -- src/scene/PickChips.test.tsx`
Expected: FAIL with `Failed to resolve import "./PickChips"`.

- [ ] **Step 3: Write `web/src/scene/PickChips.tsx`**

```tsx
// One pick from the director's menu, as a chip. Empty it reads "+ Move";
// filled it shows the option's name and a remove button. The chip opens a
// listbox of the group's options, each with the menu's "when to use it" note.
// A chip given `speeds` (the Move chip) shows them above the list once a
// moving move is picked, and stays open after a pick so the speed can be set.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../app/icons";

export interface PickOption {
  id: string;
  label: string;
  when: string;
}

export interface PickChipProps {
  /** The chip's word when empty: "Move". */
  label: string;
  /** Whose pick this is, used in every accessible name: "Stage 2 move". */
  scope: string;
  options: PickOption[];
  value: string | undefined;
  onPick(id: string | undefined): void;
  speeds?: PickOption[];
  speed?: string;
  onSpeed?(id: string | undefined): void;
}

const lower = (s: string) => `${s[0].toLowerCase()}${s.slice(1)}`;

export function PickChip({ label, scope, options, value, onPick, speeds, speed, onSpeed }: PickChipProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLSpanElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const uid = useId();

  const chosen = options.find((o) => o.id === value);
  const speedChosen = speeds?.find((o) => o.id === speed);
  // An id the menu no longer has is shown as written.
  const name = value ? `${chosen?.label ?? value}${speedChosen ? `, ${speedChosen.label.toLowerCase()}` : ""}` : null;
  const moving = Boolean(speeds && value && value !== "static");

  const close = (focus = true) => {
    setOpen(false);
    if (focus) chip.current?.focus();
  };

  // Opening starts on the chosen option and moves focus into the list.
  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.id === value)));
    list.current?.focus();
    // Only on opening: a pick that keeps the list open must not move the highlight.
  }, [open]);

  // A click anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const choose = (id: string) => {
    onPick(id);
    // The Move chip stays open on a moving move, so its speed can be set next.
    if (!speeds || id === "static") close();
  };

  const keys = (e: KeyboardEvent) => {
    const last = options.length - 1;
    const go = (i: number) => {
      e.preventDefault();
      setActive(Math.max(0, Math.min(last, i)));
    };
    if (e.key === "ArrowDown") go(active + 1);
    else if (e.key === "ArrowUp") go(active - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(last);
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (options[active]) choose(options[active].id);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };

  return (
    <span className="pick" ref={wrap}>
      <button
        type="button"
        ref={chip}
        className="chip-button pick__chip"
        data-filled={value ? "true" : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={name ? `${scope}: ${name}. Change` : `${scope}: none. Choose`}
        onClick={() => setOpen((o) => !o)}
      >
        {!value && <Icon name="plus" size={14} />}
        {value ? `${chosen?.label ?? value}${speedChosen ? ` · ${speedChosen.label.toLowerCase()}` : ""}` : label}
      </button>
      {value && (
        <button type="button" className="pick__remove" aria-label={`Remove ${lower(scope)}`} title="Remove" onClick={() => onPick(undefined)}>
          <Icon name="close" size={12} />
        </button>
      )}
      {open && (
        <div className="pick-pop">
          {moving && speeds && (
            <div className="pick-pop__speeds" role="group" aria-label={`${scope} speed`}>
              {speeds.map((s) => (
                <button key={s.id} type="button" className="pill-toggle__item" title={s.when} aria-pressed={speed === s.id} onClick={() => onSpeed?.(speed === s.id ? undefined : s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <ul
            ref={list}
            className="pick-pop__list"
            role="listbox"
            tabIndex={0}
            aria-label={scope}
            aria-activedescendant={options[active] ? `${uid}-${options[active].id}` : undefined}
            onKeyDown={keys}
          >
            {options.map((o, i) => (
              <li
                key={o.id}
                id={`${uid}-${o.id}`}
                role="option"
                className="pick-pop__option"
                aria-selected={o.id === value}
                data-active={i === active ? "true" : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o.id)}
              >
                <span className="pick-pop__label">{o.label}</span>
                <span className="pick-pop__when">{o.when}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}
```

A note for whoever implements this: the accessible name of each option comes from its text, so `getByRole("option", { name: /Push in/ })` works without an `aria-label`. The repo has no ESLint, so the opening effect's short dependency list needs no disable comment.

- [ ] **Step 4: Add the styles**

Append to `web/src/scene/scene.css`:

```css
/* Picks: chips for a stage's camera and a scene's lens and light, each with a list. */
.pick-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.pick { position: relative; display: inline-flex; align-items: center; }
.pick__chip[data-filled="true"] { padding-right: 28px; border-color: var(--text-3); background: var(--surface-2); color: var(--text); }
.pick__chip:focus-visible, .pick__remove:focus-visible, .pick-pop__list:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pick__remove { position: absolute; right: 4px; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: 0; border-radius: 999px; background: transparent; color: var(--text-3); cursor: pointer; }
.pick__remove:hover { background: var(--surface-3); color: var(--text); }
.pick-pop { position: absolute; z-index: 20; top: calc(100% + 6px); left: 0; width: 300px; max-width: 80vw; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-1); box-shadow: 0 12px 32px rgb(0 0 0 / 0.4); }
.pick-pop__speeds { display: flex; gap: var(--space-1); padding-bottom: var(--space-2); margin-bottom: var(--space-2); border-bottom: 1px solid var(--line); }
.pick-pop__list { margin: 0; padding: 0; list-style: none; max-height: 280px; overflow-y: auto; }
.pick-pop__option { display: grid; gap: 2px; padding: 6px var(--space-2); border-radius: var(--radius-sm); cursor: pointer; }
.pick-pop__option[data-active="true"] { background: var(--surface-2); }
.pick-pop__option[aria-selected="true"] .pick-pop__label { color: var(--accent); }
.pick-pop__label { color: var(--text); font: 400 var(--text-sm)/1.4 var(--font-sans); }
.pick-pop__when { color: var(--text-3); font: 400 var(--text-xs)/1.4 var(--font-sans); }
```

- [ ] **Step 5: Let the page import `menu.json` and the pick types**

In `web/tsconfig.json`, add to `compilerOptions`, after `"skipLibCheck": true,`:

```json
    "resolveJsonModule": true,
```

In `web/src/api/types.ts`, replace line 519:

```ts
export type { Ref, Cards, Stage, Span, StagePicks, ScenePicks } from "../../../cli/director/mentions.mjs";
```

- [ ] **Step 6: Run the tests**

Run: `npm --prefix web run test:page -- src/scene/PickChips.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add web/src/scene/PickChips.tsx web/src/scene/PickChips.test.tsx web/src/scene/scene.css web/src/api/types.ts web/tsconfig.json
git diff --cached --stat
git commit -m "PickChip: one pick from the director's menu, as a chip with a list"
```

---

### Task 6: Chips in the scene editor

**Files:**
- Modify: `web/src/scene/SceneCards.tsx:1-7` (imports), `:129-135` (helpers), `:176-182` (stage rows), `:186-192` (optional cards), `web/src/scene/SceneScreen.tsx:143` (paste confirm)
- Test: `web/src/scene/SceneScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `web/src/scene/SceneScreen.test.tsx`, add inside `describe("SceneScreen", …)`:

```tsx
  test("a stage's move, speed, size and angle are picked as chips and saved with the scene", async () => {
    const stage = { title: "Open", seconds: 8, camera: "on her hands", action: "", end: "" };
    const fetchMock = stub({ scenes: [scene({ cards: { ...blankCards(), goal: "She opens the box.", stages: [stage] } })] });
    render(<SceneScreen run="create" />);
    const picks = await screen.findByRole("group", { name: "Stage 1 camera picks" });
    fireEvent.click(within(picks).getByRole("button", { name: "Stage 1 move: none. Choose" }));
    fireEvent.click(screen.getByRole("option", { name: /^Push in/ }));
    fireEvent.click(within(screen.getByRole("group", { name: "Stage 1 move speed" })).getByRole("button", { name: "Slow" }));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    fireEvent.click(within(picks).getByRole("button", { name: "Stage 1 shot size: none. Choose" }));
    fireEvent.click(screen.getByRole("option", { name: /^Close-up/ }));
    expect(within(picks).getByRole("button", { name: "Stage 1 move: Push in, slow. Change" })).toBeInTheDocument();
    await waitFor(() => {
      const sent = JSON.parse(String(calls(fetchMock, `${BASE}/s1`, "PUT").at(-1)?.[1]?.body));
      expect(sent.cards.stages[0].picks).toEqual({ move: "push-in", speed: "slow", size: "close-up" });
      expect(sent.cards.stages[0].camera).toBe("on her hands");
    });
    fireEvent.click(within(picks).getByRole("button", { name: "Remove stage 1 move" }));
    await waitFor(() => {
      const sent = JSON.parse(String(calls(fetchMock, `${BASE}/s1`, "PUT").at(-1)?.[1]?.body));
      expect(sent.cards.stages[0].picks).toEqual({ size: "close-up" });
    });
  });

  test("lighting sits on the Scene card and lens on the Style card; a pick keeps its card shown", async () => {
    const fetchMock = stub({ scenes: [scene({ cards: { ...blankCards(), goal: "She opens the box.", picks: { light: "golden-hour" } } })] });
    render(<SceneScreen run="create" />);
    expect(await screen.findByRole("button", { name: "Scene lighting: Golden hour. Change" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Scene lens/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Style" }));
    fireEvent.click(screen.getByRole("button", { name: "Scene lens: none. Choose" }));
    fireEvent.click(screen.getByRole("option", { name: /^85mm portrait/ }));
    await waitFor(() => {
      const sent = JSON.parse(String(calls(fetchMock, `${BASE}/s1`, "PUT").at(-1)?.[1]?.body));
      expect(sent.cards.picks).toEqual({ light: "golden-hour", lens: "85mm" });
    });
  });

  test("pasting a whole prompt over a scene that has only chips asks first", async () => {
    stub({ scenes: [scene({ cards: { ...blankCards(), picks: { light: "golden-hour" } } })] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<SceneScreen run="create" />);
    const goal = await screen.findByRole("textbox", { name: "Goal" });
    fireEvent.paste(goal, { clipboardData: { getData: () => "[GOAL]\nHe jumps.", files: [] } });
    expect(confirm).toHaveBeenCalledWith("Replace this scene's cards with the pasted prompt?");
    expect(screen.getByRole("button", { name: "Scene lighting: Golden hour. Change" })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix web run test:page -- src/scene/SceneScreen.test.tsx`
Expected: the three new tests FAIL (no group named "Stage 1 camera picks"; no "Scene lighting" button; `confirm` not called).

- [ ] **Step 3: Import the menu and the chip in `SceneCards.tsx`**

Replace the import block at the top of `web/src/scene/SceneCards.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { InputHTMLAttributes } from "react";
import menu from "../../../cli/director/menu.json";
import { setPick } from "../../../cli/director/picks.mjs";
import { DURATION, stageTimes } from "../../../cli/director/scene-shape.mjs";
import type { Cards, Ref, Scene, ScenePicks, Span, Stage, StagePicks } from "../api/types";
import { Icon } from "../app/icons";
import { MentionField } from "./MentionField";
import { PickChip } from "./PickChips";
import "./scene.css";
```

- [ ] **Step 4: Say which card holds which pick**

Replace the `OPTIONAL` constant with one that names each card's pick:

```tsx
const OPTIONAL = [
  { key: "scene", label: "Scene", hint: "Where and when: the place, the light, the time of day.", pick: { key: "light", label: "Lighting", options: menu.lights } },
  { key: "style", label: "Style", hint: "The look: lens, grade, film stock, references.", pick: { key: "lens", label: "Lens", options: menu.lenses } },
  { key: "audio", label: "Audio", hint: "Music in (), sound effects in <>, dialogue in {}.", pick: null },
] as const;
```

- [ ] **Step 5: Add the pick setters and keep a card with a pick shown**

In `SceneCards`, under the `removeStage` line, add:

```tsx
  const pickStage = (i: number, key: keyof StagePicks, id: string | undefined) =>
    onText((c) => ({ ...c, stages: c.stages.map((s, j) => (j === i ? { ...s, picks: setPick(s.picks, key, id) } : s)) }), null);
  const pickScene = (key: keyof ScenePicks, id: string | undefined) => onText((c) => ({ ...c, picks: setPick(c.picks, key, id) }), null);
```

Replace the `shownOptional` line:

```tsx
  const shownOptional = OPTIONAL.filter((o) => cards[o.key].trim() || opened.has(o.key) || (o.pick && cards.picks?.[o.pick.key]));
```

`{ ...s, picks: undefined }` is right when the last pick is removed: JSON drops the key, and the server stores no `picks`.

- [ ] **Step 6: Put the chips on the stage card**

In the stage card, between the `scene-stage__meta` div and the `(["camera", "action", "end"] as const).map(…)` rows, add:

```tsx
          <div className="pick-row" role="group" aria-label={`Stage ${n} camera picks`}>
            <PickChip
              label="Move"
              scope={`Stage ${n} move`}
              options={menu.moves}
              value={st.picks?.move}
              onPick={(id) => pickStage(stage, "move", id)}
              speeds={menu.speeds}
              speed={st.picks?.speed}
              onSpeed={(id) => pickStage(stage, "speed", id)}
            />
            <PickChip label="Shot size" scope={`Stage ${n} shot size`} options={menu.sizes} value={st.picks?.size} onPick={(id) => pickStage(stage, "size", id)} />
            <PickChip label="Angle" scope={`Stage ${n} angle`} options={menu.angles} value={st.picks?.angle} onPick={(id) => pickStage(stage, "angle", id)} />
          </div>
```

- [ ] **Step 7: Put the chips on the Scene and Style cards**

Replace the `shownOptional.map(…)` block:

```tsx
      {shownOptional.map((o) => (
        <div key={o.key} className="scene-card">
          <h3 className="scene-card__head">{o.label}</h3>
          {o.key === "audio" && <p className="scene-hint">{o.hint}</p>}
          {o.pick && (
            <div className="pick-row">
              <PickChip label={o.pick.label} scope={`Scene ${o.pick.label.toLowerCase()}`} options={o.pick.options} value={cards.picks?.[o.pick.key]} onPick={(id) => pickScene(o.pick.key, id)} />
            </div>
          )}
          {field(o.label, cards[o.key], (c, t) => ({ ...c, [o.key]: t }))}
        </div>
      ))}
```

If TypeScript narrows `o.pick` to `null` inside the `onPick` arrow, read it into a const first: `const p = o.pick;` above the `return`, and use `p` in the JSX.

- [ ] **Step 8: Ask before a paste replaces chips**

In `web/src/scene/SceneScreen.tsx`, add the import beside the other `cli/director` imports:

```tsx
import { hasPicks } from "../../../cli/director/picks.mjs";
```

In `onPasteWhole`, replace the confirm line:

```tsx
    if ((cardTexts(cur.cards).some((t) => t.trim()) || hasPicks(cur.cards)) && !window.confirm("Replace this scene's cards with the pasted prompt?")) return;
```

The pasted cards come from `parseDanPrompt`, which never sets `picks`, so accepting the paste clears the chips. No further change is needed for that.

- [ ] **Step 9: Run the tests**

Run: `npm --prefix web run test:page -- src/scene`
Expected: PASS, every test in `src/scene`, old and new.

- [ ] **Step 10: Type-check the page**

Run: `web/node_modules/.bin/tsc -p web/tsconfig.json`
Expected: no errors in `src/scene/` or `cli/director/picks`. The repo has no type-check script and CI does not run one, so run the same command on `main` first if other errors appear, and fix only what this branch added. If it reports `menu.lights` or `menu.moves` entries missing `when` or `label`, the menu file changed shape; read `cli/director/menu.json` and adjust `PickOption`, do not cast.

- [ ] **Step 11: Look at it in the studio**

Run: `npm run studio`

In the browser, open Video > Scenes, add a stage, and check:
1. The three chips sit above the Camera box and wrap on a narrow window.
2. The Move list opens under its chip, is not cut off by the notes column, and scrolls.
3. Picking Push in shows the speed row; picking Slow turns the chip into "Push in · slow".
4. The prompt preview shows `Camera: The camera slowly pushes in.` before the typed words.
5. "+ Scene" shows the Lighting chip; picking Golden hour puts "Warm, low golden-hour sunlight." first in `[SCENE]`.
6. Tab reaches every chip and remove button, and the focus ring is visible.

If the list is clipped by the notes column (an ancestor with `overflow: hidden` or `auto`), change `.pick-pop` to open inside the column: replace `left: 0; width: 300px; max-width: 80vw;` with `left: 0; right: auto; width: min(300px, 100%);` on `.pick-pop` and add `position: static;` to `.pick` with `position: relative;` on `.pick-row`. Re-run Step 9 afterwards.

- [ ] **Step 12: Commit**

```bash
git add web/src/scene/SceneCards.tsx web/src/scene/SceneScreen.tsx web/src/scene/SceneScreen.test.tsx web/src/scene/scene.css
git diff --cached --stat
git commit -m "Scenes: pick a stage's move, size and angle, and the scene's lens and light"
```

---

### Task 7: Docs and the full run

**Files:**
- Modify: `web/README.md` (Films section, step 3), `mcp/README.md` (Scenes section)

- [ ] **Step 1: Say it in the studio README**

In `web/README.md`, in the "Films" list, add one sentence to the end of step 3 (**Scenes**):

```markdown
A stage's camera move, speed, shot size and angle, and the scene's lens and lighting, can be picked as chips from the director's menu; Shard writes their words into the prompt before what you typed.
```

- [ ] **Step 2: Say it in the MCP README**

In `mcp/README.md`, at the end of the first paragraph of the "Scenes" section (after the sentence that describes what a scene is built from), add:

```markdown
A stage can also carry `picks` (`move`, `speed`, `size`, `angle`) and the cards `picks` (`lens`, `light`): ids from `get_menu`, worded by Shard before the typed text. Send a key as `null` to remove it.
```

- [ ] **Step 3: Run everything**

Run each and expect PASS:

```bash
npm test
```

```bash
npm run test:mcp
```

```bash
npm run test:web
```

- [ ] **Step 4: Commit**

```bash
git add web/README.md mcp/README.md
git diff --cached --stat
git commit -m "Docs: picks in Scenes and in save_scene"
```

---

## What part 2 will cover

The Create Video page: the same chip row under the prompt box with all five picks, the generate request carrying them, a block of words added after the typed prompt for the chosen model's family (Hailuo's bracket commands included), `kie video --pick`, and MCP `generate_video`. `PickChip` and `picks.mjs` from this plan are reused as they are.
