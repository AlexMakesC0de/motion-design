# Director brain (build step 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code, Codex or the studio chat can turn an idea into a checked, priced shot plan with model-specific wording, spending nothing.

**Architecture:** A new shared core in `cli/director/` (menu data, brief and plan storage, checker, model picker, per-model wording, cost) used by two thin front ends: `kie brief` / `kie plan` in `cli/kie.mjs`, and nine MCP tools in `mcp/director.mjs` that the studio chat inherits automatically. Model knowledge stays in `cli/models.json` (`goodFor` ratings, `promptProfile` wording shapes); craft knowledge lives in a prose handbook under `skills/motion-design/references/director/`.

**Tech Stack:** Node 20 ES modules, `node:test`, zod 4 and `@modelcontextprotocol/sdk` 1.32 in `mcp/` only. No new dependencies.

**Spec:** [2026-10-31-director-design.md](../specs/2026-10-31-director-design.md), build order step 1.

**Verified before writing:** every code block below ran in a scratch worktree of `studio-web-app` at fccb2d9 with all suites green (root, `mcp`, `web` server). The golden strings are the real output.

---

## Ground rules for every task

- Branch `studio-web-app`. Never push. Never `git stash`. Stage explicit paths and run `git diff --cached --stat` before each commit; never stage `.gstack/` or `.gitignore`.
- Spend nothing: no `kie video/image/audio/upload` except with `--dry-run`. Every test here is free.
- No provider model id in skill prose (the handbook test enforces it). Model ids belong in `cli/models.json`, code and tests.
- Exit codes (`cli/lib/errors.mjs`): `usage()` is 1 (the caller's mistake), `unknown()` is 3 (not on a list). The director refuses a bad brief or plan with 1 and an unknown shot or menu id with 3.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (Sonnet agents: `Claude Sonnet 5.5`).

## File structure

| File | Responsibility |
|---|---|
| `cli/core/views.mjs` (modify) | Extract `planJob(catalog, req)`: model, route, call, price and problems with no store; `estimate` uses it |
| `cli/models.json` (modify) | `goodFor` on the three rated models, `promptProfile` on every video model |
| `cli/director/menu.json` | The fixed vocabulary: 13 groups, every entry with `id`, `label`, `when`, and `words` where it enters a prompt |
| `cli/director/menu.mjs` | `loadMenu`, `ids`, `entry` (refuses an unknown id, naming the valid ones), `GROUPS` |
| `cli/director/files.mjs` | `runs/<film>/brief.json` and `shots.json`: links refused, atomic O_NOFOLLOW writes, `.history/` |
| `cli/director/brief.mjs` | `validateBrief`, `readBrief`, `saveBrief` |
| `cli/director/fit.mjs` | `PAD_S`, `generatedLength`, `shotFit`, `stillFit` |
| `cli/director/pick.mjs` | `suggestModel`, `suggestStillModel` |
| `cli/director/wording.mjs` | `shotWording`: one shot in its model's prompt shape |
| `cli/director/check.mjs` | `checkPlan`: errors and warnings |
| `cli/director/plan.mjs` | `readPlan`, `findShot`, `fillSuggestions`, `savePlan`, `updateShot` |
| `cli/director/cost.mjs` | `costPlan` |
| `cli/director/show.mjs` | Text views shared by the CLI and MCP |
| `cli/kie.mjs` (modify) | `kie brief`, `kie plan` |
| `mcp/director.mjs` | `registerDirector`: nine free tools |
| `mcp/server.mjs` (modify) | Register them; one sentence in INSTRUCTIONS |
| `skills/motion-design/references/director/*.md` | The handbook: craft, four film types, brief |
| `skills/motion-design/SKILL.md`, `references/production.md`, `references/tool-routing.md` (modify) | The directed flow becomes the default |
| `cli/README.md`, `mcp/README.md` (modify) | Layout rows, a Director section, the tool table |

Tests: `tests/views.test.mjs` (append), `tests/director-{catalog,menu,store,pick,wording,check,plan,cli,handbook}.test.mjs`, `mcp/tests/director.test.mjs`, and the tool counts in `mcp/tests/{look,client}.test.mjs` and `web/tests/chat-{setup,openai}.test.mjs` (18 → 27).

---

### Task 1: `planJob`, a price with no spending state

The director prices whole plans, so it needs `estimate`'s model, route and price logic without the store and limits. Pure refactor plus a new export.

**Files:**
- Modify: `cli/core/views.mjs` (the `estimate` function)
- Test: `tests/views.test.mjs` (append)

- [ ] **Step 1: Write the failing test.** Append to `tests/views.test.mjs`:

```diff
diff --git a/tests/views.test.mjs b/tests/views.test.mjs
index 9ab3379..b21fbce 100644
--- a/tests/views.test.mjs
+++ b/tests/views.test.mjs
@@ -119,3 +119,21 @@ describe("doctor", () => {
     assert.ok(d.failures >= 1);
   });
 });
+
+describe("planJob prices a job without any spending state", () => {
+  test("the same price and problems as estimate, from the catalog alone", () => {
+    const p = views.planJob(catalog, seedance);
+    assert.equal(p.model.id, "seedance-2-5");
+    assert.equal(p.route.provider, "kie");
+    assert.equal(p.est.usd, views.estimate(catalog, seedance, { store, limits }).estimateUsd);
+    assert.deepEqual(p.problems, []);
+  });
+
+  test("a first frame picks the image-to-video call and checks its contract", () => {
+    const h3 = views.planJob(catalog, { model: "minimax-h3", capability: "video", durationS: 5, aspectRatio: "16:9", refs: [{ role: "first_frame" }] });
+    assert.notEqual(h3.call.model, h3.route.model, "the i2v call, not the text-to-video one");
+    assert.deepEqual(h3.problems, []);
+    const wan = views.planJob(catalog, { model: "wan-3-0", capability: "video", durationS: 5, refs: [{ role: "first_frame" }] });
+    assert.match(wan.problems.join(" "), /No captured contract/);
+  });
+});
```

- [ ] **Step 2: Run it and see it fail.** `node --test tests/views.test.mjs` → FAIL, `views.planJob is not a function`.

- [ ] **Step 3: Implement.** Apply this change to `cli/core/views.mjs`:

```diff
diff --git a/cli/core/views.mjs b/cli/core/views.mjs
index f9022b8..09bd77f 100644
--- a/cli/core/views.mjs
+++ b/cli/core/views.mjs
@@ -112,12 +112,12 @@ export function listPresets(catalog) {
 }
 
 /**
- * What a planned job would cost and whether the per-job budget, the per-job
- * ceiling and today's cap allow it. Reserves nothing and calls no provider. `refs` are checked by
- * role only; assets are not expanded here.
+ * A planned job without any spending state: the model, the route and call it
+ * would use, the price and every problem with the request. Reads no store or
+ * limits, so the director can price a whole plan with it.
  */
-export function estimate(catalog, req, { store, limits }) {
-  const { model: modelId, capability, durationS, resolution, aspectRatio, refs = [], params = {}, budgetUsd, provider } = req;
+export function planJob(catalog, req) {
+  const { model: modelId, capability, durationS, resolution, aspectRatio, refs = [], params = {}, provider } = req;
   const model = resolveModel(catalog, modelId, capability);
   const problems = model.capability === "video" ? validateVideoRequest(catalog, model, { durationS, aspectRatio, refs }) : [];
 
@@ -141,6 +141,17 @@ export function estimate(catalog, req, { store, limits }) {
   } else {
     problems.push(`No route for ${model.id}${provider ? ` via ${provider}` : ""}.`);
   }
+  return { model, route, call, est, problems };
+}
+
+/**
+ * What a planned job would cost and whether the per-job budget, the per-job
+ * ceiling and today's cap allow it. Reserves nothing and calls no provider. `refs` are checked by
+ * role only; assets are not expanded here.
+ */
+export function estimate(catalog, req, { store, limits }) {
+  const { budgetUsd } = req;
+  const { model, route, call, est, problems } = planJob(catalog, req);
 
   const cap = budgetUsd ?? catalog.defaultBudgetUsd?.[model.capability] ?? null;
   const pos = dailyPosition(store, limits);
```

- [ ] **Step 4: Run.** `node --test tests/views.test.mjs` → all pass (13).

- [ ] **Step 5: Commit.**

```bash
git add cli/core/views.mjs tests/views.test.mjs
git diff --cached --stat
git commit -m "views: extract planJob, a price with no spending state"
```

---

### Task 2: Alex's ratings and prompt profiles in `models.json`

`goodFor` mirrors the "Which model for which job" table in `tool-routing.md` (Kling 4.0 Flash has no catalog id and is skipped). `promptProfile` tells the translator which prompt shape, length limit and audio-off param each video model has. Only Seedance 2.5's contract declares `generate_audio`, so it is the only one with `audioOff`.

**Files:**
- Modify: `cli/models.json` (one or two lines after each video model's `"capability"` line)
- Modify: `skills/motion-design/references/tool-routing.md` (one paragraph after the table)
- Test: `tests/director-catalog.test.mjs`

- [ ] **Step 1: Write the failing test** `tests/director-catalog.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCatalog } from "../cli/lib/models.mjs";

const catalog = loadCatalog();
const routing = readFileSync(new URL("../skills/motion-design/references/tool-routing.md", import.meta.url), "utf8");
// The table's job labels and the goodFor keys they become.
const JOB_KEYS = {
  "Motion graphics": "motion-graphics",
  Cinematic: "cinematic",
  "Working from reference images": "reference-images",
  "UGC-style footage": "ugc",
  "Lip sync": "lip-sync",
  "Text to video": "text-to-video",
  "Video edit": "video-edit",
  Animation: "animation",
};

/** { modelId: { jobKey: tier } } from the "Which model for which job" table; names without a catalog id are skipped. */
function tableRatings() {
  const out = {};
  const section = routing.slice(routing.indexOf("## Which model for which job"));
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 5 || !(cells[1] in JOB_KEYS)) continue;
    for (const [tier, cell] of [["S", cells[2]], ["A", cells[3]]]) {
      for (const [, id] of cell.matchAll(/`([a-z0-9-]+)`/g)) (out[id] ??= {})[JOB_KEYS[cells[1]]] = tier;
    }
  }
  return out;
}

describe("Alex's ratings in models.json", () => {
  test("goodFor matches the table in tool-routing.md exactly", () => {
    const fromData = Object.fromEntries(catalog.list.filter((m) => m.goodFor).map((m) => [m.id, m.goodFor]));
    assert.deepEqual(fromData, tableRatings());
  });

  test("every tier is S or A and every rated model is a video model", () => {
    for (const m of catalog.list.filter((x) => x.goodFor)) {
      assert.equal(m.capability, "video", m.id);
      for (const t of Object.values(m.goodFor)) assert.ok(t === "S" || t === "A", `${m.id}: ${t}`);
    }
  });
});

describe("prompt profiles", () => {
  test("every video model has one, with a known family", () => {
    for (const m of catalog.list.filter((x) => x.capability === "video")) {
      assert.ok(m.promptProfile, `${m.id} has a promptProfile`);
      assert.ok(["seedance", "hailuo", "kling", "wan", "veo"].includes(m.promptProfile.family), m.id);
      assert.ok(m.promptProfile.maxChars === null || m.promptProfile.maxChars > 0, m.id);
    }
  });

  test("an audio-off switch names a param the route declares", () => {
    for (const m of catalog.list.filter((x) => x.promptProfile?.audioOff)) {
      const { param } = m.promptProfile.audioOff;
      assert.ok(m.routes.some((r) => r.input?.params?.[param]), `${m.id} declares ${param}`);
    }
  });
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test tests/director-catalog.test.mjs` → FAIL (`{}` vs the table; no promptProfile).

- [ ] **Step 3: Implement.** Edit `cli/models.json` by hand, keeping its layout (it is not `JSON.stringify` output, so do not rewrite the file):

```diff
diff --git a/cli/models.json b/cli/models.json
index 9b30f50..a4613d0 100644
--- a/cli/models.json
+++ b/cli/models.json
@@ -95,6 +95,8 @@
   "models": {
     "minimax-h3": {
       "capability": "video",
+      "goodFor": {"motion-graphics": "S"},
+      "promptProfile": {"family": "hailuo", "maxChars": 2000, "audioOff": null},
       "durationsS": [
         3,
         4,
@@ -276,6 +278,7 @@
     },
     "minimax-h3-max": {
       "capability": "video",
+      "promptProfile": {"family": "hailuo", "maxChars": 2000, "audioOff": null},
       "durationsS": [
         6,
         10
@@ -306,6 +309,7 @@
     },
     "seedance-2": {
       "capability": "video",
+      "promptProfile": {"family": "seedance", "maxChars": 6000, "audioOff": null},
       "durationsS": [
         4,
         5,
@@ -419,6 +423,7 @@
     },
     "seedance-2-fast": {
       "capability": "video",
+      "promptProfile": {"family": "seedance", "maxChars": 6000, "audioOff": null},
       "durationsS": [
         4,
         5,
@@ -514,6 +519,8 @@
     },
     "seedance-2-5": {
       "capability": "video",
+      "goodFor": {"cinematic": "S", "reference-images": "S", "lip-sync": "S", "text-to-video": "A", "video-edit": "A", "animation": "A"},
+      "promptProfile": {"family": "seedance", "maxChars": 6000, "audioOff": {"param": "generate_audio", "value": false}},
       "durationsS": [
         4,
         5,
@@ -707,6 +714,7 @@
     },
     "kling-3-0": {
       "capability": "video",
+      "promptProfile": {"family": "kling", "maxChars": 2500, "audioOff": null},
       "durationsS": [
         5,
         10
@@ -746,6 +754,7 @@
     },
     "wan-2-6": {
       "capability": "video",
+      "promptProfile": {"family": "wan", "maxChars": 1500, "audioOff": null},
       "durationsS": [
         5,
         10,
@@ -808,6 +817,8 @@
     },
     "wan-3-0": {
       "capability": "video",
+      "goodFor": {"reference-images": "A", "ugc": "S", "lip-sync": "A", "video-edit": "A"},
+      "promptProfile": {"family": "wan", "maxChars": 20000, "audioOff": null},
       "durationsS": [
         5,
         10
@@ -847,6 +858,7 @@
     },
     "veo-3-1": {
       "capability": "video",
+      "promptProfile": {"family": "veo", "maxChars": null, "audioOff": null},
       "durationsS": [
         8
       ],
```

And in `tool-routing.md`:

```diff
diff --git a/skills/motion-design/references/tool-routing.md b/skills/motion-design/references/tool-routing.md
index d38548c..86716bb 100644
--- a/skills/motion-design/references/tool-routing.md
+++ b/skills/motion-design/references/tool-routing.md
@@ -79,6 +79,10 @@ costs, and an explicit user choice always wins.
 | Video edit | | `seedance-2-5`, `wan-3-0` |
 | Animation | | `seedance-2-5`, Kling 4.0 Flash |
 
+The same ratings live in `models.json` as `goodFor`, where the director's model
+picker reads them (`kie plan --suggest`); a test fails if the two disagree, so
+change both together.
+
 When the user has not chosen a model, start from the S-tier entry for the job
 and say why; drop to an A-tier entry when it is the cheaper or the only one
 that fits the duration, ratio or references (read the price from
```

- [ ] **Step 4: Run.** `node --test tests/director-catalog.test.mjs` → 4 pass. `npm test` → still green (the catalog tests read the same file).

- [ ] **Step 5: Commit.**

```bash
git add cli/models.json skills/motion-design/references/tool-routing.md tests/director-catalog.test.mjs
git diff --cached --stat
git commit -m "models: goodFor ratings and promptProfile wording shapes"
```

---

### Task 3: The menu

**Files:**
- Create: `cli/director/menu.json`, `cli/director/menu.mjs`
- Test: `tests/director-menu.test.mjs`

- [ ] **Step 1: Write the failing test** `tests/director-menu.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { EXIT } from "../cli/lib/errors.mjs";
import { loadMenu, ids, entry, GROUPS } from "../cli/director/menu.mjs";

const menu = loadMenu();

describe("the director's menu", () => {
  test("has every group, each entry with an id, a label and when to use it", () => {
    for (const g of GROUPS) {
      assert.ok(Array.isArray(menu[g]) && menu[g].length, g);
      for (const e of menu[g]) {
        assert.match(e.id, /^[a-z0-9][a-z0-9-]*$/, `${g}: ${e.id}`);
        assert.ok(e.label && e.when, `${g}/${e.id} has a label and a when`);
      }
      assert.equal(new Set(ids(menu, g)).size, menu[g].length, `${g} ids are unique`);
    }
  });

  test("the sizes, angles, lenses, moves, lights and cuts the spec names", () => {
    assert.equal(menu.sizes.length, 9);
    assert.equal(menu.angles.length, 8);
    assert.deepEqual(ids(menu, "lenses"), ["14mm", "24mm", "35mm", "50mm", "85mm", "135mm", "100mm-macro"]);
    assert.deepEqual(ids(menu, "speeds"), ["slow", "medium", "fast"]);
    assert.equal(menu.lights.length, 9);
    assert.deepEqual(ids(menu, "cuts"), ["hard", "on-action", "match", "whip", "dissolve", "continuous"]);
    assert.deepEqual(ids(menu, "filmTypes"), ["product-ui", "live-action", "character", "product-hero"]);
  });

  test("every entry that goes into a prompt has words; every move has a hailuo bracket or null", () => {
    for (const g of ["sizes", "angles", "lenses", "lensLooks", "depths", "moves", "speeds", "lights", "screenDirections"]) {
      for (const e of menu[g]) assert.equal(typeof e.words, "string", `${g}/${e.id}`);
    }
    for (const m of menu.moves) assert.ok(m.hailuo === null || /^\[.+\]$/.test(m.hailuo), m.id);
  });

  test("entry refuses an id that is not on the menu and names the valid ones", () => {
    assert.equal(entry(menu, "sizes", "wide").label, "Wide");
    assert.throws(() => entry(menu, "sizes", "huge"), (e) => e.code === EXIT.UNKNOWN && /extreme-wide, wide/.test(e.message));
  });
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test tests/director-menu.test.mjs` → FAIL, cannot find `cli/director/menu.mjs`.

- [ ] **Step 3: Implement.** `cli/director/menu.mjs`:

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unknown } from "../lib/errors.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const MENU_PATH = join(HERE, "menu.json");

/** The groups a plan picks from, in the order the menu is shown. */
export const GROUPS = [
  "sizes", "angles", "lenses", "lensLooks", "depths", "moves", "speeds",
  "lights", "cuts", "screenDirections", "keyLightSides", "jobs", "filmTypes",
];

let cache = null;

export function loadMenu(path = MENU_PATH) {
  if (cache && path === MENU_PATH) return cache;
  const menu = JSON.parse(readFileSync(path, "utf8"));
  if (path === MENU_PATH) cache = menu;
  return menu;
}

/** The ids of one group, in menu order. */
export const ids = (menu, group) => (menu[group] ?? []).map((e) => e.id);

/** One entry. Refuses an id the menu does not have, naming the ones it does. */
export function entry(menu, group, id) {
  const hit = (menu[group] ?? []).find((e) => e.id === id);
  if (!hit) throw unknown(`"${id}" is not on the director's ${group} menu. Choose one of: ${ids(menu, group).join(", ")}.`);
  return hit;
}
```

`cli/director/menu.json` (exact content; the wording tests in Task 6 depend on these `words`):

```json
{
  "_comment": "The director's fixed menu. Every shot in a plan picks from these ids; the checker refuses anything else. `words` is how a prompt says it; `hailuo` is MiniMax Hailuo's bracket command where one exists. The craft behind each entry is in skills/motion-design/references/director/craft.md.",
  "sizes": [
    { "id": "extreme-wide", "label": "Extreme wide", "words": "extreme wide shot", "when": "Show the whole world and how small the subject is in it; opens a film or a new place." },
    { "id": "wide", "label": "Wide", "words": "wide shot", "when": "Establish the place and where everyone is before going closer." },
    { "id": "full", "label": "Full", "words": "full shot", "when": "The whole body, head to toe; movement, posture and costume." },
    { "id": "medium-wide", "label": "Medium wide", "words": "medium wide shot", "when": "Knees up; a person and what their hands and surroundings are doing." },
    { "id": "medium", "label": "Medium", "words": "medium shot", "when": "Waist up; the neutral conversational shot." },
    { "id": "medium-close-up", "label": "Medium close-up", "words": "medium close-up", "when": "Chest up; reactions while keeping a little context." },
    { "id": "close-up", "label": "Close-up", "words": "close-up", "when": "The face or the object fills the frame; emotion and decisions." },
    { "id": "extreme-close-up", "label": "Extreme close-up", "words": "extreme close-up", "when": "An eye, a fingertip, a texture; maximum intensity, used sparingly." },
    { "id": "insert", "label": "Insert", "words": "insert shot", "when": "A detail the viewer must read: a screen, a button, a label." }
  ],
  "angles": [
    { "id": "eye-level", "label": "Eye level", "words": "eye-level angle", "when": "Neutral and honest; the default." },
    { "id": "high", "label": "High", "words": "high angle", "when": "Looking down makes the subject smaller or overwhelmed." },
    { "id": "low", "label": "Low", "words": "low angle", "when": "Looking up makes the subject powerful or heroic." },
    { "id": "overhead", "label": "Overhead", "words": "overhead top-down angle", "when": "Straight down; desks, layouts, screens treated as graphics." },
    { "id": "worms-eye", "label": "Worm's eye", "words": "worm's-eye angle", "when": "From the floor; scale and drama." },
    { "id": "dutch", "label": "Dutch", "words": "dutch angle", "when": "A tilted horizon for unease or energy; rarely, never twice in a row." },
    { "id": "over-the-shoulder", "label": "Over the shoulder", "words": "over-the-shoulder angle", "when": "Past one person to another person or a screen; puts the viewer in the scene." },
    { "id": "point-of-view", "label": "Point of view", "words": "point-of-view angle", "when": "What the subject sees." }
  ],
  "lenses": [
    { "id": "14mm", "label": "14mm ultra-wide", "words": "14mm ultra-wide lens", "when": "Exaggerated space for tight interiors and energy; never on a face up close." },
    { "id": "24mm", "label": "24mm wide", "words": "24mm wide lens", "when": "Roomy and close at once; establishing shots and moving through space." },
    { "id": "35mm", "label": "35mm", "words": "35mm lens", "when": "Natural and documentary; the storyteller's all-rounder." },
    { "id": "50mm", "label": "50mm", "words": "50mm lens", "when": "Close to how the eye sees; honest medium shots." },
    { "id": "85mm", "label": "85mm portrait", "words": "85mm portrait lens", "when": "Flatters faces and melts the background; close-ups." },
    { "id": "135mm", "label": "135mm telephoto", "words": "135mm telephoto lens", "when": "Compresses the background and isolates; watching from afar." },
    { "id": "100mm-macro", "label": "100mm macro", "words": "100mm macro lens", "when": "Tiny details large and sharp; textures, product surfaces, UI pixels." }
  ],
  "lensLooks": [
    { "id": "spherical", "label": "Clean spherical", "words": "clean spherical", "when": "A clean modern look with round bokeh." },
    { "id": "anamorphic", "label": "Anamorphic", "words": "anamorphic", "when": "A cinematic widescreen feel with oval bokeh and horizontal flares." }
  ],
  "depths": [
    { "id": "shallow", "label": "Shallow (f/1.4-2)", "words": "shallow depth of field", "when": "One plane sharp, the rest soft; isolates the subject." },
    { "id": "medium", "label": "Medium (f/4)", "words": "moderate depth of field", "when": "Subject sharp with readable surroundings." },
    { "id": "deep", "label": "Deep (f/8-11)", "words": "deep focus", "when": "Everything sharp; wide shots and graphic layouts." }
  ],
  "moves": [
    { "id": "static", "label": "Static", "words": "holds still", "hailuo": "[Static shot]", "when": "Let the action or the composition do the work." },
    { "id": "push-in", "label": "Push in", "words": "pushes in", "hailuo": "[Push in]", "when": "Move toward the subject to build attention or a realisation." },
    { "id": "pull-out", "label": "Pull out", "words": "pulls out", "hailuo": "[Pull out]", "when": "Move away to reveal context or close a scene." },
    { "id": "pan-left", "label": "Pan left", "words": "pans left", "hailuo": "[Pan left]", "when": "Turn on the spot to follow or reveal sideways." },
    { "id": "pan-right", "label": "Pan right", "words": "pans right", "hailuo": "[Pan right]", "when": "Turn on the spot to follow or reveal sideways." },
    { "id": "tilt-up", "label": "Tilt up", "words": "tilts up", "hailuo": "[Tilt up]", "when": "Reveal height or lift the mood." },
    { "id": "tilt-down", "label": "Tilt down", "words": "tilts down", "hailuo": "[Tilt down]", "when": "Bring the eye down to what matters." },
    { "id": "truck-left", "label": "Truck left", "words": "trucks left", "hailuo": "[Truck left]", "when": "Slide sideways alongside the action for parallax." },
    { "id": "truck-right", "label": "Truck right", "words": "trucks right", "hailuo": "[Truck right]", "when": "Slide sideways alongside the action for parallax." },
    { "id": "pedestal-up", "label": "Pedestal up", "words": "rises straight up", "hailuo": "[Pedestal up]", "when": "Lift without tilting to reveal over an object." },
    { "id": "pedestal-down", "label": "Pedestal down", "words": "lowers straight down", "hailuo": "[Pedestal down]", "when": "Sink without tilting to land on a detail." },
    { "id": "follow", "label": "Follow", "words": "follows the subject", "hailuo": "[Tracking shot]", "when": "Stay with a moving subject at a constant distance." },
    { "id": "orbit-left", "label": "Orbit left", "words": "orbits left around the subject", "hailuo": null, "when": "Circle the subject to show it in the round; keep the arc under 45 degrees." },
    { "id": "orbit-right", "label": "Orbit right", "words": "orbits right around the subject", "hailuo": null, "when": "Circle the subject to show it in the round; keep the arc under 45 degrees." },
    { "id": "crane-up", "label": "Crane up", "words": "cranes up and over the scene", "hailuo": null, "when": "A big rising move for openings and endings." },
    { "id": "crane-down", "label": "Crane down", "words": "cranes down into the scene", "hailuo": null, "when": "Descend into the scene from above." },
    { "id": "handheld", "label": "Handheld", "words": "moves handheld with a slight natural shake", "hailuo": "[Shake]", "when": "Immediacy: creator footage, documentary." },
    { "id": "zoom-in", "label": "Zoom in", "words": "zooms in", "hailuo": "[Zoom in]", "when": "Magnify without moving; a flat, deliberate emphasis." },
    { "id": "zoom-out", "label": "Zoom out", "words": "zooms out", "hailuo": "[Zoom out]", "when": "Shrink the view without moving." },
    { "id": "rack-focus", "label": "Rack focus", "words": "racks focus from the foreground to the background", "hailuo": null, "when": "Shift attention between two planes without moving." }
  ],
  "speeds": [
    { "id": "slow", "label": "Slow", "words": "slowly", "when": "Calm, premium, contemplative." },
    { "id": "medium", "label": "Medium", "words": "steadily", "when": "Purposeful and neutral." },
    { "id": "fast", "label": "Fast", "words": "quickly", "when": "Energy and urgency; needs room, so not in short shots." }
  ],
  "lights": [
    { "id": "soft-high-key", "label": "Soft high key", "words": "soft, even high-key light", "when": "Bright and friendly with little shadow; tech and lifestyle." },
    { "id": "low-key", "label": "Low key", "words": "moody low-key light with deep shadows", "when": "Drama, night, mystery." },
    { "id": "rembrandt", "label": "Rembrandt", "words": "Rembrandt lighting with a triangle of light on the shadow cheek", "when": "Classic portrait depth for faces." },
    { "id": "backlit-rim", "label": "Backlit rim", "words": "backlight that rims the subject in light", "when": "Separates the subject from the background; silhouettes and hair light." },
    { "id": "golden-hour", "label": "Golden hour", "words": "warm, low golden-hour sunlight", "when": "Warmth, nostalgia, hope." },
    { "id": "night-practicals", "label": "Night with practicals", "words": "night scene lit by practical lamps and screens", "when": "Lamps, signs and screens in frame are the light." },
    { "id": "studio-product", "label": "Studio product", "words": "studio product lighting with a large softbox and a rim light", "when": "Clean reflections and crisp edges on products." },
    { "id": "neon", "label": "Neon", "words": "saturated neon colour light", "when": "Nightlife, gaming, energy." },
    { "id": "overcast", "label": "Overcast natural", "words": "soft overcast daylight", "when": "Natural and gentle with no hard shadows." }
  ],
  "cuts": [
    { "id": "hard", "label": "Hard cut", "words": "hard cut", "when": "The default change of view." },
    { "id": "on-action", "label": "Cut on action", "words": "cut on action", "when": "Cut mid-movement so the motion hides the edit." },
    { "id": "match", "label": "Match cut", "words": "match cut", "when": "A shape or motion here matches one in the next shot." },
    { "id": "whip", "label": "Whip pan", "words": "whip pan", "when": "A fast blur carries the energy into the next shot." },
    { "id": "dissolve", "label": "Dissolve", "words": "dissolve", "when": "Time passes, or a soft change of mood." },
    { "id": "continuous", "label": "Continuous", "words": "continuous", "when": "The next shot starts on this shot's last frame: one unbroken moment." }
  ],
  "screenDirections": [
    { "id": "left-to-right", "label": "Left to right", "words": "moving left to right", "when": "Forward, progress, arriving." },
    { "id": "right-to-left", "label": "Right to left", "words": "moving right to left", "when": "Returning, resisting, leaving." },
    { "id": "toward-camera", "label": "Toward camera", "words": "moving toward the camera", "when": "Confrontation or arrival." },
    { "id": "away-from-camera", "label": "Away from camera", "words": "moving away from the camera", "when": "Departure or discovery ahead." },
    { "id": "none", "label": "None", "words": "", "when": "Nothing travels across the frame." }
  ],
  "keyLightSides": [
    { "id": "left", "label": "Left", "words": "left", "when": "Key light from frame left." },
    { "id": "right", "label": "Right", "words": "right", "when": "Key light from frame right." },
    { "id": "front", "label": "Front", "words": "front", "when": "Flat and even; graphics and beauty." },
    { "id": "back", "label": "Back", "words": "back", "when": "Silhouettes and rims." },
    { "id": "top", "label": "Top", "words": "top", "when": "Overhead light; product tables and drama." }
  ],
  "jobs": [
    { "id": "motion-graphics", "label": "Motion graphics", "when": "Type, UI and abstract graphic motion." },
    { "id": "cinematic", "label": "Cinematic", "when": "Live-action-looking scenes with people and places." },
    { "id": "reference-images", "label": "Working from reference images", "when": "A Library character or product must match its sheet." },
    { "id": "ugc", "label": "UGC-style footage", "when": "Phone-camera, creator-style footage." },
    { "id": "lip-sync", "label": "Lip sync", "when": "Someone speaks a line on camera." },
    { "id": "animation", "label": "Animation", "when": "Stylised or 3D character animation." },
    { "id": "product-hero", "label": "Product hero", "ratings": "cinematic", "when": "Physical products on turntables, in macro and under light sweeps." }
  ],
  "filmTypes": [
    { "id": "product-ui", "label": "Product ad with UI", "chapter": "product-ui.md", "when": "App screens, a mascot, kinetic type and an end card." },
    { "id": "live-action", "label": "Live-action look", "chapter": "live-action.md", "when": "Real-looking people and places." },
    { "id": "character", "label": "Character animation", "chapter": "character.md", "when": "Stylised or 3D characters acting out a short story." },
    { "id": "product-hero", "label": "Product hero", "chapter": "product-hero.md", "when": "A physical product shown at its best." }
  ]
}
```

- [ ] **Step 4: Run.** `node --test tests/director-menu.test.mjs` → 4 pass.

- [ ] **Step 5: Commit.**

```bash
git add cli/director/menu.json cli/director/menu.mjs tests/director-menu.test.mjs
git diff --cached --stat
git commit -m "director: the menu of sizes, angles, lenses, moves, lights and cuts"
```

---

### Task 4: Film files and the brief

`files.mjs` follows `web/server/chat/transcript.mjs`'s `chatPath`: the film folder must be a real folder inside `runs/`, a link (even a dangling one) is refused, and writes go to a temp file opened with `O_NOFOLLOW`, then a rename. The replaced version is copied to `runs/<film>/.history/<stamp>/` first, with `-2`, `-3` suffixes when two saves share an instant.

**Files:**
- Create: `cli/director/files.mjs`, `cli/director/brief.mjs`
- Test: `tests/director-store.test.mjs`

- [ ] **Step 1: Write the failing test** `tests/director-store.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "kie-director-store-")));
const RUNS = join(tmp, "runs");
process.env.KIE_RUNS_DIR = RUNS;
mkdirSync(RUNS, { recursive: true });

const { EXIT } = await import("../cli/lib/errors.mjs");
const { filmFile, readFilmJson, writeFilmJson } = await import("../cli/director/files.mjs");
const { validateBrief, readBrief, saveBrief } = await import("../cli/director/brief.mjs");

const brief = { takeaway: "Calm mornings", durationS: 10, aspectRatio: "16:9", filmType: "live-action" };
let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 31, 12, 0, clock++));

describe("film files", () => {
  test("only brief.json and shots.json, and a missing film reads as null", () => {
    assert.throws(() => filmFile("f1", "chat.jsonl"), { code: EXIT.USAGE });
    assert.equal(readFilmJson("nope", "brief.json"), null);
    assert.equal(existsSync(join(RUNS, "nope")), false, "reading makes no folder");
  });

  test("writes atomically and keeps the replaced version in .history", () => {
    writeFilmJson("f1", "brief.json", { v: 1 }, { now });
    writeFilmJson("f1", "brief.json", { v: 2 }, { now });
    assert.deepEqual(readFilmJson("f1", "brief.json"), { v: 2 });
    const hist = readdirSync(join(RUNS, "f1", ".history"));
    assert.equal(hist.length, 1);
    assert.deepEqual(JSON.parse(readFileSync(join(RUNS, "f1", ".history", hist[0], "brief.json"), "utf8")), { v: 1 });
    assert.equal(existsSync(join(RUNS, "f1", "brief.json.tmp")), false);
  });

  test("two saves in the same instant keep both old versions", () => {
    const fixed = () => new Date(Date.UTC(2026, 0, 1));
    writeFilmJson("f2", "brief.json", { v: 1 }, { now: fixed });
    writeFilmJson("f2", "brief.json", { v: 2 }, { now: fixed });
    writeFilmJson("f2", "brief.json", { v: 3 }, { now: fixed });
    assert.equal(readdirSync(join(RUNS, "f2", ".history")).length, 2);
  });

  test("refuses a film folder or a file that is a link", () => {
    mkdirSync(join(tmp, "elsewhere"));
    symlinkSync(join(tmp, "elsewhere"), join(RUNS, "linked"));
    assert.throws(() => writeFilmJson("linked", "brief.json", {}), { code: EXIT.UNKNOWN, message: /runs\/linked is a link/ });
    mkdirSync(join(RUNS, "f3"));
    symlinkSync(join(tmp, "missing.json"), join(RUNS, "f3", "shots.json"));
    assert.throws(() => writeFilmJson("f3", "shots.json", {}), { message: /runs\/f3\/shots\.json is a link/ });
    assert.equal(existsSync(join(tmp, "missing.json")), false, "nothing written through the dangling link");
  });

  test("a file that is not JSON is reported, not swallowed", () => {
    mkdirSync(join(RUNS, "f4"));
    writeFileSync(join(RUNS, "f4", "shots.json"), "{ nope");
    assert.throws(() => readFilmJson("f4", "shots.json"), /runs\/f4\/shots\.json is not valid JSON/);
  });
});

describe("the brief", () => {
  test("a sound brief has no problems; every bad field is named", () => {
    assert.deepEqual(validateBrief(brief), []);
    assert.deepEqual(validateBrief({ durationS: 200, aspectRatio: "2:1", filmType: "vlog", tone: "", mustShow: "x", sound: { bass: "y" }, extra: 1 }), [
      'The brief has no field "extra". Fields: takeaway, audience, durationS, aspectRatio, tone, mustShow, copy, sound, filmType.',
      "takeaway is missing: the one thing the viewer should leave with.",
      "durationS must be whole seconds from 1 to 120.",
      "aspectRatio must be one of: 16:9, 9:16, 1:1, 4:5, 21:9.",
      "filmType must be one of: product-ui, live-action, character, product-hero.",
      "tone must be a sentence, or left out.",
      "mustShow must be a list of short lines.",
      'sound has no field "bass". Fields: music, voice, sfx.',
    ]);
  });

  test("saveBrief refuses a bad brief with code 1 and writes nothing", () => {
    assert.throws(() => saveBrief("b1", { takeaway: "x" }), { code: EXIT.USAGE, message: /^The brief was not saved:/ });
    assert.equal(readBrief("b1"), null);
    saveBrief("b1", brief, { now });
    assert.deepEqual(readBrief("b1"), brief);
  });
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test tests/director-store.test.mjs` → FAIL, module not found.

- [ ] **Step 3: Implement** `cli/director/files.mjs`:

```js
import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeSync } from "node:fs";
import { join, sep } from "node:path";
import { RUNS_DIR, runDir } from "../lib/run.mjs";
import { unknown, usage } from "../lib/errors.mjs";

/** The director's files in a film folder. Anything else is refused. */
export const FILM_FILES = ["brief.json", "shots.json"];

const linked = (film, what) => unknown(`runs/${film}${what} is a link; the director only writes plain files in a film.`);

/**
 * runs/<film>/<name>. The film must be a real folder inside runs/ (not a
 * link) and the file must not be a link, even a dangling one, so a write can
 * never land outside the film. With `create`, a missing film folder is made.
 */
export function filmFile(film, name, { create = false } = {}) {
  if (!FILM_FILES.includes(name)) throw usage(`The director keeps ${FILM_FILES.join(" and ")}, not ${name}.`);
  const dir = runDir(film, { create: false });
  const d = lstatSync(dir, { throwIfNoEntry: false });
  if (d && (d.isSymbolicLink() || !d.isDirectory())) throw linked(film, "");
  if (!d && create) runDir(film, { create: true });
  if (d || create) {
    const root = realpathSync(RUNS_DIR);
    if (!realpathSync(dir).startsWith(root + sep)) throw linked(film, "");
  }
  const file = join(dir, name);
  if (lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) throw linked(film, `/${name}`);
  return file;
}

/** The parsed file, or null when the film or the file does not exist yet. A file that is not JSON is an error. */
export function readFilmJson(film, name) {
  const file = filmFile(film, name);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw unknown(`runs/${film}/${name} is not valid JSON. Fix it by hand or save it again.`);
  }
}

/**
 * Write atomically: a temp file opened with O_NOFOLLOW, then a rename. The
 * version being replaced is copied first to runs/<film>/.history/<stamp>/,
 * as the Library keeps old assets. Returns the path written.
 */
export function writeFilmJson(film, name, data, { now = () => new Date() } = {}) {
  const file = filmFile(film, name, { create: true });
  const dir = runDir(film, { create: false });
  if (existsSync(file)) {
    if (lstatSync(join(dir, ".history"), { throwIfNoEntry: false })?.isSymbolicLink()) throw linked(film, "/.history");
    const stamp = now().toISOString().replace(/[:.]/g, "-");
    let hist = join(dir, ".history", stamp);
    for (let n = 2; existsSync(join(hist, name)); n += 1) hist = join(dir, ".history", `${stamp}-${n}`);
    mkdirSync(hist, { recursive: true });
    writeNoFollow(join(hist, name), readFileSync(file));
  }
  const tmp = `${file}.tmp`;
  writeNoFollow(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, file);
  return file;
}

function writeNoFollow(path, body) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644);
  try {
    writeSync(fd, body);
  } finally {
    closeSync(fd);
  }
}
```

and `cli/director/brief.mjs`:

```js
import { usage } from "../lib/errors.mjs";
import { loadMenu, ids } from "./menu.mjs";
import { readFilmJson, writeFilmJson } from "./files.mjs";

/** The frame shapes a film can be cut in. */
export const ASPECTS = ["16:9", "9:16", "1:1", "4:5", "21:9"];
export const MAX_FILM_S = 120;
const KEYS = new Set(["takeaway", "audience", "durationS", "aspectRatio", "tone", "mustShow", "copy", "sound", "filmType"]);
const SOUND_KEYS = new Set(["music", "voice", "sfx"]);

const text = (v) => typeof v === "string" && v.trim() !== "";
const textList = (v) => Array.isArray(v) && v.every(text);

/** Every problem with a brief, as plain sentences. An empty list means it is sound. */
export function validateBrief(brief, { menu = loadMenu() } = {}) {
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) return ["The brief must be an object."];
  const problems = [];
  for (const k of Object.keys(brief)) if (!KEYS.has(k)) problems.push(`The brief has no field "${k}". Fields: ${[...KEYS].join(", ")}.`);
  if (!text(brief.takeaway)) problems.push("takeaway is missing: the one thing the viewer should leave with.");
  if (!(Number.isInteger(brief.durationS) && brief.durationS >= 1 && brief.durationS <= MAX_FILM_S)) problems.push(`durationS must be whole seconds from 1 to ${MAX_FILM_S}.`);
  if (!ASPECTS.includes(brief.aspectRatio)) problems.push(`aspectRatio must be one of: ${ASPECTS.join(", ")}.`);
  if (!ids(menu, "filmTypes").includes(brief.filmType)) problems.push(`filmType must be one of: ${ids(menu, "filmTypes").join(", ")}.`);
  for (const k of ["audience", "tone"]) if (brief[k] != null && !text(brief[k])) problems.push(`${k} must be a sentence, or left out.`);
  for (const k of ["mustShow", "copy"]) if (brief[k] != null && !textList(brief[k])) problems.push(`${k} must be a list of short lines.`);
  if (brief.sound != null) {
    if (typeof brief.sound !== "object" || Array.isArray(brief.sound)) problems.push("sound must be { music, voice, sfx }.");
    else {
      for (const k of Object.keys(brief.sound)) if (!SOUND_KEYS.has(k)) problems.push(`sound has no field "${k}". Fields: music, voice, sfx.`);
      for (const k of SOUND_KEYS) if (brief.sound[k] != null && !text(brief.sound[k])) problems.push(`sound.${k} must be a sentence, or left out.`);
    }
  }
  return problems;
}

export const readBrief = (film) => readFilmJson(film, "brief.json");

/** Save a brief after checking it; a bad brief is refused with every reason (exit 1). */
export function saveBrief(film, brief, opts = {}) {
  const problems = validateBrief(brief, opts);
  if (problems.length) throw usage(`The brief was not saved:\n- ${problems.join("\n- ")}`, { problems });
  writeFilmJson(film, "brief.json", brief, opts);
  return brief;
}
```

- [ ] **Step 4: Run.** `node --test tests/director-store.test.mjs` → 7 pass.

- [ ] **Step 5: Commit.**

```bash
git add cli/director/files.mjs cli/director/brief.mjs tests/director-store.test.mjs
git diff --cached --stat
git commit -m "director: brief and film files with history, links refused"
```

---

### Task 5: Fit and the model picker

A shot is generated `PAD_S` (1s) longer than planned so the edit can trim a slow start: the generated length is the shortest supported duration ≥ planned + 1. `shotFit` prices that length with a `first_frame` ref, so a model without a captured image-to-video contract is ruled out. Today that leaves Seedance (2, 2 Fast, 2.5) and H3; Wan 3.0, Kling and Veo are ruled out in plain words and the picker falls back to the best cinematic model.

**Files:**
- Create: `cli/director/fit.mjs`, `cli/director/pick.mjs`
- Test: `tests/director-pick.test.mjs`

- [ ] **Step 1: Write the failing test** `tests/director-pick.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../cli/lib/models.mjs";
import { suggestModel, suggestStillModel } from "../cli/director/pick.mjs";
import { generatedLength, shotFit, PAD_S } from "../cli/director/fit.mjs";

const catalog = loadCatalog();
const brief = { takeaway: "x", durationS: 10, aspectRatio: "16:9", filmType: "live-action" };
const shot = (job, durationS = 4) => ({ id: "s1", job, durationS });

/** A copy of the catalog with some models' fields replaced, for picker cases the real ratings do not cover. */
function withModels(patch) {
  const models = { ...catalog.models };
  for (const [id, fields] of Object.entries(patch)) models[id] = { ...models[id], ...fields };
  return { ...catalog, models, list: Object.entries(models).map(([id, m]) => ({ id, ...m })) };
}

describe("generated length", () => {
  test("the shortest length the model makes that covers the shot plus the pad", () => {
    assert.equal(PAD_S, 1);
    assert.equal(generatedLength({ durationsS: [4, 5, 6, 8] }, 4), 5);
    assert.equal(generatedLength({ durationsS: [8] }, 4), 8);
    assert.equal(generatedLength({ durationsS: [5, 10] }, 10), null);
  });

  test("shotFit prices the generated length from the still", () => {
    const f = shotFit(catalog, "minimax-h3", { plannedS: 14, aspectRatio: "16:9" });
    assert.equal(f.generatedS, 15);
    assert.deepEqual(f.problems, []);
    assert.equal(typeof f.estimateUsd, "number");
  });
});

describe("suggestModel", () => {
  test("the S-tier model for the job", () => {
    const s = suggestModel(catalog, shot("motion-graphics"), { brief });
    assert.equal(s.model, "minimax-h3");
    assert.equal(s.tier, "S");
    assert.equal(s.reason, "S tier for motion graphics.");
    assert.equal(s.generatedS, 5);
  });

  test("product hero reads the cinematic ratings", () => {
    assert.equal(suggestModel(catalog, shot("product-hero"), { brief }).model, "seedance-2-5");
  });

  test("a rated model that cannot start from a still is ruled out in plain words, and cinematic is the fallback", () => {
    const s = suggestModel(catalog, shot("ugc"), { brief });
    assert.equal(s.model, "seedance-2-5");
    assert.equal(s.ratings, "cinematic");
    assert.equal(s.reason, "Nothing rated for UGC-style footage can take this shot, so the best cinematic model: seedance-2-5 (S tier).");
    assert.deepEqual(s.ruledOut, [{ model: "wan-3-0", tier: "S", why: "wan-3-0 cannot start from a still yet: its image-to-video input has not been captured." }]);
  });

  test("a shot too long for the S model goes to the A model", () => {
    const cat = withModels({ "seedance-2": { goodFor: { animation: "S" } } });
    const s = suggestModel(cat, shot("animation", 15), { brief });
    assert.equal(s.model, "seedance-2-5");
    assert.equal(s.tier, "A");
    assert.match(s.ruledOut[0].why, /^seedance-2 makes at most \d+s; this shot needs 16s/);
  });

  test("within a tier, the cheaper model for this shot comes first", () => {
    const cat = withModels({ "seedance-2-fast": { goodFor: { cinematic: "S" } } });
    const a = suggestModel(cat, shot("cinematic"), { brief });
    const fast = shotFit(cat, "seedance-2-fast", { plannedS: 4, aspectRatio: "16:9" }).estimateUsd;
    const full = shotFit(cat, "seedance-2-5", { plannedS: 4, aspectRatio: "16:9" }).estimateUsd;
    assert.equal(a.model, fast < full ? "seedance-2-fast" : "seedance-2-5");
  });

  test("nothing fits: model null with every reason", () => {
    const s = suggestModel(catalog, shot("cinematic", 40), { brief });
    assert.equal(s.model, null);
    assert.equal(s.reason, "No rated model can take this shot.");
    assert.ok(s.ruledOut.length >= 1);
  });

  test("an unknown job is refused with the menu's jobs", () => {
    assert.throws(() => suggestModel(catalog, shot("vlog"), { brief }), /Choose one of: motion-graphics, cinematic/);
  });
});

describe("suggestStillModel", () => {
  test("by film type, and graphics always get the exact-text model", () => {
    assert.equal(suggestStillModel(shot("cinematic"), { brief }).model, "nano-banana-2");
    assert.equal(suggestStillModel(shot("cinematic"), { brief: { ...brief, filmType: "character" } }).model, "seedream-5-pro");
    assert.equal(suggestStillModel(shot("cinematic"), { brief: { ...brief, filmType: "product-hero" } }).model, "gpt-image-2-5");
    assert.equal(suggestStillModel(shot("motion-graphics"), { brief }).model, "gpt-image-2-5");
    assert.equal(suggestStillModel(shot("cinematic"), {}).model, "gpt-image-2-5");
  });
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test tests/director-pick.test.mjs` → FAIL, module not found.

- [ ] **Step 3: Implement** `cli/director/fit.mjs`:

```js
import { resolveModel } from "../lib/models.mjs";
import { planJob } from "../core/views.mjs";

/** Seconds generated beyond the planned length, so the edit can drop a sluggish start. */
export const PAD_S = 1;

/** The shortest length the model makes that covers the shot plus the pad, or null. */
export function generatedLength(model, plannedS) {
  const want = plannedS + PAD_S;
  const fits = (model.durationsS ?? []).filter((d) => d >= want).sort((a, b) => a - b);
  return fits[0] ?? null;
}

/**
 * Can this video model film this shot from its still? Every reason it cannot,
 * the length it would generate and the price, without reading any spending state.
 */
export function shotFit(catalog, modelId, { plannedS, aspectRatio }) {
  let model;
  try {
    model = resolveModel(catalog, modelId, "video");
  } catch (e) {
    return { model: modelId ?? null, generatedS: null, estimateUsd: null, basis: null, problems: [e.message] };
  }
  const generatedS = generatedLength(model, plannedS);
  if (generatedS == null) {
    const longest = Math.max(...(model.durationsS ?? [0]));
    return {
      model: model.id,
      generatedS: null,
      estimateUsd: null,
      basis: null,
      problems: [`${model.id} makes at most ${longest}s; this shot needs ${plannedS + PAD_S}s including the ${PAD_S}s trim margin.`],
    };
  }
  const job = planJob(catalog, { model: model.id, capability: "video", durationS: generatedS, aspectRatio, refs: [{ role: "first_frame" }] });
  return { model: model.id, generatedS, estimateUsd: job.est?.usd ?? null, basis: job.est?.basis ?? null, problems: job.problems };
}

/** The same for the still: an image model at the film's aspect ratio. */
export function stillFit(catalog, modelId, { aspectRatio }) {
  try {
    const job = planJob(catalog, { model: modelId, capability: "image", aspectRatio });
    return { model: job.model.id, estimateUsd: job.est?.usd ?? null, problems: job.problems };
  } catch (e) {
    return { model: modelId ?? null, estimateUsd: null, problems: [e.message] };
  }
}
```

and `cli/director/pick.mjs`:

```js
import { loadMenu, entry } from "./menu.mjs";
import { shotFit } from "./fit.mjs";

const TIER_ORDER = { S: 0, A: 1 };

/** Why a model cannot take the shot, in words for Alex rather than for the request builder. */
const whyNot = (id, problem) =>
  /No captured contract/.test(problem) ? `${id} cannot start from a still yet: its image-to-video input has not been captured.` : problem;

/** Video models rated for a job, best tier first, then cheapest for this shot. */
function candidates(catalog, ratings, shot, aspectRatio) {
  return catalog.list
    .filter((m) => m.capability === "video" && m.goodFor?.[ratings])
    .map((m) => ({ id: m.id, tier: m.goodFor[ratings], fit: shotFit(catalog, m.id, { plannedS: shot.durationS, aspectRatio }) }))
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || (a.fit.estimateUsd ?? Infinity) - (b.fit.estimateUsd ?? Infinity));
}

/**
 * The model to film one shot on. Alex's ratings (`goodFor` in models.json) give
 * the order; a model that cannot take the shot (length, ratio, no first-frame
 * contract) is ruled out with the reason. When nothing rated for the shot's job
 * fits, the best cinematic model is the fallback, and the reason says so.
 */
export function suggestModel(catalog, shot, { brief = null, menu = loadMenu() } = {}) {
  const job = entry(menu, "jobs", shot.job);
  const lists = [job.ratings ?? job.id];
  if (lists[0] !== "cinematic") lists.push("cinematic");
  const ruledOut = [];
  for (const ratings of lists) {
    for (const c of candidates(catalog, ratings, shot, brief?.aspectRatio)) {
      if (ruledOut.some((r) => r.model === c.id)) continue;
      if (c.fit.problems.length) {
        ruledOut.push({ model: c.id, tier: c.tier, why: whyNot(c.id, c.fit.problems[0]) });
        continue;
      }
      const label = ratings === job.id ? job.label : entry(menu, "jobs", ratings).label;
      const fallback = ratings !== lists[0];
      return {
        model: c.id,
        tier: c.tier,
        ratings,
        reason: fallback
          ? `Nothing rated for ${job.label} can take this shot, so the best ${label.toLowerCase()} model: ${c.id} (${c.tier} tier).`
          : `${c.tier} tier for ${label.toLowerCase()}.`,
        generatedS: c.fit.generatedS,
        estimateUsd: c.fit.estimateUsd,
        ruledOut,
      };
    }
  }
  return { model: null, tier: null, ratings: null, reason: `No rated model can take this shot.`, generatedS: null, estimateUsd: null, ruledOut };
}

const STILL_BY_FILM = {
  "product-ui": ["gpt-image-2-5", "GPT Image 2.5 keeps screens and products exact."],
  "product-hero": ["gpt-image-2-5", "GPT Image 2.5 keeps screens and products exact."],
  "live-action": ["nano-banana-2", "Nano Banana 2 for photoreal people and places."],
  character: ["seedream-5-pro", "Seedream 5 Pro for a stylised look."],
};

/** The image model for a shot's still: exact screens and products, photoreal, or stylised. */
export function suggestStillModel(shot, { brief = null } = {}) {
  const [model, reason] =
    shot.job === "motion-graphics" ? STILL_BY_FILM["product-ui"] : STILL_BY_FILM[brief?.filmType] ?? STILL_BY_FILM["product-ui"];
  return { model, reason };
}
```

- [ ] **Step 4: Run.** `node --test tests/director-pick.test.mjs` → 10 pass.

- [ ] **Step 5: Commit.**

```bash
git add cli/director/fit.mjs cli/director/pick.mjs tests/director-pick.test.mjs
git diff --cached --stat
git commit -m "director: shot fit and the model picker from goodFor"
```

---

### Task 6: The translator

One shot plus the film's look becomes the prompt its model reads best. The shot is animated from its still, so the words carry camera, action and light; Library descriptions and the look are copied word for word into every shot.

| Family | Line order |
|---|---|
| seedance | Subject, Look, `Shot 1: <Camera>, <framing>.`, action, light, no-text, "No subtitles, no logo or watermark." |
| hailuo | Look, `[Bracket] <Framing>.`, Subject, action, light, no-text |
| kling | Subject, Look, `Shot: <framing>; <camera>.`, action, light, no-text |
| wan | "One continuous shot.", `<Framing>; <camera>.`, Subject, action, light, Look, no-text, "No dialogue. No background music." (not on lip sync) |
| veo | `<Framing>, <camera>.`, Subject, action, light, Look, no-text |

**Files:**
- Create: `cli/director/wording.mjs`
- Test: `tests/director-wording.test.mjs`

- [ ] **Step 1: Write the failing golden tests** `tests/director-wording.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../cli/lib/models.mjs";
import { shotWording } from "../cli/director/wording.mjs";

const catalog = loadCatalog();
const assets = [{ name: "mara", kind: "character", description: "A woman in her thirties, short black hair, olive raincoat." }];
const plan = {
  look: { palette: "teal and amber", grade: "soft contrast, lifted blacks", filmLook: "35mm film grain", lensFamily: "anamorphic", keyLightSide: "left" },
  shots: [],
};
const shot = {
  id: "s2", durationS: 6, purpose: "Her calm", subject: "mara", action: "Mara stops and looks out to sea", why: "The payoff",
  size: "close-up", angle: "eye-level", lens: "85mm", depth: "shallow", move: { type: "push-in", speed: "slow" },
  light: "golden-hour", cut: "on-action", job: "cinematic", screenDirection: "none", cast: ["mara"], copy: ["Find your coast"], checks: ["ok"],
};
const word = (model, extra = {}) => shotWording(catalog, plan, { ...shot, model, ...extra }, { assets });

const SUBJECT = "Subject: A woman in her thirties, short black hair, olive raincoat.";
const LOOK = "Look: 35mm film grain, teal and amber, soft contrast, lifted blacks, anamorphic lenses, key light from the left.";
const FRAMING = "close-up, eye-level angle, 85mm portrait lens, shallow depth of field";

describe("golden wording per family", () => {
  test("seedance: Shot 1 label, camera first, audio off", () => {
    const w = word("seedance-2-5");
    assert.equal(w.family, "seedance");
    assert.equal(w.prompt, [SUBJECT, LOOK, `Shot 1: The camera slowly pushes in, ${FRAMING}.`, "Mara stops and looks out to sea.", "Warm, low golden-hour sunlight.", "No on-screen text.", "No subtitles, no logo or watermark."].join("\n"));
    assert.deepEqual(w.params, { generate_audio: false });
    assert.deepEqual(w.problems, []);
  });

  test("hailuo: look line, then the bracket command", () => {
    const w = word("minimax-h3");
    assert.equal(w.prompt, [LOOK, "[Push in] Close-up, eye-level angle, 85mm portrait lens, shallow depth of field.", SUBJECT, "Mara stops and looks out to sea.", "Warm, low golden-hour sunlight.", "No on-screen text."].join("\n"));
    assert.deepEqual(w.params, {});
  });

  test("wan: one continuous shot, no dialogue or music", () => {
    assert.equal(word("wan-3-0").prompt, ["One continuous shot.", `Close-up, eye-level angle, 85mm portrait lens, shallow depth of field; the camera slowly pushes in.`, SUBJECT, "Mara stops and looks out to sea.", "Warm, low golden-hour sunlight.", LOOK, "No on-screen text.", "No dialogue. No background music."].join("\n"));
  });

  test("kling: subject and look first, then the shot line", () => {
    assert.equal(word("kling-3-0").prompt, [SUBJECT, LOOK, `Shot: ${FRAMING}; the camera slowly pushes in.`, "Mara stops and looks out to sea.", "Warm, low golden-hour sunlight.", "No on-screen text."].join("\n"));
  });

  test("veo: cinematography, subject, action, context, style", () => {
    assert.equal(word("veo-3-1").prompt, [`Close-up, eye-level angle, 85mm portrait lens, shallow depth of field, the camera slowly pushes in.`, SUBJECT, "Mara stops and looks out to sea.", "Warm, low golden-hour sunlight.", LOOK, "No on-screen text."].join("\n"));
  });
});

describe("wording rules", () => {
  test("a static camera holds still, and screen direction joins the action", () => {
    const w = word("seedance-2-5", { move: { type: "static" }, screenDirection: "left-to-right", copy: [] });
    assert.match(w.prompt, /^Shot 1: The camera holds still, /m);
    assert.match(w.prompt, /^Mara stops and looks out to sea, moving left to right\.$/m);
    assert.doesNotMatch(w.prompt, /No on-screen text/);
  });

  test("a lip-sync shot keeps its audio and drops the no-dialogue line", () => {
    assert.deepEqual(word("seedance-2-5", { job: "lip-sync" }).params, {});
    assert.doesNotMatch(word("wan-3-0", { job: "lip-sync" }).prompt, /No dialogue/);
  });

  test("a shot's own key light side overrides the look's", () => {
    assert.match(word("seedance-2-5", { keyLightSide: "right" }).prompt, /key light from the right\./);
  });

  test("the same plan always gives the same text", () => {
    assert.equal(word("seedance-2-5").prompt, word("seedance-2-5").prompt);
  });

  test("wording past the model's limit is a problem, with both numbers", () => {
    const w = word("wan-2-6", { action: "Mara walks ".repeat(200) });
    assert.equal(w.maxChars, 1500);
    assert.match(w.problems[0], /^The wording is \d+ characters; wan-2-6 follows at most 1500\./);
  });
});
```

- [ ] **Step 2: Run them and see them fail.** `node --test tests/director-wording.test.mjs` → FAIL, module not found.

- [ ] **Step 3: Implement** `cli/director/wording.mjs`:

```js
import { resolveModel } from "../lib/models.mjs";
import { loadMenu, entry } from "./menu.mjs";

/** "the camera slowly pushes in" -> "The camera slowly pushes in." */
const sentence = (s) => {
  const t = String(s ?? "").trim().replace(/[.\s]+$/, "");
  return t ? `${t[0].toUpperCase()}${t.slice(1)}.` : "";
};
const cap = (s) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);

/**
 * One shot as its model reads best. The shot is animated from its still, so the
 * words carry the camera, the action and the light; the cast and look lines are
 * the Library descriptions and the film's look, word for word in every shot.
 * Returns the prompt, any provider params it needs (audio off) and its length
 * against the model's limit. Pure: the same plan always gives the same text.
 */
export function shotWording(catalog, plan, shot, { menu = loadMenu(), assets = [] } = {}) {
  const model = resolveModel(catalog, shot.model, "video");
  const profile = model.promptProfile ?? { family: "seedance", maxChars: null, audioOff: null };
  const look = plan.look ?? {};
  const pick = (group, id) => entry(menu, group, id);

  const move = pick("moves", shot.move.type);
  const camera = shot.move.type === "static" ? "the camera holds still" : `the camera ${pick("speeds", shot.move.speed).words} ${move.words}`;
  const framing = [pick("sizes", shot.size).words, pick("angles", shot.angle).words, pick("lenses", shot.lens).words, pick("depths", shot.depth).words].join(", ");
  const described = (shot.cast ?? []).map((name) => assets.find((a) => a.name === name)?.description).filter(Boolean);
  const subjectLine = described.length ? `Subject: ${described.map((d) => d.trim().replace(/[.\s]+$/, "")).join("; ")}.` : "";
  const keySide = shot.keyLightSide ?? look.keyLightSide;
  const lookLine = `Look: ${look.filmLook}, ${look.palette}, ${look.grade}, ${pick("lensLooks", look.lensFamily).words} lenses, key light from the ${keySide}.`;
  const direction = shot.screenDirection && shot.screenDirection !== "none" ? pick("screenDirections", shot.screenDirection).words : "";
  const action = sentence(direction ? `${shot.action.trim().replace(/[.\s]+$/, "")}, ${direction}` : shot.action);
  const light = sentence(pick("lights", shot.light).words);
  const noText = shot.copy?.length ? "No on-screen text." : "";
  const speaks = shot.job === "lip-sync";

  let lines;
  switch (profile.family) {
    case "hailuo":
      lines = [lookLine, `${move.hailuo ?? sentence(camera)} ${sentence(framing)}`, subjectLine, action, light, noText];
      break;
    case "kling":
      lines = [subjectLine, lookLine, `Shot: ${framing}; ${camera}.`, action, light, noText];
      break;
    case "wan":
      lines = ["One continuous shot.", `${cap(framing)}; ${camera}.`, subjectLine, action, light, lookLine, noText, speaks ? "" : "No dialogue. No background music."];
      break;
    case "veo":
      lines = [`${cap(framing)}, ${camera}.`, subjectLine, action, light, lookLine, noText];
      break;
    default:
      lines = [subjectLine, lookLine, `Shot 1: ${cap(camera)}, ${framing}.`, action, light, noText, "No subtitles, no logo or watermark."];
  }
  const prompt = lines.filter(Boolean).join("\n");
  const params = profile.audioOff && !speaks ? { [profile.audioOff.param]: profile.audioOff.value } : {};
  const problems =
    profile.maxChars && prompt.length > profile.maxChars
      ? [`The wording is ${prompt.length} characters; ${model.id} follows at most ${profile.maxChars}. Shorten the action or the descriptions.`]
      : [];
  return { shot: shot.id, model: model.id, family: profile.family, prompt, params, chars: prompt.length, maxChars: profile.maxChars ?? null, problems };
}
```

- [ ] **Step 4: Run.** `node --test tests/director-wording.test.mjs` → 10 pass.

- [ ] **Step 5: Commit.**

```bash
git add cli/director/wording.mjs tests/director-wording.test.mjs
git diff --cached --stat
git commit -m "director: per-model shot wording with golden tests"
```

---

### Task 7: The checker

Errors block saving, stills and filming; warnings never block. Every finding is `{ shot, rule, message }`, `shot` null for the whole film. The spec's "continuous cut into a model without `first_frame`" needs no rule of its own: every shot is animated from its still, so `model-fit` already refuses such a model. The jump-cut rule approximates the 30° rule as "same size and same angle".

Error rules: `shape`, `menu`, `one-move`, `model-fit`, `last-continuous`, `text-in-action`, `unknown-cast`, `total-length`, `screen-direction`, `wording-length`. Warning rules: `same-size-run`, `jump-cut`, `wide-lens-close`, `fast-move-short`, `light-side`, `seedance-long`, `no-wide`, `wan-orbit`.

**Files:**
- Create: `cli/director/check.mjs`
- Test: `tests/director-check.test.mjs`

- [ ] **Step 1: Write the failing tests**, one or more per rule, `tests/director-check.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../cli/lib/models.mjs";
import { checkPlan } from "../cli/director/check.mjs";

const catalog = loadCatalog();
const brief = { takeaway: "x", durationS: 10, aspectRatio: "16:9", filmType: "live-action" };
const assets = [{ name: "mara", kind: "character", description: "A woman in an olive raincoat." }];
const look = { palette: "teal", grade: "soft", filmLook: "35mm grain", lensFamily: "spherical", keyLightSide: "left" };
const shot = (id, durationS, extra = {}) => ({
  id, durationS, purpose: "p", subject: "mara", action: "Mara walks along the pier", why: "w",
  size: "wide", angle: "eye-level", lens: "35mm", depth: "deep", move: { type: "truck-left", speed: "slow" },
  light: "overcast", cut: "hard", job: "cinematic", screenDirection: "left-to-right", checks: ["ok"],
  model: "seedance-2-5", stillModel: "nano-banana-2", ...extra,
});
// A sound 10s plan: a wide then a close-up.
const good = () => ({ look: { ...look }, shots: [shot("s1", 4), shot("s2", 6, { size: "close-up", lens: "85mm", screenDirection: "none" })] });
const check = (plan, b = brief) => checkPlan(plan, { catalog, brief: b, assets });
const rules = (findings) => findings.map((f) => f.rule);

describe("a sound plan", () => {
  test("has no errors and no warnings", () => {
    assert.deepEqual(check(good()), { errors: [], warnings: [] });
  });
});

describe("errors", () => {
  const errs = (plan, b) => check(plan, b).errors;

  test("shape: no shots, missing fields, a bad or repeated id, bad checks", () => {
    assert.deepEqual(rules(errs({ look, shots: [] })), ["shape"]);
    const p = good();
    delete p.shots[0].why;
    p.shots[1].id = "s1";
    p.shots[1].checks = [];
    const e = errs(p);
    assert.ok(e.some((x) => x.message === "s1: why is missing."));
    assert.ok(e.some((x) => x.message === "Two shots are called s1."));
    assert.ok(e.some((x) => /checks must be 1 to 3/.test(x.message)));
    assert.match(errs({ look, shots: [shot("S 1", 10)] })[0].message, /Shot id "S 1" must be short lowercase/);
  });

  test("look: words for palette, grade and film look; lens family and key side from the menu", () => {
    const e = errs({ look: { lensFamily: "fisheye" }, shots: [shot("s1", 10, { size: "medium" })] });
    assert.deepEqual(e.map((x) => x.message), [
      "look.palette is missing; say it in words.",
      "look.grade is missing; say it in words.",
      "look.filmLook is missing; say it in words.",
      "look.lensFamily must be one of: spherical, anamorphic.",
      "look.keyLightSide must be one of: left, right, front, back, top.",
    ]);
  });

  test("menu: a value not on the menu names the valid ones", () => {
    const p = good();
    p.shots[0].size = "huge";
    assert.equal(errs(p)[0].message, 's1: size "huge" is not on the menu. Choose one of: extreme-wide, wide, full, medium-wide, medium, medium-close-up, close-up, extreme-close-up, insert.');
  });

  test("one-move: a list of moves is refused", () => {
    const p = good();
    p.shots[0].move = [{ type: "push-in", speed: "slow" }, { type: "pan-left", speed: "slow" }];
    assert.deepEqual(rules(errs(p)), ["one-move"]);
  });

  test("a moving camera needs a speed; a static one does not", () => {
    const p = good();
    p.shots[0].move = { type: "push-in" };
    assert.match(errs(p)[0].message, /move speed must be one of: slow, medium, fast/);
    p.shots[0].move = { type: "static" };
    assert.deepEqual(errs(p), []);
  });

  test("model-fit: a shot longer than the model makes, counting the trim margin", () => {
    const p = { look, shots: [shot("s1", 10, { model: "kling-3-0", size: "medium" })] };
    assert.deepEqual(errs(p).map((x) => x.message), ["s1: kling-3-0 makes at most 10s; this shot needs 11s including the 1s trim margin."]);
  });

  test("model-fit: a model that cannot start from a still", () => {
    const p = { look, shots: [shot("s1", 4, { model: "wan-3-0", size: "medium" }), shot("s2", 6, { size: "close-up" })] };
    assert.match(errs(p)[0].message, /^s1: No captured contract/);
  });

  test("model-fit: no model at all, and an unknown still model", () => {
    const p = good();
    delete p.shots[0].model;
    p.shots[1].stillModel = "paint-3";
    const e = errs(p);
    assert.equal(e[0].message, "s1: no model fits this shot.");
    assert.match(e[1].message, /^s2: still: Unknown model "paint-3"/);
  });

  test("last-continuous: the last shot cannot continue into nothing", () => {
    const p = good();
    p.shots[1].cut = "continuous";
    assert.deepEqual(rules(errs(p)), ["last-continuous"]);
  });

  test("text-in-action: quoted words, prices and percentages belong in copy", () => {
    for (const action of ['A sign reads "Open now"', "The price drops to $49", "Battery fills to 80%", "Price falls to €12"]) {
      const p = good();
      p.shots[0].action = action;
      assert.deepEqual(rules(errs(p)), ["text-in-action"], action);
    }
    const p = good();
    p.shots[0].action = "Mara walks 20 steps along the pier";
    assert.deepEqual(errs(p), [], "a plain number is fine");
  });

  test("unknown-cast: in a shot and in the look", () => {
    const p = good();
    p.shots[0].cast = ["ghost"];
    p.look.cast = [{ asset: "phantom", role: "character" }];
    assert.deepEqual(errs(p).map((x) => x.message), [
      'look.cast names "phantom", which is not in the Library. Save it first or remove it.',
      's1: cast names "ghost", which is not in the Library. Save it first or remove it.',
    ]);
    p.shots[0].cast = ["mara"];
    p.look.cast = [{ asset: "mara", role: "character" }];
    assert.deepEqual(errs(p), []);
  });

  test("total-length: within one second of the brief", () => {
    const p = good();
    p.shots[1].durationS = 7;
    assert.deepEqual(errs(p), [], "11s against 10s is fine");
    p.shots[1].durationS = 8;
    assert.equal(errs(p)[0].message, "The shots add up to 12s; the brief asks for 10s.");
    assert.deepEqual(errs(p, null), [], "no brief, no length rule");
  });

  test("screen-direction: the same subject flipping direction crosses the line", () => {
    const p = good();
    p.shots[1].screenDirection = "right-to-left";
    assert.equal(errs(p)[0].message, "s2: mara travels right to left after left to right in s1, which crosses the line. Keep the direction, or say why in crossesLine.");
    p.shots[1].crossesLine = "She turns back toward home.";
    assert.deepEqual(errs(p), []);
    p.shots[1].subject = "the gull";
    delete p.shots[1].crossesLine;
    assert.deepEqual(errs(p), [], "another subject may travel the other way");
  });

  test("wording-length: a shot worded past its model's limit", () => {
    const p = { look, shots: [shot("s1", 4, { model: "minimax-h3", action: "Mara walks along the pier ".repeat(90) }), shot("s2", 6, { size: "close-up" })] };
    assert.deepEqual(rules(errs(p)), ["wording-length"]);
  });

  test("errors do not stop at the first: every reason is reported", () => {
    const p = good();
    p.shots[0].size = "huge";
    p.shots[1].cut = "continuous";
    assert.deepEqual(rules(errs(p)), ["menu", "last-continuous"]);
  });
});

describe("warnings", () => {
  const warns = (plan, b) => check(plan, b).warnings;

  test("same-size-run: three of one size in a row", () => {
    const p = { look, shots: [shot("a", 3, { size: "medium" }), shot("b", 3, { size: "medium", angle: "low" }), shot("c", 4, { size: "medium" })] };
    assert.deepEqual(rules(warns(p)), ["same-size-run", "no-wide"]);
  });

  test("jump-cut: same subject, size and angle, unless the cut is continuous", () => {
    const p = { look, shots: [shot("a", 4), shot("b", 6)] };
    assert.equal(warns(p)[0].message, "b: same subject, size and angle as a, which reads as a jump cut. Change the size or the angle.");
    p.shots[0].cut = "continuous";
    assert.deepEqual(warns(p), []);
  });

  test("wide-lens-close: a wide lens close on a face, but not on a product or graphics", () => {
    const p = good();
    p.shots[1].lens = "24mm";
    assert.equal(warns(p)[0].message, "s2: a 24mm lens this close distorts a face. An 85mm flatters it.");
    p.shots[1].job = "product-hero";
    assert.deepEqual(warns(p), []);
  });

  test("fast-move-short: a fast move in four seconds or less", () => {
    const p = good();
    p.shots[0].move = { type: "push-in", speed: "fast" };
    assert.deepEqual(rules(warns(p)), ["fast-move-short"]);
  });

  test("light-side: the key light changes side without a reason", () => {
    const p = good();
    p.shots[1].keyLightSide = "right";
    assert.deepEqual(rules(warns(p)), ["light-side"]);
    p.shots[1].lightReason = "She turns to the window.";
    assert.deepEqual(warns(p), []);
  });

  test("seedance-long: a Seedance shot past eight seconds", () => {
    const p = { look, shots: [shot("s1", 10)] };
    assert.deepEqual(rules(warns(p)), ["seedance-long"]);
  });

  test("no-wide: a live-action film with no wide, but not other film types", () => {
    const p = good();
    p.shots[0].size = "medium";
    assert.deepEqual(rules(warns(p)), ["no-wide"]);
    assert.deepEqual(warns(p, { ...brief, filmType: "product-ui" }), []);
  });

  test("wan-orbit: an orbit on Wan", () => {
    const p = good();
    p.shots[1].model = "wan-2-6";
    p.shots[1].move = { type: "orbit-left", speed: "slow" };
    assert.ok(rules(warns(p)).includes("wan-orbit"));
  });

  test("warnings never block: a plan with warnings has no errors", () => {
    const p = { look, shots: [shot("s1", 10)] };
    assert.deepEqual(check(p).errors, []);
  });
});
```

- [ ] **Step 2: Run them and see them fail.** `node --test tests/director-check.test.mjs` → FAIL, module not found.

- [ ] **Step 3: Implement** `cli/director/check.mjs`. Note `lookOk`: wording is only built when the look is sound, or a bad `lensFamily` would throw from `entry()` instead of being reported.

```js
import { loadMenu, ids } from "./menu.mjs";
import { shotFit, stillFit } from "./fit.mjs";
import { shotWording } from "./wording.mjs";

const SHOT_ID = /^[a-z0-9][a-z0-9-]{0,19}$/;
const SHOT_TEXT = ["purpose", "subject", "action", "why"];
const LOOK_TEXT = ["palette", "grade", "filmLook"];
const CLOSE = new Set(["medium-close-up", "close-up", "extreme-close-up"]);
const WIDE_LENS = new Set(["14mm", "24mm"]);
const WIDE_SIZES = new Set(["extreme-wide", "wide", "full"]);
const NOT_FACES = new Set(["motion-graphics", "product-hero"]);
// Words a model would draw as a picture of text: quoted copy, prices, percentages.
const QUOTED = /["“”][^"“”]{2,}["“”]/;
const FIGURE = /[$€£]\s?\d|\d+(?:[.,]\d+)?\s?%/;
const OPPOSITE = { "left-to-right": "right-to-left", "right-to-left": "left-to-right" };

const text = (v) => typeof v === "string" && v.trim() !== "";
const same = (a, b) => text(a) && text(b) && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The script supervisor. Errors block the plan from being saved, stills and
 * filming; warnings are craft notes that never block. Each finding names its
 * shot (null for the whole film), a rule id and one plain sentence.
 */
export function checkPlan(plan, { catalog, brief = null, assets = [], menu = loadMenu() }) {
  const errors = [];
  const warnings = [];
  const err = (shot, rule, message) => errors.push({ shot, rule, message });
  const warn = (shot, rule, message) => warnings.push({ shot, rule, message });
  const inMenu = (group, v) => ids(menu, group).includes(v);
  const oneOf = (group) => ids(menu, group).join(", ");
  const library = new Set(assets.map((a) => a.name));

  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    err(null, "shape", "The plan must be an object with look and shots.");
    return { errors, warnings };
  }
  const look = plan.look && typeof plan.look === "object" ? plan.look : {};
  for (const k of LOOK_TEXT) if (!text(look[k])) err(null, "shape", `look.${k} is missing; say it in words.`);
  if (!inMenu("lensLooks", look.lensFamily)) err(null, "menu", `look.lensFamily must be one of: ${oneOf("lensLooks")}.`);
  if (!inMenu("keyLightSides", look.keyLightSide)) err(null, "menu", `look.keyLightSide must be one of: ${oneOf("keyLightSides")}.`);
  for (const c of Array.isArray(look.cast) ? look.cast : []) {
    if (!library.has(c?.asset)) err(null, "unknown-cast", `look.cast names "${c?.asset}", which is not in the Library. Save it first or remove it.`);
  }

  const lookOk = errors.length === 0;
  const shots = Array.isArray(plan.shots) ? plan.shots : [];
  if (!shots.length) err(null, "shape", "The plan has no shots.");
  const seen = new Set();
  const valid = new Set();

  for (const s of shots) {
    const before = errors.length;
    const id = s?.id;
    if (!SHOT_ID.test(id ?? "")) err(id ?? null, "shape", `Shot id "${id}" must be short lowercase letters, digits and hyphens, like s1.`);
    else if (seen.has(id)) err(id, "shape", `Two shots are called ${id}.`);
    seen.add(id);
    if (!(typeof s?.durationS === "number" && s.durationS > 0)) err(id, "shape", `${id}: durationS must be a number of seconds above 0.`);
    for (const k of SHOT_TEXT) if (!text(s?.[k])) err(id, "shape", `${id}: ${k} is missing.`);
    for (const [k, group] of [["size", "sizes"], ["angle", "angles"], ["lens", "lenses"], ["depth", "depths"], ["light", "lights"], ["cut", "cuts"], ["job", "jobs"], ["screenDirection", "screenDirections"]]) {
      if (!inMenu(group, s?.[k])) err(id, "menu", `${id}: ${k} "${s?.[k]}" is not on the menu. Choose one of: ${oneOf(group)}.`);
    }
    if (s?.keyLightSide != null && !inMenu("keyLightSides", s.keyLightSide)) err(id, "menu", `${id}: keyLightSide must be one of: ${oneOf("keyLightSides")}.`);
    if (Array.isArray(s?.move) || !s?.move || typeof s.move !== "object") {
      err(id, "one-move", `${id}: one camera move per shot, written as { type, speed }. Give a second move its own shot.`);
    } else {
      if (!inMenu("moves", s.move.type)) err(id, "menu", `${id}: move "${s.move.type}" is not on the menu. Choose one of: ${oneOf("moves")}.`);
      if (s.move.type !== "static" && !inMenu("speeds", s.move.speed)) err(id, "menu", `${id}: move speed must be one of: ${oneOf("speeds")}.`);
    }
    const checks = s?.checks;
    if (!Array.isArray(checks) || checks.length < 1 || checks.length > 3 || !checks.every(text)) {
      err(id, "shape", `${id}: checks must be 1 to 3 short pass/fail sentences.`);
    }
    if (s?.copy != null && !(Array.isArray(s.copy) && s.copy.every(text))) err(id, "shape", `${id}: copy must be a list of exact text lines.`);
    for (const name of Array.isArray(s?.cast) ? s.cast : []) {
      if (!library.has(name)) err(id, "unknown-cast", `${id}: cast names "${name}", which is not in the Library. Save it first or remove it.`);
    }
    if (text(s?.action) && (QUOTED.test(s.action) || FIGURE.test(s.action))) {
      err(id, "text-in-action", `${id}: the action contains quoted text or a figure, which a model would draw wrongly. Move it to copy; the edit renders it in code.`);
    }
    if (!text(s?.model)) {
      err(id, "model-fit", `${id}: no model fits this shot.`);
    } else if (typeof s?.durationS === "number" && s.durationS > 0) {
      for (const p of shotFit(catalog, s.model, { plannedS: s.durationS, aspectRatio: brief?.aspectRatio }).problems) err(id, "model-fit", `${id}: ${p}`);
    }
    if (s?.stillModel != null) {
      for (const p of stillFit(catalog, s.stillModel, { aspectRatio: brief?.aspectRatio }).problems) err(id, "model-fit", `${id}: still: ${p}`);
    }
    if (errors.length === before) valid.add(s);

    if (WIDE_LENS.has(s?.lens) && CLOSE.has(s?.size) && !NOT_FACES.has(s?.job)) {
      warn(id, "wide-lens-close", `${id}: a ${s.lens} lens this close distorts a face. An 85mm flatters it.`);
    }
    if (s?.move?.speed === "fast" && s?.move?.type !== "static" && s?.durationS <= 4) {
      warn(id, "fast-move-short", `${id}: a fast move in ${s.durationS}s rarely reads. Slow it or lengthen the shot.`);
    }
    if (typeof s?.model === "string" && s.model.startsWith("seedance") && s?.durationS > 8) {
      warn(id, "seedance-long", `${id}: Seedance shots past 8s tend to drift. Split it into two shots.`);
    }
    if (typeof s?.model === "string" && s.model.startsWith("wan") && String(s?.move?.type).startsWith("orbit")) {
      warn(id, "wan-orbit", `${id}: Wan breaks orbits wider than 45 degrees. Keep the arc small or choose a truck.`);
    }
    if (s?.keyLightSide != null && s.keyLightSide !== look.keyLightSide && !text(s?.lightReason)) {
      warn(id, "light-side", `${id}: the key light moves from ${look.keyLightSide} to ${s.keyLightSide}. Say why in lightReason, or keep it on one side.`);
    }
  }

  for (let i = 1; i < shots.length; i += 1) {
    const a = shots[i - 1];
    const b = shots[i];
    if (same(a?.subject, b?.subject) && OPPOSITE[a?.screenDirection] === b?.screenDirection && !text(b?.crossesLine)) {
      err(b?.id ?? null, "screen-direction", `${b?.id}: ${b.subject} travels ${b.screenDirection.replace(/-/g, " ")} after ${a.screenDirection.replace(/-/g, " ")} in ${a.id}, which crosses the line. Keep the direction, or say why in crossesLine.`);
    }
    if (same(a?.subject, b?.subject) && a?.size === b?.size && a?.angle === b?.angle && a?.cut !== "continuous") {
      warn(b?.id ?? null, "jump-cut", `${b?.id}: same subject, size and angle as ${a?.id}, which reads as a jump cut. Change the size or the angle.`);
    }
    if (i >= 2 && shots[i - 2]?.size === a?.size && a?.size === b?.size) {
      warn(b?.id ?? null, "same-size-run", `${b?.id}: three ${b.size} shots in a row. Vary the size to give the cut somewhere to go.`);
    }
  }
  if (shots.length && shots.at(-1)?.cut === "continuous") {
    err(shots.at(-1)?.id ?? null, "last-continuous", `${shots.at(-1)?.id}: the last shot cannot continue into a next shot. Use another cut.`);
  }
  if (brief && shots.length && shots.every((s) => typeof s?.durationS === "number")) {
    const total = shots.reduce((t, s) => t + s.durationS, 0);
    if (Math.abs(total - brief.durationS) > 1) err(null, "total-length", `The shots add up to ${total}s; the brief asks for ${brief.durationS}s.`);
  }
  if (brief?.filmType === "live-action" && shots.length && !shots.some((s) => WIDE_SIZES.has(s?.size))) {
    warn(null, "no-wide", "No wide shot: a live-action film usually establishes the place before going close.");
  }

  // Wording is only built when the look and the shot are otherwise sound.
  for (const s of lookOk ? valid : []) {
    const w = shotWording(catalog, plan, s, { menu, assets });
    for (const p of w.problems) err(s.id, "wording-length", `${s.id}: ${p}`);
  }
  return { errors, warnings };
}
```

- [ ] **Step 4: Run.** `node --test tests/director-check.test.mjs` → 25 pass.

- [ ] **Step 5: Commit.**

```bash
git add cli/director/check.mjs tests/director-check.test.mjs
git diff --cached --stat
git commit -m "director: the checker, one test per rule"
```

---

### Task 8: Plan storage, cost and the text view

`savePlan` needs a brief, fills missing models (`fillSuggestions`), checks, numbers the version itself and refuses a plan with errors (exit 1, `err.errors` carries the findings). `updateShot` saves through `savePlan`; a new `job` or `durationS` without a `model` asks the picker again, and a still model the picker chose follows a new job.

**Files:**
- Create: `cli/director/plan.mjs`, `cli/director/cost.mjs`, `cli/director/show.mjs`
- Test: `tests/director-plan.test.mjs`

- [ ] **Step 1: Write the failing test** `tests/director-plan.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "kie-director-")));
const RUNS = join(tmp, "runs");
process.env.KIE_RUNS_DIR = RUNS;
mkdirSync(RUNS, { recursive: true });

const { EXIT } = await import("../cli/lib/errors.mjs");
const { loadCatalog } = await import("../cli/lib/models.mjs");
const { saveBrief } = await import("../cli/director/brief.mjs");
const { readPlan, savePlan, updateShot, fillSuggestions, findShot } = await import("../cli/director/plan.mjs");
const { costPlan } = await import("../cli/director/cost.mjs");

const catalog = loadCatalog();
const brief = { takeaway: "Calm mornings", durationS: 10, aspectRatio: "16:9", filmType: "live-action" };
const look = { palette: "teal", grade: "soft", filmLook: "35mm grain", lensFamily: "spherical", keyLightSide: "left" };
const shot = (id, durationS, extra = {}) => ({
  id, durationS, purpose: "p", subject: "mara", action: "Mara walks along the pier", why: "w",
  size: "wide", angle: "eye-level", lens: "35mm", depth: "deep", move: { type: "truck-left", speed: "slow" },
  light: "overcast", cut: "hard", job: "cinematic", screenDirection: "left-to-right", checks: ["ok"], ...extra,
});
const plan = () => ({ look, shots: [shot("s1", 4), shot("s2", 6, { size: "close-up", lens: "85mm", screenDirection: "none" })] });
let clock = 0;
const now = () => new Date(Date.UTC(2026, 9, 31, 12, 0, clock++));

describe("the plan", () => {
  test("needs a brief first", () => {
    assert.throws(() => savePlan(catalog, "p0", plan()), { code: EXIT.USAGE, message: /runs\/p0 has no brief yet/ });
  });

  test("fillSuggestions adds the picker's model and still model, and never replaces a chosen one", () => {
    const p = plan();
    p.shots[1].model = "seedance-2";
    const filled = fillSuggestions(catalog, p, { brief });
    assert.equal(filled.shots[0].model, "seedance-2-5");
    assert.equal(filled.shots[0].modelReason, "S tier for cinematic.");
    assert.equal(filled.shots[0].stillModel, "nano-banana-2");
    assert.equal(filled.shots[1].model, "seedance-2");
    assert.equal(filled.shots[1].modelReason, undefined);
    assert.equal(p.shots[0].model, undefined, "the input is not changed");
  });

  test("savePlan checks, numbers the version and keeps the old one", () => {
    saveBrief("p1", brief, { now });
    const a = savePlan(catalog, "p1", plan(), { now });
    assert.equal(a.plan.version, 1);
    assert.deepEqual(a.check.errors, []);
    const b = savePlan(catalog, "p1", { ...plan(), version: 99 }, { now });
    assert.equal(b.plan.version, 2, "the version is ours, not the caller's");
    assert.equal(readPlan("p1").version, 2);
    assert.equal(readdirSync(join(RUNS, "p1", ".history")).length, 1);
  });

  test("a plan with errors is refused with every reason and the saved plan is untouched", () => {
    const bad = plan();
    bad.shots[0].size = "huge";
    bad.shots[1].cut = "continuous";
    try {
      savePlan(catalog, "p1", bad, { now });
      assert.fail("should refuse");
    } catch (e) {
      assert.equal(e.code, EXIT.USAGE);
      assert.deepEqual(e.errors.map((x) => x.rule), ["menu", "last-continuous"]);
      assert.match(e.message, /^The plan was not saved:\n- s1: size "huge"/);
    }
    assert.equal(readPlan("p1").version, 2);
  });

  test("updateShot changes one shot; a new job asks the picker again", () => {
    const r = updateShot(catalog, "p1", "s2", { job: "motion-graphics" }, { now });
    const s2 = findShot(r.plan, "s2");
    assert.equal(s2.model, "minimax-h3");
    assert.equal(s2.stillModel, "gpt-image-2-5", "the picked still model follows the job");
    assert.equal(r.plan.version, 3);
  });

  test("updateShot keeps a model somebody named, refuses an id change and a breaking edit", () => {
    const r = updateShot(catalog, "p1", "s1", { model: "seedance-2", durationS: 5, action: "Mara runs" }, { now });
    assert.equal(findShot(r.plan, "s1").model, "seedance-2");
    assert.throws(() => updateShot(catalog, "p1", "s1", { id: "x" }), { code: EXIT.USAGE });
    assert.throws(() => updateShot(catalog, "p1", "s1", { durationS: 20 }), { message: /add up to 26s/ });
    assert.throws(() => updateShot(catalog, "p1", "s9", { durationS: 3 }), { code: EXIT.UNKNOWN, message: /No shot "s9". Shots: s1, s2/ });
  });
});

describe("the cost", () => {
  test("one still and one take per shot, at the generated length, with today's room", () => {
    const p = fillSuggestions(catalog, plan(), { brief });
    const c = costPlan(catalog, p, { brief, store: { list: () => [], now: () => new Date() }, limits: { dailyUsd: 10 } });
    assert.deepEqual(c.shots.map((s) => [s.id, s.model, s.generatedS, s.stillModel]), [
      ["s1", "seedance-2-5", 5, "nano-banana-2"],
      ["s2", "seedance-2-5", 7, "nano-banana-2"],
    ]);
    assert.ok(c.shots.every((s) => s.stillUsd > 0 && s.takeUsd > 0));
    assert.equal(c.totalUsd, Math.round((c.stillsUsd + c.filmUsd) * 1000) / 1000);
    assert.equal(c.complete, true);
    assert.equal(c.availableTodayUsd, 10);
  });

  test("a shot without a model is not priced, and the total says so", () => {
    const c = costPlan(catalog, plan(), { brief });
    assert.equal(c.complete, false);
    assert.equal(c.availableTodayUsd, null);
    assert.equal(c.filmUsd, 0);
  });
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test tests/director-plan.test.mjs` → FAIL, module not found.

- [ ] **Step 3: Implement** `cli/director/plan.mjs`:

```js
import { usage, unknown } from "../lib/errors.mjs";
import { loadMenu } from "./menu.mjs";
import { readFilmJson, writeFilmJson } from "./files.mjs";
import { readBrief } from "./brief.mjs";
import { checkPlan } from "./check.mjs";
import { suggestModel, suggestStillModel } from "./pick.mjs";

export const readPlan = (film) => readFilmJson(film, "shots.json");

export function findShot(plan, id) {
  const shot = plan?.shots?.find((s) => s.id === id);
  if (!shot) throw unknown(`No shot "${id}". Shots: ${(plan?.shots ?? []).map((s) => s.id).join(", ") || "none"}.`);
  return shot;
}

/**
 * Fill what the director left for the picker: a shot without a model gets the
 * suggested one and its reason; a shot without a still model gets one by film
 * type. A model the director or Alex chose is never replaced.
 */
export function fillSuggestions(catalog, plan, { brief, menu = loadMenu() }) {
  return {
    ...plan,
    shots: (plan.shots ?? []).map((s) => {
      if (!s || typeof s !== "object") return s;
      const out = { ...s };
      if (!out.model && typeof out.job === "string" && typeof out.durationS === "number") {
        try {
          const sug = suggestModel(catalog, out, { brief, menu });
          if (sug.model) Object.assign(out, { model: sug.model, modelReason: sug.reason });
        } catch {
          // an unknown job is reported by the checker
        }
      }
      if (!out.stillModel) {
        const st = suggestStillModel(out, { brief });
        Object.assign(out, { stillModel: st.model, stillReason: st.reason });
      }
      return out;
    }),
  };
}

/**
 * Save the shot list. Needs a brief first. Missing models are filled in, the
 * checker runs, and a plan with errors is refused with every reason (exit 1)
 * so a broken plan never reaches stills or filming. Warnings ride along.
 */
export function savePlan(catalog, film, plan, { assets = [], menu = loadMenu(), now } = {}) {
  const brief = readBrief(film);
  if (!brief) throw usage(`runs/${film} has no brief yet. Save the brief first (kie brief, or save_brief).`);
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw usage("The plan must be an object with look and shots.");
  const filled = fillSuggestions(catalog, plan, { brief, menu });
  const check = checkPlan(filled, { catalog, brief, assets, menu });
  if (check.errors.length) {
    throw usage(`The plan was not saved:\n- ${check.errors.map((e) => e.message).join("\n- ")}`, { errors: check.errors, warnings: check.warnings });
  }
  const prev = readPlan(film);
  const saved = { ...filled, version: (prev?.version ?? 0) + 1 };
  writeFilmJson(film, "shots.json", saved, { now });
  return { plan: saved, check };
}

/**
 * Change some fields of one shot and save the whole plan through savePlan,
 * so an edit that breaks the plan is refused like any other. Changing the
 * job or the length without naming a model asks the picker again.
 */
export function updateShot(catalog, film, id, changes, opts = {}) {
  const plan = readPlan(film);
  if (!plan) throw usage(`runs/${film} has no plan yet. Save one first (kie plan --file, or save_plan).`);
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw usage("changes must be an object of shot fields.");
  if ("id" in changes && changes.id !== id) throw usage("A shot's id cannot change; delete and add it in a new plan instead.");
  findShot(plan, id);
  const repick = ("job" in changes || "durationS" in changes) && !("model" in changes);
  const shots = plan.shots.map((s) => {
    if (s.id !== id) return s;
    const next = { ...s, ...changes };
    if (repick) {
      delete next.model;
      delete next.modelReason;
    }
    // A still model the picker chose follows the job; one somebody named stays.
    if ("job" in changes && !("stillModel" in changes) && s.stillReason) {
      delete next.stillModel;
      delete next.stillReason;
    }
    return next;
  });
  const { version, ...rest } = plan;
  return savePlan(catalog, film, { ...rest, shots }, opts);
}
```

`cli/director/cost.mjs`:

```js
import { shotFit, stillFit } from "./fit.mjs";
import { dailyPosition } from "../core/spend.mjs";

const round = (n) => Math.round(n * 1000) / 1000;

/**
 * What the plan would cost: one still and one take per shot, at the length
 * each shot is generated. Reads today's position when a store is given;
 * reserves nothing and calls no provider.
 */
export function costPlan(catalog, plan, { brief = null, store = null, limits = null } = {}) {
  const shots = (plan?.shots ?? []).map((s) => {
    const still = s.stillModel ? stillFit(catalog, s.stillModel, { aspectRatio: brief?.aspectRatio }) : null;
    const take = s.model && s.durationS > 0 ? shotFit(catalog, s.model, { plannedS: s.durationS, aspectRatio: brief?.aspectRatio }) : null;
    return {
      id: s.id,
      stillModel: s.stillModel ?? null,
      stillUsd: still?.estimateUsd ?? null,
      model: s.model ?? null,
      generatedS: take?.generatedS ?? null,
      takeUsd: take?.estimateUsd ?? null,
    };
  });
  const sum = (k) => round(shots.reduce((t, s) => t + (s[k] ?? 0), 0));
  const stillsUsd = sum("stillUsd");
  const filmUsd = sum("takeUsd");
  const priced = shots.every((s) => s.stillUsd != null && s.takeUsd != null);
  const today = store && limits ? dailyPosition(store, limits) : null;
  return {
    shots,
    stillsUsd,
    filmUsd,
    totalUsd: round(stillsUsd + filmUsd),
    complete: priced,
    availableTodayUsd: today?.availableUsd ?? null,
  };
}
```

`cli/director/show.mjs` (exercised by the CLI and MCP tests in Tasks 9 and 10):

```js
// Plain-text views of a brief and a plan, shared by `kie plan` and the MCP tools.

const usd = (n) => (n == null ? "price unknown" : `$${n.toFixed(2)}`);

export function briefLines(brief) {
  if (!brief) return ["No brief yet."];
  const lines = [
    `takeaway: ${brief.takeaway}`,
    `film:     ${brief.durationS}s ${brief.aspectRatio} ${brief.filmType}`,
  ];
  if (brief.audience) lines.push(`audience: ${brief.audience}`);
  if (brief.tone) lines.push(`tone:     ${brief.tone}`);
  if (brief.mustShow?.length) lines.push(`show:     ${brief.mustShow.join("; ")}`);
  if (brief.copy?.length) lines.push(`copy:     ${brief.copy.map((c) => `"${c}"`).join(", ")}`);
  const sound = Object.entries(brief.sound ?? {}).map(([k, v]) => `${k}: ${v}`);
  if (sound.length) lines.push(`sound:    ${sound.join(" · ")}`);
  return lines;
}

export function findingLines({ errors, warnings }) {
  const lines = [];
  lines.push(errors.length ? `errors (${errors.length}), these block stills and filming:` : "errors: none");
  for (const e of errors) lines.push(`  ✗ ${e.message}`);
  if (warnings.length) lines.push(`warnings (${warnings.length}):`);
  for (const w of warnings) lines.push(`  ! ${w.message}`);
  return lines;
}

/** One line per fact: the film, the look, each shot with its model and price, the checker and the total. */
export function planLines({ film, brief, plan, check, cost }) {
  if (!plan) return [`runs/${film} has no plan yet.`];
  const total = (plan.shots ?? []).reduce((t, s) => t + (s.durationS ?? 0), 0);
  const l = plan.look ?? {};
  const lines = [
    `${film} · v${plan.version ?? "?"} · ${plan.shots.length} shot(s) · ${total}s of ${brief?.durationS ?? "?"}s · ${brief?.aspectRatio ?? "?"} ${brief?.filmType ?? ""}`.trim(),
    `look: ${l.filmLook} · ${l.palette} · ${l.grade} · ${l.lensFamily} lenses · key light ${l.keyLightSide}`,
    "",
  ];
  for (const s of plan.shots) {
    const c = cost.shots.find((x) => x.id === s.id) ?? {};
    const move = s.move?.type === "static" ? "static" : `${s.move?.type} ${s.move?.speed}`;
    lines.push(`${s.id}  ${s.durationS}s  ${s.size} · ${s.angle} · ${s.lens} · ${s.depth} · ${move} · ${s.light} · cut ${s.cut}`);
    lines.push(`    ${s.action}`);
    lines.push(`    film:  ${s.model ?? "no model"}${c.generatedS ? ` ${c.generatedS}s` : ""} ${usd(c.takeUsd)}${s.modelReason ? `  (${s.modelReason})` : ""}`);
    lines.push(`    still: ${s.stillModel ?? "no model"} ${usd(c.stillUsd)}`);
  }
  lines.push("", ...findingLines(check), "");
  lines.push(`cost: stills ${usd(cost.stillsUsd)} + film ${usd(cost.filmUsd)} = ${usd(cost.totalUsd)}${cost.complete ? "" : " (some shots have no price)"}`);
  if (cost.availableTodayUsd != null) lines.push(`today: ${usd(cost.availableTodayUsd)} left under the daily cap`);
  return lines;
}
```

- [ ] **Step 4: Run.** `node --test tests/director-plan.test.mjs` → 8 pass.

- [ ] **Step 5: Commit.**

```bash
git add cli/director/plan.mjs cli/director/cost.mjs cli/director/show.mjs tests/director-plan.test.mjs
git diff --cached --stat
git commit -m "director: save and edit the plan, price it, show it"
```

---

### Task 9: `kie brief` and `kie plan`

**Files:**
- Modify: `cli/kie.mjs` (imports, HELP, OPTS, three functions before `cmdTemplates`, two `case`s)
- Modify: `cli/README.md`
- Test: `tests/director-cli.test.mjs`

- [ ] **Step 1: Write the failing test** `tests/director-cli.test.mjs` (runs the CLI as a subprocess against a temp `runs/`):

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "kie-director-cli-")));
const KIE = new URL("../cli/kie.mjs", import.meta.url).pathname;
const env = { ...process.env, KIE_RUNS_DIR: join(tmp, "runs"), KIE_LIBRARY_DIR: join(tmp, "library"), KIE_LIMITS_FILE: join(tmp, "limits.json") };
mkdirSync(env.KIE_RUNS_DIR);
const kie = (...args) => {
  const r = spawnSync(process.execPath, [KIE, ...args], { env, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const file = (name, data) => {
  const p = join(tmp, name);
  writeFileSync(p, JSON.stringify(data));
  return p;
};

const look = { palette: "teal", grade: "soft", filmLook: "35mm grain", lensFamily: "anamorphic", keyLightSide: "left" };
const shot = (id, durationS, extra = {}) => ({
  id, durationS, purpose: "p", subject: "mara", action: "Mara walks along the pier", why: "w",
  size: "wide", angle: "eye-level", lens: "35mm", depth: "deep", move: { type: "truck-left", speed: "slow" },
  light: "overcast", cut: "hard", job: "cinematic", screenDirection: "left-to-right", checks: ["ok"], ...extra,
});

describe("kie brief and kie plan", () => {
  test("a plan before a brief is refused with code 1", () => {
    const r = kie("plan", "--run", "sea", "--file", file("p.json", { look, shots: [shot("s1", 10)] }));
    assert.equal(r.code, 1);
    assert.match(r.err, /runs\/sea has no brief yet/);
  });

  test("brief --file saves and shows it", () => {
    const r = kie("brief", "--run", "sea", "--file", file("b.json", { takeaway: "Calm mornings", durationS: 10, aspectRatio: "16:9", filmType: "live-action" }));
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^saved runs\/sea\/brief\.json\ntakeaway: Calm mornings\nfilm:     10s 16:9 live-action\n/);
  });

  test("plan --file saves a sound plan and prints shots, checker and cost", () => {
    const r = kie("plan", "--run", "sea", "--file", file("p.json", { look, shots: [shot("s1", 4), shot("s2", 6, { size: "close-up", lens: "85mm", screenDirection: "none" })] }));
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^saved runs\/sea\/shots\.json \(v1\)\nsea · v1 · 2 shot\(s\) · 10s of 10s · 16:9 live-action\n/);
    assert.match(r.out, /film: {2}seedance-2-5 5s \$\d+\.\d\d {2}\(S tier for cinematic\.\)/);
    assert.match(r.out, /\nerrors: none\n/);
    assert.match(r.out, /\ncost: stills \$\d+\.\d\d \+ film \$\d+\.\d\d = \$\d+\.\d\d\n/);
  });

  test("a bad plan file exits 1 with every reason; a file that is not JSON says so", () => {
    const r = kie("plan", "--run", "sea", "--file", file("bad.json", { look: {}, shots: [] }));
    assert.equal(r.code, 1);
    assert.match(r.err, /look\.palette is missing[\s\S]*The plan has no shots\./);
    writeFileSync(join(tmp, "torn.json"), "{");
    assert.match(kie("plan", "--run", "sea", "--file", join(tmp, "torn.json")).err, /torn\.json is not valid JSON/);
  });

  test("--json gives brief, plan, check and cost", () => {
    const r = kie("plan", "--run", "sea", "--json");
    const j = JSON.parse(r.out);
    assert.deepEqual(Object.keys(j), ["brief", "plan", "check", "cost"]);
    assert.equal(j.plan.version, 1);
  });

  test("--wording prints each shot's prompt and the params to pass", () => {
    const r = kie("plan", "--run", "sea", "--wording", "--shot", "s1");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /── s1 · seedance-2-5 · seedance · \d+\/6000 chars\n/);
    assert.match(r.out, /Shot 1: The camera slowly trucks left, wide shot/);
    assert.match(r.out, /--param generate_audio=false/);
    assert.doesNotMatch(r.out, /── s2/);
  });

  test("--suggest gives the pick and its reason", () => {
    const r = kie("plan", "--run", "sea", "--suggest");
    assert.match(r.out, /^s1 {2}film: seedance-2-5 \$\d+\.\d\d {2}S tier for cinematic\./m);
    assert.match(r.out, /still: nano-banana-2 {2}Nano Banana 2 for photoreal people and places\./);
  });

  test("--menu lists the groups; an unknown shot names the real ones", () => {
    assert.match(kie("plan", "--menu").out, /\nsizes\n {2}extreme-wide {7}/);
    const r = kie("plan", "--run", "sea", "--wording", "--shot", "s9");
    assert.equal(r.code, 3);
    assert.match(r.err, /No shot "s9"\. Shots: s1, s2/);
  });
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test tests/director-cli.test.mjs` → FAIL, `Unknown command "plan"`.

- [ ] **Step 3: Implement** in `cli/kie.mjs`:

```diff
diff --git a/cli/kie.mjs b/cli/kie.mjs
index 9119c4e..2affddd 100755
--- a/cli/kie.mjs
+++ b/cli/kie.mjs
@@ -32,6 +32,14 @@ import { assemble } from "./lib/assemble.mjs";
 import { burnCaptions } from "./lib/caption.mjs";
 import { makeVariants, captionOrderWarning } from "./lib/variants.mjs";
 import { render, TEMPLATES, BRAND_DIR } from "./lib/render.mjs";
+import { loadMenu, GROUPS } from "./director/menu.mjs";
+import { readBrief, saveBrief } from "./director/brief.mjs";
+import { readPlan, savePlan, findShot } from "./director/plan.mjs";
+import { checkPlan } from "./director/check.mjs";
+import { costPlan } from "./director/cost.mjs";
+import { suggestModel, suggestStillModel } from "./director/pick.mjs";
+import { shotWording } from "./director/wording.mjs";
+import { briefLines, planLines } from "./director/show.mjs";
 
 const HELP = `kie -- motion-design execution layer
 
@@ -56,6 +64,14 @@ const HELP = `kie -- motion-design execution layer
                  [--voice V] [--budget U]
                  [--provider kie|wavespeed] [--no-wait] [--dry-run]
 
+Director (planning only — free):
+  kie brief      --run SLUG [--file BRIEF.json]          show the brief, or check and save one
+  kie plan       --run SLUG [--json]                     the shot plan, the checker and the cost
+  kie plan       --run SLUG --file PLAN.json             check and save a plan (refused with reasons)
+  kie plan       --run SLUG --suggest [--shot ID]        the model picker's choice and why
+  kie plan       --run SLUG --wording [--shot ID]        each shot's prompt, worded for its model
+  kie plan       --menu [--json]                         every size, angle, lens, move, light and cut
+
   kie job        <local job id>            wait for a job and download it
   kie job resolve <local job id> (--task ID | --not-created)
                                            settle an uncertain job after checking the provider's log
@@ -140,6 +156,10 @@ const OPTS = {
   task: { type: "string" },
   "not-created": { type: "boolean", default: false },
   "dry-run": { type: "boolean", default: false },
+  file: { type: "string" },
+  menu: { type: "boolean", default: false },
+  suggest: { type: "boolean", default: false },
+  wording: { type: "boolean", default: false },
   help: { type: "boolean", default: false },
 };
 
@@ -924,6 +944,86 @@ async function cmdVariants(args) {
 
 // ----------------------------------------- graphic motion (code-rendered)
 
+// --------------------------------------------------------------- director
+
+function readJsonFile(path) {
+  if (!path) return null;
+  let text;
+  try {
+    text = readFileSync(resolve(path), "utf8");
+  } catch {
+    throw usage(`Cannot read ${path}.`);
+  }
+  try {
+    return JSON.parse(text);
+  } catch (e) {
+    throw usage(`${path} is not valid JSON: ${e.message}`);
+  }
+}
+
+function cmdBrief(args) {
+  if (!args.run) throw usage("kie brief --run SLUG [--file BRIEF.json]");
+  if (args.file) {
+    saveBrief(args.run, readJsonFile(args.file));
+    say(`saved runs/${args.run}/brief.json`);
+  }
+  const brief = readBrief(args.run);
+  if (args.json) return say(JSON.stringify(brief, null, 2));
+  for (const line of briefLines(brief)) say(line);
+  if (!brief) say(`Write one: kie brief --run ${args.run} --file brief.json`);
+}
+
+function cmdMenu(args) {
+  const menu = loadMenu();
+  if (args.json) return say(JSON.stringify(menu, null, 2));
+  for (const group of GROUPS) {
+    say(`\n${group}`);
+    for (const e of menu[group]) say(`  ${e.id.padEnd(18)} ${e.when}`);
+  }
+}
+
+function cmdPlan(catalog, args) {
+  if (args.menu) return cmdMenu(args);
+  if (!args.run) throw usage("kie plan --run SLUG [--file PLAN.json | --suggest | --wording] [--shot ID]   or   kie plan --menu");
+  const assets = openLibrary().list();
+  if (args.file) {
+    const { plan } = savePlan(catalog, args.run, readJsonFile(args.file), { assets });
+    say(`saved runs/${args.run}/shots.json (v${plan.version})`);
+  }
+  const brief = readBrief(args.run);
+  const plan = readPlan(args.run);
+  if (!plan) throw usage(`runs/${args.run} has no plan yet. Save one: kie plan --run ${args.run} --file plan.json`);
+  const shots = args.shot.length ? args.shot.map((id) => findShot(plan, id)) : plan.shots;
+
+  if (args.suggest) {
+    const out = shots.map((s) => ({ shot: s.id, film: suggestModel(catalog, s, { brief }), still: suggestStillModel(s, { brief }) }));
+    if (args.json) return say(JSON.stringify(out, null, 2));
+    for (const { shot, film, still } of out) {
+      say(`${shot}  film: ${film.model ?? "none"}${film.estimateUsd != null ? ` $${film.estimateUsd.toFixed(2)}` : ""}  ${film.reason}`);
+      for (const r of film.ruledOut) say(`      not ${r.model} (${r.tier}): ${r.why}`);
+      say(`      still: ${still.model}  ${still.reason}`);
+    }
+    return;
+  }
+  if (args.wording) {
+    const out = shots.map((s) => shotWording(catalog, plan, s, { assets }));
+    if (args.json) return say(JSON.stringify(out, null, 2));
+    for (const w of out) {
+      say(`\n── ${w.shot} · ${w.model} · ${w.family} · ${w.chars}${w.maxChars ? `/${w.maxChars}` : ""} chars`);
+      say(w.prompt);
+      const params = Object.entries(w.params).map(([k, v]) => `--param ${k}=${v}`);
+      if (params.length) say(`   ${params.join(" ")}`);
+      for (const p of w.problems) warn(`   ! ${p}`);
+    }
+    return;
+  }
+  const check = checkPlan(plan, { catalog, brief, assets });
+  const cost = costPlan(catalog, plan, { brief, store: openJobs(), limits: readLimits() });
+  if (args.json) return say(JSON.stringify({ brief, plan, check, cost }, null, 2));
+  for (const line of planLines({ film: args.run, brief, plan, check, cost })) say(line);
+  return check.errors.length ? EXIT.USAGE : EXIT.OK;
+}
+
 function cmdTemplates() {
   say(`Code-rendered graphic motion. No key, no spend, pixel-exact, re-renderable.\n`);
   for (const [id, desc] of Object.entries(TEMPLATES)) say(`  ${id.padEnd(14)} ${desc}`);
@@ -1051,6 +1151,10 @@ async function main(argv) {
       return cmdCaption(args);
     case "variants":
       return cmdVariants(args);
+    case "brief":
+      return cmdBrief(args) ?? EXIT.OK;
+    case "plan":
+      return cmdPlan(catalog, args) ?? EXIT.OK;
     case "templates":
       return cmdTemplates();
     case "render":
```

and document it in `cli/README.md`:

```diff
diff --git a/cli/README.md b/cli/README.md
index 39a6496..41c3f5f 100644
--- a/cli/README.md
+++ b/cli/README.md
@@ -40,6 +40,14 @@ Corollary: **the CLI refuses an unknown model rather than forwarding it.**
 | `lib/caption.mjs` | SRT parsing/validation, alpha-overlay compositing |
 | `lib/variants.mjs` | Aspect reframing and the caption-order guard |
 | `lib/render.mjs` | Bridge to the Remotion project in `render/` |
+| `director/menu.json` | The director's fixed vocabulary: sizes, angles, lenses, moves, lights, cuts, jobs, film types |
+| `director/files.mjs` | `runs/<film>/brief.json` and `shots.json`: atomic writes, `.history/`, links refused |
+| `director/brief.mjs` | The brief's fields and their checks |
+| `director/check.mjs` | The script supervisor: errors that block, warnings that advise |
+| `director/fit.mjs` | Can a model film a shot from its still, at what generated length and price |
+| `director/pick.mjs` | The model picker, from `goodFor` ratings |
+| `director/wording.mjs` | One shot worded for its model, from `promptProfile` |
+| `director/plan.mjs`, `cost.mjs`, `show.mjs` | Saving and editing the plan, its cost, its text view |
 
 Zero npm dependencies. Two optional binaries, and the CLI says which commands
 need them: **ffmpeg** for finishing, and `render/`'s own `npm install` for
@@ -102,6 +110,25 @@ Every file is checked by its contents before it is sent: PNG, JPEG, WebP,
 MP4, MOV, WAV, MP3, AAC or OGG, under 30 MB (200 MB for video). Results are
 downloaded only from https URLs, only into the run directory.
 
+### Director (planning)
+
+`kie brief --run sea --file brief.json` saves a film's brief (takeaway,
+length, frame, film type, tone, exact copy, sound) to `runs/sea/brief.json`.
+`kie plan --run sea --file plan.json` saves its shot list to `shots.json`.
+Every shot picks its size, angle, lens, depth, one move, light and cut from
+`director/menu.json` (`kie plan --menu`); leave `model` out and the picker
+fills it from the `goodFor` ratings in `models.json`, ruling out models that
+cannot film the shot from its still. A plan the checker finds errors in is
+refused (exit 1) with every reason; warnings are printed and never block.
+
+`kie plan --run sea` shows the plan, the checker and the cost of one still
+and one take per shot, at the length each take is generated (the shot plus a
+one-second trim margin). `--wording` prints each shot's prompt in the shape
+its model reads best (`promptProfile`), with the `--param` flags to pass;
+`--suggest` explains each model choice. All of it is free. Old versions of
+both files move to `runs/sea/.history/`. The craft behind the menu is in
+`skills/motion-design/references/director/`.
+
 ### MCP server
 
 `mcp/` is a separate package that exposes this layer to Claude Code and Codex
@@ -178,7 +205,11 @@ Consequences:
   table is what makes the refusals meaningful.
 
 Adding a model is one entry: `capability`, `family`, provider `model` string,
-the real limits, a price, and a note saying what it is for.
+the real limits, a price, and a note saying what it is for. A video model also
+gets a `promptProfile` (the wording family, its prompt length limit and its
+audio-off param), and a `goodFor` rating only when the table in
+`skills/motion-design/references/tool-routing.md` rates it; a test keeps the
+two in step.
 
 ## Two providers, one interface
 
```

- [ ] **Step 4: Run.** `node --test tests/director-cli.test.mjs` → 8 pass. `npm test` → green except `director-handbook` (not written yet; Task 11).

- [ ] **Step 5: Commit.**

```bash
git add cli/kie.mjs cli/README.md tests/director-cli.test.mjs
git diff --cached --stat
git commit -m "kie brief and kie plan: show, check, price and word a plan for free"
```

---

### Task 10: MCP planning tools

Nine free tools in a new file, registered from `createServer`. Input schemas use the menu's ids as enums so the agent sees the vocabulary in the tool list. Shots are `z.looseObject` so later steps' fields (`still`, `take`, `status`) survive. The studio chat reaches MCP tools through an in-process client, so it gets these with no web change; only the hard-coded counts move from 18 to 27.

**Files:**
- Create: `mcp/director.mjs`, `mcp/tests/director.test.mjs`
- Modify: `mcp/server.mjs`, `mcp/README.md`, `mcp/tests/look.test.mjs`, `mcp/tests/client.test.mjs`, `web/tests/chat-setup.test.mjs`, `web/tests/chat-openai.test.mjs`

- [ ] **Step 1: Write the failing tests** `mcp/tests/director.test.mjs`:

```js
import { RUNS, stubs, connect, call, errorOf } from "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { deps, calls } = stubs();
const client = await connect(deps);

const brief = { takeaway: "Mornings by the sea are calm", durationS: 10, aspectRatio: "16:9", filmType: "live-action" };
const look = { palette: "teal and amber", grade: "soft contrast", filmLook: "35mm film grain", lensFamily: "anamorphic", keyLightSide: "left" };
const shot = (id, durationS, extra = {}) => ({
  id, durationS, purpose: "p", subject: "mara", action: "Mara walks along the wet pier", why: "w",
  size: "wide", angle: "eye-level", lens: "35mm", depth: "deep", move: { type: "truck-left", speed: "slow" },
  light: "overcast", cut: "hard", job: "cinematic", screenDirection: "left-to-right", checks: ["Mara stays on the pier"], ...extra,
});
const plan = { look, shots: [shot("s1", 4), shot("s2", 6, { size: "close-up", lens: "85mm", screenDirection: "none" })] };

describe("director tools", () => {
  test("get_menu lists every group with its ids", async () => {
    const r = await call(client, "get_menu");
    assert.equal(r.isError, undefined, JSON.stringify(r));
    assert.ok(r.structuredContent.menu.moves.some((m) => m.id === "push-in"));
    assert.match(r.content[0].text, /^sizes: extreme-wide/);
  });

  test("save_plan before a brief is refused with code 1", async () => {
    const r = await call(client, "save_plan", { run: "sea", plan });
    assert.equal(r.isError, true);
    assert.equal(errorOf(r).code, 1);
    assert.match(r.content[0].text, /no brief yet/);
  });

  test("save_brief then get_brief round-trips", async () => {
    const saved = await call(client, "save_brief", { run: "sea", brief });
    assert.equal(saved.isError, undefined, JSON.stringify(saved));
    const r = await call(client, "get_brief", { run: "sea" });
    assert.deepEqual(r.structuredContent.brief, brief);
  });

  test("save_plan fills models, checks, prices and writes shots.json", async () => {
    const r = await call(client, "save_plan", { run: "sea", plan });
    assert.equal(r.isError, undefined, JSON.stringify(r));
    const sc = r.structuredContent;
    assert.equal(sc.plan.version, 1);
    assert.deepEqual(sc.plan.shots.map((s) => s.model), ["seedance-2-5", "seedance-2-5"]);
    assert.deepEqual(sc.check.errors, []);
    assert.ok(sc.cost.totalUsd > 0);
    assert.ok(existsSync(join(RUNS, "sea", "shots.json")));
    assert.equal(calls.create.length, 0, "nothing was generated");
  });

  test("a plan that breaks a rule is refused with every reason", async () => {
    const bad = { look, shots: [shot("s1", 4)] };
    const r = await call(client, "save_plan", { run: "sea", plan: bad });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /add up to 4s; the brief asks for 10s/);
    assert.equal(JSON.parse(readFileSync(join(RUNS, "sea", "shots.json"), "utf8")).version, 1, "the saved plan is untouched");
  });

  test("a value off the menu is refused before the checker", async () => {
    const r = await call(client, "save_plan", { run: "sea", plan: { look, shots: [shot("s1", 10, { size: "huge" })] } });
    assert.equal(r.isError, true);
  });

  test("update_shot changes one field and saves a new version", async () => {
    const r = await call(client, "update_shot", { run: "sea", shot: "s2", changes: { job: "motion-graphics" } });
    assert.equal(r.isError, undefined, JSON.stringify(r));
    const s2 = r.structuredContent.plan.shots[1];
    assert.equal(s2.model, "minimax-h3");
    assert.equal(r.structuredContent.plan.version, 2);
  });

  test("check_plan checks an unsaved plan without writing it", async () => {
    const r = await call(client, "check_plan", { run: "sea", plan: { look, shots: [shot("s1", 4), shot("s2", 6, { screenDirection: "right-to-left" })] } });
    assert.equal(r.isError, undefined, JSON.stringify(r));
    assert.ok(r.structuredContent.errors.some((e) => e.rule === "screen-direction"));
  });

  test("suggest_model gives the pick, its reason and the still model", async () => {
    const r = await call(client, "suggest_model", { run: "sea", shot: "s1" });
    assert.equal(r.isError, undefined, JSON.stringify(r));
    assert.equal(r.structuredContent.model, "seedance-2-5");
    assert.equal(r.structuredContent.stillModel, "nano-banana-2");
  });

  test("shot_wording words the shot for its model with audio off", async () => {
    const r = await call(client, "shot_wording", { run: "sea", shot: "s1" });
    assert.equal(r.isError, undefined, JSON.stringify(r));
    assert.equal(r.structuredContent.family, "seedance");
    assert.deepEqual(r.structuredContent.params, { generate_audio: false });
    assert.match(r.structuredContent.prompt, /^Look: 35mm film grain/);
  });

  test("an unknown shot names the shots there are", async () => {
    const r = await call(client, "shot_wording", { run: "sea", shot: "s9" });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /Shots: s1, s2/);
  });
});
```

and move the counts:

```diff
diff --git a/mcp/tests/look.test.mjs b/mcp/tests/look.test.mjs
index 557c270..be2cef9 100644
--- a/mcp/tests/look.test.mjs
+++ b/mcp/tests/look.test.mjs
@@ -15,10 +15,11 @@ const TOOLS = [
   "save_asset", "list_assets", "get_asset",
   "generate_image", "generate_video", "wait_job",
   "frames", "probe", "assemble", "variants", "caption", "render",
+  "get_menu", "get_brief", "save_brief", "get_plan", "save_plan", "update_shot", "check_plan", "suggest_model", "shot_wording",
 ];
 
 describe("the tool list", () => {
-  test("all 18 tools; spending tools say so first and are marked open-world, not destructive", async () => {
+  test("all 27 tools; spending tools say so first and are marked open-world, not destructive", async () => {
     const { tools } = await client.listTools();
     assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOLS].sort());
     for (const name of ["generate_image", "generate_video"]) {
diff --git a/mcp/tests/client.test.mjs b/mcp/tests/client.test.mjs
index f32da3e..8fbddb0 100644
--- a/mcp/tests/client.test.mjs
+++ b/mcp/tests/client.test.mjs
@@ -5,11 +5,11 @@ import assert from "node:assert/strict";
 const { connectInProcess } = await import("../client.mjs");
 
 describe("connectInProcess", () => {
-  test("lists the same 18 tools and the server's instructions, and calls a tool through the given deps", async () => {
+  test("lists the same 27 tools and the server's instructions, and calls a tool through the given deps", async () => {
     const { deps } = stubs();
     const { client, close } = await connectInProcess({ deps });
     const { tools } = await client.listTools();
-    assert.equal(tools.length, 18);
+    assert.equal(tools.length, 27);
     assert.ok(tools.some((t) => t.name === "generate_video"));
     assert.match(client.getInstructions(), /^Motion-design studio over kie\.ai\./);
     const r = await call(client, "estimate", { model: "seedance-2-5", duration_s: 4, resolution: "480p" });
diff --git a/web/tests/chat-setup.test.mjs b/web/tests/chat-setup.test.mjs
index 5057995..e490559 100644
--- a/web/tests/chat-setup.test.mjs
+++ b/web/tests/chat-setup.test.mjs
@@ -63,9 +63,9 @@ describe("tools over the in-process MCP client", () => {
   const tools = createTools({ deps });
   after(() => tools.close());
 
-  test("offers the 18 MCP tools as function tools, without the schema keywords the Responses API rejects", async () => {
+  test("offers the 27 MCP tools as function tools, without the schema keywords the Responses API rejects", async () => {
     const fns = await tools.functions();
-    assert.equal(fns.length, 18);
+    assert.equal(fns.length, 27);
     const video = fns.find((f) => f.name === "generate_video");
     assert.equal(video.type, "function");
     assert.equal(video.strict, false);
diff --git a/web/tests/chat-openai.test.mjs b/web/tests/chat-openai.test.mjs
index 348781e..60ff2a3 100644
--- a/web/tests/chat-openai.test.mjs
+++ b/web/tests/chat-openai.test.mjs
@@ -44,7 +44,7 @@ describe("runTurn", () => {
     assert.equal(req.body.stream, true);
     assert.equal(req.body.store, false);
     assert.deepEqual(req.body.input, [{ role: "user", content: "Make a 4s fox clip." }]);
-    assert.equal(req.body.tools.length, 18);
+    assert.equal(req.body.tools.length, 27);
   });
 
   test("runs the function loop: the model calls estimate, the MCP tool answers, the result goes back, then the model answers", async () => {
```

- [ ] **Step 2: Run them and see them fail.** `npm run test:mcp` → FAIL (18 tools; unknown tool `get_menu`).

- [ ] **Step 3: Implement** `mcp/director.mjs`:

```js
// The director's planning tools: brief, shot plan, checker, model picker and
// per-model wording. All of them are free; nothing here reaches a provider.
import { z } from "zod";
import { loadMenu, ids, GROUPS } from "../cli/director/menu.mjs";
import { ASPECTS, MAX_FILM_S, readBrief, saveBrief } from "../cli/director/brief.mjs";
import { readPlan, savePlan, updateShot, findShot } from "../cli/director/plan.mjs";
import { checkPlan } from "../cli/director/check.mjs";
import { costPlan } from "../cli/director/cost.mjs";
import { suggestModel, suggestStillModel } from "../cli/director/pick.mjs";
import { shotWording } from "../cli/director/wording.mjs";
import { briefLines, planLines, findingLines } from "../cli/director/show.mjs";
import { ok } from "./results.mjs";

const LOOK = { readOnlyHint: true, openWorldHint: false };
const LOCAL_WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

export function registerDirector(tool, { catalog, ctx }) {
  const menu = loadMenu();
  const pick = (group) => z.enum(ids(menu, group));
  const run = z.string().describe("The film's run folder slug: lowercase letters, digits, hyphens.");

  const Brief = z.object({
    takeaway: z.string().describe("The one thing the viewer should leave with."),
    durationS: z.number().int().min(1).max(MAX_FILM_S),
    aspectRatio: z.enum(ASPECTS),
    filmType: pick("filmTypes"),
    audience: z.string().optional(),
    tone: z.string().optional(),
    mustShow: z.array(z.string()).optional(),
    copy: z.array(z.string()).optional().describe("Exact on-screen text. The edit renders it in code; models never draw it."),
    sound: z.object({ music: z.string().optional(), voice: z.string().optional(), sfx: z.string().optional() }).optional(),
  });
  const Shot = z.looseObject({
    id: z.string().describe("Short id such as s1."),
    durationS: z.number().positive().describe("Seconds this shot holds in the cut."),
    purpose: z.string(),
    subject: z.string(),
    action: z.string().describe("What happens, in words. No quoted text, prices or percentages; those go in copy."),
    why: z.string().describe("Why this framing and move tell the story."),
    size: pick("sizes"),
    angle: pick("angles"),
    lens: pick("lenses"),
    depth: pick("depths"),
    move: z.object({ type: pick("moves"), speed: pick("speeds").optional() }).describe("One move per shot."),
    light: pick("lights"),
    cut: pick("cuts").describe("How this shot cuts to the next."),
    job: pick("jobs").describe("Drives the model picker."),
    screenDirection: pick("screenDirections"),
    checks: z.array(z.string()).min(1).max(3).describe("Pass/fail sentences a reviewer can judge from the take."),
    cast: z.array(z.string()).optional().describe("Library asset names in this shot."),
    copy: z.array(z.string()).optional(),
    model: z.string().optional().describe("Leave out to let the picker choose."),
    stillModel: z.string().optional(),
    keyLightSide: pick("keyLightSides").optional(),
    lightReason: z.string().optional(),
    crossesLine: z.string().optional().describe("Why this shot deliberately breaks screen direction."),
  });
  const Plan = z.object({
    look: z.looseObject({
      palette: z.string(),
      grade: z.string(),
      filmLook: z.string(),
      lensFamily: pick("lensLooks"),
      keyLightSide: pick("keyLightSides"),
      cast: z.array(z.object({ asset: z.string(), role: z.string() })).optional(),
    }),
    shots: z.array(Shot).min(1),
  });
  const Finding = z.object({ shot: z.string().nullable(), rule: z.string(), message: z.string() });
  const Check = { errors: z.array(Finding), warnings: z.array(Finding) };
  const Cost = z.object({
    shots: z.array(
      z.object({
        id: z.string().nullable(),
        stillModel: z.string().nullable(),
        stillUsd: z.number().nullable(),
        model: z.string().nullable(),
        generatedS: z.number().nullable(),
        takeUsd: z.number().nullable(),
      }),
    ),
    stillsUsd: z.number(),
    filmUsd: z.number(),
    totalUsd: z.number(),
    complete: z.boolean(),
    availableTodayUsd: z.number().nullable(),
  });
  const Data = z.record(z.string(), z.unknown());

  /** The plan with its checker results and cost, the way get_plan and the saves report it. */
  const planView = (film, plan, { store, limits, library }) => {
    const brief = readBrief(film);
    const check = checkPlan(plan, { catalog, brief, assets: library.list(), menu });
    const cost = costPlan(catalog, plan, { brief, store, limits });
    return { text: planLines({ film, brief, plan, check, cost }).join("\n"), data: { brief, plan, check, cost } };
  };
  const PlanOut = { brief: Data.nullable(), plan: Data.nullable(), check: z.object(Check), cost: Cost };

  tool(
    "get_menu",
    {
      title: "Director's menu",
      description:
        "Every shot size, angle, lens, depth, camera move, speed, light, cut, screen direction, job and film type a plan may use, each with when to use it. Free.",
      inputSchema: {},
      outputSchema: { menu: Data },
      annotations: LOOK,
    },
    async () => {
      const text = GROUPS.map((g) => `${g}: ${menu[g].map((e) => `${e.id} (${e.when})`).join("; ")}`).join("\n");
      return ok(text, { menu });
    },
  );

  tool(
    "get_brief",
    {
      title: "Get brief",
      description: "The film's brief: takeaway, length, frame, film type, audience, tone, must-shows, exact copy and sound. Free.",
      inputSchema: { run },
      outputSchema: { brief: Data.nullable() },
      annotations: LOOK,
    },
    async (a) => {
      const brief = readBrief(a.run);
      return ok(briefLines(brief).join("\n"), { brief });
    },
  );

  tool(
    "save_brief",
    {
      title: "Save brief",
      description:
        "Write the film's brief, replacing the old one (kept in .history). Agree it with the user first: develop a vague idea into a takeaway, offer two or three directions when unsure. Free.",
      inputSchema: { run, brief: Brief },
      outputSchema: { brief: Data },
      annotations: LOCAL_WRITE,
    },
    async (a) => {
      const brief = saveBrief(a.run, a.brief, { menu });
      return ok(`Saved runs/${a.run}/brief.json\n${briefLines(brief).join("\n")}`, { brief });
    },
  );

  tool(
    "get_plan",
    {
      title: "Get plan",
      description: "The film's shot plan with the checker's errors and warnings and the cost of every still and take. Free.",
      inputSchema: { run },
      outputSchema: PlanOut,
      annotations: LOOK,
    },
    async (a) => {
      const c = ctx();
      const plan = readPlan(a.run);
      if (!plan) return ok(`runs/${a.run} has no plan yet.`, { brief: readBrief(a.run), plan: null, check: { errors: [], warnings: [] }, cost: costPlan(catalog, null, {}) });
      const v = planView(a.run, plan, c);
      return ok(v.text, v.data);
    },
  );

  tool(
    "save_plan",
    {
      title: "Save plan",
      description:
        "Write the whole shot plan. Needs a saved brief. Leave model out on a shot to let the picker choose. A plan the checker finds errors in is refused with every reason; fix them and save again. Free.",
      inputSchema: { run, plan: Plan },
      outputSchema: PlanOut,
      annotations: LOCAL_WRITE,
    },
    async (a) => {
      const c = ctx();
      const { plan } = savePlan(catalog, a.run, a.plan, { assets: c.library.list(), menu });
      const v = planView(a.run, plan, c);
      return ok(`Saved runs/${a.run}/shots.json (v${plan.version}).\n${v.text}`, v.data);
    },
  );

  tool(
    "update_shot",
    {
      title: "Update shot",
      description:
        "Change some fields of one shot and save the plan, refused like save_plan if it breaks a rule. Changing job or durationS without a model asks the picker again. Free.",
      inputSchema: { run, shot: z.string(), changes: Shot.partial() },
      outputSchema: PlanOut,
      annotations: LOCAL_WRITE,
    },
    async (a) => {
      const c = ctx();
      const { plan } = updateShot(catalog, a.run, a.shot, a.changes, { assets: c.library.list(), menu });
      const v = planView(a.run, plan, c);
      return ok(`Updated ${a.shot} (v${plan.version}).\n${v.text}`, v.data);
    },
  );

  tool(
    "check_plan",
    {
      title: "Check plan",
      description: "Run the checker on a plan without saving it, or on the saved plan when plan is left out. Errors block; warnings are craft notes. Free.",
      inputSchema: { run, plan: Plan.optional() },
      outputSchema: Check,
      annotations: LOOK,
    },
    async (a) => {
      const { library } = ctx();
      const plan = a.plan ?? readPlan(a.run);
      if (!plan) return ok(`runs/${a.run} has no plan yet.`, { errors: [], warnings: [] });
      const check = checkPlan(plan, { catalog, brief: readBrief(a.run), assets: library.list(), menu });
      return ok(findingLines(check).join("\n"), check);
    },
  );

  tool(
    "suggest_model",
    {
      title: "Suggest model",
      description:
        "The model to film one saved shot on, from Alex's ratings for its job, with the reason, the price and every rated model ruled out and why; plus the image model for its still. Free.",
      inputSchema: { run, shot: z.string() },
      outputSchema: {
        shot: z.string(),
        model: z.string().nullable(),
        tier: z.string().nullable(),
        reason: z.string(),
        generatedS: z.number().nullable(),
        estimateUsd: z.number().nullable(),
        ruledOut: z.array(z.object({ model: z.string(), tier: z.string(), why: z.string() })),
        stillModel: z.string(),
        stillReason: z.string(),
      },
      annotations: LOOK,
    },
    async (a) => {
      const plan = readPlan(a.run);
      const shot = findShot(plan, a.shot);
      const brief = readBrief(a.run);
      const s = suggestModel(catalog, shot, { brief, menu });
      const still = suggestStillModel(shot, { brief });
      const data = {
        shot: shot.id,
        model: s.model,
        tier: s.tier,
        reason: s.reason,
        generatedS: s.generatedS,
        estimateUsd: s.estimateUsd,
        ruledOut: s.ruledOut,
        stillModel: still.model,
        stillReason: still.reason,
      };
      const lines = [`${shot.id}: ${s.model ?? "no model"} — ${s.reason}`, ...s.ruledOut.map((r) => `not ${r.model} (${r.tier}): ${r.why}`), `still: ${still.model} — ${still.reason}`];
      return ok(lines.join("\n"), data);
    },
  );

  tool(
    "shot_wording",
    {
      title: "Shot wording",
      description:
        "One saved shot's prompt, worded the way its model reads best, with the params it needs (audio off) and its length against the model's limit. Pass prompt and params to generate_video unchanged. Free.",
      inputSchema: { run, shot: z.string() },
      outputSchema: {
        shot: z.string(),
        model: z.string(),
        family: z.string(),
        prompt: z.string(),
        params: Data,
        chars: z.number(),
        maxChars: z.number().nullable(),
        problems: z.array(z.string()),
      },
      annotations: LOOK,
    },
    async (a) => {
      const { library } = ctx();
      const plan = readPlan(a.run);
      const w = shotWording(catalog, plan, findShot(plan, a.shot), { menu, assets: library.list() });
      return ok(`${w.shot} · ${w.model} · ${w.family}\n${w.prompt}`, w);
    },
  );
}
```

Register it and extend the instructions in `mcp/server.mjs`:

```diff
diff --git a/mcp/server.mjs b/mcp/server.mjs
index f71e668..92081f6 100755
--- a/mcp/server.mjs
+++ b/mcp/server.mjs
@@ -30,6 +30,7 @@ import { allowedRoots, confinePath, confineProps } from "../cli/core/inputs.mjs"
 import { status, listModels, listPresets, estimate, listRuns, getRun } from "../cli/core/views.mjs";
 import { ok, fail } from "./results.mjs";
 import { artifactPreview, imagePreview } from "./preview.mjs";
+import { registerDirector } from "./director.mjs";
 
 const VERSION = "0.1.0";
 
@@ -39,7 +40,9 @@ const INSTRUCTIONS =
   "against a per-job budget and a daily cap. Error 2 means nothing was spent: ask the user. " +
   "Error 5 means a job may exist: never resubmit it. " +
   "If a call times out or its result is lost, call status before generating again: an unsettled job may already exist. " +
-  "Relative paths are inside runs/; only runs/, library/ and folders the user allowed can be read.";
+  "Relative paths are inside runs/; only runs/, library/ and folders the user allowed can be read. " +
+  "To make a film, direct it: agree a brief (save_brief), plan the shots from the menu (get_menu, save_plan), " +
+  "and let the checker, the model picker and shot_wording do the craft; all of these are free.";
 
 const LOOK = { readOnlyHint: true, openWorldHint: false };
 const LOCAL_WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
@@ -149,6 +152,7 @@ export function createServer({ deps = {}, catalog = loadCatalog() } = {}) {
   registerAssets();
   registerGenerate(); // Task 5
   registerFinish(); // Task 6
+  registerDirector(tool, { catalog, ctx });
   return server;
 
   function registerLook() {
```

And the tool table in `mcp/README.md`:

```diff
diff --git a/mcp/README.md b/mcp/README.md
index efe198f..67ca229 100644
--- a/mcp/README.md
+++ b/mcp/README.md
@@ -30,6 +30,7 @@ the same code as the `kie` CLI.
 | Assets | `save_asset`, `list_assets`, `get_asset` | free |
 | Generate | `generate_image`, `generate_video`, `wait_job` | spends kie credits |
 | Finish | `frames`, `probe`, `assemble`, `variants`, `caption`, `render` | free, local |
+| Direct | `get_menu`, `get_brief`, `save_brief`, `get_plan`, `save_plan`, `update_shot`, `check_plan`, `suggest_model`, `shot_wording` | free, local |
 
 ## Limits that protect your money
 
```

- [ ] **Step 4: Run.** `npm run test:mcp` → 50 pass. `npm --prefix web run test:server` → 270 pass.

- [ ] **Step 5: Commit.**

```bash
git add mcp/director.mjs mcp/server.mjs mcp/README.md mcp/tests/director.test.mjs mcp/tests/look.test.mjs mcp/tests/client.test.mjs web/tests/chat-setup.test.mjs web/tests/chat-openai.test.mjs
git diff --cached --stat
git commit -m "mcp: nine free director tools; the studio chat gets them too"
```

---

### Task 11: The handbook (delegate to Sonnet)

Prose the agent reads before planning. Guidance only: anything code enforces lives in the menu and the checker.

**Files:**
- Create: `skills/motion-design/references/director/{craft,product-ui,live-action,character,product-hero,brief}.md`
- Test: `tests/director-handbook.test.mjs`

- [ ] **Step 1: Write the failing test** `tests/director-handbook.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadMenu } from "../cli/director/menu.mjs";
import { loadCatalog } from "../cli/lib/models.mjs";

const menu = loadMenu();
const DIR = new URL("../skills/motion-design/references/director/", import.meta.url);
const read = (name) => readFileSync(new URL(name, DIR), "utf8");

describe("the director's handbook", () => {
  test("every film type's chapter exists in the handbook", () => {
    for (const f of menu.filmTypes) assert.ok(read(f.chapter).length > 500, f.chapter);
  });

  test("craft.md explains every size, angle, lens, move and light by its label", () => {
    const craft = read("craft.md").toLowerCase();
    for (const g of ["sizes", "angles", "lenses", "depths", "moves", "lights", "cuts"]) {
      for (const e of menu[g]) assert.ok(craft.includes(e.label.toLowerCase()), `craft.md mentions ${g}: ${e.label}`);
    }
  });

  test("names no provider model id, so prose never pins a model", () => {
    const ids = loadCatalog().list.map((m) => m.id);
    for (const name of ["craft.md", "brief.md", ...menu.filmTypes.map((f) => f.chapter)]) {
      const text = read(name);
      for (const id of ids) assert.ok(!new RegExp(`\\b${id}\\b`).test(text), `${name} names ${id}`);
    }
  });
});
```

- [ ] **Step 2: Run it and see it fail.** `node --test tests/director-handbook.test.mjs` → 3 FAIL (ENOENT).

- [ ] **Step 3: Write the chapters.**
  - `craft.md`: sizes, angles, lenses (spherical and anamorphic), depth, every move and speed, every light and the key side, composition, every cut including continuous, continuity (180° line, screen direction, eyelines, light direction, the 30° rule), pacing. Each entry is headed by its menu **label exactly** (for example "Medium close-up", "Worm's eye", "85mm portrait", "Shallow (f/1.4-2)", "Whip pan"), then its id. It covers what the entry is, when to use it and what to avoid.
  - `product-ui.md`, `live-action.md`, `character.md`, `product-hero.md`: typical coverage, a worked 3 to 5 shot example in menu ids, common mistakes.
  - `brief.md`: idea to brief (the fields), when to ask, offering two or three directions, brief to shot count.
  - No model ids, no em dashes, relative links between chapters.

- [ ] **Step 4: Run.** `node --test tests/director-handbook.test.mjs` → 3 pass.

- [ ] **Step 5: Commit.**

```bash
git add skills/motion-design/references/director tests/director-handbook.test.mjs
git diff --cached --stat
git commit -m "skill: the director's handbook"
```

---

### Task 12: The skill directs by default

Steps 2 and 3 of the spec add `kie still` and `kie shot`; until then the directed flow uses today's commands: `kie image` per still, `kie upload`, `kie video --ref <url>:first_frame` with the shot's wording and params, `kie assemble`.

**Files:**
- Modify: `skills/motion-design/SKILL.md`, `skills/motion-design/references/production.md`

- [ ] **Step 1: Apply.**

```diff
diff --git a/skills/motion-design/SKILL.md b/skills/motion-design/SKILL.md
index 4bb311d..ce2e84a 100644
--- a/skills/motion-design/SKILL.md
+++ b/skills/motion-design/SKILL.md
@@ -5,7 +5,7 @@ description: Adapt motion-design gallery prompts or closely recreate a supplied
 
 # Motion Design
 
-For gallery adaptation, start from the closest example's complete original prompt and adapt its useful visual and motion techniques to the new communication goal. For a supplied video, default to close recreation: that clip controls the sequence, framing, timing and movement while the subject and copy change. An explicit request for loose inspiration overrides this default. Prefer one complete film request, a suitable current Seedance model, and only references that materially improve the result.
+For gallery adaptation, start from the closest example's complete original prompt and adapt its useful visual and motion techniques to the new communication goal. For a supplied video, default to close recreation: that clip controls the sequence, framing, timing and movement while the subject and copy change. An explicit request for loose inspiration overrides this default. Direct a new film shot by shot: agree a brief, plan the shots from the director's menu, make a still per shot, then animate each still with the model and wording the plan gives it. Use only references that materially improve the result.
 
 ## Requested mode
 
@@ -13,6 +13,7 @@ For gallery adaptation, start from the closest example's complete original promp
 - **Supplied video:** Read [video-reference.md](references/video-reference.md). Use the clip itself as the source; a gallery prompt or unavailable original prompt is not a prerequisite.
 - **Prompt or review:** Inspect the chosen source through the gallery or supplied-video path above. Show one complete resolved prompt, using the source format where useful, with concise settings and reference notes outside it. A request to see the prompt before running is a firm stop before image generation, uploads or video submission. No tool call may submit a job merely to check access or cost.
 - **Images:** Create only requested or necessary references. Use `kie image` in every host, preferring GPT Image 2. Read [tool-routing.md](references/tool-routing.md) for capability checks and asset handoff. An image request does not commission video.
+- **Direct a film:** Read [director/brief.md](references/director/brief.md) to turn the idea into a brief (expand a vague idea, offer two or three directions when the user is unsure), then [director/craft.md](references/director/craft.md) and the chapter for the film type to plan the shots. `kie brief` and `kie plan` save, check and price the plan for free; show it to the user before any still or take is paid for.
 - **Production:** Follow [production.md](references/production.md) through generation and inspection, within the user's authorization. Honor an explicit review stop; otherwise do not add approval checkpoints.
 - **Original concept:** Use [creative-brief.md](references/creative-brief.md). Offer a few relevant ideas when asked, then develop the selected one.
 - **Graphic motion:** Copy, a logo, prices, chart values or a real screenshot must be *correct*, not plausible, so they are a code render rather than a generation — a model draws a picture of text and misspells it in ways no retry fixes. Read [graphic-motion.md](references/graphic-motion.md) and use `kie render`. The two engines are meant to meet: `--alpha` composites a rendered strap or end card onto a generated film.
@@ -26,9 +27,9 @@ Source prompts may contain original client names, speech, external attachment ma
 
 ## Production defaults
 
-- One complete film request containing all timed shots or phases. Multiple shots are not multiple jobs. Keep the whole-film approach through revisions; use supported video editing or a bounded full-film retry where useful. Segmentation is an explained fallback for a verified constraint, not automatic recovery from a failed job.
-- Prefer the strongest suitable accessible model, with Seedance the current general preference. Read the actual schema with `kie models`; never state a duration, aspect ratio or reference role from memory. Three presets record a `minimax_h3` source label that kie.ai exposes directly, so `kie presets` marks them **native** and the rest **adaptation** — report whichever applies rather than describing every run the same way. Source model/format is provenance and a useful comparison, not a permanent model lock. Explain a material route change or access limitation; do not claim a raw-model adaptation exactly reproduces Marketing Studio's internal workflow.
-- References are conditional. Start prompt-only for typography or abstract motion. Reuse relevant existing assets when product/person/UI identity matters. Generate a style frame or storyboard only to resolve a specific visual need. Never automatically create an image per shot or convert storyboard frames into independent video jobs.
+- A directed film is a checked shot plan (`kie plan`): one still and one take per shot, each take animated from its still with the wording `kie plan --wording` gives for its model, then joined with `kie assemble`. A shot that fails is redone on its own. One complete multi-shot request stays an explicit choice where one continuous camera is the point (a hero loop) or the user asks for it.
+- Let the director's model picker choose each shot's model (`kie plan --suggest` says why and what it ruled out); an explicit user choice wins. Read the actual schema with `kie models`; never state a duration, aspect ratio or reference role from memory. Three presets record a `minimax_h3` source label that kie.ai exposes directly, so `kie presets` marks them **native** and the rest **adaptation** — report whichever applies rather than describing every run the same way. Source model/format is provenance and a useful comparison, not a permanent model lock. Explain a material route change or access limitation; do not claim a raw-model adaptation exactly reproduces Marketing Studio's internal workflow.
+- References are conditional. Start prompt-only for typography or abstract motion. Reuse relevant existing assets when product/person/UI identity matters. In a directed film every shot gets its still, made with the still model the plan names; it is where the user sees whether the camera language landed before video is paid for. Outside a directed film, generate a style frame or storyboard only to resolve a specific visual need.
 - Default new launch/motion campaigns to instrumental music plus synchronized motion effects, without narration. Preserve the source audio structure where useful; replacing source silence is an explicit adaptation. Separate music, effects, existing speech and new narration. Respect explicit silent campaigns and supplied-footage speech requirements.
 - Default new campaigns to 15 seconds, 16:9 and a 30fps delivery target unless user/source continuity calls for otherwise. Native generation fps may differ. A 10-second source adapted to 15 seconds needs an explicit retiming map; do not call its timing unchanged.
 
diff --git a/skills/motion-design/references/production.md b/skills/motion-design/references/production.md
index 66d85d0..f10f9e9 100644
--- a/skills/motion-design/references/production.md
+++ b/skills/motion-design/references/production.md
@@ -8,7 +8,7 @@ For gallery work, read the selected original prompt and adaptation guide, then u
 
 Keep source endpoint/format as provenance. A Marketing Studio SaaS source and a Seedance adaptation are different routes; preserve the creative template while disclosing this difference. Do not guess an unavailable preset slug or interpret catalog exposure as account entitlement. `kie preflight` and `kie doctor` are read-only and answer cost and access questions without spending; **never submit a generation as a probe.** A budget refusal (exit `2`) submits nothing and spends nothing — report the estimate rather than raising the cap unprompted.
 
-One request should contain the entire film. A provider failure does not establish that the duration or shot count is unsupported. Inspect the returned error and current schema before changing approach. If the preferred route is unavailable, explain a concrete suitable fallback. A material change to the user's one-film method requires their acceptance; do not silently begin separate clip production.
+A new film is directed shot by shot from a checked plan: `kie brief`, then `kie plan --file` (refused with reasons until the checker has no errors), then a still and a take per shot. One complete multi-shot request is the explicit alternative when one continuous camera is the point or the user asks for it. A provider failure does not establish that a duration is unsupported. Inspect the returned error and current schema before changing approach. If the preferred route is unavailable, explain a concrete suitable fallback.
 
 ## Decide whether references help
 
@@ -20,9 +20,11 @@ Identify each asset's purpose: identity, style, motion reference, start frame or
 
 Reuse acquired assets. Do not regenerate source screenshots to make them look more polished. Only create assets the chosen request will actually use. Record whether the model output is an illustration or preserves original source media; do not promise pixel-exact screenshots from conditioning alone.
 
-## Submit the complete request
+## Submit the shots
 
-Upload only the selected assets with `kie upload`, then bind the URLs it returns through `--ref <url>:<role>` with real roles. A local path passed to `--ref` is refused outright. Preserve the exact reviewed creative prompt; technical adaptation should not silently change its content. Include every shot and shared motion rule in the same request, with one requested output by default. Never send unresolved source attachment markers, draft paths or placeholders as remote inputs.
+For each shot of a saved plan, in order: make its still with `kie image --model <its stillModel>` from the shot's framing and the film's look, inspect it, and redo only a still that misses. Then `kie upload` the approved still and animate it with `kie video --model <its model> --duration <generatedS from kie plan> --ref <url>:first_frame --prompt-file <the shot's wording>` plus the `--param` flags `kie plan --wording` prints (audio off for silent shots). The take runs one second longer than the shot so the edit can trim a sluggish start. Join the takes with `kie assemble` in plan order, and render exact copy with `kie render`.
+
+For a single multi-shot request: Upload only the selected assets with `kie upload`, then bind the URLs it returns through `--ref <url>:<role>` with real roles. A local path passed to `--ref` is refused outright. Preserve the exact reviewed creative prompt; technical adaptation should not silently change its content. Include every shot and shared motion rule in the same request, with one requested output by default. Never send unresolved source attachment markers, draft paths or placeholders as remote inputs.
 
 For audio-enabled campaigns, include both the soundscape and music directions in the full prompt and enable native audio where supported. Music and effects do not imply narration. If native audio is unavailable, explain the needed audio route before changing the workflow. Respect explicit silence or source-speech instructions.
 
@@ -34,9 +36,9 @@ Inspect playback for the full sequence: shot order, transitions, camera amplitud
 
 Listen for music/effects synchronization, unintended speech, clipped audio and a clean ending. Exact copy and benchmark values must survive the rendered frames; prompt instructions are not proof. The original preview's polish is not a guarantee of first-attempt output.
 
-Default to one corrective full-film generation within the authorized run, unless the user sets another retry or budget limit. Pass `--budget` to make that limit enforced rather than intended. Retain the original result for comparison — artifact numbering does this automatically, so never delete a take to make room for another. After that, report the unresolved issue and next action rather than starting an unbounded paid loop. Do not make segmentation the corrective default.
+Default to one corrective take for a failed shot (or one full-film retry for a single multi-shot request) within the authorized run, unless the user sets another retry or budget limit. Pass `--budget` to make that limit enforced rather than intended. Retain the original result for comparison — artifact numbering does this automatically, so never delete a take to make room for another. After that, report the unresolved issue and next action rather than starting an unbounded paid loop. Fix the shot that failed; do not refilm shots that passed.
 
-Technical finishing such as trimming/conforming is optional and must not replace the intended generation method. An exact typography/source-media composite is a disclosed fallback when generated content fails, not a mandatory production pipeline. Finishing is local and free: `kie assemble` for a music bed, voiceover and loudness, `kie variants` to reframe, `kie caption` to burn captions. Run them in that order — reframing a captioned film moves the captions out of the safe area, which `kie variants` will warn about. None of it substitutes for the requested generation: assembly joins a film to a rendered card or two deliberately distinct takes, and is not a way to build a film shot by shot. Do not introduce Blender.
+Technical finishing such as trimming/conforming is optional and must not replace the intended generation method. An exact typography/source-media composite is a disclosed fallback when generated content fails, not a mandatory production pipeline. Finishing is local and free: `kie assemble` for a music bed, voiceover and loudness, `kie variants` to reframe, `kie caption` to burn captions. Run them in that order — reframing a captioned film moves the captions out of the safe area, which `kie variants` will warn about. None of it substitutes for the requested generation: assembly joins the planned takes in order, or a film to a rendered card. Do not introduce Blender.
 
 Text, a logo, prices or a real screenshot belong to `kie render`, not to a prompt — a model draws a picture of text and gets it wrong. See [graphic-motion.md](graphic-motion.md); `--alpha` composites a rendered strap or end card onto generated footage. Verify the delivered duration, dimensions, fps, audio, copy and final hold. A 15-second 30fps delivery has 450 frames, but frame count alone says nothing about visual fidelity.
 
```

- [ ] **Step 2: Check.** `npm run validate` → exit 0. `npm --prefix web run test:server` → green (the chat prompt embeds the routing section).

- [ ] **Step 3: Commit.**

```bash
git add skills/motion-design/SKILL.md skills/motion-design/references/production.md
git diff --cached --stat
git commit -m "skill: direct a film shot by shot by default"
```

---

### Task 13: Full verification

- [ ] `npm test` → all pass (root suite, about 400 tests).
- [ ] `npm run test:mcp` → 50 pass.
- [ ] `npm run test:web` → server and page suites pass.
- [ ] Free end-to-end run against a temp `runs/` (no spend):

```bash
T=$(mktemp -d); export KIE_RUNS_DIR=$T/runs KIE_LIBRARY_DIR=$T/lib KIE_LIMITS_FILE=$T/limits.json; mkdir -p $T/runs
node cli/kie.mjs brief --run sea --file brief.json   # from the CLI test fixture
node cli/kie.mjs plan --run sea --file plan.json
node cli/kie.mjs plan --run sea --wording
```

Expected: the plan prints with `errors: none` and a cost line; each shot's wording ends with the `--param` flags for its model.
- [ ] `git status` shows nothing unexpected (`.gstack/` stays untracked and unstaged).

## Where this plan narrows the spec

- `promptProfile` holds `family`, `maxChars` and `audioOff`. The shot and camera syntax and the closing line live in `wording.mjs` per family, because they are fixed per family and need golden tests rather than data.
- Hailuo's "prompt optimizer off", Kling's negative list and Veo's `SFX:` / `Ambient:` lines need route fields that are not captured yet, so they wait for those contracts.
- The picker reports the catalog price (`planJob`), not a live `preflight`, so planning never reads a balance.
- `text-in-action` catches quoted text, prices and percentages; a plain number such as "20 steps" is allowed.
- `get_menu` is one tool more than the spec's table: the agent needs the vocabulary before it can plan.

## Follow-ups (not in this plan)

- Capture the image-to-video contracts for Wan 3.0, Kling 3.0 and Veo 3.1 in `models.json` (free; needs their kie doc pages). Until then the picker rules them out and UGC shots fall back to the cinematic model.
- Steps 2 to 5 of the spec: casting and stills, filming and the editor pass, the studio storyboard, review.
