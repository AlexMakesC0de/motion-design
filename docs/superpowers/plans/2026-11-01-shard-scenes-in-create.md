# Shard scenes in Create: implementation plan (phase 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scene editor in Create. You write or paste a Seedance 2.5 prompt in Dan's sections, fill its references from the Library or uploads, and make 480p drafts and 720p/1080p finals.

**Architecture:**
- **One mention module**, `cli/director/mentions.mjs`, written in plain browser-safe JS. It turns pasted forms into `@image2` / `@library:name`, binds image mentions to ref ids (`@{r2}`), makes empty slots, and says which mentions are linked or missing. The page and the server both import it, so the editor's green and red always match what generation accepts.
- **Scene storage:** `cli/director/scenes.mjs` reads and writes `runs/<film>/scenes.json` through the existing film lock.
- **Prompt compiler:** `cli/director/scene.mjs` `compileScene` builds Dan's sectioned prompt and the ordered refs.
- **Server:** `web/server/api/scenes.mjs` reuses the generate route's submit path. It is extracted from `web/server/api/generate.mjs` into a shared function.
- **Page:** a new `web/src/scene/` folder. Create gets two tabs: **Scene** (new, the default) and **Quick take** (today's prompt bar and feed, unchanged).

**Tech Stack:**
- Node 22 ESM, tested with `node:test`.
- React 19, Vite and Vitest with Testing Library.

**Spec:** [docs/superpowers/specs/2026-11-01-shard-scenes-design.md](../specs/2026-11-01-shard-scenes-design.md), sections "Scenes", "Film → Scenes" and "Create", including the "Pasted prompts" and "Mention states" bullets.

**Decided while planning (2026-11-01):**
- **Reference token:** Seedance 2.5 on kie gets `[Image N]`. kie's docs name no token. ByteDance's own API is reported to use `[Image 1]`, numbered in send order (sources: github.com/paperfoot/seedance-cli, vercel.com/ai-gateway/models/seedance-2.0-fast). It is set per model as `promptProfile.refToken`, so changing it is one line.
- **Finalize:** kie publishes no price for `bytedance/seedance-2-5-draft`. "Make final" re-runs the compiled prompt at 720p or 1080p, and says the motion will differ. The finalize route stays unused.
- **Create's own folder:** the spec's `runs/_create` cannot work, because `runDir` refuses a leading underscore. Create uses the run `create`, and `listRuns` hides it.
- **Stage times** come from each stage's length in seconds. Contiguity holds by construction: `fromS` and `toS` are derived on save. The stage bar is a picture, not a drag control, and handles come later.
- **Out of this phase:** chat tools, the film steps, Finish, and "Save into film". Those are phase 4.

**Repo rules for every task:**
- Stage explicit paths only, and run `git diff --cached --stat` before each commit.
- Never stage `.gstack/`, `web/tsconfig.tsbuildinfo`, `transcript` or `.superpowers/`.
- Never use `git stash`.
- Never write the shell-running call from `node:child_process` that takes one command string; a security hook refuses it.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do not push.
- Never call kie or spend. Tests use the existing stubs (`deps` in core, `generateStubs()` in `web/tests/helpers.mjs`).
- Use `/bin/ls`, not `ls`.
- Text on screen is 12px or more (guarded by `web/tests/type-scale.test.mjs`).
- Green (`--accent`) appears only on the main button, prices and linked mentions.

---

## File structure

| File | Responsibility |
|---|---|
| `cli/models.json` | `promptProfile.refToken` for seedance-2-5 (modify) |
| `cli/lib/run.mjs`, `cli/core/views.mjs` | `SCRATCH_RUN = "create"`, hidden from `listRuns` (modify) |
| `cli/director/files.mjs` | `scenes.json` added to `FILM_FILES` (modify) |
| `cli/director/mentions.mjs` + `mentions.d.mts` | Pasted forms, binding, slots, spans, removal. Browser-safe (create) |
| `cli/director/scenes.mjs` | Read and save `scenes.json`, check scenes, versions, `parseDanPrompt` (create) |
| `cli/director/scene.mjs` | `compileScene` (create) |
| `tests/mentions.test.mjs`, `tests/scenes.test.mjs`, `tests/scene-compile.test.mjs` | Core tests (create) |
| `web/server/api/generate.mjs` | Extract `createSubmitter` (modify) |
| `web/server/api/scenes.mjs` | Scene endpoints, ref upload, prompt preview, draft, final, choose (create) |
| `web/server/app.mjs` | Register the scene routes (modify) |
| `web/tests/scenes.test.mjs` | Server tests (create) |
| `web/src/api/types.ts` | Scene types (modify) |
| `web/src/scene/useScenes.ts` | Load and save scenes, with a debounced save (create) |
| `web/src/scene/MentionField.tsx` | Textarea with a coloured overlay, the `@` menu and the status line (create) |
| `web/src/scene/RefChooser.tsx` | "Choose a picture for @image3": Library, Upload, paste (create) |
| `web/src/scene/SceneRefs.tsx` | Left column, "In this scene" (create) |
| `web/src/scene/SceneCards.tsx` | Centre: title, stage bar, cards (create) |
| `web/src/scene/Versions.tsx` | Right column: player, versions, New draft, Make final (create) |
| `web/src/scene/SceneScreen.tsx` + `scene.css` | Scene tabs and the three columns (create) |
| `web/src/studio/StudioScreen.tsx` | Scene and Quick take tabs (modify) |
| `web/src/library/LibraryScreen.tsx`, `web/src/app/route.ts` | `#/library/new/<name>` opens the sheet maker with the name filled in (modify) |

---

### Task 1: Groundwork: the ref token, the scratch run, scenes.json

**Files:**
- Modify: `cli/models.json`, `cli/lib/run.mjs`, `cli/core/views.mjs`, `cli/director/files.mjs`
- Test: add to `tests/director-store.test.mjs` and to the test file that covers `listRuns` (grep `listRuns` in `tests/`)

- [ ] **Step 1: Failing tests**

```js
// tests/director-store.test.mjs
test("scenes.json is a film file", () => {
  writeFilmJson("scene-film", "scenes.json", { version: 1, idea: null, scenes: [] });
  assert.deepEqual(readFilmJson("scene-film", "scenes.json").scenes, []);
});
```

```js
// beside the existing listRuns tests
test("the Create scratch run is not listed as a film", () => {
  mkdirSync(join(RUNS, "create"), { recursive: true });
  assert.ok(!listRuns().some((r) => r.run === "create"));
});
```

```js
// tests/models.test.mjs (or whichever file loads the catalog)
test("Seedance 2.5 names its references [Image N]", () => {
  assert.equal(catalog.models["seedance-2-5"].promptProfile.refToken, "[Image {n}]");
});
```

Adapt the catalog access to how the existing tests load it. Read the top of `tests/models.test.mjs` first.

- [ ] **Step 2: Run and see them fail**

Run: `npm test`

Expected: the three new tests FAIL. `filmFile` refuses scenes.json, `create` is listed, and `refToken` is undefined.

- [ ] **Step 3: Implement**
- In `cli/director/files.mjs`, append `"scenes.json"` to `FILM_FILES`.
- In `cli/lib/run.mjs`, export this below `SLUG`:

```js
/** Create's own run: one-off scenes that belong to no film. Hidden from film lists. */
export const SCRATCH_RUN = "create";
```

- In `cli/core/views.mjs` `listRuns`, import `SCRATCH_RUN` and add `&& d.name !== SCRATCH_RUN` to the filter.
- In `cli/models.json`, in the `seedance-2-5` `promptProfile`, add:

```json
"refToken": "[Image {n}]",
"refTokenSource": "kie's Seedance 2.5 docs name no token (docs.kie.ai/market/bytedance/seedance-2-5.md, read 2026-11-01). ByteDance's API is reported to use [Image 1] in send order (github.com/paperfoot/seedance-cli; vercel.com/ai-gateway/models/seedance-2.0-fast). Unverified by a paid run."
```

- In the same model's kie route `draftFinalize.note`, append: ` kie.ai/seedance-2-5 shows no price for it (read 2026-11-01); the studio re-runs at 720p/1080p instead.`
- If a test checks that models.json keys are known, add `refToken` and `refTokenSource` to its allowed list.

- [ ] **Step 4: Run** `npm test && npm --prefix web run test:server`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/models.json cli/lib/run.mjs cli/core/views.mjs cli/director/files.mjs tests/director-store.test.mjs
# plus the listRuns and models test files you touched, by explicit path
git diff --cached --stat
git commit -m "scenes: scenes.json film file, Create's scratch run, and Seedance's [Image N] token

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: mentions.mjs

**Files:**
- Create: `cli/director/mentions.mjs`, `cli/director/mentions.d.mts`, `tests/mentions.test.mjs`

This module must not import anything from Node. The page imports it.

- [ ] **Step 1: Failing tests**

`tests/mentions.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_REFS, normalizeMentions, toDisplay, toStored, mentionSpans, removeRef, attachLibraryMentions, cardTexts, mapCardTexts, refLabel,
} from "../cli/director/mentions.mjs";

const refs = [{ id: "r1", source: "library:alexandros" }, { id: "r2", source: "file:refs/door.png" }];
const items = new Map([["alexandros", { hasSheet: true }], ["maya", { hasSheet: false }]]);

describe("pasted forms", () => {
  test("every pasted form becomes @imageN or @library:name", () => {
    assert.equal(
      normalizeMentions("[@image2] then @Image 3, <<<image_1>>>, [Image 4], @image5 and [@library:maya]"),
      "@image2 then @image3, @image1, @image4, @image5 and @library:maya",
    );
  });
  test("words that only look close are left alone", () => {
    assert.equal(normalizeMentions("email@image2x.com and imageN"), "email@image2x.com and imageN");
  });
});

describe("binding", () => {
  test("stored text binds by id and shows by position", () => {
    assert.equal(toDisplay("@{r2} beside @{r1}", refs), "@image2 beside @image1");
    const { text, refs: same } = toStored("@image2 beside @image1", refs);
    assert.equal(text, "@{r2} beside @{r1}");
    assert.equal(same, refs);
  });
  test("reordering refs renumbers what is shown", () => {
    assert.equal(toDisplay("@{r2}", [refs[1], refs[0]]), "@image1");
  });
  test("while typing, an image number past the list stays as typed", () => {
    const { text, refs: out } = toStored("@image7", refs);
    assert.equal(text, "@image7");
    assert.equal(out.length, 2);
  });
  test("settling (paste or leaving the field) normalises and adds empty slots up to the highest number", () => {
    const { text, refs: out } = toStored("[@image4] and @image1", refs, { settle: true });
    assert.deepEqual(out.map((r) => [r.id, r.source]), [["r1", "library:alexandros"], ["r2", "file:refs/door.png"], ["r3", null], ["r4", null]]);
    assert.equal(text, "@{r4} and @{r1}");
  });
  test("slots stop at MAX_REFS", () => {
    const { text, refs: out } = toStored("@image12", [], { settle: true });
    assert.equal(MAX_REFS, 9);
    assert.equal(out.length, 0);
    assert.equal(text, "@image12");
  });
});

describe("spans", () => {
  test("linked mentions are green, missing ones say why", () => {
    const slots = [...refs, { id: "r3", source: null }];
    const display = "@image1 @image3 @image8 @library:alexandros @library:maya @library:ghost";
    const spans = mentionSpans(display, slots, items);
    assert.deepEqual(
      spans.map((s) => [display.slice(s.start, s.end), s.state, s.reason]),
      [
        ["@image1", "linked", null],
        ["@image3", "missing", "no picture yet"],
        ["@image8", "missing", "there is no image 8 in this scene"],
        ["@library:alexandros", "linked", null],
        ["@library:maya", "missing", "no sheet yet"],
        ["@library:ghost", "missing", "not in the Library"],
      ],
    );
    assert.equal(spans[0].label, "image 1, alexandros");
    assert.equal(spans[1].label, "image 3, no picture yet, choose one");
  });
  test("an image slot holding an item with no sheet is missing", () => {
    const [s] = mentionSpans("@image1", [{ id: "r1", source: "library:maya" }], items);
    assert.deepEqual([s.state, s.reason], ["missing", "maya has no sheet yet"]);
  });
});

describe("cards", () => {
  const scene = {
    refs,
    cards: { goal: "@{r1} jumps", scene: "", stages: [{ title: "Exit", seconds: 4, camera: "behind @{r1}", action: "", end: "" }], style: "", audio: "" },
  };
  test("cardTexts lists every text; mapCardTexts rewrites them all", () => {
    assert.deepEqual(cardTexts(scene.cards), ["@{r1} jumps", "", "behind @{r1}", "", "", "", ""]);
    const up = mapCardTexts(scene.cards, (t) => t.toUpperCase());
    assert.equal(up.stages[0].camera, "BEHIND @{R1}");
  });
  test("removing a mentioned ref turns its mentions into plain words", () => {
    const out = removeRef(scene, "r1");
    assert.deepEqual(out.refs.map((r) => r.id), ["r2"]);
    assert.equal(out.cards.goal, "alexandros jumps");
    assert.equal(out.cards.stages[0].camera, "behind alexandros");
  });
  test("library mentions attach their item once, up to MAX_REFS", () => {
    const s = { refs: [], cards: { goal: "@library:maya and @library:maya", scene: "", stages: [], style: "", audio: "" } };
    assert.deepEqual(attachLibraryMentions(s).refs, [{ id: "r1", source: "library:maya" }]);
  });
  test("refLabel names a ref", () => {
    assert.deepEqual([refLabel(refs[0]), refLabel(refs[1]), refLabel({ id: "r9", source: null })], ["alexandros", "door.png", "empty"]);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `node --test tests/mentions.test.mjs`. Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement**

`cli/director/mentions.mjs`:

```js
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
```

Note: the test for `removeRef` expects `mapCardTexts` to touch only text fields. `toUpperCase` turns `@{r1}` into `@{R1}` in that test, which is fine.

`cli/director/mentions.d.mts`, types for the page:

```ts
export type Ref = { id: string; source: string | null; keep?: string };
export type Stage = { title: string; seconds: number; camera: string; action: string; end: string };
export type Cards = { goal: string; scene: string; stages: Stage[]; style: string; audio: string };
export type Span = {
  start: number; end: number; kind: "image" | "library"; n?: number; name?: string; refId: string | null;
  state: "linked" | "missing"; reason: string | null; label: string;
};
export const MAX_REFS: number;
export function normalizeMentions(text: string): string;
export function nextRefId(refs: Ref[]): string;
export function refLabel(ref: Ref | null | undefined): string;
export function toDisplay(stored: string, refs: Ref[]): string;
export function toStored(display: string, refs: Ref[], opts?: { settle?: boolean }): { text: string; refs: Ref[] };
export function mentionSpans(display: string, refs: Ref[], items: Map<string, { hasSheet: boolean }>): Span[];
export function cardTexts(cards: Cards): string[];
export function mapCardTexts(cards: Cards, fn: (t: string) => string): Cards;
export function removeRef<S extends { refs: Ref[]; cards: Cards }>(scene: S, id: string): S;
export function attachLibraryMentions<S extends { refs: Ref[]; cards: Cards }>(scene: S): S;
```

- [ ] **Step 4: Run** `node --test tests/mentions.test.mjs && npm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/director/mentions.mjs cli/director/mentions.d.mts tests/mentions.test.mjs
git diff --cached --stat
git commit -m "scenes: mentions — pasted forms, bound images, empty slots, linked or missing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: scenes.mjs: storage, checks, versions, and pasting a whole Dan prompt

**Files:**
- Create: `cli/director/scenes.mjs`, `tests/scenes.test.mjs`

`emptyCards` and `parseDanPrompt` go in `cli/director/mentions.mjs`, because the page needs them and that file is the browser-safe one. `scenes.mjs` re-exports them, so this task's test imports still work. Add both to `mentions.d.mts` (`emptyCards(): Cards`, `parseDanPrompt(text: string): Cards | null`).

Stages are stored as `{ title, seconds, camera, action, end }`. `fromS` and `toS` are derived (`stageTimes`), so stages are contiguous by construction, and a scene's `durationS` is the sum of its stage seconds when it has stages.

- [ ] **Step 1: Failing tests**

`tests/scenes.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "kie-scenes-"));
process.env.KIE_RUNS_DIR = join(tmp, "runs");
mkdirSync(process.env.KIE_RUNS_DIR);
const { readScenes, saveScene, deleteScene, orderScenes, addVersion, chooseVersion, stageTimes, parseDanPrompt, emptyScene } = await import("../cli/director/scenes.mjs");

const base = () => ({ ...emptyScene(), title: "Freefall", durationS: 8 });

describe("scenes.json", () => {
  test("a film with no scenes reads as empty", () => {
    assert.deepEqual(readScenes("none-yet"), { version: 1, idea: null, scenes: [] });
  });
  test("save gives a new scene the next id and keeps versions out of the caller's hands", () => {
    const s = saveScene("f1", { ...base(), versions: [{ job: "fake" }] });
    assert.equal(s.id, "s1");
    assert.deepEqual(s.versions, []);
    assert.equal(saveScene("f1", base()).id, "s2");
    assert.deepEqual(readScenes("f1").scenes.map((x) => x.id), ["s1", "s2"]);
  });
  test("saving an existing id replaces it and keeps its versions and chosen", () => {
    saveScene("f2", base());
    addVersion("f2", "s1", { job: "j-1", kind: "draft", resolution: "480p", prompt: "p", createdAt: "t" });
    chooseVersion("f2", "s1", "j-1");
    const s = saveScene("f2", { ...base(), id: "s1", title: "New title" });
    assert.equal(s.title, "New title");
    assert.equal(s.versions.length, 1);
    assert.equal(s.chosen, "j-1");
  });
  test("stages set the length; times are derived", () => {
    const s = saveScene("f3", { ...base(), durationS: 99, cards: { ...base().cards, stages: [{ title: "Exit", seconds: 4, camera: "", action: "", end: "" }, { title: "Fall", seconds: 6, camera: "", action: "", end: "" }] } });
    assert.equal(s.durationS, 10);
    assert.deepEqual(stageTimes(s), [{ fromS: 0, toS: 4 }, { fromS: 4, toS: 10 }]);
  });
  test("bad scenes are refused with the field named", () => {
    assert.throws(() => saveScene("f4", { ...base(), durationS: 2 }), /4 to 30 seconds/);
    assert.throws(() => saveScene("f4", { ...base(), ratio: "5:4" }), /ratio/);
    assert.throws(() => saveScene("f4", { ...base(), refs: Array.from({ length: 10 }, (_, i) => ({ id: `r${i + 1}`, source: null })) }), /at most 9/);
    assert.throws(() => saveScene("f4", { ...base(), refs: [{ id: "r1", source: "https://x" }] }), /library:<name> or file:refs/);
    assert.throws(() => saveScene("f4", { ...base(), cards: { ...base().cards, stages: [{ title: "", seconds: 0, camera: "", action: "", end: "" }] } }), /at least 1 second/);
  });
  test("delete and order", () => {
    saveScene("f5", base()); saveScene("f5", base()); saveScene("f5", base());
    orderScenes("f5", ["s3", "s1", "s2"]);
    assert.deepEqual(readScenes("f5").scenes.map((x) => x.id), ["s3", "s1", "s2"]);
    deleteScene("f5", "s1");
    assert.deepEqual(readScenes("f5").scenes.map((x) => x.id), ["s3", "s2"]);
    assert.throws(() => orderScenes("f5", ["s2"]), /every scene once/);
  });
  test("chosen must be one of the scene's versions", () => {
    saveScene("f6", base());
    assert.throws(() => chooseVersion("f6", "s1", "j-nope"), /not a version/);
  });
});

describe("parseDanPrompt", () => {
  test("a whole sectioned prompt splits into cards and stages", () => {
    const cards = parseDanPrompt(`[GOAL]
He jumps.

[REFERENCES]
@image1 — him.

[SCENE]
Over the Alps.

[STAGE 1 | 0–4 SECONDS | EXIT]
Camera: behind him
Action: he drops
End: Hard cut.

[STAGE 2 | 4-10 SECONDS | FREEFALL]
Camera: facing him
Action: arms spread

[VISUAL STYLE]
Film grain.

[AUDIO]
<wind>`);
    assert.equal(cards.goal, "He jumps.");
    assert.equal(cards.scene, "Over the Alps.");
    assert.deepEqual(cards.stages.map((s) => [s.title, s.seconds, s.camera, s.action, s.end]), [
      ["Exit", 4, "behind him", "he drops", "Hard cut."],
      ["Freefall", 6, "facing him", "arms spread", ""],
    ]);
    assert.equal(cards.style, "Film grain.");
    assert.equal(cards.audio, "<wind>");
  });
  test("plain text is not a sectioned prompt", () => {
    assert.equal(parseDanPrompt("A fox runs through snow."), null);
  });
});
```

- [ ] **Step 2: Run and see it fail**: `node --test tests/scenes.test.mjs`.

- [ ] **Step 3: Implement**

`cli/director/scenes.mjs`:

```js
// A film's scenes: runs/<film>/scenes.json, written under the film lock.
// One scene is one Seedance 2.5 reference-to-video generation.
import { readFilmJson, withFilmLock, writeFilmJson } from "./files.mjs";
import { unknown } from "../lib/errors.mjs";
import { MAX_REFS, emptyCards } from "./mentions.mjs";
export { emptyCards, parseDanPrompt } from "./mentions.mjs";

const FILE = "scenes.json";
export const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
export const DURATION = { min: 4, max: 30 };
const SOURCE = /^(library:[a-z0-9][a-z0-9-]{0,80}|file:refs\/[A-Za-z0-9._-]+\.(png|jpe?g|webp))$/;

export const emptyScene = () => ({ title: "", durationS: 8, ratio: "16:9", refs: [], cards: emptyCards() });

const bad = (field, message) => unknown(message, { field });
const text = (v, field) => {
  if (v == null) return "";
  if (typeof v !== "string") throw bad(field, `${field} must be text.`);
  return v;
};

export function readScenes(film) {
  return readFilmJson(film, FILE) ?? { version: 1, idea: null, scenes: [] };
}

export function stageTimes(scene) {
  let at = 0;
  return scene.cards.stages.map((s) => ({ fromS: at, toS: (at += s.seconds) }));
}

/** Check and tidy what a caller sent. Versions and chosen are never taken from the caller. */
function clean(input) {
  const title = text(input.title, "title").trim();
  const ratio = input.ratio ?? "16:9";
  if (!RATIOS.includes(ratio)) throw bad("ratio", `ratio must be one of ${RATIOS.join(", ")}.`);
  const refs = input.refs ?? [];
  if (!Array.isArray(refs) || refs.length > MAX_REFS) throw bad("refs", `A scene holds at most ${MAX_REFS} images.`);
  const ids = new Set();
  const cleanRefs = refs.map((r) => {
    if (!/^r\d+$/.test(r?.id ?? "") || ids.has(r.id)) throw bad("refs", "Each image needs its own id, r1, r2…");
    ids.add(r.id);
    if (r.source !== null && !SOURCE.test(r.source ?? "")) throw bad("refs", `An image's source is library:<name> or file:refs/<file>, got "${r.source}".`);
    const keep = text(r.keep, "keep").trim();
    return keep ? { id: r.id, source: r.source, keep } : { id: r.id, source: r.source };
  });
  const c = input.cards ?? emptyCards();
  const stages = (c.stages ?? []).map((s, i) => {
    if (!Number.isInteger(s.seconds) || s.seconds < 1) throw bad("stages", `Stage ${i + 1} must last at least 1 second.`);
    return { title: text(s.title, "title").trim(), seconds: s.seconds, camera: text(s.camera, "camera"), action: text(s.action, "action"), end: text(s.end, "end") };
  });
  const cards = { goal: text(c.goal, "goal"), scene: text(c.scene, "scene"), stages, style: text(c.style, "style"), audio: text(c.audio, "audio") };
  const durationS = stages.length ? stages.reduce((n, s) => n + s.seconds, 0) : input.durationS;
  if (!Number.isInteger(durationS) || durationS < DURATION.min || durationS > DURATION.max) {
    throw bad("durationS", `A Seedance scene lasts ${DURATION.min} to ${DURATION.max} seconds, got ${durationS}.`);
  }
  return { title, durationS, ratio, refs: cleanRefs, cards };
}

function update(film, fn) {
  return withFilmLock(film, () => {
    const data = readScenes(film);
    const result = fn(data);
    writeFilmJson(film, FILE, data);
    return result;
  });
}

const find = (data, id) => {
  const s = data.scenes.find((x) => x.id === id);
  if (!s) throw unknown(`No scene "${id}".`, { field: "id" });
  return s;
};

export function saveScene(film, input) {
  const tidy = clean(input);
  return update(film, (data) => {
    if (input.id) {
      const i = data.scenes.findIndex((x) => x.id === input.id);
      if (i < 0) throw unknown(`No scene "${input.id}".`, { field: "id" });
      data.scenes[i] = { id: input.id, ...tidy, versions: data.scenes[i].versions, chosen: data.scenes[i].chosen };
      return data.scenes[i];
    }
    let n = 1;
    while (data.scenes.some((x) => x.id === `s${n}`)) n += 1;
    const scene = { id: `s${n}`, ...tidy, versions: [], chosen: null };
    data.scenes.push(scene);
    return scene;
  });
}

export function deleteScene(film, id) {
  update(film, (data) => {
    find(data, id);
    data.scenes = data.scenes.filter((x) => x.id !== id);
  });
}

export function orderScenes(film, ids) {
  update(film, (data) => {
    const have = data.scenes.map((x) => x.id).sort().join();
    if ([...ids].sort().join() !== have) throw unknown("Send every scene once to reorder.", { field: "ids" });
    data.scenes = ids.map((id) => find(data, id));
  });
}

export function addVersion(film, id, version) {
  return update(film, (data) => {
    const s = find(data, id);
    s.versions.push(version);
    return s;
  });
}

export function chooseVersion(film, id, job) {
  return update(film, (data) => {
    const s = find(data, id);
    if (!s.versions.some((v) => v.job === job)) throw unknown(`"${job}" is not a version of ${id}.`, { field: "job" });
    s.chosen = job;
    return s;
  });
}

// ↓ This block (SECTION, parseDanPrompt, titleCase) and emptyCards go in mentions.mjs:
// export const emptyCards = () => ({ goal: "", scene: "", stages: [], style: "", audio: "" });
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
```

`[REFERENCES]` and `[MAINTAIN CONSISTENCY]` are dropped on purpose, because `compileScene` writes both. Check `withFilmLock` is re-entrant (the map says it is), because `writeFilmJson` takes the lock too.

- [ ] **Step 4: Run** `node --test tests/scenes.test.mjs && npm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/director/scenes.mjs cli/director/mentions.mjs cli/director/mentions.d.mts tests/scenes.test.mjs
git diff --cached --stat
git commit -m "scenes: scenes.json storage, checks, versions, and pasting a whole Dan prompt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: compileScene

**Files:**
- Create: `cli/director/scene.mjs`, `tests/scene-compile.test.mjs`

- [ ] **Step 1: Failing tests**

`tests/scene-compile.test.mjs`. It builds a temp library the way `tests/refs.test.mjs` does (read its top for `png()` and the library setup):

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { png } from "./fixtures/images.mjs";
import { openLibrary } from "../cli/core/assets.mjs";
import { compileScene } from "../cli/director/scene.mjs";

const dir = mkdtempSync(join(tmpdir(), "kie-compile-"));
const img = (name, w = 600, h = 400) => { const p = join(dir, name); writeFileSync(p, png(w, h)); return p; };
const library = openLibrary(join(dir, "library"));
library.save({ name: "alexandros", kind: "character", description: "A man with a beard.", keep: "exact face and glasses", images: [img("a.png"), { path: img("sheet.png", 900, 300), role: "sheet" }] });
library.save({ name: "jumpsuit", kind: "product", description: "A neon green jumpsuit.", images: [{ path: img("j.png"), role: "sheet" }] });
library.save({ name: "maya", kind: "character", description: "Maya.", images: [img("m.png")] });

const scene = (over = {}) => ({
  id: "s1", title: "Freefall", durationS: 8, ratio: "9:16",
  refs: [{ id: "r1", source: "library:alexandros" }, { id: "r2", source: "file:refs/door.png", keep: "the door frame" }],
  cards: {
    goal: "@{r1} leaves the plane.",
    scene: "Over the Alps.",
    stages: [
      { title: "Exit", seconds: 4, camera: "Behind him, framed like @{r2}", action: "He drops.", end: "Hard cut." },
      { title: "Freefall", seconds: 4, camera: "Facing him.", action: "@library:jumpsuit flaps.", end: "" },
    ],
    style: "Film grain.", audio: "<wind>",
  },
  ...over,
});

describe("compileScene", () => {
  test("Dan's sections, in order, with every mention as the model's token", () => {
    const { prompt, refs, problems } = compileScene(scene(), { film: "sky", library });
    assert.deepEqual(problems, []);
    assert.equal(prompt, [
      "[GOAL]", "[Image 1] leaves the plane.", "",
      "[REFERENCES]",
      "[Image 1] — alexandros, character. Preserve exact face and glasses.",
      "[Image 2] — door.png. Preserve the door frame.",
      "[Image 3] — jumpsuit, prop. Preserve A neon green jumpsuit.",
      "Do not reproduce reference-sheet panels, grey studio backgrounds or labels.", "",
      "[SCENE]", "Over the Alps.", "",
      "[STAGE 1 | 0–4 SECONDS | EXIT]", "Camera: Behind him, framed like [Image 2]", "Action: He drops.", "End: Hard cut.", "",
      "[STAGE 2 | 4–8 SECONDS | FREEFALL]", "Camera: Facing him.", "Action: [Image 3] flaps.", "",
      "[VISUAL STYLE]", "Film grain.", "",
      "[AUDIO]", "<wind>", "",
      "[MAINTAIN CONSISTENCY]", "Keep every person, product and place exactly as in their reference images in every stage.",
    ].join("\n"));
    assert.deepEqual(refs, [
      { source: "alexandros#2", role: "identity" },
      { source: join("sky", "refs/door.png"), role: "identity" },
      { source: "jumpsuit#1", role: "identity" },
    ]);
  });

  test("reordering refs renumbers the prompt", () => {
    const s = scene();
    const { prompt } = compileScene({ ...s, refs: [s.refs[1], s.refs[0]] }, { film: "sky", library });
    assert.match(prompt, /^\[GOAL\]\n\[Image 2\] leaves the plane\./);
  });

  test("the token comes from the model's profile", () => {
    const { prompt } = compileScene(scene(), { film: "sky", library, refToken: "@Image {n}" });
    assert.match(prompt, /@Image 1 leaves the plane/);
  });

  test("empty sections are left out", () => {
    const s = scene();
    const { prompt } = compileScene({ ...s, cards: { ...s.cards, style: "", audio: " " } }, { film: "sky", library });
    assert.doesNotMatch(prompt, /VISUAL STYLE|\[AUDIO\]/);
  });

  test("refusals name the item and what to do, and send no refs", () => {
    const s = scene({ refs: [{ id: "r1", source: null }, { id: "r2", source: "library:maya" }, { id: "r3", source: "library:ghost" }] });
    const { refs, problems } = compileScene({ ...s, cards: { ...s.cards, goal: "@image7 and @{r1}" } }, { film: "sky", library });
    assert.deepEqual(refs, []);
    assert.deepEqual(problems, [
      "image 1 is empty. Choose a picture or remove it.",
      "@library:maya has no sheet yet. Make one in the Library.",
      "@library:ghost is not in the Library. Make it in the Library first.",
      "@image7: there is no image 7 in this scene.",
    ]);
  });
});
```

- [ ] **Step 2: Run and see it fail**: `node --test tests/scene-compile.test.mjs`.

- [ ] **Step 3: Implement**

`cli/director/scene.mjs`:

```js
// One scene → the prompt Seedance 2.5 gets, in Dan Kieft's sections, plus its
// reference images in order. Image N in the prompt is refs[N-1].
import { join } from "node:path";
import { sheetOf } from "../core/assets.mjs";
import { IMAGE, LIBRARY, STORED, attachLibraryMentions, refLabel, MAX_REFS } from "./mentions.mjs";
import { stageTimes } from "./scenes.mjs";

export const DEFAULT_REF_TOKEN = "[Image {n}]";
const KIND_WORD = { character: "character", product: "prop", location: "location", style: "style" };

export function compileScene(input, { film, library, refToken = DEFAULT_REF_TOKEN }) {
  const scene = attachLibraryMentions(input);
  const problems = [];
  const token = (i) => refToken.replace("{n}", String(i + 1));
  const item = (name) => {
    try {
      return library.get(name);
    } catch {
      return null;
    }
  };

  const resolved = scene.refs.map((r, i) => {
    if (!r.source) return problems.push(`image ${i + 1} is empty. Choose a picture or remove it.`) && null;
    if (r.source.startsWith("library:")) {
      const name = refLabel(r);
      const a = item(name);
      if (!a) return problems.push(`@library:${name} is not in the Library. Make it in the Library first.`) && null;
      const sheet = sheetOf(a);
      if (!sheet) return problems.push(`@library:${name} has no sheet yet. Make one in the Library.`) && null;
      return {
        send: { source: `${name}#${sheet.n}`, role: "identity" },
        line: `${token(i)} — ${name}, ${KIND_WORD[a.kind] ?? a.kind}. Preserve ${r.keep ?? a.keep ?? a.description}${/[.!?]$/.test(r.keep ?? a.keep ?? a.description) ? "" : "."}`,
      };
    }
    const rel = r.source.slice("file:".length);
    return { send: { source: join(film, rel), role: "identity" }, line: `${token(i)} — ${refLabel(r)}.${r.keep ? ` Preserve ${r.keep}.` : ""}` };
  });
  if (scene.refs.length > MAX_REFS) problems.push(`A scene holds at most ${MAX_REFS} images.`);

  const render = (t) =>
    t
      .replace(STORED, (m, id) => {
        const i = scene.refs.findIndex((r) => r.id === id);
        return i < 0 ? m : token(i);
      })
      .replace(LIBRARY, (m, name) => {
        const i = scene.refs.findIndex((r) => r.source === `library:${name}`);
        return i < 0 ? m : token(i);
      })
      .replace(IMAGE, (m, n) => {
        problems.push(`${m}: there is no image ${n} in this scene.`);
        return m;
      })
      .trim();

  const c = scene.cards;
  const out = [];
  const section = (head, body) => {
    if (body) out.push(`[${head}]`, body, "");
  };
  section("GOAL", render(c.goal));
  if (resolved.length) {
    out.push("[REFERENCES]", ...resolved.filter(Boolean).map((r) => r.line), "Do not reproduce reference-sheet panels, grey studio backgrounds or labels.", "");
  }
  section("SCENE", render(c.scene));
  const times = stageTimes(scene);
  c.stages.forEach((s, i) => {
    const lines = [["Camera", s.camera], ["Action", s.action], ["End", s.end]].map(([k, v]) => [k, render(v)]).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    out.push(`[STAGE ${i + 1} | ${times[i].fromS}–${times[i].toS} SECONDS | ${(s.title || `Stage ${i + 1}`).toUpperCase()}]`, ...lines, "");
  });
  section("VISUAL STYLE", render(c.style));
  section("AUDIO", render(c.audio));
  out.push("[MAINTAIN CONSISTENCY]", "Keep every person, product and place exactly as in their reference images in every stage.");

  const unique = [...new Set(problems)];
  return { prompt: out.join("\n"), refs: unique.length ? [] : resolved.map((r) => r.send), problems: unique };
}
```

Two things to check against the test:
- The `[Image 3] — jumpsuit, prop. Preserve A neon green jumpsuit.` line uses the description as `keep` when the item has none. The full-stop logic must not double the period.
- `render` must run before the problems are de-duplicated. Problem order follows the refs first, then the text, as the test expects.

- [ ] **Step 4: Run** `node --test tests/scene-compile.test.mjs && npm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/director/scene.mjs tests/scene-compile.test.mjs
git diff --cached --stat
git commit -m "scenes: compileScene writes Dan's sections with [Image N] tokens and ordered refs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Server: scene endpoints, ref upload, prompt preview, draft, final, choose

**Files:**
- Modify: `web/server/api/generate.mjs` (extract `createSubmitter`), `web/server/app.mjs`
- Create: `web/server/api/scenes.mjs`, `web/tests/scenes.test.mjs`

**Endpoints** (behind the session key, like every `/api` route; `:slug` is a film slug or `create`):

| Method and path | Body | Returns |
|---|---|---|
| `GET /api/films/:slug/scenes` | | `{ idea, scenes: [SceneView] }` |
| `POST /api/films/:slug/scenes` | a scene without id | `SceneView` (201 or 200 as the router does) |
| `PUT /api/films/:slug/scenes/order` | `{ ids }` | `{ ok: true }` (register before `:id`) |
| `PUT /api/films/:slug/scenes/:id` | a scene | `SceneView` |
| `DELETE /api/films/:slug/scenes/:id` | | `{ ok: true }` |
| `GET /api/films/:slug/scenes/:id/prompt` | | `{ prompt, refs, problems, prices: { draft, final720, final1080 } }`. Each price is `{ usd, basis }` or null, from core `estimate()` |
| `POST /api/films/:slug/refs` | raw image body, `?name=` (like `/api/library/incoming`) | `{ source: "file:refs/<safe-name>" }` |
| `POST /api/films/:slug/scenes/:id/draft` | `{}` | the generate response plus `{ scene: SceneView }` |
| `POST /api/films/:slug/scenes/:id/final` | `{ resolution: "720p" \| "1080p" }` | the same |
| `POST /api/films/:slug/scenes/:id/choose` | `{ job }` | `SceneView` |

**SceneView** is the stored scene with each version enriched from its job record: `{ ...version, state, media: string \| null, estimateUsd, actualUsd }`, through `jobView` from `web/server/state.mjs`.

- [ ] **Step 1: Failing tests**

`web/tests/scenes.test.mjs`. Follow `web/tests/generate.test.mjs` and `library.test.mjs` for the setup (`helpers.mjs`, `generateStubs()`, `createApp`, a temp library with a sheet item):

```js
import { RUNS, LIBRARY, KEY, generateStubs, req, tmp } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { png } from "../../tests/fixtures/images.mjs";

const { createApp } = await import("../server/app.mjs");
const { openLibrary } = await import("../../cli/core/assets.mjs");
let app, port, calls;

before(async () => {
  const lib = openLibrary(LIBRARY);
  const p = join(tmp, "sheet.png");
  writeFileSync(p, png(900, 300));
  lib.save({ name: "alexandros", kind: "character", description: "A man.", keep: "exact face", images: [{ path: p, role: "sheet" }] }, { roots: [tmp] });
  const stubs = generateStubs({ estimateUsd: 0.56 });
  calls = stubs.calls;
  app = createApp({ key: KEY, deps: stubs.deps, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.close());

const scene = { title: "Freefall", durationS: 4, ratio: "9:16", refs: [{ id: "r1", source: "library:alexandros" }], cards: { goal: "@{r1} jumps.", scene: "", stages: [], style: "", audio: "" } };

describe("scenes api", () => {
  test("create, read, edit, order, delete", async () => {
    const a = await req(port, "/api/films/create/scenes", { method: "POST", body: scene });
    assert.equal(a.status, 200, a.text);
    assert.equal(a.json.id, "s1");
    await req(port, "/api/films/create/scenes", { method: "POST", body: scene });
    const e = await req(port, "/api/films/create/scenes/s1", { method: "PUT", body: { ...scene, title: "Exit" } });
    assert.equal(e.json.title, "Exit");
    await req(port, "/api/films/create/scenes/order", { method: "PUT", body: { ids: ["s2", "s1"] } });
    assert.deepEqual((await req(port, "/api/films/create/scenes")).json.scenes.map((s) => s.id), ["s2", "s1"]);
    await req(port, "/api/films/create/scenes/s2", { method: "DELETE" });
    assert.deepEqual((await req(port, "/api/films/create/scenes")).json.scenes.map((s) => s.id), ["s1"]);
  });

  test("a bad scene is refused with its field", async () => {
    const r = await req(port, "/api/films/create/scenes", { method: "POST", body: { ...scene, ratio: "5:4" } });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.field, "ratio");
  });

  test("the prompt preview compiles with [Image N] and prices the draft and finals", async () => {
    const r = await req(port, "/api/films/create/scenes/s1/prompt");
    assert.equal(r.status, 200, r.text);
    assert.match(r.json.prompt, /^\[GOAL\]\n\[Image 1\] jumps\./);
    assert.deepEqual(r.json.problems, []);
    assert.equal(r.json.prices.draft.usd, 0.56);
    assert.ok(r.json.prices.final1080.usd > r.json.prices.final720.usd);
  });

  test("a draft sends draft=true at 480p with the sheet as reference, and records a version", async () => {
    const r = await req(port, "/api/films/create/scenes/s1/draft", { method: "POST", body: {} });
    assert.equal(r.status, 200, r.text);
    const sent = calls.create.at(-1).input;
    assert.equal(sent.draft, true);
    assert.equal(sent.resolution, "480p");
    assert.equal(sent.aspect_ratio, "9:16");
    assert.equal(sent.reference_image_urls.length, 1);
    assert.match(sent.prompt, /\[Image 1\] jumps\./);
    assert.deepEqual(r.json.scene.versions.map((v) => [v.kind, v.resolution]), [["draft", "480p"]]);
    await app.follower.idle();
    const v = (await req(port, "/api/films/create/scenes")).json.scenes[0].versions[0];
    assert.equal(v.state, "succeeded");
    assert.match(v.media, /^\/media\/runs\/create\/s1-draft/);
  });

  test("a final re-runs at the chosen resolution without draft", async () => {
    const r = await req(port, "/api/films/create/scenes/s1/final", { method: "POST", body: { resolution: "1080p" } });
    assert.equal(r.status, 200, r.text);
    const sent = calls.create.at(-1).input;
    assert.equal(sent.resolution, "1080p");
    assert.notEqual(sent.draft, true);
    assert.equal(r.json.scene.versions.at(-1).kind, "final");
  });

  test("choose marks a version", async () => {
    const s = (await req(port, "/api/films/create/scenes")).json.scenes[0];
    const r = await req(port, "/api/films/create/scenes/s1/choose", { method: "POST", body: { job: s.versions[0].job } });
    assert.equal(r.json.chosen, s.versions[0].job);
  });

  test("a scene with an empty slot is refused before anything is reserved", async () => {
    const before = calls.create.length;
    await req(port, "/api/films/create/scenes/s1", { method: "PUT", body: { ...scene, refs: [...scene.refs, { id: "r2", source: null }] } });
    const r = await req(port, "/api/films/create/scenes/s1/draft", { method: "POST", body: {} });
    assert.equal(r.status, 400);
    assert.deepEqual(r.json.error.problems, ["image 2 is empty. Choose a picture or remove it."]);
    assert.equal(calls.create.length, before);
  });

  test("an uploaded ref lands in the film's refs folder", async () => {
    const r = await req(port, "/api/films/create/refs?name=Door%20View.png", { method: "POST", body: png(400, 400), headers: { "content-type": "image/png" } });
    assert.equal(r.status, 200, r.text);
    assert.match(r.json.source, /^file:refs\/door-view(-\d+)?\.png$/);
    assert.ok(existsSync(join(RUNS, "create", r.json.source.slice(5))));
  });
});
```

Check how `req` sends a raw Buffer body: read `web/tests/library.test.mjs` `drop()` and copy it.

- [ ] **Step 2: Run and see it fail**: `node --test web/tests/scenes.test.mjs`. Expected: 404s.

- [ ] **Step 3: Extract the submitter**

In `web/server/api/generate.mjs`, move `submit()` and the `upload` it closes over into an exported factory, and make `registerGenerate` use it. Behaviour stays the same.

```js
export function createSubmitter({ catalog, deps = {}, follower }) {
  const view = (j) => jobView(j, follower.has);
  const upload = deps.upload ?? ((path, opts) => uploadFile(catalog, path, opts));
  return async function submit(capability, model, a, values, opts) {
    /* body of today's submit, unchanged */
  };
}
```

Run `npm --prefix web run test:server` here. Expected: still PASS.

- [ ] **Step 4: Implement `web/server/api/scenes.mjs`**

```js
// Scenes: one Seedance 2.5 reference-to-video generation each. Drafts at 480p
// with draft=true; finals re-run the same prompt and refs at 720p or 1080p.
import { readScenes, saveScene, deleteScene, orderScenes, addVersion, chooseVersion } from "../../../cli/director/scenes.mjs";
import { compileScene, DEFAULT_REF_TOKEN } from "../../../cli/director/scene.mjs";
import { resolveModel } from "../../../cli/lib/models.mjs";
import { runDir } from "../../../cli/lib/run.mjs";
import { estimate } from "../../../cli/core/views.mjs";
import { unknown } from "../../../cli/lib/errors.mjs";
import { context, jobView } from "../state.mjs";
import { createSubmitter } from "./generate.mjs";
import * as f from "./fields.mjs";

const MODEL = "seedance-2-5";
```

Inside `registerScenes(router, { catalog, deps, follower })`:

- **Slugs:** `slug = f.run({ run: params.slug })`, or the same check `runDir` makes. `create` is allowed.
- **Views:** `sceneView(slug, s)` maps each version to `{ ...v, ...pick(jobView(store.get(v.job), follower.has)) }`: `state`, `media: media[0] ?? null`, `estimateUsd`, `actualUsd`. Read how `store.get` is named in `cli/core/jobs.mjs`.
- **Compiling:** `compile(slug, scene)` calls `compileScene(scene, { film: slug, library, refToken: model.promptProfile?.refToken ?? DEFAULT_REF_TOKEN })`.
- **Prompt preview:** compile, then three `estimate(catalog, { model: MODEL, durationS, resolution, aspectRatio: scene.ratio, refs: [], params }, { store, limits })` calls:
  - 480p with `{ draft: true, generate_audio: true }`;
  - 720p with `{ generate_audio: true }`;
  - 1080p with `{ generate_audio: true }`.
  
  Read `estimate`'s real argument shape in `cli/core/views.mjs:152` and adapt. Map each result to `{ usd: r.estimateUsd ?? null, basis: r.basis ?? null }`.
- **Making** (draft or final):
  1. Read the scene and compile it.
  2. If there are problems, throw `unknown("Refused before submitting, nothing was spent. " + problems.join(" "), { field: "scene", problems })`.
  3. Call `submit("video", resolveModel(catalog, MODEL, "video"), { run: slug, prompt, refs, params, budget_usd: null, provider: null }, { prompt, duration: scene.durationS, aspect_ratio: scene.ratio, resolution }, { promptFile: \`${id}-prompt.txt\`, inputsFile: \`${id}-inputs.json\`, artifactBase: \`${id}-${kind}\`, useI2v: () => false, extra: { scene: id, kind } })`.
  4. Then `addVersion(slug, id, { job: r.localJobId, kind, resolution, prompt, createdAt: new Date().toISOString() })`.
  5. Return `{ ...r, scene: sceneView(...) }`.
- **Draft:** `resolution: "480p"`, `params: { draft: true, generate_audio: true }`.
- **Final:** the body's `resolution` must be `720p` or `1080p` (`f.invalid("resolution", …)` otherwise), with `params: { generate_audio: true }`.
- **Ref upload:** copy the raw-upload route from `web/server/api/library.mjs` (`{ raw: true }`, `saveBody(req, path, limit)`, `MAX_BYTES`, image check with `checkLocalFile`).
  - Make the name safe: lowercase, with spaces and odd characters turned into `-`. Never overwrite: add `-2`, `-3` and so on.
  - Save to `join(runDir(slug), "refs", name)`.
  - Return `{ source: \`file:refs/${name}\` }`.

Register `registerScenes` in `web/server/app.mjs` next to `registerGenerate`, passing the same `catalog`, `deps` and `follower`.

- [ ] **Step 5: Run** `npm --prefix web run test:server && npm test`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/server/api/generate.mjs web/server/api/scenes.mjs web/server/app.mjs web/tests/scenes.test.mjs
git diff --cached --stat
git commit -m "scenes api: edit scenes, upload refs, preview the prompt, draft, final and choose

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Page types, `useScenes`, and the shared mentions import

**Files:**
- Modify: `web/src/api/types.ts`
- Create: `web/src/scene/useScenes.ts`, `web/src/scene/useScenes.test.ts`

- [ ] **Step 1: Types.** In `web/src/api/types.ts`:

```ts
import type { Ref, Cards } from "../../../cli/director/mentions.mjs";
export type { Ref, Cards, Stage, Span } from "../../../cli/director/mentions.mjs";
export interface SceneVersion { job: string; kind: "draft" | "final"; resolution: string; prompt: string; createdAt: string; state: string | null; media: string | null; estimateUsd: number | null; actualUsd: number | null }
export interface Scene { id: string; title: string; durationS: number; ratio: string; refs: Ref[]; cards: Cards; versions: SceneVersion[]; chosen: string | null }
export interface ScenePreview { prompt: string; refs: { source: string; role: string }[]; problems: string[]; prices: Record<"draft" | "final720" | "final1080", { usd: number | null; basis: string | null } | null> }
```

Run `npx tsc -p web --noEmit` from the repo root. If TypeScript cannot resolve the `.mjs` import to `mentions.d.mts`, add `"allowJs": false` and check `moduleResolution: "Bundler"` picks up the `.d.mts`. As a last resort, copy the types into `types.ts` with a comment naming the source.

- [ ] **Step 2: Failing tests for `useScenes`**

`useScenes(run)` gives `{ scenes, loading, error, create(), save(scene), remove(id), preview(id), draft(id), final(id, resolution), choose(id, job), uploadRef(file) }`.
- `save` updates local state at once and PUTs after 400 ms of quiet, one request per scene.
- Job events for a version's job reload the scenes.

```ts
import { describe, test, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useScenes } from "./useScenes";
import { routes } from "../test-fixtures";
import { emitForTests } from "../app/useStudio";

const s1 = { id: "s1", title: "A", durationS: 4, ratio: "16:9", refs: [], cards: { goal: "", scene: "", stages: [], style: "", audio: "" }, versions: [], chosen: null };

describe("useScenes", () => {
  beforeEach(() => vi.useRealTimers());

  test("loads scenes for the run", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/create/scenes": () => ({ idea: null, scenes: [s1] }) })));
    const { result } = renderHook(() => useScenes("create"));
    await waitFor(() => expect(result.current.scenes.map((s) => s.id)).toEqual(["s1"]));
  });

  test("save is local at once and sends one PUT after a pause", async () => {
    const fetchMock = vi.fn(routes({ "/api/films/create/scenes": () => ({ idea: null, scenes: [s1] }), "/api/films/create/scenes/s1": () => s1 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useScenes("create"));
    await waitFor(() => expect(result.current.scenes.length).toBe(1));
    vi.useFakeTimers();
    act(() => result.current.save({ ...s1, title: "B" }));
    act(() => result.current.save({ ...s1, title: "BC" }));
    expect(result.current.scenes[0].title).toBe("BC");
    await act(async () => { vi.advanceTimersByTime(450); });
    const puts = fetchMock.mock.calls.filter((c) => c[1]?.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(JSON.parse(puts[0][1].body).title).toBe("BC");
  });

  test("a job event for one of its versions reloads", async () => {
    const withV = { ...s1, versions: [{ job: "j-1", kind: "draft", resolution: "480p", prompt: "", createdAt: "", state: "submitted", media: null, estimateUsd: 0.56, actualUsd: null }] };
    const fetchMock = vi.fn(routes({ "/api/films/create/scenes": () => ({ idea: null, scenes: [withV] }) }));
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useScenes("create"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => emitForTests({ event: "job", data: { id: "j-1", state: "succeeded" } as never }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
```

Check that `emitForTests` exists and where it lives (`web/src/app/useStudio.ts` or `web/src/api/events.ts`), and fix the import.

- [ ] **Step 3: Implement** `web/src/scene/useScenes.ts` with `api()` from `../api/client` and `onStudioEvent`. Keep one pending timer per scene id in a `useRef(Map)`. Flush pending saves before `draft`, `final` and `preview`, so they compile what is on screen.

- [ ] **Step 4: Run** `npm --prefix web run test:page -- src/scene` and `npx tsc -p web --noEmit`. Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/types.ts web/src/scene/useScenes.ts web/src/scene/useScenes.test.ts
git diff --cached --stat
git commit -m "scene page: types from the shared mentions module and useScenes with debounced saves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: MentionField, the prompt text box that knows its mentions

**Files:**
- Create: `web/src/scene/MentionField.tsx`, `web/src/scene/MentionField.test.tsx`, `web/src/scene/scene.css`

**How it works:**
- A `<textarea>` with transparent text sits over a `<div aria-hidden>` mirror that draws the same text. The mirror has the same font, padding, wrapping and scroll position. In the mirror, mentions are wrapped in `<mark class="mention" data-state="linked|missing">`. The textarea's caret and selection stay visible (`caret-color: var(--text)`), and its `::selection` uses `--selection`.
- **Props:** `{ label, value /* stored */, refs, items /* Map name → {hasSheet} */, onChange(stored, refs), onChoose(span), rows? }`.
- **Display:** `toDisplay(value, refs)`.
  - On input: `toStored(display, refs)`, then `onChange`.
  - On paste: let the paste land, then on the next input event run `toStored(display, refs, { settle: true })`. The same happens on blur.
  - If the pasted text is a whole Dan prompt (`parseDanPrompt` from `mentions.mjs` is not null), call the optional `onPasteWhole(cards)` instead and cancel the paste. `SceneCards` uses this to fill every card.
- **Status line** under the field (`role="status"`, Mono 13px):
  - When the caret is inside a mention, it shows that span's `label`.
  - For each missing span (deduplicated), it shows a small text button whose `aria-label` is the span's `label`:
    - an image: "Choose @image3";
    - a library item that is not in the Library: "Make @library:name";
    - a library item with no sheet: "Make its sheet".
  - Pressing one calls `onChoose(span)`.
- **Clicking** inside a missing mention in the textarea also calls `onChoose(span)`: on `click`, find the span containing `selectionStart`.
- **The `@` menu:** when the word before the caret starts with `@`, a `role="listbox"` labelled "Mention" opens under the field.
  - It lists the attached images first (`@image1 · alexandros`, …), then `@library:` items filtered by the typed text.
  - Arrow keys move, Enter or Tab insert the mention plus a space, and Escape closes.
  - The textarea has `aria-expanded`, `aria-controls` and `aria-activedescendant` while it is open.
- **Styles** (`scene.css`, tokens only):

```css
.mention-field { position: relative; }
.mention-field__mirror, .mention-field__input { font: 400 var(--text-lg)/1.6 var(--font-sans); padding: 10px 12px; white-space: pre-wrap; overflow-wrap: break-word; }
.mention-field__mirror { position: absolute; inset: 0; color: var(--text); pointer-events: none; overflow: hidden; border: 1px solid transparent; }
.mention-field__input { position: relative; width: 100%; color: transparent; caret-color: var(--text); background: transparent; border: 1px solid var(--line); border-radius: var(--radius-sm); resize: vertical; }
.mention { background: none; font-family: var(--font-mono); font-size: var(--text-md); }
.mention[data-state="linked"] { color: var(--accent); }
.mention[data-state="missing"] { color: var(--bad); text-decoration: underline wavy var(--bad); text-underline-offset: 3px; }
.mention-field__status { min-height: 18px; margin-top: 4px; display: flex; gap: var(--space-2); flex-wrap: wrap; color: var(--text-3); font: 400 var(--text-sm) var(--font-mono); }
.mention-field__fix { background: none; border: 0; padding: 0; color: var(--bad-ink); text-decoration: underline; cursor: pointer; font: inherit; }
```

The `.mention` font must keep the same advance widths as the textarea, or the caret drifts. Mono in the mirror changes widths. So in the mirror use the same font as the textarea, `font-family: inherit`, and mark mentions by colour and underline only. Keep Mono for the status line and the menu. Change `.mention`'s rule to `font: inherit`.

- [ ] **Step 1: Failing tests** (`MentionField.test.tsx`):

```tsx
import { describe, test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MentionField } from "./MentionField";
import type { Ref } from "../api/types";

const items = new Map([["alexandros", { hasSheet: true }], ["maya", { hasSheet: false }]]);

function Harness({ initial, refs0, onChoose = () => {}, onPasteWhole }: { initial: string; refs0: Ref[]; onChoose?: (s: unknown) => void; onPasteWhole?: (c: unknown) => void }) {
  const [value, setValue] = useState(initial);
  const [refs, setRefs] = useState(refs0);
  return (
    <>
      <MentionField label="Goal" value={value} refs={refs} items={items} onChange={(v, r) => { setValue(v); setRefs(r); }} onChoose={onChoose} onPasteWhole={onPasteWhole} />
      <output data-testid="stored">{value}</output>
      <output data-testid="refs">{refs.map((r) => `${r.id}:${r.source ?? "empty"}`).join(",")}</output>
    </>
  );
}

const box = () => screen.getByRole("textbox", { name: "Goal" });

describe("MentionField", () => {
  test("shows stored mentions by position and colours them", () => {
    const { container } = render(<Harness initial="@{r1} jumps with @{r2}" refs0={[{ id: "r1", source: "library:alexandros" }, { id: "r2", source: null }]} />);
    expect(box()).toHaveValue("@image1 jumps with @image2");
    const marks = container.querySelectorAll("mark.mention");
    expect([...marks].map((m) => [m.textContent, m.getAttribute("data-state")])).toEqual([["@image1", "linked"], ["@image2", "missing"]]);
  });

  test("pasting a Higgsfield-style prompt makes bound mentions and empty slots", () => {
    render(<Harness initial="" refs0={[]} />);
    fireEvent.paste(box(), { clipboardData: { getData: () => "[@image2] walks past @Image 1", files: [] } });
    fireEvent.change(box(), { target: { value: "[@image2] walks past @Image 1" } });
    expect(screen.getByTestId("refs")).toHaveTextContent("r1:empty,r2:empty");
    expect(screen.getByTestId("stored")).toHaveTextContent("@{r2} walks past @{r1}");
    expect(box()).toHaveValue("@image2 walks past @image1");
  });

  test("each missing mention gets a fix button named for screen readers", () => {
    const onChoose = vi.fn();
    render(<Harness initial="@{r1} and @library:maya and @library:ghost" refs0={[{ id: "r1", source: null }]} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("button", { name: "image 1, no picture yet, choose one" }));
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ kind: "image", refId: "r1" }));
    expect(screen.getByRole("button", { name: "maya, no sheet yet" })).toHaveTextContent("Make its sheet");
    expect(screen.getByRole("button", { name: "ghost, not in the Library" })).toHaveTextContent("Make @library:ghost");
  });

  test("clicking inside a red mention opens the chooser", () => {
    const onChoose = vi.fn();
    render(<Harness initial="go @{r1}" refs0={[{ id: "r1", source: null }]} onChoose={onChoose} />);
    const t = box() as HTMLTextAreaElement;
    t.setSelectionRange(5, 5);
    fireEvent.click(t);
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ n: 1 }));
  });

  test("typing @ opens the mention menu; Enter inserts", () => {
    render(<Harness initial="" refs0={[{ id: "r1", source: "library:alexandros" }]} />);
    const t = box() as HTMLTextAreaElement;
    fireEvent.change(t, { target: { value: "@", selectionStart: 1 } });
    const menu = screen.getByRole("listbox", { name: "Mention" });
    expect(menu).toHaveTextContent("@image1");
    fireEvent.keyDown(t, { key: "Enter" });
    expect(screen.getByTestId("stored")).toHaveTextContent("@{r1}");
  });

  test("pasting a whole sectioned prompt hands it to the scene", () => {
    const onPasteWhole = vi.fn();
    render(<Harness initial="" refs0={[]} onPasteWhole={onPasteWhole} />);
    fireEvent.paste(box(), { clipboardData: { getData: () => "[GOAL]\nHe jumps.\n\n[SCENE]\nAlps.", files: [] } });
    expect(onPasteWhole).toHaveBeenCalledWith(expect.objectContaining({ goal: "He jumps.", scene: "Alps." }));
  });
});
```

`fireEvent.change` with `selectionStart` may not set the caret in jsdom. If the menu test cannot see the caret, set `t.selectionStart`/`selectionEnd` before firing `input`, and read the caret from the element in the handler.

- [ ] **Step 2: Run, see it fail, implement, run.** Use `npm --prefix web run test:page -- src/scene/MentionField.test.tsx`.

- [ ] **Step 3: Commit**

```bash
git add web/src/scene/MentionField.tsx web/src/scene/MentionField.test.tsx web/src/scene/scene.css
git diff --cached --stat
git commit -m "scene page: the mention field — green when linked, red with a fix when missing, @ menu, paste

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: RefChooser and "Make @library:name"

**Files:**
- Create: `web/src/scene/RefChooser.tsx`, `web/src/scene/RefChooser.test.tsx`
- Modify: `web/src/app/route.ts` (and its test), `web/src/library/LibraryScreen.tsx` (and its test)

**RefChooser** is a dialog (`role="dialog"`, labelled "Choose a picture for @image3"). It closes on Escape and returns focus to the field.
- **Props:** `{ n, library: AssetSummary[], onPick(source: string), onUpload(file: File): Promise<string /* source */>, onClose }`.
- **Body:**
  - A search box, "Search the Library".
  - Cards of Library items, the ones with sheets first. Each shows the cover, `@library:name` and kind. Items without a sheet are shown but disabled, with "no sheet yet".
  - Under the cards, "Upload a picture" (a file input) and "or paste one (⌘V)".
  - Picking an item calls `onPick("library:<name>")`. An upload or paste calls `onUpload(file)` and then `onPick(source)`.

**Making a missing Library item:**
- Add the route `#/library/new/<name>`. `route.ts` returns `{ screen: "library", newName }`. Read how `route.ts` returns params today and follow it.
- `LibraryScreen` opens the SheetMaker in new mode with the Name prefilled when `newName` is set.
- "Make its sheet" goes to `#/library` with that item open. Use `#/library/item/<name>`, or reuse the same mechanism.

- [ ] **Step 1: Failing tests**:

```tsx
// RefChooser.test.tsx
test("lists items with sheets first, picks one, and disables those without", async () => {
  const onPick = vi.fn();
  render(<RefChooser n={3} library={[
    { name: "maya", kind: "character", description: "", imageCount: 1, hasSheet: false, updatedAt: "", cover: null, usedIn: [] },
    { name: "alexandros", kind: "character", description: "", imageCount: 2, hasSheet: true, updatedAt: "", cover: "/x.png", usedIn: [] },
  ]} onPick={onPick} onUpload={vi.fn()} onClose={() => {}} />);
  expect(screen.getByRole("dialog", { name: "Choose a picture for @image3" })).toBeInTheDocument();
  const options = screen.getAllByRole("button", { name: /@library:/ });
  expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining("alexandros"), expect.stringContaining("maya")]);
  expect(options[1]).toBeDisabled();
  fireEvent.click(options[0]);
  expect(onPick).toHaveBeenCalledWith("library:alexandros");
});

test("an upload becomes the slot's picture", async () => {
  const onPick = vi.fn();
  const onUpload = vi.fn().mockResolvedValue("file:refs/door.png");
  render(<RefChooser n={1} library={[]} onPick={onPick} onUpload={onUpload} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("Upload a picture"), { target: { files: [new File(["x"], "door.png", { type: "image/png" })] } });
  await waitFor(() => expect(onPick).toHaveBeenCalledWith("file:refs/door.png"));
});
```

Also test in `route.test.ts` that `#/library/new/maya` parses with `newName: "maya"`. Test in `LibraryScreen.test.tsx` that rendering with that hash opens "New sheet" with Name `maya`.

- [ ] **Step 2: Implement, run** `npm --prefix web run test:page`.

- [ ] **Step 3: Commit**

```bash
git add web/src/scene/RefChooser.tsx web/src/scene/RefChooser.test.tsx web/src/app/route.ts web/src/library/LibraryScreen.tsx
# plus the route and Library test files you changed, by explicit path
git diff --cached --stat
git commit -m "scene page: choose a picture for a slot, and make a missing Library item by name

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: The Scene screen: refs column, cards, versions, and Create's tabs

**Files:**
- Create: `web/src/scene/SceneRefs.tsx`, `web/src/scene/SceneCards.tsx`, `web/src/scene/Versions.tsx`, `web/src/scene/SceneScreen.tsx`, `web/src/scene/SceneScreen.test.tsx`
- Modify: `web/src/scene/scene.css`, `web/src/studio/StudioScreen.tsx` (and its test)

**Layout,** following `.superpowers/brainstorm/76381-1793497460/content/scene-a-v2.html`: three columns, `280px 1fr 360px`, each scrolling on its own. The page does not scroll, the same way the Library got `.app__main[data-screen="library"]`. Use the Create screen's existing `data-screen="create"` rule, which already sets `overflow: hidden`.

- **Top of the centre column:**
  - Scene tabs ("1 Freefall", "2 …", then "+"). "+" creates a scene with `emptyScene()` values and the title "Scene N".
  - The title as an input (22px), and the Mono data line: `8s · 9:16 · Seedance 2.5`.
  - A ratio select and, when the scene has no stages, a length select (4–30).
- **SceneRefs, the left column "In this scene":**
  - One row per ref: `image1` (Mono), the thumbnail (the Library cover, or `/media/runs/<run>/refs/<file>`), the name (`@library:x` Mono or the file name), and the keep line. The keep line is an input whose placeholder is the item's keep or description.
  - An empty slot shows "image 3 · empty", with **Choose** (opens RefChooser) and **Remove**.
  - Each row has ↑ and ↓ buttons, named "Move image 2 up" and so on, which reorder the refs. Drag is not needed this phase.
  - **Remove** on a mentioned ref asks with `window.confirm("image 2 is used in the prompt. Remove it? Its mentions become plain words.")`, then calls `removeRef`.
  - Below the rows: "+ Add from Library" (RefChooser for a new slot), "Upload", and the hint "Type @ in any card. Up to 9 images."
- **SceneCards, the centre:**
  - The stage bar: one segment per stage, sized by seconds, labelled `0–4s Exit`. No stages means one segment, "whole scene".
  - Cards: Goal, Scene, one card per stage, Style and Audio.
    - Each stage card has a Title input, a seconds number input (1–30) and Camera, Action and End MentionFields, with "Remove stage".
    - "+ Add stage" sits below the stages.
    - The Audio card's hint: "Music in (), sound effects in <>, dialogue in {}."
  - Every text is a `MentionField`.
  - `onPasteWhole(cards)` replaces all cards after `window.confirm("Replace this scene's cards with the pasted prompt?")` when any card has text.
  - On settle, refs from the fields are merged by taking the field's returned `refs`, which only ever extends. Then `attachLibraryMentions`.
- **Versions, the right column:**
  - A player (`<video controls>`) for the selected version, which defaults to the chosen one, else the newest that succeeded.
  - The list: "Draft 2 · 480p · 4 min ago", with a ★ "chosen" mark, or "Choose" on hover or focus, and the state for running or failed ones.
  - **New draft** (quiet button) with its price in Mono, and **Make final** (the one green `.generate` button) with a 720p/1080p select and its price.
  - Under them: "The final re-runs this prompt at 1080p, so the motion will differ from the draft."
  - When the preview has problems, both buttons are disabled and the problems are listed (`role="alert"`, `--bad-ink`).
  - Prices and problems come from `preview(id)`, which is refetched 500 ms after the scene last changed.
  - Two kinds of errors are shown in place: a 402 (a cap) and a code-5 uncertain create, which says "Check Spend before trying again".
- **StudioScreen:** two tabs at the top, "Scene" (default; renders `<SceneScreen run="create" />`) and "Quick take" (today's screen, unchanged). The choice is remembered in `localStorage["shard.createTab"]`.

- [ ] **Step 1: Failing tests** (`SceneScreen.test.tsx`). Stub the API with `routes()`:

```tsx
test("a pasted prompt with [@image1] shows a red mention, and choosing a Library item turns it green", async () => {
  // routes: GET scenes -> one empty scene s1; PUT s1 -> echo body; GET /api/library -> alexandros with a sheet; GET prompt -> { prompt: "", refs: [], problems: ["image 1 is empty. Choose a picture or remove it."], prices: {...} }
  render(<SceneScreen run="create" />);
  const goal = await screen.findByRole("textbox", { name: "Goal" });
  fireEvent.paste(goal, { clipboardData: { getData: () => "[@image1] jumps", files: [] } });
  fireEvent.change(goal, { target: { value: "[@image1] jumps" } });
  expect(await screen.findByText("image 1 · empty")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "image 1, no picture yet, choose one" }));
  fireEvent.click(await screen.findByRole("button", { name: /@library:alexandros/ }));
  await waitFor(() => expect(document.querySelector('mark.mention[data-state="linked"]')).toHaveTextContent("@image1"));
});

test("problems disable both buttons and say what to fix", async () => { /* preview with problems → New draft and Make final disabled; alert lists the problem */ });

test("New draft posts to /draft and the version appears", async () => { /* click New draft → POST /api/films/create/scenes/s1/draft; returned scene with one version → list shows "Draft 1 · 480p" */ });

test("moving image 2 up renumbers the mentions", async () => { /* refs r1, r2; goal "@{r2}"; click "Move image 2 up" → goal box shows "@image1" */ });

test("removing a mentioned image asks first", async () => { /* confirm stub false → nothing changes; true → mention becomes the plain name */ });
```

Write each of the commented tests in full, in the style of the first. Add to `StudioScreen.test.tsx`: the Scene tab is the default, and the Quick take tab still shows the old prompt bar.

- [ ] **Step 2: Implement, run** `npm --prefix web test && npm --prefix web run build && npx tsc -p web --noEmit`. All pass, and the type check is clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/scene/SceneRefs.tsx web/src/scene/SceneCards.tsx web/src/scene/Versions.tsx web/src/scene/SceneScreen.tsx web/src/scene/SceneScreen.test.tsx web/src/scene/scene.css web/src/studio/StudioScreen.tsx web/src/studio/StudioScreen.test.tsx
git diff --cached --stat
git commit -m "create: the scene editor — references, cards with mentions, drafts and finals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Check it in the browser (no paid calls)

- [ ] Build, and start Shard with `STUDIO_PORT=4390 node web/server/main.mjs --no-open` in the background (never port 4317).
- [ ] Use gstack browse at 1440×900 and 1280×800. Save screenshots to `/private/tmp/shard-shots/`.
- [ ] **Paste test:** on Create → Scene, paste this into Goal:

```
[GOAL]
[@image1] steps out of the plane door seen in [@image2], grinning.

[SCENE]
4,000 m over the Alps @library:sky-over-alps, low morning sun.

[STAGE 1 | 0–4 SECONDS | EXIT]
Camera: behind him
Action: he drops

[AUDIO]
<roaring wind>
```

- [ ] **Check by eye:**
  - The cards fill in.
  - `@image1`, `@image2` and `@library:sky-over-alps` are red with wavy underlines.
  - The left column shows two empty slots.
  - Choosing alexandros for image 1 turns it green, provided alexandros has a sheet by then; otherwise it shows "has no sheet yet".
  - "Make @library:sky-over-alps" opens the sheet maker with the name filled in.
  - The prompt preview's problems list what is still missing, and both buttons are disabled.
- [ ] Do **not** press New draft or Make final. Spending needs Alex's go.
- [ ] Check text sizes (nothing under 12px) and that green appears only on linked mentions, prices and Make final.
- [ ] Afterwards: stop the server and browse, and run `git checkout .gitignore`. Any visual fix gets its own commit with explicit paths.
