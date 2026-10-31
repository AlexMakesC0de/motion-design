# Studio v2, stage 1: shell, Home and Projects. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the studio's six top tabs with a left rail, a chat drawer, a Home page, a Projects page and a per-film workspace with a step bar, mounting today's screens inside it unchanged.

**Architecture:**
- **Server:** a pure `progressOf()` judges a film's step and next action from its board, its outputs and its spend. `films.mjs` serves it on `/api/films` and `/api/films/:slug/progress`.
- **Page:** the hash router becomes a typed `Route` with redirects for old hashes. `App` draws `Rail` + `TopBar` + the screen + `ChatDrawer`. Chat state moves from `StudioScreen` into a small `chatStore`, so any screen can open it or hand it a message.
- **Today's screens:**
  - Studio (takes only) becomes Create.
  - Storyboard and FilmPage are mounted by `FilmWorkspace`.
  - FilmsScreen's list is replaced by Projects.

**Tech Stack:** Node 20 `node:http` server (no deps), `node:test`; React 19 + Vite, Vitest + Testing Library; plain CSS on the tokens in `web/src/theme/tokens.css`.

**Spec:** [studio-v2-layout-design.md](../specs/2026-10-31-studio-v2-layout-design.md), stage 1. Wireframes: [studio-v2-wireframes.html](../../design/studio-v2-wireframes.html) frames 1, 1b and 7.

**Ground rules for every task:**
- Run page tests with `cd web && npx vitest run <file>` and server tests with `cd web && node --test tests/<file>`.
- Stage explicit paths only. Run `git diff --cached --stat` before each commit.
- Never stage `.gstack/` or `web/tsconfig.tsbuildinfo`.
- Never use `git stash`.
- End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File structure

| File | Responsibility |
|---|---|
| `web/server/progress.mjs` (new) | `progressOf(board, facts)`: pure, judges steps and the next action |
| `web/server/api/films.mjs` (modify) | `filmProgress(slug)`, `progress` on `/api/films`, `GET /api/films/:slug/progress`, `POST /api/films/:slug/reveal` |
| `web/tests/progress.test.mjs` (new) | unit tests for `progressOf` |
| `web/tests/films.test.mjs` (modify) | endpoint tests |
| `web/src/api/types.ts` (modify) | `FilmProgress`, `StepState`, `FilmStep`; `FilmSummary.progress` |
| `web/src/app/route.ts` (rewrite) | `parseRoute(hash) → Route`, `RAIL`, `replaceHash`, `decoded` |
| `web/src/app/icons.tsx` (new) | eight inline SVG icons for the rail |
| `web/src/app/Rail.tsx` (new, replaces `Nav.tsx`) | the left rail |
| `web/src/app/TopBar.tsx` (new) | breadcrumb, jobs-running pill, spend meter |
| `web/src/app/App.tsx`, `App.css`, `App.test.tsx` (modify) | the shell |
| `web/src/chat/chatStore.ts` (new) | drawer open/closed (remembered), outbox, opener focus |
| `web/src/chat/ChatDrawer.tsx` (new) | the drawer around `ChatPanel` |
| `web/src/chat/ChatPanel.tsx` (modify) | optional `onClose` |
| `web/src/studio/StudioScreen.tsx` (modify) | takes only: no view switch, no storyboard, no chat |
| `web/src/film/StepBar.tsx`, `FilmWorkspace.tsx`, `film.css` (new) | the film's step bar and steps |
| `web/src/projects/FilmCard.tsx`, `ProjectsScreen.tsx`, `projects.css` (new) | film cards and the Projects page |
| `web/src/home/slug.ts`, `HomeScreen.tsx`, `home.css` (new) | the new-film box and recent films |
| `web/src/films/FilmsScreen.tsx` + test (delete) | replaced by Projects and FilmWorkspace |

---

### Task 1: `progressOf`, the film's step and next action

**Files:**
- Create: `web/server/progress.mjs`
- Test: `web/tests/progress.test.mjs`

The board shape comes from `cli/director/board.mjs` `board()`: `{ brief, plan, shots: [{ id, continuesFrom, still, take, filming: [jobIds] }] }`.

- [ ] **Step 1: Write the failing tests**

```js
// web/tests/progress.test.mjs
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { progressOf } from "../server/progress.mjs";

const brief = { takeaway: "Rain and coffee", durationS: 8, aspectRatio: "16:9", filmType: "live-action" };
const shot = (id, over = {}) => ({ id, continuesFrom: null, still: null, take: null, filming: [], ...over });
const facts = (over = {}) => ({ outputs: 0, hasFilm: false, spentUsd: 0, legacy: false, ...over });

describe("progressOf", () => {
  test("no brief: the Brief step is current and the rest are locked", () => {
    const p = progressOf({ brief: null, plan: null, shots: [] }, facts());
    assert.equal(p.step, "brief");
    assert.deepEqual(p.steps, { brief: "current", references: "locked", shots: "locked", finish: "locked" });
    assert.deepEqual(p.next, { text: "Write the brief", step: "brief" });
  });

  test("a brief without a plan asks for the shots to be planned", () => {
    const p = progressOf({ brief, plan: null, shots: [] }, facts());
    assert.equal(p.step, "brief");
    assert.deepEqual(p.next, { text: "Plan the shots", step: "brief" });
  });

  test("a plan with shots missing stills: Shots is current and names how many stills", () => {
    const b = { brief, plan: { shots: [{}, {}, {}] }, shots: [shot("s1", { still: "s1-still.png" }), shot("s2"), shot("s3", { continuesFrom: "s2" })] };
    const p = progressOf(b, facts());
    assert.deepEqual(p.steps, { brief: "done", references: "done", shots: "current", finish: "locked" });
    assert.deepEqual(p.next, { text: "Make 1 still", step: "shots" });
    assert.deepEqual(p.counts, { shots: 3, stills: 1, takes: 0, outputs: 0 });
  });

  test("every still made: names the shots left to film", () => {
    const b = { brief, plan: { shots: [{}, {}, {}] }, shots: [shot("s1", { still: "a", take: "s1-take.mp4" }), shot("s2", { still: "b" }), shot("s3", { still: "c" })] };
    assert.deepEqual(progressOf(b, facts()).next, { text: "Film s2 and s3", step: "shots" });
  });

  test("shots being filmed say so", () => {
    const b = { brief, plan: { shots: [{}] }, shots: [shot("s1", { still: "a", filming: ["j1"] })] };
    assert.deepEqual(progressOf(b, facts()).next, { text: "Filming 1 shot", step: "shots" });
  });

  test("every shot has a take and no film yet: Finish is current", () => {
    const b = { brief, plan: { shots: [{}] }, shots: [shot("s1", { still: "a", take: "t.mp4" })] };
    const p = progressOf(b, facts());
    assert.equal(p.step, "finish");
    assert.deepEqual(p.steps, { brief: "done", references: "done", shots: "done", finish: "current" });
    assert.deepEqual(p.next, { text: "Assemble the film", step: "finish" });
  });

  test("a film.mp4 marks Finish done", () => {
    const b = { brief, plan: { shots: [{}] }, shots: [shot("s1", { still: "a", take: "t.mp4" })] };
    const p = progressOf(b, facts({ hasFilm: true, outputs: 1, spentUsd: 0.6449 }));
    assert.equal(p.steps.finish, "done");
    assert.deepEqual(p.next, { text: "Watch the film", step: "finish" });
    assert.equal(p.spentUsd, 0.64);
  });

  test("a folder made before the studio opens on Finish as takes only", () => {
    const p = progressOf({ brief: null, plan: null, shots: [] }, facts({ legacy: true, outputs: 2 }));
    assert.equal(p.step, "finish");
    assert.equal(p.legacy, true);
    assert.deepEqual(p.next, { text: "Made before the studio: takes only", step: "finish" });
    assert.deepEqual(p.steps, { brief: "todo", references: "todo", shots: "todo", finish: "current" });
  });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd web && node --test tests/progress.test.mjs`
Expected: FAIL. `Cannot find module '../server/progress.mjs'`.

- [ ] **Step 3: Write `progressOf`**

```js
// web/server/progress.mjs
// Where a film is: which of its four steps (Brief, References, Shots, Finish)
// are done, which one is current, and the next thing to do, in words. Pure:
// the caller reads the board, the folder and the spend. References has no
// check of its own until the references-first stage, so it is done once the
// brief is.

export const STEPS = ["brief", "references", "shots", "finish"];

const r2 = (n) => Math.round(n * 100) / 100;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const and = (ids) => (ids.length < 2 ? ids.join("") : `${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}`);

/** b: board() ({ brief, plan, shots }); facts: { outputs, hasFilm, spentUsd, legacy }. */
export function progressOf(b, { outputs = 0, hasFilm = false, spentUsd = 0, legacy = false } = {}) {
  const shots = b.shots ?? [];
  const counts = {
    shots: shots.length,
    stills: shots.filter((s) => s.still).length,
    takes: shots.filter((s) => s.take).length,
    outputs,
  };
  const base = { counts, spentUsd: r2(spentUsd), legacy };

  if (legacy) {
    return {
      ...base,
      step: "finish",
      steps: { brief: "todo", references: "todo", shots: "todo", finish: hasFilm ? "done" : "current" },
      next: { text: "Made before the studio: takes only", step: "finish" },
    };
  }

  const done = {
    brief: Boolean(b.brief && b.plan),
    references: Boolean(b.brief && b.plan),
    shots: shots.length > 0 && shots.every((s) => s.take),
    finish: hasFilm,
  };
  const step = STEPS.find((s) => !done[s]) ?? "finish";
  const at = STEPS.indexOf(step);
  const steps = Object.fromEntries(STEPS.map((s, i) => [s, done[s] ? "done" : i === at ? "current" : "locked"]));
  return { ...base, step, steps, next: nextAction(b, step, hasFilm) };
}

function nextAction(b, step, hasFilm) {
  if (step === "brief") return { text: b.brief ? "Plan the shots" : "Write the brief", step };
  if (step === "shots") {
    const needStill = b.shots.filter((s) => !s.continuesFrom && !s.still);
    if (needStill.length) return { text: `Make ${plural(needStill.length, "still")}`, step };
    const filming = b.shots.filter((s) => !s.take && s.filming.length);
    if (filming.length) return { text: `Filming ${plural(filming.length, "shot")}`, step };
    return { text: `Film ${and(b.shots.filter((s) => !s.take).map((s) => s.id))}`, step };
  }
  return { text: hasFilm ? "Watch the film" : "Assemble the film", step: "finish" };
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd web && node --test tests/progress.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add web/server/progress.mjs web/tests/progress.test.mjs
git diff --cached --stat
git commit -m "studio: progressOf judges a film's step and next action

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Serve progress, and Show in Finder

**Files:**
- Modify: `web/server/api/films.mjs` (imports at the top, after `filmDetail`, inside `registerFilms`)
- Test: `web/tests/films.test.mjs` (append)

What happens:
- `GET /api/films` adds `progress` to each card: `null` for a folder that is not a run slug or whose board cannot be read.
- `GET /api/films/:slug/progress` returns `{ ...progress, updatedAt, cover }`.
- `POST /api/films/:slug/reveal` opens the folder in Finder through an injectable `reveal(dir)`. The default is `spawn("open", [dir])` on macOS, `xdg-open` elsewhere, detached, with stdio ignored.

A folder counts as legacy when it has no `brief.json` and no `shots.json` but does have media.

- [ ] **Step 1: Write the failing tests** (append to `web/tests/films.test.mjs`; it already sets up `film-demo` with `film.mp4`, a succeeded job of `actualUsd: 0.5`, and `app`/`port`)

```js
describe("film progress", () => {
  test("GET /api/films gives each card its progress; a folder made before the studio is takes only", async () => {
    const r = await req(port, "/api/films");
    const demo = r.json.find((f) => f.run === "film-demo");
    assert.equal(demo.progress.legacy, true);
    assert.equal(demo.progress.step, "finish");
    assert.equal(demo.progress.steps.finish, "done", "film.mp4 is in the folder");
    assert.equal(demo.progress.spentUsd, 0.5);
    assert.equal(r.json.find((f) => f.run === "Old Stuff").progress, null);
  });

  test("a film with a brief and no plan is on Brief, with the next action in words", async () => {
    mkdirSync(join(RUNS, "fresh"), { recursive: true });
    writeFileSync(join(RUNS, "fresh", "brief.json"), JSON.stringify({ takeaway: "A boat", durationS: 8, aspectRatio: "16:9", filmType: "live-action" }));
    const r = await req(port, "/api/films/fresh/progress");
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.step, "brief");
    assert.deepEqual(r.json.next, { text: "Plan the shots", step: "brief" });
    assert.equal(typeof r.json.updatedAt, "string");
  });

  test("progress for an unknown film is refused", async () => {
    const r = await req(port, "/api/films/no-such-film/progress");
    assert.equal(r.status, 404);
  });

  test("reveal opens the film's folder through the injected opener", async () => {
    const r = await req(port, "/api/films/film-demo/reveal", { method: "POST", body: {} });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(revealed, [join(RUNS, "film-demo")]);
  });
});
```

At the top of the file, record reveals and pass them to `createApp`. Change the existing `before`:

```js
const revealed = [];
// ...
app = createApp({ key: KEY, deps: { ...deps, reveal: (dir) => revealed.push(dir) }, distDir: join(tmp, "nodist"), pollMs: 60_000 });
```

`req(port, path, { method, body })` JSON-encodes `body` (`web/tests/helpers.mjs:68`).

Check what status an unknown run gives elsewhere in `films.test.mjs` (core's code 3). The `/api/films/:slug` tests assert it; use that status, which is 404 if the http layer maps code 3 to 404.

- [ ] **Step 2: Run and see them fail**

Run: `cd web && node --test tests/films.test.mjs`
Expected: the four new tests FAIL (`progress` undefined, 404 on the route).

- [ ] **Step 3: Implement in `web/server/api/films.mjs`**

Add imports:

```js
import { spawn } from "node:child_process";
import { existsSync } from "node:fs"; // merge into the existing node:fs import
import { board } from "../../../cli/director/board.mjs";
import { loadMenu } from "../../../cli/director/menu.mjs";
import { countedUsd } from "../../../cli/core/jobs.mjs";
import { progressOf } from "../progress.mjs";
```

After `filmDetail`, add:

```js
const r2 = (n) => Math.round(n * 100) / 100;
const OUTPUTS = new Set(["film", "captioned", "variant", "card"]);

/** Where a film is (progress.mjs), from its board, its folder and what its jobs cost. Throws core's code 3 for an unknown run. */
export function filmProgress(slug, { menu = loadMenu() } = {}) {
  const { store, library } = context();
  const dir = runDir(slug, { create: false });
  if (!existsSync(dir)) getRun(slug, { store }); // throws the "No run" error with the recent list
  const b = board(store, slug, { assets: library.list(), menu });
  const files = visible(dir);
  const outputs = files.filter((f) => OUTPUTS.has(fileOrigin(f.name, f.kind))).length;
  const hasFilm = files.some((f) => fileOrigin(f.name, f.kind) === "film");
  const legacy = !b.brief && !b.plan && files.length > 0;
  const spentUsd = r2(store.list().filter((j) => j.run === slug).reduce((t, j) => t + countedUsd(j), 0));
  return {
    ...progressOf(b, { outputs, hasFilm, spentUsd, legacy }),
    updatedAt: statSync(dir).mtime.toISOString(),
    cover: cover(slug),
  };
}

/** Progress for the films list: null for a folder the tools cannot name as a run. */
function progressOrNull(slug, menu) {
  try {
    return filmProgress(slug, { menu });
  } catch {
    return null;
  }
}

const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
const revealDir = (dir) => spawn(opener, [dir], { detached: true, stdio: "ignore" }).unref();
```

`web/server/app.mjs` line ~71 calls `registerFilms(router, { following })`. Change it to `registerFilms(router, { following, deps })`. Then in `films.mjs`:

```js
export function registerFilms(router, { following, maxAudioBytes = MAX_AUDIO_UPLOAD, deps = {} } = {}) {
  const menu = loadMenu();
  router.get("/api/films", () => listRuns().map((r) => ({ ...r, cover: cover(r.run), progress: progressOrNull(r.run, menu) })));
  router.get("/api/films/:slug/progress", ({ params }) => filmProgress(params.slug, { menu }));
  router.post("/api/films/:slug/reveal", ({ params }) => {
    const dir = runDir(params.slug, { create: false });
    if (!existsSync(dir)) getRun(params.slug, { store: context().store });
    (deps.reveal ?? revealDir)(dir);
    return { revealed: params.slug };
  });
  // ...the existing routes, without the old GET /api/films line
```

If `filmProgress` for an unknown slug does not give 404, look at how `filmDetail`'s `getRun` error becomes 404 (code 3 → `HttpError`) and make `filmProgress` throw the same error. Calling `getRun` first, as above, does that.

- [ ] **Step 4: Run and see them pass**

Run: `cd web && node --test tests/films.test.mjs tests/progress.test.mjs`
Expected: PASS, all.

- [ ] **Step 5: Run the whole server suite**

Run: `cd web && npm run test:server`
Expected: PASS, the same count as before plus 12.

- [ ] **Step 6: Commit**

```bash
git add web/server/api/films.mjs web/server/app.mjs web/tests/films.test.mjs
git diff --cached --stat
git commit -m "studio: films list and /progress say where each film is; reveal opens its folder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Typed routes with redirects

**Files:**
- Rewrite: `web/src/app/route.ts`
- Rewrite: `web/src/app/route.test.ts`
- Modify: `web/src/api/types.ts` (append the progress types)

- [ ] **Step 1: Append types to `web/src/api/types.ts`**

```ts
export type FilmStep = "brief" | "references" | "shots" | "finish";
export type StepState = "done" | "current" | "todo" | "locked";

export interface FilmProgress {
  step: FilmStep;
  steps: Record<FilmStep, StepState>;
  next: { text: string; step: FilmStep };
  counts: { shots: number; stills: number; takes: number; outputs: number };
  spentUsd: number;
  legacy: boolean;
  updatedAt?: string;
  cover?: { kind: "video" | "image"; url: string } | null;
}
```

Change `FilmSummary`:

```ts
export interface FilmSummary extends RunSummary {
  cover: { kind: "video" | "image"; url: string } | null;
  progress: FilmProgress | null;
}
```

- [ ] **Step 2: Write the failing route tests**

```ts
// web/src/app/route.test.ts
import { describe, test, expect } from "vitest";
import { parseRoute, RAIL, railItemFor } from "./route";

describe("parseRoute", () => {
  test("empty, slash and unknown hashes go Home", () => {
    expect(parseRoute("")).toEqual({ screen: "home" });
    expect(parseRoute("#/")).toEqual({ screen: "home" });
    expect(parseRoute("#/nope")).toEqual({ screen: "home" });
  });
  test("each rail screen by name", () => {
    for (const s of ["projects", "create", "library", "presets", "spend", "settings"] as const) {
      expect(parseRoute(`#/${s}`)).toEqual({ screen: s });
    }
  });
  test("a film with and without a step", () => {
    expect(parseRoute("#/films/rainy-coffee/shots")).toEqual({ screen: "film", slug: "rainy-coffee", step: "shots" });
    expect(parseRoute("#/films/rainy-coffee")).toEqual({ screen: "film", slug: "rainy-coffee", step: null });
    expect(parseRoute("#/films/rainy-coffee/nope")).toEqual({ screen: "film", slug: "rainy-coffee", step: null });
  });
  test("a stray % in a film name does not throw", () => {
    expect(parseRoute("#/films/50%25-off")).toEqual({ screen: "film", slug: "50%-off", step: null });
    expect(parseRoute("#/films/bad%")).toEqual({ screen: "film", slug: "bad%", step: null });
  });
  test("old hashes redirect", () => {
    expect(parseRoute("#/studio")).toEqual({ redirect: "#/create" });
    expect(parseRoute("#/films")).toEqual({ redirect: "#/projects" });
  });
});

describe("RAIL", () => {
  test("top and bottom groups in order", () => {
    expect(RAIL.top.map((r) => r.id)).toEqual(["home", "projects", "create", "library", "presets"]);
    expect(RAIL.bottom.map((r) => r.id)).toEqual(["spend", "settings"]);
  });
  test("a film lights Projects", () => {
    expect(railItemFor({ screen: "film", slug: "x", step: null })).toBe("projects");
    expect(railItemFor({ screen: "library" })).toBe("library");
  });
});
```

- [ ] **Step 3: Run and see them fail**

Run: `cd web && npx vitest run src/app/route.test.ts`
Expected: FAIL (`RAIL`, `railItemFor` not exported).

- [ ] **Step 4: Write `route.ts`**

```ts
// web/src/app/route.ts
// The page's places, read from the hash. A film lives at #/films/<slug>/<step>;
// old hashes from the six-tab studio redirect so links in docs keep working.
import type { FilmStep } from "../api/types";

export type RailId = "home" | "projects" | "create" | "library" | "presets" | "spend" | "settings";
export type Screen = RailId | "film";
export type Route = { screen: Exclude<Screen, "film"> } | { screen: "film"; slug: string; step: FilmStep | null } | { redirect: string };
export type Place = Exclude<Route, { redirect: string }>;

export const STEPS: { id: FilmStep; label: string }[] = [
  { id: "brief", label: "Brief" },
  { id: "references", label: "References" },
  { id: "shots", label: "Shots" },
  { id: "finish", label: "Finish" },
];

export const RAIL: { top: { id: RailId; label: string }[]; bottom: { id: RailId; label: string }[] } = {
  top: [
    { id: "home", label: "Home" },
    { id: "projects", label: "Projects" },
    { id: "create", label: "Create" },
    { id: "library", label: "Library" },
    { id: "presets", label: "Presets" },
  ],
  bottom: [
    { id: "spend", label: "Spend" },
    { id: "settings", label: "Settings" },
  ],
};

const RAIL_IDS = new Set<string>([...RAIL.top, ...RAIL.bottom].map((r) => r.id));
const REDIRECTS: Record<string, string> = { studio: "#/create", films: "#/projects" };

/** The hash part as typed; a stray % must not break the page. */
export function decoded(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export function parseRoute(hash: string): Route {
  const [first = "", ...rest] = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (first === "films" && rest[0]) {
    const step = STEPS.find((s) => s.id === rest[1])?.id ?? null;
    return { screen: "film", slug: decoded(rest[0]), step };
  }
  if (REDIRECTS[first]) return { redirect: REDIRECTS[first] };
  if (RAIL_IDS.has(first)) return { screen: first as Exclude<Screen, "film"> };
  return { screen: "home" };
}

/** The rail item lit for a place: inside a film, Projects. */
export const railItemFor = (place: Place): RailId => (place.screen === "film" ? "projects" : place.screen);

export const filmHref = (slug: string, step?: FilmStep) => `#/films/${encodeURIComponent(slug)}${step ? `/${step}` : ""}`;

/** Go somewhere without a history entry (a redirect), and tell useRoute. */
export function replaceHash(hash: string) {
  history.replaceState(null, "", hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
```

- [ ] **Step 5: Run and see them pass**

Run: `cd web && npx vitest run src/app/route.test.ts`
Expected: PASS. (App.tsx will not type-check yet; it is rewritten in Task 6.)

- [ ] **Step 6: Commit**

```bash
git add web/src/app/route.ts web/src/app/route.test.ts web/src/api/types.ts
git diff --cached --stat
git commit -m "studio: typed routes for the rail, films with steps, and redirects for old hashes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Chat store and drawer

**Files:**
- Create: `web/src/chat/chatStore.ts`, `web/src/chat/chatStore.test.ts`, `web/src/chat/ChatDrawer.tsx`
- Modify: `web/src/chat/ChatPanel.tsx` (prop `onClose`), `web/src/chat/chat.css` (drawer styles)

- [ ] **Step 1: Write the failing store tests**

```ts
// web/src/chat/chatStore.test.ts
import { describe, test, expect, beforeEach } from "vitest";
import { closeChat, getChat, openChat, sendToChat, toggleChat, resetChatForTests } from "./chatStore";

beforeEach(() => {
  localStorage.clear();
  resetChatForTests();
});

describe("chatStore", () => {
  test("starts closed, opens, closes and toggles", () => {
    expect(getChat().open).toBe(false);
    openChat();
    expect(getChat().open).toBe(true);
    closeChat();
    expect(getChat().open).toBe(false);
    toggleChat();
    expect(getChat().open).toBe(true);
  });
  test("remembers open across reloads", () => {
    openChat();
    expect(localStorage.getItem("studio.chatOpen")).toBe("1");
    resetChatForTests();
    expect(getChat().open).toBe(true);
  });
  test("sendToChat opens the drawer and hands over a numbered message", () => {
    sendToChat("Plan the shots for rainy-coffee");
    expect(getChat()).toMatchObject({ open: true, outbox: { id: 1, text: "Plan the shots for rainy-coffee" } });
    sendToChat("again");
    expect(getChat().outbox).toEqual({ id: 2, text: "again" });
  });
});
```

- [ ] **Step 2: Run and see them fail**

Run: `cd web && npx vitest run src/chat/chatStore.test.ts`
Expected: FAIL (no module).

- [ ] **Step 3: Write `chatStore.ts`**

```ts
// web/src/chat/chatStore.ts
// The chat drawer's state, shared by the rail's Chat button, the drawer and
// any screen that hands the chat a message (the storyboard's "Plan this").
// Open or closed is remembered across reloads.
import { useSyncExternalStore } from "react";

const KEY = "studio.chatOpen";
const readOpen = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

interface ChatState {
  open: boolean;
  outbox: { id: number; text: string } | null;
}

let state: ChatState = { open: readOpen(), outbox: null };
/** The element that opened the drawer, so closing gives focus back. */
let opener: HTMLElement | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<ChatState>) {
  state = { ...state, ...next };
  try {
    localStorage.setItem(KEY, state.open ? "1" : "0");
  } catch {
    // private mode: the drawer just forgets
  }
  listeners.forEach((fn) => fn());
}

export const getChat = () => state;

export function openChat() {
  if (!state.open) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  set({ open: true });
}

export function closeChat() {
  set({ open: false });
  opener?.focus();
  opener = null;
}

export const toggleChat = () => (state.open ? closeChat() : openChat());

export function sendToChat(text: string) {
  openChat();
  set({ outbox: { id: (state.outbox?.id ?? 0) + 1, text } });
}

export function useChatDrawer(): ChatState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

export function resetChatForTests() {
  state = { open: readOpen(), outbox: null };
  opener = null;
}
```

- [ ] **Step 4: Run and see them pass**

Run: `cd web && npx vitest run src/chat/chatStore.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Give `ChatPanel` an `onClose`**

In `web/src/chat/ChatPanel.tsx`:

- Change the signature:

  ```tsx
  export function ChatPanel({ film, outbox, onClose }: { film: string | null; outbox?: { id: number; text: string } | null; onClose?: () => void }) {
    const [open, setOpen] = useState(() => Boolean(onClose) || !narrow());
  ```

- Replace the header's Hide button with:

  ```tsx
  {onClose ? (
    <button type="button" className="button button--quiet chat__hide" onClick={onClose}>
      Close chat
    </button>
  ) : (
    <button type="button" className="button button--quiet chat__hide" aria-expanded="true" onClick={() => setOpen(false)}>
      Hide chat
    </button>
  )}
  ```

- Change the empty-state sentence's "Jobs the chat starts appear in the feed." to "Jobs the chat starts appear in the film."

- [ ] **Step 6: Write `ChatDrawer.tsx`**

```tsx
// web/src/chat/ChatDrawer.tsx
// The chat as a drawer over the right edge of any page. It talks about the
// film you are in (or the film Create saves into). Escape closes it and gives
// focus back to whatever opened it.
import { useEffect, useRef } from "react";
import { ChatPanel } from "./ChatPanel";
import { closeChat, useChatDrawer } from "./chatStore";

export function ChatDrawer({ film }: { film: string | null }) {
  const { open, outbox } = useChatDrawer();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeChat();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="drawer" role="dialog" aria-modal="false" aria-label="Chat drawer" ref={box}>
      <ChatPanel film={film} outbox={outbox} onClose={closeChat} />
    </div>
  );
}
```

- [ ] **Step 7: Drawer styles** (append to `web/src/chat/chat.css`)

```css
/* The drawer: over the page's right edge, full height under nothing. */
.drawer {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 20;
  width: min(420px, 100vw); display: flex;
  background: var(--surface-1); border-left: 1px solid var(--line);
}
.drawer .chat { flex: 1; min-width: 0; border-left: 0; padding: var(--space-4); }
```

Open `chat.css` and check that `.chat`'s own width, border and grid placement do not fight this. Where `.chat` sets a fixed width or a grid column, add `.drawer .chat { width: auto; grid-column: auto; }`.

- [ ] **Step 8: Run the chat tests**

Run: `cd web && npx vitest run src/chat`
Expected: PASS. `ChatPanel.test.tsx` is unchanged because `onClose` is optional. If a test expected the old "appear in the feed" sentence, update that string.

- [ ] **Step 9: Commit**

```bash
git add web/src/chat/chatStore.ts web/src/chat/chatStore.test.ts web/src/chat/ChatDrawer.tsx web/src/chat/ChatPanel.tsx web/src/chat/chat.css
# plus web/src/chat/ChatPanel.test.tsx only if a string changed
git diff --cached --stat
git commit -m "studio: chat drawer and a shared chat store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Rail, icons and top bar

**Files:**
- Create: `web/src/app/icons.tsx`, `web/src/app/Rail.tsx`, `web/src/app/TopBar.tsx`, `web/src/app/Rail.test.tsx`
- Delete: `web/src/app/Nav.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/app/Rail.test.tsx
import { describe, test, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Rail } from "./Rail";
import { getChat, resetChatForTests } from "../chat/chatStore";

beforeEach(() => {
  localStorage.clear();
  resetChatForTests();
});

describe("Rail", () => {
  test("links every place, lights the current one, and has a Chat button", () => {
    render(<Rail current="projects" />);
    const nav = screen.getByRole("navigation", { name: "Studio" });
    for (const name of ["Home", "Projects", "Create", "Library", "Presets", "Spend", "Settings"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(nav).toContainElement(screen.getByRole("button", { name: "Chat" }));
  });

  test("Chat opens and closes the drawer and says which", () => {
    render(<Rail current="home" />);
    const chat = screen.getByRole("button", { name: "Chat" });
    expect(chat).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(chat);
    expect(getChat().open).toBe(true);
    expect(chat).toHaveAttribute("aria-expanded", "true");
  });
});
```

`@testing-library/user-event` is not installed; use `fireEvent` and do not add a package.

- [ ] **Step 2: Run and see it fail**

Run: `cd web && npx vitest run src/app/Rail.test.tsx`
Expected: FAIL (no module).

- [ ] **Step 3: Write `icons.tsx`**

```tsx
// web/src/app/icons.tsx
// The rail's icons: 20px line drawings in currentColor, hidden from screen
// readers (the label under each icon names it).
const paths: Record<string, string> = {
  home: "M3 10.5 10 4l7 6.5V17a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1z",
  projects: "M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z",
  create: "M10 3v14M3 10h14",
  library: "M4 3h3v14H4zM9 3h3v14H9zM14 4l3 .8-3.2 12.6-3-.8z",
  presets: "M5 3h10v14l-5-3.5L5 17z",
  chat: "M3 4h14v9H8l-4 3v-3H3z",
  spend: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm0 3v8m-2.5-6h3.5a1.5 1.5 0 0 1 0 3H9a1.5 1.5 0 0 0 0 3h3.5",
  settings: "M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm6.5 3-1.6-.9.2-1.8-1.7-1-1.5 1-1.6-.8L10 3.5 9.7 5.5l-1.6.8-1.5-1-1.7 1 .2 1.8-1.6.9.0 2 1.6.9-.2 1.8 1.7 1 1.5-1 1.6.8.3 2h.6l.3-2 1.6-.8 1.5 1 1.7-1-.2-1.8 1.6-.9z",
};

export function Icon({ name }: { name: keyof typeof paths | string }) {
  return (
    <svg className="icon" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d={paths[name] ?? ""} />
    </svg>
  );
}
```

- [ ] **Step 4: Write `Rail.tsx`**

```tsx
// web/src/app/Rail.tsx
// The left rail: where you can go, plus the Chat drawer's button. Places you
// visit now and then (Spend, Settings) sit at the bottom with Chat.
import { Icon } from "./icons";
import { RAIL, type RailId } from "./route";
import { toggleChat, useChatDrawer } from "../chat/chatStore";

function Item({ id, label, current }: { id: RailId; label: string; current: RailId }) {
  return (
    <a className="rail__item" href={id === "home" ? "#/" : `#/${id}`} aria-current={id === current ? "page" : undefined}>
      <Icon name={id} />
      <span>{label}</span>
    </a>
  );
}

export function Rail({ current }: { current: RailId }) {
  const { open } = useChatDrawer();
  return (
    <nav className="rail" aria-label="Studio">
      <a className="rail__brand" href="#/" aria-label="Studio home">
        MD
      </a>
      {RAIL.top.map((r) => (
        <Item key={r.id} {...r} current={current} />
      ))}
      <span className="rail__gap" />
      <button type="button" className="rail__item" aria-expanded={open} onClick={toggleChat}>
        <Icon name="chat" />
        <span>Chat</span>
      </button>
      {RAIL.bottom.map((r) => (
        <Item key={r.id} {...r} current={current} />
      ))}
    </nav>
  );
}
```

`aria-label="Studio home"` on the brand link keeps "Home" unique for `getByRole("link", { name: "Home" })`.

- [ ] **Step 5: Write `TopBar.tsx`**

```tsx
// web/src/app/TopBar.tsx
// Where you are, how many jobs are running, and today's spend.
import type { ReactNode } from "react";
import type { SpendView } from "../api/types";
import { SpendMeter } from "./SpendMeter";

export function TopBar({ children, spend }: { children: ReactNode; spend: SpendView | null }) {
  const running = spend?.unsettled ?? 0;
  return (
    <header className="topbar">
      <div className="topbar__where">{children}</div>
      {running > 0 && (
        <a className="topbar__jobs" href="#/spend">
          {running === 1 ? "1 job running" : `${running} jobs running`}
        </a>
      )}
      <SpendMeter spend={spend} />
    </header>
  );
}
```

- [ ] **Step 6: Delete `Nav.tsx`**

```bash
git rm web/src/app/Nav.tsx
```

This stages the deletion immediately, so it rides the next commit. That is fine here, because the next commit is this task's.

- [ ] **Step 7: Run and see the test pass**

Run: `cd web && npx vitest run src/app/Rail.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 8: Commit**

```bash
git add web/src/app/icons.tsx web/src/app/Rail.tsx web/src/app/TopBar.tsx web/src/app/Rail.test.tsx
git diff --cached --stat   # shows Nav.tsx deleted plus the four new files
git commit -m "studio: left rail with icons, a Chat button and a top bar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Film workspace with a step bar

**Files:**
- Create: `web/src/film/StepBar.tsx`, `web/src/film/FilmWorkspace.tsx`, `web/src/film/film.css`, `web/src/film/FilmWorkspace.test.tsx`

What it does:
- It loads `/api/films/:slug/progress`.
- With no step in the hash, it replaces the hash with the film's current step.
- It sets the prompt store's run to the film, so Create and the chat follow it.
- **Brief and Shots** mount today's `Storyboard`, via `useBoard(slug)`. Its `onPlan` hands the text to the chat drawer.
- **References** says, in words, that it comes next and links to Shots.
- **Finish** mounts today's `FilmPage`.
- A locked step is not a link. Its reason is `progress.next.text`, shown as the step's `title` and in a visually hidden description.

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/film/FilmWorkspace.test.tsx
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { FilmWorkspace } from "./FilmWorkspace";
import { routes } from "../test-fixtures";
import type { FilmProgress } from "../api/types";

const progress = (over: Partial<FilmProgress> = {}): FilmProgress => ({
  step: "shots",
  steps: { brief: "done", references: "done", shots: "current", finish: "locked" },
  next: { text: "Film s2 and s3", step: "shots" },
  counts: { shots: 3, stills: 3, takes: 1, outputs: 0 },
  spentUsd: 0.38,
  legacy: false,
  ...over,
});

beforeEach(() => {
  window.location.hash = "";
});

describe("FilmWorkspace", () => {
  test("with no step, goes to the film's current step", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/boat/progress": () => progress() })));
    render(<FilmWorkspace slug="boat" step={null} />);
    await waitFor(() => expect(window.location.hash).toBe("#/films/boat/shots"));
  });

  test("the step bar is an ordered list: done and current steps are links, a locked one says why", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/boat/progress": () => progress() })));
    render(<FilmWorkspace slug="boat" step="references" />);
    const bar = await screen.findByRole("list", { name: "Steps" });
    expect(within(bar).getByRole("link", { name: /Brief/ })).toHaveAttribute("href", "#/films/boat/brief");
    expect(within(bar).getByRole("link", { name: /References/ })).toHaveAttribute("aria-current", "step");
    expect(within(bar).queryByRole("link", { name: /Finish/ })).toBeNull();
    expect(within(bar).getByText("Finish").closest("li")).toHaveAttribute("title", "Locked: Film s2 and s3 first.");
  });

  test("References says it is coming and points to Shots", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/boat/progress": () => progress() })));
    render(<FilmWorkspace slug="boat" step="references" />);
    expect(await screen.findByRole("heading", { name: "References" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Shots" })).toHaveAttribute("href", "#/films/boat/shots");
  });

  test("an unknown film says so", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(routes({ "/api/films/gone/progress": () => new Response(JSON.stringify({ error: { message: 'No run "gone".' } }), { status: 404 }) })),
    );
    render(<FilmWorkspace slug="gone" step="shots" />);
    expect(await screen.findByRole("alert")).toHaveTextContent('No run "gone".');
  });
});
```

`ApiError` reads `{ error: { code, message } }` from the body (`web/src/api/client.ts:74`), so the 404 above matches.

- [ ] **Step 2: Run and see them fail**

Run: `cd web && npx vitest run src/film`
Expected: FAIL (no module).

- [ ] **Step 3: Write `StepBar.tsx`**

```tsx
// web/src/film/StepBar.tsx
// A film's four steps in order. Done and current steps are links; a locked
// step is plain text whose title says what to do first.
import type { FilmProgress, FilmStep } from "../api/types";
import { STEPS, filmHref } from "../app/route";

export function StepBar({ slug, progress, at }: { slug: string; progress: FilmProgress; at: FilmStep }) {
  return (
    <ol className="stepbar" aria-label="Steps">
      {STEPS.map((s, i) => {
        const state = progress.steps[s.id];
        const label = (
          <>
            <span className="stepbar__n">{state === "done" ? "✓" : i + 1}</span>
            {s.label}
          </>
        );
        if (state === "locked") {
          return (
            <li key={s.id} className="stepbar__step" data-state="locked" title={`Locked: ${progress.next.text} first.`}>
              {label}
            </li>
          );
        }
        return (
          <li key={s.id} className="stepbar__step" data-state={state}>
            <a href={filmHref(slug, s.id)} aria-current={s.id === at ? "step" : undefined}>
              {label}
            </a>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 4: Write `FilmWorkspace.tsx`**

```tsx
// web/src/film/FilmWorkspace.tsx
// One film's home: its step bar and the step you are on. Stage 1 mounts the
// existing screens: the storyboard for Brief and Shots, the film page for
// Finish. References arrives with the references-first work.
import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { FilmProgress, FilmStep } from "../api/types";
import { filmHref, replaceHash } from "../app/route";
import { onStudioEvent } from "../app/useStudio";
import { Storyboard } from "../storyboard/Storyboard";
import { useBoard } from "../storyboard/useBoard";
import { FilmPage } from "../films/FilmPage";
import { setRun } from "../studio/promptStore";
import { sendToChat } from "../chat/chatStore";
import { StepBar } from "./StepBar";
import "./film.css";

function BoardStep({ slug }: { slug: string }) {
  const { board, error, apply } = useBoard(slug);
  return <Storyboard film={slug} board={board} error={error} apply={apply} onPlan={sendToChat} />;
}

function ReferencesStep({ slug }: { slug: string }) {
  return (
    <section className="film-step film-step--note" aria-labelledby="refs-h">
      <h2 id="refs-h">References</h2>
      <p>
        Reference images for each character, product and place, from several angles, come in the next update. Until then, shots use the Library
        items named in their cast.
      </p>
      <a className="button" href={filmHref(slug, "shots")}>
        Go to Shots
      </a>
    </section>
  );
}

export function FilmWorkspace({ slug, step }: { slug: string; step: FilmStep | null }) {
  const [progress, setProgress] = useState<FilmProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRun(slug);
    let alive = true;
    const load = () =>
      api<FilmProgress>(`/api/films/${encodeURIComponent(slug)}/progress`)
        .then((p) => alive && setProgress(p))
        .catch((e) => alive && setError(e instanceof ApiError ? e.message : String(e)));
    load();
    // A job settling can move the film on a step.
    const off = onStudioEvent((e) => e.event === "job" && load());
    return () => {
      alive = false;
      off();
    };
  }, [slug]);

  useEffect(() => {
    if (progress && !step) replaceHash(filmHref(slug, progress.step));
  }, [progress, step, slug]);

  if (error) {
    return (
      <p className="film-step__error" role="alert">
        {error}
      </p>
    );
  }
  if (!progress || !step) return <p className="film-step__loading">Opening {slug}…</p>;

  return (
    <div className="film-ws">
      <div className="film-ws__head">
        <h1 className="film-ws__name mono">{slug}</h1>
        <StepBar slug={slug} progress={progress} at={step} />
        <p className="film-ws__next">
          Next: <a href={filmHref(slug, progress.next.step)}>{progress.next.text}</a>
        </p>
      </div>
      {(step === "brief" || step === "shots") && <BoardStep slug={slug} />}
      {step === "references" && <ReferencesStep slug={slug} />}
      {step === "finish" && <FilmPage key={slug} slug={slug} />}
    </div>
  );
}
```

Job events are `{ event: "job", data: JobView }` (`StudioEvent` in `web/src/api/types.ts`).

- [ ] **Step 5: Write `film.css`**

```css
/* web/src/film/film.css: a film's step bar and the frame its steps sit in. Tokens only. */
.film-ws { display: flex; flex-direction: column; gap: var(--space-4); min-height: 100%; }
.film-ws__head { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
.film-ws__name { margin: 0; font-size: var(--text-lg); font-weight: 600; }
.film-ws__next { margin: 0 0 0 auto; color: var(--text-2); font-size: var(--text-sm); }
.film-ws__next a { color: var(--text); }

.stepbar { display: flex; margin: 0; padding: 0; list-style: none; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; }
.stepbar__step { display: flex; }
.stepbar__step + .stepbar__step { border-left: 1px solid var(--line); }
.stepbar__step > a, .stepbar__step[data-state="locked"] {
  display: inline-flex; align-items: center; gap: var(--space-2);
  padding: 6px var(--space-4); font-size: var(--text-sm); color: var(--text-2); text-decoration: none;
}
.stepbar__step > a:hover { color: var(--text); background: var(--surface-2); }
.stepbar__step > a[aria-current="step"] { color: var(--text); background: var(--surface-3); font-weight: 500; }
.stepbar__step[data-state="locked"] { color: var(--text-3); cursor: not-allowed; }
.stepbar__n {
  display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%;
  border: 1px solid currentColor; font-size: var(--text-xs); font-family: var(--font-mono);
}
.stepbar__step[data-state="done"] .stepbar__n { background: var(--ok); border-color: var(--ok); color: var(--bg); }

.film-step--note { max-width: 560px; padding: var(--space-5); border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface-1); }
.film-step--note h2 { margin: 0 0 var(--space-2); font-size: var(--text-lg); }
.film-step--note p { margin: 0 0 var(--space-4); color: var(--text-2); }
.film-step__error { color: var(--bad-ink); }
.film-step__loading { color: var(--text-3); }
```

- [ ] **Step 6: Run and see them pass**

Run: `cd web && npx vitest run src/film`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add web/src/film/StepBar.tsx web/src/film/FilmWorkspace.tsx web/src/film/film.css web/src/film/FilmWorkspace.test.tsx
git diff --cached --stat
git commit -m "studio: a film workspace with Brief, References, Shots and Finish steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Film cards and the Projects page

**Files:**
- Create: `web/src/projects/FilmCard.tsx`, `web/src/projects/ProjectsScreen.tsx`, `web/src/projects/projects.css`, `web/src/projects/ProjectsScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/projects/ProjectsScreen.test.tsx
import { describe, test, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { ProjectsScreen } from "./ProjectsScreen";
import { routes } from "../test-fixtures";
import type { FilmProgress, FilmSummary } from "../api/types";

const prog = (over: Partial<FilmProgress>): FilmProgress => ({
  step: "shots",
  steps: { brief: "done", references: "done", shots: "current", finish: "locked" },
  next: { text: "Film s2 and s3", step: "shots" },
  counts: { shots: 3, stills: 3, takes: 1, outputs: 0 },
  spentUsd: 0.42,
  legacy: false,
  ...over,
});

const films: FilmSummary[] = [
  { run: "boat", modified: "2026-10-31T12:00:00.000Z", files: 6, takes: 3, cover: null, progress: prog({}) },
  {
    run: "rainy-coffee",
    modified: "2026-10-31T09:00:00.000Z",
    files: 9,
    takes: 6,
    cover: { kind: "video", url: "/media/runs/rainy-coffee/film.mp4" },
    progress: prog({ step: "finish", steps: { brief: "done", references: "done", shots: "done", finish: "done" }, next: { text: "Watch the film", step: "finish" }, spentUsd: 0.64 }),
  },
  { run: "Old Stuff", modified: "2026-10-01T09:00:00.000Z", files: 1, takes: 1, cover: null, progress: null },
];

describe("ProjectsScreen", () => {
  test("one card per film, naming its next step as a link into the film", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => films })));
    render(<ProjectsScreen />);
    const boat = await screen.findByRole("article", { name: "boat" });
    expect(within(boat).getByRole("link", { name: "Next: Film s2 and s3" })).toHaveAttribute("href", "#/films/boat/shots");
    expect(within(boat).getByText("$0.42 spent")).toBeInTheDocument();
    expect(within(boat).getByRole("list", { name: "Steps" })).toBeInTheDocument();
  });

  test("filters by In progress and Finished, with counts", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => films })));
    render(<ProjectsScreen />);
    await screen.findByRole("article", { name: "boat" });
    fireEvent.click(screen.getByRole("button", { name: "Finished 1" }));
    expect(screen.queryByRole("article", { name: "boat" })).toBeNull();
    expect(screen.getByRole("article", { name: "rainy-coffee" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "In progress 1" }));
    expect(screen.getByRole("article", { name: "boat" })).toBeInTheDocument();
  });

  test("search narrows by name, and sort by spent puts the costliest first", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => films })));
    render(<ProjectsScreen />);
    await screen.findByRole("article", { name: "boat" });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), { target: { value: "spent" } });
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["rainy-coffee", "boat", "Old Stuff"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search films" }), { target: { value: "rain" } });
    expect(screen.getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["rainy-coffee"]);
  });

  test("Show in Finder posts to reveal", async () => {
    const fetchMock = vi.fn(routes({ "/api/films": () => films, "/api/films/boat/reveal": () => ({ revealed: "boat" }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProjectsScreen />);
    const boat = await screen.findByRole("article", { name: "boat" });
    fireEvent.click(within(boat).getByRole("button", { name: "Show boat in Finder" }));
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/api/films/boat/reveal") && init?.method === "POST")).toBe(true);
  });

  test("no films: says so and offers to start one", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => [] })));
    render(<ProjectsScreen />);
    expect(await screen.findByText(/No films yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a film" })).toHaveAttribute("href", "#/");
  });
});
```

`api(path, { method, body })` JSON-encodes `body` (`web/src/api/client.ts:40-61`).

- [ ] **Step 2: Run and see them fail**

Run: `cd web && npx vitest run src/projects`
Expected: FAIL (no module).

- [ ] **Step 3: Write `FilmCard.tsx`**

```tsx
// web/src/projects/FilmCard.tsx
// One film as a card: cover, name, four step markers, what it cost, and the
// next thing to do as a link straight to that step. Shared by Home and Projects.
import type { FilmSummary } from "../api/types";
import { STEPS, filmHref } from "../app/route";

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

export function FilmCard({ film, onReveal }: { film: FilmSummary; onReveal?: (slug: string) => void }) {
  const p = film.progress;
  return (
    <article className="film-card2" aria-label={film.run}>
      <a className="film-card2__cover" href={filmHref(film.run)} tabIndex={-1} aria-hidden="true">
        {film.cover?.kind === "video" && <video src={film.cover.url} preload="metadata" muted />}
        {film.cover?.kind === "image" && <img src={film.cover.url} alt="" />}
      </a>
      <div className="film-card2__body">
        <div className="film-card2__title">
          <a className="mono" href={filmHref(film.run)}>
            {film.run}
          </a>
          {onReveal && (
            <button type="button" className="button button--quiet film-card2__reveal" aria-label={`Show ${film.run} in Finder`} onClick={() => onReveal(film.run)}>
              Show in Finder
            </button>
          )}
        </div>
        {p && (
          <ol className="film-card2__steps" aria-label="Steps">
            {STEPS.map((s) => (
              <li key={s.id} data-state={p.steps[s.id]}>
                {s.label}
              </li>
            ))}
          </ol>
        )}
        <p className="film-card2__meta">
          {p ? <span className="mono film-card2__cost">${p.spentUsd.toFixed(2)} spent</span> : <span>{film.takes === 1 ? "1 file" : `${film.takes} files`}</span>}
          <span>{when(film.modified)}</span>
        </p>
        {p && (
          <a className="film-card2__next" href={filmHref(film.run, p.next.step)}>
            Next: {p.next.text}
          </a>
        )}
      </div>
    </article>
  );
}
```

`$0.42 spent` keeps the amber cost rule from DESIGN.md: `.film-card2__cost` is coloured `--accent`.

- [ ] **Step 4: Write `ProjectsScreen.tsx`**

```tsx
// web/src/projects/ProjectsScreen.tsx
// Every film, to find one, see where it is stuck and jump back in. A film is
// finished once its Finish step is done.
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type { FilmSummary } from "../api/types";
import { FilmCard } from "./FilmCard";
import "./projects.css";

type Filter = "all" | "progress" | "finished";
type Sort = "edited" | "name" | "spent";

const finished = (f: FilmSummary) => f.progress?.steps.finish === "done";

export function ProjectsScreen() {
  const [films, setFilms] = useState<FilmSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("edited");
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<"grid" | "list">("grid");

  useEffect(() => {
    api<FilmSummary[]>("/api/films")
      .then(setFilms)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  const counts = useMemo(() => {
    const all = films ?? [];
    return { all: all.length, finished: all.filter(finished).length, progress: all.filter((f) => !finished(f)).length };
  }, [films]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (films ?? [])
      .filter((f) => (filter === "all" ? true : filter === "finished" ? finished(f) : !finished(f)))
      .filter((f) => !q || f.run.toLowerCase().includes(q));
    const by: Record<Sort, (a: FilmSummary, b: FilmSummary) => number> = {
      edited: (a, b) => b.modified.localeCompare(a.modified),
      name: (a, b) => a.run.localeCompare(b.run),
      spent: (a, b) => (b.progress?.spentUsd ?? 0) - (a.progress?.spentUsd ?? 0),
    };
    return [...list].sort(by[sort]);
  }, [films, filter, sort, query]);

  const reveal = (slug: string) => {
    api(`/api/films/${encodeURIComponent(slug)}/reveal`, { method: "POST", body: {} }).catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  };

  const tabs: { id: Filter; label: string }[] = [
    { id: "all", label: `All ${counts.all}` },
    { id: "progress", label: `In progress ${counts.progress}` },
    { id: "finished", label: `Finished ${counts.finished}` },
  ];

  return (
    <div className="projects">
      <header className="projects__head">
        <h1>Projects</h1>
        <div className="projects__filters" role="group" aria-label="Show">
          {tabs.map((t) => (
            <button key={t.id} type="button" className="projects__filter" aria-pressed={filter === t.id} onClick={() => setFilter(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <input className="projects__search" type="search" aria-label="Search films" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="projects__sort" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="edited">Last edited</option>
          <option value="name">Name</option>
          <option value="spent">Most spent</option>
        </select>
        <button type="button" className="button button--quiet" aria-pressed={layout === "list"} onClick={() => setLayout(layout === "grid" ? "list" : "grid")}>
          {layout === "grid" ? "List view" : "Grid view"}
        </button>
        <a className="generate projects__new" href="#/">
          + New film
        </a>
      </header>
      {error && (
        <p className="projects__error" role="alert">
          {error}
        </p>
      )}
      {films && films.length === 0 && (
        <p className="projects__none">
          No films yet. <a href="#/">Start a film</a>
        </p>
      )}
      {shown.length > 0 && (
        <div className="projects__grid" data-layout={layout}>
          {shown.map((f) => (
            <FilmCard key={f.run} film={f} onReveal={reveal} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write `projects.css`**

```css
/* web/src/projects/projects.css: the Projects page and the film card Home shares. Tokens only. */
.projects { display: flex; flex-direction: column; gap: var(--space-5); }
.projects__head { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.projects__head h1 { margin: 0 var(--space-3) 0 0; font-size: var(--text-xl); }
.projects__filters { display: flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; }
.projects__filter { background: transparent; border: 0; color: var(--text-2); padding: 6px var(--space-4); font: inherit; font-size: var(--text-sm); cursor: pointer; }
.projects__filter + .projects__filter { border-left: 1px solid var(--line); }
.projects__filter[aria-pressed="true"] { background: var(--surface-3); color: var(--text); }
.projects__search, .projects__sort {
  background: var(--surface-1); color: var(--text); border: 1px solid var(--line); border-radius: var(--radius-sm);
  padding: 6px var(--space-3); font: inherit; font-size: var(--text-sm);
}
.projects__search { margin-left: auto; width: 200px; }
.projects__new { text-decoration: none; }
.projects__error { color: var(--bad-ink); }
.projects__none { color: var(--text-2); }

.projects__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-5); }
.projects__grid[data-layout="list"] { grid-template-columns: 1fr; }
.projects__grid[data-layout="list"] .film-card2 { flex-direction: row; }
.projects__grid[data-layout="list"] .film-card2__cover { width: 200px; aspect-ratio: 16 / 9; flex: none; }

.film-card2 { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface-1); overflow: hidden; }
.film-card2__cover { display: block; aspect-ratio: 16 / 9; background: var(--surface-2); }
.film-card2__cover video, .film-card2__cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.film-card2__body { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3) var(--space-4) var(--space-4); }
.film-card2__title { display: flex; align-items: center; gap: var(--space-2); }
.film-card2__title a { color: var(--text); font-weight: 600; text-decoration: none; }
.film-card2__title a:hover { text-decoration: underline; }
.film-card2__reveal { margin-left: auto; font-size: var(--text-xs); }
.film-card2__steps { display: flex; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
.film-card2__steps li { padding: 2px var(--space-2); border-radius: 999px; font-size: var(--text-xs); border: 1px solid var(--line); color: var(--text-3); }
.film-card2__steps li[data-state="done"] { background: var(--surface-3); color: var(--text); border-color: var(--surface-3); }
.film-card2__steps li[data-state="current"] { border-color: var(--text-2); color: var(--text); }
.film-card2__steps li[data-state="locked"], .film-card2__steps li[data-state="todo"] { border-style: dashed; }
.film-card2__meta { display: flex; justify-content: space-between; margin: 0; font-size: var(--text-sm); color: var(--text-2); }
.film-card2__cost { color: var(--accent); }
.film-card2__next { color: var(--text); font-size: var(--text-sm); font-weight: 500; text-decoration: none; }
.film-card2__next:hover { text-decoration: underline; }
```

`.generate` is the existing amber primary button from `studio.css`. Check that `studio.css` is loaded on every page (it is imported by `StudioScreen`). If `.generate` does not style on Projects, move the `.generate` rules from `studio.css` into `web/src/theme/controls.css` unchanged.

- [ ] **Step 6: Run and see them pass**

Run: `cd web && npx vitest run src/projects`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add web/src/projects/FilmCard.tsx web/src/projects/ProjectsScreen.tsx web/src/projects/projects.css web/src/projects/ProjectsScreen.test.tsx
# plus web/src/theme/controls.css and web/src/studio/studio.css if .generate moved
git diff --cached --stat
git commit -m "studio: Projects page with film cards, filters, search and sort

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Home, with the new-film box and recent films

**Files:**
- Create: `web/src/home/slug.ts`, `web/src/home/slug.test.ts`, `web/src/home/HomeScreen.tsx`, `web/src/home/home.css`, `web/src/home/HomeScreen.test.tsx`

- [ ] **Step 1: Write the failing slug tests**

```ts
// web/src/home/slug.test.ts
import { describe, test, expect } from "vitest";
import { filmSlug } from "./slug";

describe("filmSlug", () => {
  test("first four words, lowercase, hyphens", () => {
    expect(filmSlug("A slow, quiet rainy morning with coffee", [])).toBe("a-slow-quiet-rainy");
  });
  test("made unique against existing films", () => {
    expect(filmSlug("Boat at dawn", ["boat-at-dawn", "boat-at-dawn-2"])).toBe("boat-at-dawn-3");
  });
  test("nothing usable falls back to film", () => {
    expect(filmSlug("¿¡!", [])).toBe("film");
  });
});
```

- [ ] **Step 2: Run and see it fail, then write `slug.ts`**

Run: `cd web && npx vitest run src/home/slug.test.ts` and confirm it FAILS.

```ts
// web/src/home/slug.ts
// A run folder name from the film's first words: lowercase letters, digits
// and hyphens (the CLI's slug rule), unique among the films that exist.
export function filmSlug(text: string, taken: string[]): string {
  const base =
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9\s-]/g, "")
      .split(/[\s-]+/)
      .filter(Boolean)
      .slice(0, 4)
      .join("-")
      .slice(0, 60) || "film";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
```

Run again and confirm it PASSES (3 tests).

- [ ] **Step 3: Write the failing Home tests**

```tsx
// web/src/home/HomeScreen.test.tsx
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { HomeScreen } from "./HomeScreen";
import { routes } from "../test-fixtures";
import type { FilmSummary } from "../api/types";

const film = (run: string, modified: string): FilmSummary => ({ run, modified, files: 1, takes: 1, cover: null, progress: null });
const films = ["e", "d", "c", "b", "a"].map((r, i) => film(r, `2026-10-3${i}T10:00:00.000Z`)).reverse();
const menu = { menu: { filmTypes: [{ id: "live-action", label: "Live-action look" }, { id: "character", label: "Character animation" }] }, aspects: ["16:9", "9:16", "1:1", "21:9"], maxFilmS: 120 };

beforeEach(() => {
  window.location.hash = "";
});

describe("HomeScreen", () => {
  test("shows the four newest films and a link to all projects", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => films, "/api/director/menu": () => menu })));
    render(<HomeScreen />);
    const recent = await screen.findByRole("region", { name: "Recent films" });
    await waitFor(() => expect(within(recent).getAllByRole("article")).toHaveLength(4));
    expect(screen.getByRole("link", { name: "See all projects" })).toHaveAttribute("href", "#/projects");
  });

  test("Start film saves the brief under a slug from its words and opens it on Brief", async () => {
    const put = vi.fn(() => ({}));
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => [film("rain-on-glass", "2026-10-31T10:00:00.000Z")], "/api/director/menu": () => menu, "/api/films/rain-on-glass-2/brief": put })));
    render(<HomeScreen />);
    fireEvent.change(await screen.findByRole("textbox", { name: "What is the film about?" }), { target: { value: "Rain on glass, a cup going cold" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Length" }), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Start film" }));
    await waitFor(() => expect(window.location.hash).toBe("#/films/rain-on-glass-2/brief"));
    const body = JSON.parse(String((put.mock.calls[0] as unknown as [RequestInit])[0].body));
    expect(body).toEqual({ brief: { takeaway: "Rain on glass, a cup going cold", durationS: 8, aspectRatio: "16:9", filmType: "live-action" } });
  });

  test("Start film waits for words", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => [], "/api/director/menu": () => menu })));
    render(<HomeScreen />);
    expect(await screen.findByRole("button", { name: "Start film" })).toBeDisabled();
  });
});
```

The `routes` helper calls each handler with `init`, so `put.mock.calls[0][0]` is the `RequestInit`. `api()` sends `JSON.stringify(body)`, so the `JSON.parse` line reads it back.

- [ ] **Step 4: Run and see them fail**

Run: `cd web && npx vitest run src/home/HomeScreen.test.tsx`
Expected: FAIL (no module).

- [ ] **Step 5: Write `HomeScreen.tsx`**

```tsx
// web/src/home/HomeScreen.tsx
// Where you land: one box to start a film (its words become the brief's
// takeaway and its folder name), and your four most recent films.
import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { FilmSummary } from "../api/types";
import { filmHref } from "../app/route";
import { FilmCard } from "../projects/FilmCard";
import { filmSlug } from "./slug";
import "../projects/projects.css";
import "./home.css";

interface Menu {
  menu: { filmTypes: { id: string; label: string }[] };
  aspects: string[];
  maxFilmS: number;
}

const LENGTHS = [6, 8, 10, 15, 20, 30];

export function HomeScreen() {
  const [films, setFilms] = useState<FilmSummary[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [text, setText] = useState("");
  const [aspect, setAspect] = useState("16:9");
  const [length, setLength] = useState(15);
  const [type, setType] = useState("live-action");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<FilmSummary[]>("/api/films").then(setFilms).catch(() => {});
    api<Menu>("/api/director/menu").then(setMenu).catch(() => {});
  }, []);

  async function start() {
    const takeaway = text.trim();
    if (!takeaway || busy) return;
    setBusy(true);
    setError(null);
    const slug = filmSlug(takeaway, films.map((f) => f.run));
    try {
      await api(`/api/films/${slug}/brief`, { method: "PUT", body: { brief: { takeaway, durationS: length, aspectRatio: aspect, filmType: type } } });
      window.location.hash = filmHref(slug, "brief");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="home">
      <form
        className="home__start"
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        <h1 className="home__title">What are we making?</h1>
        <textarea
          className="home__text"
          aria-label="What is the film about?"
          placeholder="A 15-second film about… one or two sentences"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="home__chips">
          <select aria-label="Aspect ratio" value={aspect} onChange={(e) => setAspect(e.target.value)}>
            {(menu?.aspects ?? ["16:9", "9:16", "1:1", "21:9"]).map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <select aria-label="Length" value={length} onChange={(e) => setLength(Number(e.target.value))}>
            {LENGTHS.map((s) => (
              <option key={s} value={s}>
                {s}s
              </option>
            ))}
          </select>
          <select aria-label="Film type" value={type} onChange={(e) => setType(e.target.value)}>
            {(menu?.menu.filmTypes ?? [{ id: "live-action", label: "Live-action look" }]).map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <a className="home__preset" href="#/presets">
            Start from a preset
          </a>
          <button type="submit" className="generate home__go" disabled={!text.trim() || busy}>
            Start film
          </button>
        </div>
        {error && (
          <p className="home__error" role="alert">
            {error}
          </p>
        )}
      </form>

      {films.length > 0 && (
        <section className="home__recent" aria-labelledby="recent-h">
          <div className="home__recent-head">
            <h2 id="recent-h">Recent films</h2>
            <a href="#/projects">See all projects</a>
          </div>
          <div className="projects__grid">
            {films.slice(0, 4).map((f) => (
              <FilmCard key={f.run} film={f} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

`/api/films` comes back newest first (core's `listRuns` sorts by modified time). The test fixture is built newest first to match.

- [ ] **Step 6: Write `home.css`**

```css
/* web/src/home/home.css: the start box and recent films. Tokens only. */
.home { display: flex; flex-direction: column; gap: var(--space-6); max-width: 1100px; margin: 0 auto; padding-top: var(--space-6); }
.home__start { display: flex; flex-direction: column; gap: var(--space-3); width: min(720px, 100%); margin: 0 auto; }
.home__title { margin: 0 0 var(--space-2); text-align: center; font-size: 28px; font-weight: 600; }
.home__text {
  background: var(--surface-1); color: var(--text); border: 1px solid var(--line); border-radius: var(--radius-lg);
  padding: var(--space-4); font: inherit; font-size: var(--text-lg); resize: vertical;
}
.home__text:focus-visible { outline: 2px solid var(--text-2); outline-offset: 2px; }
.home__chips { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.home__chips select {
  background: var(--surface-2); color: var(--text); border: 1px solid var(--line); border-radius: 999px;
  padding: 5px var(--space-3); font: inherit; font-size: var(--text-sm);
}
.home__preset { color: var(--text-2); font-size: var(--text-sm); }
.home__go { margin-left: auto; }
.home__error { margin: 0; color: var(--bad-ink); }
.home__recent-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: var(--space-3); }
.home__recent-head h2 { margin: 0; font-size: var(--text-sm); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-2); font-weight: 500; }
.home__recent-head a { color: var(--text); font-size: var(--text-sm); }
```

- [ ] **Step 7: Run and see them pass**

Run: `cd web && npx vitest run src/home`
Expected: PASS, 6 tests.

- [ ] **Step 8: Commit**

```bash
git add web/src/home/slug.ts web/src/home/slug.test.ts web/src/home/HomeScreen.tsx web/src/home/home.css web/src/home/HomeScreen.test.tsx
git diff --cached --stat
git commit -m "studio: Home starts a film from one box and shows recent films

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Wire the shell: App, Create (takes only), redirects

**Files:**
- Modify: `web/src/app/App.tsx`, `web/src/app/App.css`, `web/src/app/App.test.tsx`
- Modify: `web/src/studio/StudioScreen.tsx`, `web/src/studio/StudioScreen.test.tsx`
- Delete: `web/src/films/FilmsScreen.tsx`, `web/src/films/FilmsScreen.test.tsx`

- [ ] **Step 1: Rewrite `App.test.tsx`**

```tsx
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import { routes } from "../test-fixtures";
import { resetChatForTests, openChat } from "../chat/chatStore";

beforeEach(() => {
  window.location.hash = "";
  localStorage.clear();
  resetChatForTests();
});

const pending = () => vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));

describe("App", () => {
  test("a rail of places, Home lit by default", () => {
    pending();
    render(<App />);
    expect(screen.getByRole("navigation", { name: "Studio" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "What are we making?" })).toBeInTheDocument();
  });

  test("each rail place shows its screen", () => {
    pending();
    window.location.hash = "#/presets";
    const a = render(<App />);
    expect(screen.getByRole("heading", { name: "Presets" })).toBeInTheDocument();
    a.unmount();
    window.location.hash = "#/projects";
    const b = render(<App />);
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    b.unmount();
    window.location.hash = "#/settings";
    render(<App />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  test("old hashes redirect: #/studio to Create, #/films to Projects", async () => {
    pending();
    window.location.hash = "#/studio";
    render(<App />);
    await waitFor(() => expect(window.location.hash).toBe("#/create"));
    expect(screen.getByRole("link", { name: "Create" })).toHaveAttribute("aria-current", "page");
  });

  test("inside a film, Projects is lit", () => {
    pending();
    window.location.hash = "#/films/zed/finish";
    render(<App />);
    expect(screen.getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
  });

  test("the chat drawer opens over any page and talks about the film you are in", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/chat-settings": () => ({ backend: null }) })));
    window.location.hash = "#/films/zed/finish";
    openChat();
    render(<App />);
    const drawer = await screen.findByRole("dialog", { name: "Chat drawer" });
    expect(drawer).toHaveTextContent("zed");
  });
});
```

Keep any other existing `App.test.tsx` tests that still apply, such as the offline banner, adapting their hashes. Delete the six-tab tests.

- [ ] **Step 2: Run and see it fail**

Run: `cd web && npx vitest run src/app/App.test.tsx`
Expected: FAIL (old App).

- [ ] **Step 3: Rewrite `App.tsx`**

```tsx
import { useEffect } from "react";
import { Rail } from "./Rail";
import { TopBar } from "./TopBar";
import { parseRoute, railItemFor, replaceHash, type Place } from "./route";
import { useRoute, useStudio } from "./useStudio";
import { HomeScreen } from "../home/HomeScreen";
import { ProjectsScreen } from "../projects/ProjectsScreen";
import { FilmWorkspace } from "../film/FilmWorkspace";
import { StudioScreen } from "../studio/StudioScreen";
import { LibraryScreen } from "../library/LibraryScreen";
import { PresetsScreen } from "../presets/PresetsScreen";
import { SpendScreen } from "../spend/SpendScreen";
import { SettingsScreen } from "../settings/SettingsScreen";
import { ChatDrawer } from "../chat/ChatDrawer";
import { useRun } from "../studio/promptStore";
import "./App.css";

const TITLES: Record<Exclude<Place["screen"], "film">, string> = {
  home: "Home",
  projects: "Projects",
  create: "Create",
  library: "Library",
  presets: "Presets",
  spend: "Spend",
  settings: "Settings",
};

function Screen({ place }: { place: Place }) {
  switch (place.screen) {
    case "home":
      return <HomeScreen />;
    case "projects":
      return <ProjectsScreen />;
    case "film":
      return <FilmWorkspace key={place.slug} slug={place.slug} step={place.step} />;
    case "create":
      return <StudioScreen />;
    case "library":
      return <LibraryScreen />;
    case "presets":
      return <PresetsScreen />;
    case "spend":
      return <SpendScreen />;
    case "settings":
      return <SettingsScreen />;
  }
}

export function App() {
  const route = parseRoute(useRoute());
  const { spend, online } = useStudio();
  const run = useRun();
  const redirect = "redirect" in route ? route.redirect : null;
  useEffect(() => {
    if (redirect) replaceHash(redirect);
  }, [redirect]);
  if ("redirect" in route) return null;

  const film = route.screen === "film" ? route.slug : run || null;
  return (
    <div className="app">
      <Rail current={railItemFor(route)} />
      <div className="app__col">
        <TopBar spend={spend}>
          {route.screen === "film" ? (
            <>
              <a href="#/projects">Projects</a> <span aria-hidden="true">/</span> <span className="mono">{route.slug}</span>
            </>
          ) : (
            TITLES[route.screen]
          )}
        </TopBar>
        {!online && (
          <div className="banner" role="alert">
            Studio server isn't running. Start it with <code className="mono">npm run studio</code>, and this page reconnects.
          </div>
        )}
        <main className="app__main" data-screen={route.screen}>
          <Screen place={route} />
        </main>
      </div>
      <ChatDrawer film={film} />
    </div>
  );
}
```

- [ ] **Step 4: Rewrite the shell part of `App.css`**

Replace the `.app`, `.app__top`, `.app__brand`, `.nav*` and `.app__main[data-tab="studio"]` rules and the 760px media block. Keep `.spend-meter*` and `.banner` unchanged.

```css
.app { display: grid; grid-template-columns: 76px minmax(0, 1fr); height: 100%; }
.app__col { display: flex; flex-direction: column; min-width: 0; min-height: 0; }

.rail {
  display: flex; flex-direction: column; align-items: center; gap: var(--space-1);
  padding: var(--space-3) 0; background: var(--surface-1); border-right: 1px solid var(--line);
}
.rail__brand { color: var(--text); font-weight: 700; text-decoration: none; padding: var(--space-2) 0 var(--space-3); }
.rail__item {
  display: flex; flex-direction: column; align-items: center; gap: 2px; width: 64px; padding: var(--space-2) 0;
  border: 0; border-radius: var(--radius-md); background: transparent; color: var(--text-2);
  font: inherit; font-size: var(--text-xs); text-decoration: none; cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}
.rail__item:hover { color: var(--text); background: var(--surface-2); }
.rail__item[aria-current="page"], .rail__item[aria-expanded="true"] { color: var(--text); background: var(--surface-3); }
.rail__gap { flex: 1; }

.topbar {
  display: flex; align-items: center; gap: var(--space-4); min-height: 48px;
  padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--line); background: var(--surface-1);
}
.topbar__where { font-weight: 600; color: var(--text); }
.topbar__where a { color: var(--text-2); text-decoration: none; font-weight: 400; }
.topbar__where a:hover { color: var(--text); }
.topbar__jobs {
  margin-left: auto; padding: 3px var(--space-3); border: 1px solid var(--line); border-radius: 999px;
  color: var(--text-2); font-size: var(--text-sm); text-decoration: none;
}
.topbar__jobs + .spend-meter { margin-left: 0; }

.app__main { flex: 1; min-height: 0; overflow-y: auto; padding: var(--space-5) var(--space-5) var(--space-5); }
/* Create scrolls its feed itself, so the prompt bar stays on screen. */
.app__main[data-screen="create"] { overflow: hidden; padding-top: var(--space-4); padding-bottom: var(--space-4); }

/* Narrow windows: the rail becomes a bottom bar. */
@media (max-width: 760px) {
  .app { grid-template-columns: 1fr; grid-template-rows: 1fr auto; }
  .rail { order: 2; flex-direction: row; overflow-x: auto; padding: var(--space-1); border-right: 0; border-top: 1px solid var(--line); }
  .rail__brand, .rail__gap { display: none; }
  .rail__item { width: auto; min-width: 56px; }
  .spend-meter__bar { width: 48px; }
}
```

- [ ] **Step 5: Make `StudioScreen` takes-only**

In `web/src/studio/StudioScreen.tsx`:
- Remove the imports of `ChatPanel`, `Storyboard`, `useBoard`.
- Remove the `board`/`view`/`outbox`/`shown` state and effects.
- Remove the `view-switch` group, the Storyboard branch and `<ChatPanel …/>`.

The component returns:

```tsx
<div className="studio">
  <div className="studio__main">
    <div className="studio__head">
      <FilmPicker runs={runs} run={run} onChange={setRun} />
    </div>
    <section className="feed" aria-label="Takes">…unchanged…</section>
    <PromptBar …unchanged… />
  </div>
  {open && <TakeViewer job={open} kinds={vocab.kinds} now={now} onClose={() => setOpenId(null)} />}
</div>
```

In `studio.css`, the `.studio` grid had a column for the chat. Make it one column: find `.studio {` and the `.studio--board` rules, set `grid-template-columns: minmax(0, 1fr)`, and delete the `.studio--board` rules.

In `StudioScreen.test.tsx`:
- Delete the test that finds `complementary` "Chat" (line ~56): the chat is the drawer now.
- Delete any storyboard/view-switch tests.
- Keep the feed and prompt tests.

- [ ] **Step 6: Delete FilmsScreen**

```bash
git rm web/src/films/FilmsScreen.tsx web/src/films/FilmsScreen.test.tsx
```

Grep for leftover imports with `grep -rn "FilmsScreen\|from \"./Nav\"\|TABS" web/src`. Expected: no matches.

- [ ] **Step 7: Run the whole page suite and the type check**

Run: `cd web && npx vitest run && npx tsc -b --noEmit`
Expected: every test PASSES and there are no type errors.

If `tsc -b` writes `web/tsconfig.tsbuildinfo`, delete it, and never stage it. If `--noEmit` is refused with `-b`, run `npx tsc -p tsconfig.json --noEmit` (or the app tsconfig the repo uses: check `web/tsconfig*.json`).

- [ ] **Step 8: Commit**

```bash
git add web/src/app/App.tsx web/src/app/App.css web/src/app/App.test.tsx web/src/studio/StudioScreen.tsx web/src/studio/StudioScreen.test.tsx web/src/studio/studio.css
git diff --cached --stat   # also shows the two FilmsScreen deletions
git commit -m "studio: the new shell: rail, top bar, chat drawer; Studio becomes Create

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Check it in the browser

**Files:** none changed unless a check fails.

- [ ] **Step 1: Build and start a studio on a spare port**

```bash
cd web && npx vite build && STUDIO_PORT=4330 node server/main.mjs --no-open
```

Run this in the background. The log prints the URL; never print the session key.

- [ ] **Step 2: Screenshot each place at 1440×900 and 1280×800**

Use the gstack browse binary `~/.claude/skills/gstack/browse/dist/browse`:
- `viewport 1440x900`
- `goto` each of `#/`, `#/projects`, `#/films/rainy-coffee`, `#/films/boat/shots`, `#/films/ctlt-test/references`, `#/create`, `#/library`
- Click Chat on the rail, then screenshot again.

Save to `/private/tmp/studio-shots/v2/`. Afterwards run `git checkout .gitignore` (browse appends `.gstack/`).

- [ ] **Step 3: Compare against wireframe frames 1, 1b and 7, and check**

- The rail is on every screen.
- Projects is lit inside a film.
- `#/films/rainy-coffee` lands on its current step.
- Old films ("takes only") open on Finish.
- `#/studio` lands on Create.
- The drawer opens and closes, Escape closes it, and focus returns to the Chat button.
- No console errors (`browse console`).

Fix anything that fails in a focused commit.

- [ ] **Step 4: Stop the server**

Kill whatever is listening on 4330 (`lsof -tiTCP:4330 -sTCP:LISTEN | xargs kill`). Leave Alex's own studio on 4317 alone.

---

## Self-review notes

- **Spec coverage, stage 1:** rail (T5), top bar (T5, T9), routes and redirects (T3, T9), chat drawer (T4, T9), `filmProgress` (T1, T2), Home (T8), Projects with filters, search, sort, grid/list and Show in Finder (T7, T2). Existing screens are mounted unchanged: Storyboard and FilmPage in the workspace (T6), Studio as Create (T9).
- **Out of this stage:** the step contents (Shots layout, Finish timeline, Brief card) are stage 2; References is stage 3; the Create and Library layouts are stage 4.
- **Step bar:** the spec put it in stage 2, but stage 1 needs it so that Projects' "Next" links land somewhere. Its contents are today's screens.
