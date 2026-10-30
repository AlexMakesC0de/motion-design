# Studio Plan 7: Films, Spend and Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The last three tabs work. Films lists the run folders and opens a film page where the takes are put in order and finished: Assemble (chosen shots, music or voice-over, crossfades, loudness-normalised), Captions (SRT burned in), Variants (9:16 and 1:1) and Text cards from the render templates, each output with a player and a download. Spend shows today against the cap, 14 days of bars and every job, with Check again and the `kie job resolve` commands for a lost job. Settings edits the two limits, shows which provider keys are set (never the keys) and runs `kie doctor` on request.

**Architecture:** Finishing endpoints in `web/server/api/finish.mjs` check and confine every input (core's `checkLocalFile` and `confineProps` against the allowed roots), then start a background task (`web/server/tasks.mjs`) that calls the same core functions as the CLI and MCP server (`assemble`, `burnCaptions`, `makeVariants`, `render`) with outputs at core's next free default name inside the film. Progress comes from the ffmpeg stderr core already passes to `onLine` and reaches the page as SSE `task` events. Films reads come from core's `listRuns`/`getRun`; Settings writes through core's `setDailyLimit`/`setPerJobLimit`; `kie doctor` becomes `doctor()` in `cli/core/views.mjs` so the CLI and the studio share it. The page adds `web/src/films/`, `web/src/spend/` and `web/src/settings/`.

**Tech Stack:** Node ≥20 (ESM, `node:test`), React 19, Vite 8, Vitest 5 with Testing Library (`fireEvent`, no user-event) and jsdom, TypeScript 6. ffmpeg for two finishing tests (they skip with "ffmpeg not installed" without it). No new dependencies.

Spec: [`docs/superpowers/specs/2026-10-30-studio-web-app-design.md`](../specs/2026-10-30-studio-web-app-design.md), build order steps 7-8 (Films, then Spend and Settings). Follows [Plan 6](2026-10-31-plan-6-studio-library-presets.md); Plan 8 is the chat.

**Repo rules for every task:**
- Work on the `studio-web-app` branch. Never `git stash`. Run `git diff --cached --stat` before each commit and commit only the task's files. Leave the untracked `.gstack/` folder alone, and if a tool appends `.gstack/` to `.gitignore`, revert that edit.
- End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never run a paid command. Tests stub every provider call: `web/tests/helpers.mjs` replaces `globalThis.fetch` with a function that throws, and page tests stub `fetch` per test. The finishing tools are local and free; tests use real ffmpeg only on one-second clips they make themselves.
- A hook blocks any file containing the four letters e-x-e-c followed by an opening parenthesis. Use `String.prototype.match` / `matchAll` and `spawn`/`spawnSync`, never the RegExp method of that name.
- Never print or log the session key or any API key.
- Visual direction B from the spec: colours and sizes come from `web/src/theme/tokens.css` variables only, with the shared `.button` styles from `controls.css`; the mono face (`.mono` or `font-family: var(--font-mono)`) for every number, id and cost; amber (`--accent`) only on Generate, the spend meter and costs (the Spend tab's meter, bars and cost column are all money); no text under 11px. Target 1280-1440px wide; below 760px the layout stacks.

**How to copy a "Modify" step:** each one is a unified diff against the file as the previous task left it. Apply it by hand, or save the block to a file and run `git apply that-file.diff` from the repo root. "Create" steps give the whole file.

---

## Where things stand

Plan 6 left the Studio, Library and Presets tabs working, with Films, Spend and Settings as placeholders. Suites before this plan: core 293, MCP 36, server 124, page 80 tests in 14 files, all green. Core pieces this plan uses:

| Core | What this plan relies on |
|---|---|
| `assemble` (`cli/lib/assemble.mjs`) | Joins shots with an xfade transition (or hard cuts at 0 s), mixes music and voice-over with ducking, two-pass loudness normalisation; `onLine` gets ffmpeg's stderr. Returns `{ out, totalS, … }`. |
| `burnCaptions`, `parseSrt` (`cli/lib/caption.mjs`) | Draws SRT cues with the render engine and overlays them with ffmpeg; `parseSrt` returns `{ cues, problems, lastEnd }`. |
| `makeVariants`, `MODES`, `captionOrderWarning` (`cli/lib/variants.mjs`) | Reframes to other ratios as `<name>-9x16.mp4` beside the source; warns when the source already has captions. |
| `render`, `TEMPLATES`, `requireRemotion` (`cli/lib/render.mjs`) | Renders a template from a props file; `TEMPLATES` holds ids and descriptions only. |
| `requireFfmpeg`, `RATIOS`, `dimsFor` (`cli/lib/ffmpeg.mjs`) | Throw code 1 with install help when the tool is missing. |
| `outPath`, `claimArtifact`, `landArtifact`, `writeRecord`, `runDir`, `RUNS_DIR` (`cli/lib/run.mjs`) | Next free default names; moving a file in without replacing anything; JSON records in the run. |
| `checkLocalFile`, `confinePath` (`cli/core/inputs.mjs`) | Type by content, allowed roots, no hidden folders under a root. |
| `listRuns`, `getRun` (`cli/core/views.mjs`) | The run folders, and one run's media (code 3 for an unknown run). |
| `readLimits`, `setDailyLimit`, `setPerJobLimit`, `limitsPath` (`cli/core/spend.mjs`) | The limits file the CLI's `kie limits` writes. |
| `uncertainMessage` (`cli/core/jobs.mjs`) | The instruction for an uncertain job, with `kie job resolve <id> --task <task id>` and `--not-created` when no task id came back. |

---

## File map

| File | Responsibility |
|---|---|
| `cli/core/views.mjs`, `cli/kie.mjs` (modify) | `doctor()` returns the checks as data; `kie doctor` prints from it |
| `cli/core/inputs.mjs`, `mcp/server.mjs` (modify) | `confineProps` moves from the MCP server into core |
| `web/server/tasks.mjs` | background finishing tasks: one per film, progress from ffmpeg, SSE `task` events |
| `web/server/events.mjs`, `app.mjs` (modify) | `publish()` for task events; wiring of tasks, films, finish and settings |
| `web/server/api/films.mjs` | `GET /api/films`, `GET /api/films/:slug`, `POST /api/films/:slug/audio` (raw upload), `POST /api/films/:slug/srt` |
| `web/server/templates.mjs` | each render template's props, for the text-card form |
| `web/server/api/finish.mjs` | `GET /api/finish`; `POST /api/films/:slug/assemble`, `/caption`, `/variants`, `/card` |
| `web/server/api/library.mjs` (modify) | exports `label` and `saveBody` for the audio upload |
| `web/server/state.mjs`, `http.mjs` (modify) | job view gains `day` and `uncertainMessage`; `HttpError` carries extra fields |
| `web/server/api/settings.mjs` | `GET /api/settings`, `PUT /api/settings/limits`, `POST /api/settings/doctor` |
| `web/tests/*.test.mjs` | `tasks`, `films`, `templates`, `finish`, `settings`; `state` gains a test |
| `web/src/api/types.ts`, `test-fixtures.ts`, `app/useStudio.ts` (modify) | new shapes, fixtures, `emitForTests` |
| `web/src/films/useTasks.ts`, `finishing.ts` | live task list; shared picker and submit helpers |
| `web/src/films/FilmsScreen.tsx`, `FilmPage.tsx`, `films.css` | the films list and the film page |
| `web/src/films/FinishPanel.tsx`, `TaskList.tsx`, `AssembleForm.tsx`, `CaptionsForm.tsx`, `VariantsForm.tsx`, `CardForm.tsx` | the Finish panel and its four tools |
| `web/src/spend/SpendScreen.tsx`, `spend.css` | today, the 14-day chart, the jobs table |
| `web/src/settings/SettingsScreen.tsx`, `settings.css` | limits, providers, doctor, chat placeholder |
| `web/src/app/App.tsx`, `App.css`, `App.test.tsx` (modify), `Placeholder.tsx` (delete) | the three screens replace their placeholders |

---

### Task 1: Core: kie doctor as data, and confineProps shared

**Files:**
- Modify: `cli/core/inputs.mjs`
- Modify: `cli/core/views.mjs`
- Modify: `cli/kie.mjs`
- Modify: `mcp/server.mjs`
- Modify: `tests/inputs.test.mjs` (test)
- Modify: `tests/views.test.mjs` (test)

The Settings tab runs `kie doctor`, but core only had `cmdDoctor` in `cli/kie.mjs`, which prints. This task moves the checks into `doctor(catalog, { credits })` in `cli/core/views.mjs`, returning `{ checks: [{ level, text, keyOf? }], failures }`; `cmdDoctor` prints from it with the same tags and still adds the key hint (`(abcd…yz)`) itself, so the CLI output does not change and no key hint ever enters the data. Text cards (Task 8) need the MCP server's `confineProps`, so it moves into `cli/core/inputs.mjs` and `mcp/server.mjs` imports it from there.

- [ ] **Step 0: Save the CLI's doctor output to compare later**

A fresh `HOME` and empty key variables mean no key is found, so this makes no network call.

```bash
mkdir -p /tmp/p7-doctor-home
HOME=/tmp/p7-doctor-home KIE_API_KEY= WAVESPEED_API_KEY= node cli/kie.mjs doctor > /tmp/p7-doctor-before.txt; true
```

- [ ] **Step 1: Write the failing tests**

Modify `tests/views.test.mjs` with this change:

```diff
--- a/tests/views.test.mjs
+++ b/tests/views.test.mjs
@@ -91,3 +91,31 @@ describe("status and runs", () => {
     assert.throws(() => views.getRun("nope", { store }), { code: EXIT.UNKNOWN });
   });
 });
+
+describe("doctor", () => {
+  test("returns kie doctor's checks as data, reading balances only through the injected reader", async () => {
+    let reads = 0;
+    const d = await views.doctor(catalog, {
+      credits: async () => {
+        reads += 1;
+        return 42;
+      },
+    });
+    assert.equal(reads, 1, "only kie.ai has a balance endpoint");
+    assert.ok(d.checks.some((c) => c.level === "ok" && c.text === "kie.ai: 42 credits"));
+    assert.ok(d.checks.some((c) => c.level === "ok" && c.text === "kie.ai: key found" && c.keyOf === "kie"));
+    assert.ok(d.checks.every((c) => ["ok", "warn", "fail", "info"].includes(c.level)));
+    assert.equal(d.failures, d.checks.filter((c) => c.level === "fail").length);
+    assert.ok(!JSON.stringify(d).includes("test-key-not-real"), "no key value in any check");
+  });
+
+  test("a failed balance read is a failed check, not a throw", async () => {
+    const d = await views.doctor(catalog, {
+      credits: async () => {
+        throw new Error("kie.ai credit check failed (HTTP 401).");
+      },
+    });
+    assert.ok(d.checks.some((c) => c.level === "fail" && c.text === "kie.ai: credit check — kie.ai credit check failed (HTTP 401)."));
+    assert.ok(d.failures >= 1);
+  });
+});
```

Modify `tests/inputs.test.mjs` with this change:

```diff
--- a/tests/inputs.test.mjs
+++ b/tests/inputs.test.mjs
@@ -5,7 +5,7 @@ import { tmpdir } from "node:os";
 import { join } from "node:path";
 
 import { EXIT } from "../cli/lib/errors.mjs";
-import { sniff, imageSize, checkLocalFile, checkHttpsUrl, confinePath } from "../cli/core/inputs.mjs";
+import { sniff, imageSize, checkLocalFile, checkHttpsUrl, confinePath, confineProps } from "../cli/core/inputs.mjs";
 import { png, jpeg, webp, mp4 } from "./fixtures/images.mjs";
 
 const root = realpathSync(mkdtempSync(join(tmpdir(), "kie-root-")));
@@ -116,3 +116,21 @@ describe("URLs", () => {
     assert.throws(() => checkHttpsUrl("file:///etc/passwd"), { code: EXIT.UNKNOWN });
   });
 });
+
+describe("confineProps, for render template props", () => {
+  test("an image path inside a root comes back as its real path; other values pass unchanged", () => {
+    const logo = put(root, "logo.png", png(10, 10));
+    const out = confineProps({ wordmark: "Zed", logo, steps: [{ image: logo, caption: "One" }], size: 3 }, [root]);
+    assert.deepEqual(out, { wordmark: "Zed", logo, steps: [{ image: logo, caption: "One" }], size: 3 });
+  });
+
+  test("an image path outside every root is refused with code 3", () => {
+    const p = put(outside, "logo.png", png(10, 10));
+    assert.throws(() => confineProps({ logo: p }, [root]), (e) => e.code === EXIT.UNKNOWN && /outside the folders/.test(e.message));
+  });
+
+  test("file: and http(s) URLs are refused, at any depth", () => {
+    assert.throws(() => confineProps({ steps: [{ image: "file:///etc/x.png" }] }, [root]), /file: URLs/);
+    assert.throws(() => confineProps({ background: "HTTPS://example.com/page" }, [root]), /remote URLs would be fetched from this machine/);
+  });
+});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/views.test.mjs tests/inputs.test.mjs`
Expected: FAIL. `tests/views.test.mjs`: 2 of 11 fail with `TypeError: views.doctor is not a function`. `tests/inputs.test.mjs` does not load: `SyntaxError: The requested module '../cli/core/inputs.mjs' does not provide an export named 'confineProps'`.

- [ ] **Step 3: Implement**

Modify `cli/core/inputs.mjs` with this change:

```diff
--- a/cli/core/inputs.mjs
+++ b/cli/core/inputs.mjs
@@ -1,5 +1,5 @@
 import { closeSync, existsSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
-import { relative, resolve, sep } from "node:path";
+import { isAbsolute, join, relative, resolve, sep } from "node:path";
 import { LIBRARY_DIR, RUNS_DIR, isInside } from "../lib/run.mjs";
 import { unknown } from "../lib/errors.mjs";
 import { limitsPath } from "./spend.mjs";
@@ -105,6 +105,33 @@ export function confinePath(path, roots) {
   return real;
 }
 
+const IMAGE_PATH = /\.(png|jpe?g|webp|gif|svg)$/i;
+
+/**
+ * Render template props, confined like any other file a client names. The
+ * renderer turns every image path in props into a file:// URL for a headless
+ * browser, so each such path must sit in an allowed root (relative means
+ * inside runs/), and file: or http(s) URLs are refused outright: a remote URL
+ * would be fetched from this machine. Returns the props with real paths.
+ */
+export function confineProps(value, roots) {
+  if (typeof value === "string") {
+    if (/^file:/i.test(value)) {
+      throw unknown(`props may not contain file: URLs ("${value}"); name a file inside runs/ or library/ instead.`);
+    }
+    if (/^\s*https?:/i.test(value)) {
+      throw unknown("render props may only name local files in the allowed folders; remote URLs would be fetched from this machine.");
+    }
+    if (!IMAGE_PATH.test(value) || /^data:/i.test(value)) return value;
+    return confinePath(isAbsolute(value) ? value : join(RUNS_DIR, value), roots);
+  }
+  if (Array.isArray(value)) return value.map((v) => confineProps(v, roots));
+  if (value && typeof value === "object") {
+    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, confineProps(v, roots)]));
+  }
+  return value;
+}
+
 /**
  * Everything a local file must pass before it may be sent to a provider.
  * `roots` is set when an MCP client is asking: the file's real path (symlinks
```

Modify `cli/core/views.mjs` with this change:

```diff
--- a/cli/core/views.mjs
+++ b/cli/core/views.mjs
@@ -214,3 +214,63 @@ export function getRun(slug, { store }) {
     review: readText(join(dir, "review.md")),
   };
 }
+
+/**
+ * `kie doctor`'s checks as data, for the CLI and the studio's Settings screen.
+ * Its one network call is each provider's balance read (a GET on the credit
+ * endpoint, which costs nothing); `credits` replaces it in tests. No check
+ * carries a key: the key check names its provider in `keyOf`, and the CLI
+ * alone adds the short key hint it prints.
+ */
+export async function doctor(catalog, { credits = providerCredits } = {}) {
+  const checks = [];
+  const add = (level, text, extra = {}) => checks.push({ level, text, ...extra });
+
+  let anyKey = false;
+  for (const name of Object.keys(catalog.providers)) {
+    const prov = getProvider(catalog, name);
+    const key = providerKey(prov, { required: false });
+    if (!key) {
+      add("warn", `${prov.label}: no key (set ${prov.keyEnv} or write ~/${prov.keyFile}) — routes skipped`);
+      continue;
+    }
+    anyKey = true;
+    add("ok", `${prov.label}: key found`, { keyOf: name });
+    if (prov.credits) {
+      try {
+        const c = await credits(prov, key);
+        if (c == null) add("fail", `${prov.label}: credit endpoint gave no balance`);
+        else add("ok", `${prov.label}: ${c} ${prov.creditUnit}`);
+      } catch (e) {
+        add("fail", `${prov.label}: credit check — ${e.message}`);
+      }
+    } else {
+      add("ok", `${prov.label}: no balance endpoint — spend is not readable from here`);
+    }
+  }
+  if (!anyKey) add("fail", "No provider key configured at all — nothing can be generated.");
+
+  const age = catalogAgeDays(catalog);
+  add(isStale(catalog) ? "fail" : "ok", `models.json captured ${catalog.captured}${age != null ? ` (${age}d ago)` : ""}`);
+
+  const routes = catalog.list.flatMap((m) => routesFor(catalog, m).map((r) => ({ m, r })));
+  const unverified = routes.filter(({ r }) => !r.verified);
+  add(unverified.length ? "warn" : "ok", `${routes.length - unverified.length}/${routes.length} routes verified by a real job`);
+
+  const noRoute = catalog.list.filter((m) => !routesFor(catalog, m).some((r) => r.usable));
+  if (noRoute.length) add("warn", `unreachable with current keys: ${noRoute.map((m) => m.id).join(", ")}`);
+
+  const withFallback = catalog.list.filter((m) => routesFor(catalog, m).filter((r) => r.usable).length > 1);
+  add("ok", `${withFallback.length}/${catalog.list.length} models have a working fallback: ${withFallback.map((m) => m.id).join(", ") || "none"}`);
+
+  try {
+    const presets = loadPresets();
+    const mapped = presets.filter((p) => p.kie?.native || p.kie?.route?.length);
+    add("ok", `presets: ${mapped.length}/${presets.length} routed to a model`);
+    add("info", `native-route presets: ${presets.filter((p) => p.kie?.native).map((p) => p.id).join(", ") || "none"}`);
+  } catch (e) {
+    add("fail", `presets.json: ${e.message}`);
+  }
+
+  return { checks, failures: checks.filter((c) => c.level === "fail").length };
+}
```

Modify `cli/kie.mjs` with this change:

```diff
--- a/cli/kie.mjs
+++ b/cli/kie.mjs
@@ -24,6 +24,7 @@ import { submitJob, waitJob, shouldFailOver } from "./core/generate.mjs";
 import { openLibrary, KINDS } from "./core/assets.mjs";
 import { expandRefs } from "./core/refs.mjs";
 import { checkLocalFile } from "./core/inputs.mjs";
+import { doctor } from "./core/views.mjs";
 import { loadPresets, findPreset, routeFor } from "./lib/presets.mjs";
 import { probe, measureLoudness, dimsFor } from "./lib/ffmpeg.mjs";
 import { extractFrames } from "./lib/frames.mjs";
@@ -218,57 +219,17 @@ function cmdPresets(catalog, args) {
 }
 
 async function cmdDoctor(catalog) {
-  let failures = 0;
-  const ok = (m) => say(`  ok    ${m}`);
-  const bad = (m) => { failures += 1; say(`  FAIL  ${m}`); };
-
   say("kie doctor\n");
-
-  let anyKey = false;
-  for (const name of Object.keys(catalog.providers)) {
-    const prov = getProvider(catalog, name);
-    const key = providerKey(prov, { required: false });
-    if (!key) {
-      say(`  warn  ${prov.label}: no key (set ${prov.keyEnv} or write ~/${prov.keyFile}) — routes skipped`);
-      continue;
+  const { checks, failures } = await doctor(catalog);
+  const tag = { ok: "ok    ", warn: "warn  ", fail: "FAIL  ", info: "      " };
+  for (const c of checks) {
+    let text = c.text;
+    if (c.keyOf) {
+      const key = providerKey(getProvider(catalog, c.keyOf), { required: false });
+      text += ` (${key.slice(0, 4)}…${key.slice(-2)})`;
     }
-    anyKey = true;
-    ok(`${prov.label}: key found (${key.slice(0, 4)}…${key.slice(-2)})`);
-    if (prov.credits) {
-      try {
-        const c = await providerCredits(prov, key);
-        c == null ? bad(`${prov.label}: credit endpoint gave no balance`) : ok(`${prov.label}: ${c} ${prov.creditUnit}`);
-      } catch (e) {
-        bad(`${prov.label}: credit check — ${e.message}`);
-      }
-    } else {
-      say(`  ok    ${prov.label}: no balance endpoint — spend is not readable from here`);
-    }
-  }
-  if (!anyKey) bad("No provider key configured at all — nothing can be generated.");
-
-  const age = catalogAgeDays(catalog);
-  (isStale(catalog) ? bad : ok)(`models.json captured ${catalog.captured}${age != null ? ` (${age}d ago)` : ""}`);
-
-  const routes = catalog.list.flatMap((m) => routesFor(catalog, m).map((r) => ({ m, r })));
-  const unverified = routes.filter(({ r }) => !r.verified);
-  say(`  ${unverified.length ? "warn " : "ok   "} ${routes.length - unverified.length}/${routes.length} routes verified by a real job`);
-
-  const noRoute = catalog.list.filter((m) => !routesFor(catalog, m).some((r) => r.usable));
-  if (noRoute.length) say(`  warn  unreachable with current keys: ${noRoute.map((m) => m.id).join(", ")}`);
-
-  const withFallback = catalog.list.filter((m) => routesFor(catalog, m).filter((r) => r.usable).length > 1);
-  ok(`${withFallback.length}/${catalog.list.length} models have a working fallback: ${withFallback.map((m) => m.id).join(", ") || "none"}`);
-
-  try {
-    const presets = loadPresets();
-    const mapped = presets.filter((p) => p.kie?.native || p.kie?.route?.length);
-    ok(`presets: ${mapped.length}/${presets.length} routed to a model`);
-    say(`        native-route presets: ${presets.filter((p) => p.kie?.native).map((p) => p.id).join(", ") || "none"}`);
-  } catch (e) {
-    bad(`presets.json: ${e.message}`);
+    say(`  ${tag[c.level]}${text}`);
   }
-
   say(`\n${failures ? `${failures} check(s) failed.` : "All checks passed."}`);
   return failures ? EXIT.PROVIDER : EXIT.OK;
 }
```

Modify `mcp/server.mjs` with this change:

```diff
--- a/mcp/server.mjs
+++ b/mcp/server.mjs
@@ -26,7 +26,7 @@ import { readLimits } from "../cli/core/spend.mjs";
 import { submitJob, waitJob } from "../cli/core/generate.mjs";
 import { openLibrary, KINDS } from "../cli/core/assets.mjs";
 import { expandRefs } from "../cli/core/refs.mjs";
-import { allowedRoots, confinePath } from "../cli/core/inputs.mjs";
+import { allowedRoots, confinePath, confineProps } from "../cli/core/inputs.mjs";
 import { status, listModels, listPresets, estimate, listRuns, getRun } from "../cli/core/views.mjs";
 import { ok, fail } from "./results.mjs";
 import { artifactPreview, imagePreview } from "./preview.mjs";
@@ -665,24 +665,6 @@ export function createServer({ deps = {}, catalog = loadCatalog() } = {}) {
     const InRun = (what) => z.string().describe(`${what}: a file name in the run folder, or a path inside runs/ or library/.`);
     const Ratio = z.enum(Object.keys(RATIOS));
 
-    const IMAGE_PATH = /\.(png|jpe?g|webp|gif|svg)$/i;
-    const confineProps = (value, roots) => {
-      if (typeof value === "string") {
-        if (/^file:/i.test(value)) {
-          throw unknown(`props may not contain file: URLs ("${value}"); name a file inside runs/ or library/ instead.`);
-        }
-        if (/^\s*https?:/i.test(value)) {
-          throw unknown("render props may only name local files in the allowed folders; remote URLs would be fetched from this machine.");
-        }
-        return IMAGE_PATH.test(value) && !/^data:/i.test(value) ? clientPath(value, roots) : value;
-      }
-      if (Array.isArray(value)) return value.map((v) => confineProps(v, roots));
-      if (value && typeof value === "object") {
-        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, confineProps(v, roots)]));
-      }
-      return value;
-    };
-
     tool(
       "frames",
       {
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node --test tests/views.test.mjs tests/inputs.test.mjs`
Expected: PASS, 0 fail.

Then run: `npm test && npm run test:mcp`
Expected: core 298 pass, MCP 36 pass, 0 fail.

Then run:

```bash
HOME=/tmp/p7-doctor-home KIE_API_KEY= WAVESPEED_API_KEY= node cli/kie.mjs doctor > /tmp/p7-doctor-after.txt; true
diff /tmp/p7-doctor-before.txt /tmp/p7-doctor-after.txt && echo SAME
rm -rf /tmp/p7-doctor-home /tmp/p7-doctor-before.txt /tmp/p7-doctor-after.txt
```

Expected: `SAME`.

- [ ] **Step 5: Commit**

```bash
git add cli/core/inputs.mjs cli/core/views.mjs cli/kie.mjs mcp/server.mjs tests/inputs.test.mjs tests/views.test.mjs
git diff --cached --stat
git commit -m "Return kie doctor's checks as data and share confineProps in core

The studio's Settings tab shows the same checks the CLI prints; the CLI
output is unchanged. Text cards confine template props like the MCP tool.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 2: Finishing tasks that report progress

**Files:**
- Modify: `web/server/app.mjs`
- Modify: `web/server/events.mjs`
- Create: `web/server/tasks.mjs`
- Create: `web/tests/tasks.test.mjs` (test)

Assemble, captions and variants can run for minutes (captions also start a headless browser), so the finishing endpoints answer at once with a task and the work runs in the background. `createTasks` keeps the last 50 tasks in memory, allows one running task per film (a second gets 409 rather than a queue, so two tools never race for the same next free output name), reads ffmpeg's `time=` from the stderr core passes to `onLine` as `outS`, and redacts error text. Every change is published as an SSE `task` event, throttled to once a second while running and always sent on start and end. `GET /api/tasks?run=` lists them, so a reloaded page catches up.

- [ ] **Step 1: Write the failing test**

Create `web/tests/tasks.test.mjs`:

```js
import { KEY, tmp, req } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

const { createTasks, progressSeconds } = await import("../server/tasks.mjs");
const { createApp } = await import("../server/app.mjs");

/** A task body the test finishes by hand. */
function gate() {
  let open;
  let fail;
  const p = new Promise((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { work: () => p, open, fail };
}

describe("progressSeconds", () => {
  test("reads the last time= in an ffmpeg progress chunk", () => {
    assert.equal(progressSeconds("frame=  30 fps=0.0 q=28.0 size=0kB time=00:00:01.00 bitrate=N/A\rframe=  61 time=00:01:02.50 speed=2x"), 62.5);
  });

  test("is null for a line without one", () => {
    assert.equal(progressSeconds("Input #0, mov,mp4 from 'a.mp4':"), null);
  });
});

describe("createTasks", () => {
  test("start returns a running task at once, and the task settles with what the work returned", async () => {
    const seen = [];
    const tasks = createTasks({ onChange: (t) => seen.push(`${t.state}`) });
    const g = gate();
    const t = tasks.start("zed", "assemble", "Assemble", g.work);
    assert.equal(t.state, "running");
    assert.equal(t.run, "zed");
    assert.match(t.id, /^t-[0-9a-f]{8}$/);
    g.open({ outputs: [{ name: "film.mp4", url: "/media/runs/zed/film.mp4" }], warnings: ["w"] });
    await tasks.idle();
    const done = tasks.get(t.id);
    assert.equal(done.state, "done");
    assert.deepEqual(done.outputs, [{ name: "film.mp4", url: "/media/runs/zed/film.mp4" }]);
    assert.deepEqual(done.warnings, ["w"]);
    assert.ok(done.endedAt);
    assert.deepEqual(seen, ["running", "done"]);
  });

  test("a film with a task running refuses a second one with 409 naming it; another film may run", async () => {
    const tasks = createTasks();
    const g = gate();
    tasks.start("zed", "assemble", "Assemble", g.work);
    assert.throws(() => tasks.start("zed", "variants", "Variants", async () => ({ outputs: [] })), (e) => e.status === 409 && /Assemble is still running in zed/.test(e.message));
    const other = tasks.start("other", "variants", "Variants", async () => ({ outputs: [] }));
    assert.equal(other.state, "running");
    g.open({ outputs: [] });
    await tasks.idle();
    assert.equal(tasks.start("zed", "variants", "Variants", async () => ({ outputs: [] })).state, "running", "the film is free again");
    await tasks.idle();
  });

  test("a failure is recorded with its message and frees the film", async () => {
    const tasks = createTasks();
    const g = gate();
    const t = tasks.start("zed", "caption", "Captions", g.work);
    g.fail(new Error("ffmpeg exited 1:\nInvalid data found when processing input"));
    await tasks.idle();
    assert.equal(tasks.get(t.id).state, "failed");
    assert.match(tasks.get(t.id).error, /Invalid data found/);
    assert.equal(tasks.start("zed", "caption", "Captions", async () => ({ outputs: [] })).state, "running");
    await tasks.idle();
  });

  test("progress lines set outS, and are passed on at most once per throttle window", async () => {
    let clock = 0;
    const seen = [];
    const tasks = createTasks({ onChange: (t) => seen.push(t.outS), throttleMs: 1000, now: () => clock });
    const g = gate();
    let progress;
    const t = tasks.start("zed", "assemble", "Assemble", (p) => {
      progress = p.progress;
      return g.work();
    });
    await new Promise((r) => setImmediate(r));
    clock = 1500;
    progress("time=00:00:01.00");
    clock = 1600;
    progress("time=00:00:02.00");
    assert.equal(tasks.get(t.id).outS, 2);
    g.open({ outputs: [] });
    await tasks.idle();
    assert.deepEqual(seen, [null, 1, 2], "start, one throttled progress, then the end");
  });

  test("list is newest first, filtered by film, and keeps the last 50", async () => {
    const tasks = createTasks();
    for (let i = 0; i < 55; i++) {
      tasks.start(i % 2 ? "odd" : "even", "variants", `V${i}`, async () => ({ outputs: [] }));
      await tasks.idle();
    }
    assert.equal(tasks.list().length, 50);
    assert.equal(tasks.list()[0].label, "V54");
    assert.ok(tasks.list("odd").every((t) => t.run === "odd"));
  });
});

describe("GET /api/tasks", () => {
  let app, port;
  before(async () => {
    app = createApp({ key: KEY, distDir: join(tmp, "nodist"), pollMs: 60_000 });
    await new Promise((r) => app.listen(0, "127.0.0.1", r));
    port = app.address().port;
  });
  after(() => app.closeAll());

  test("lists the film's tasks, and a task change reaches subscribers as a task event", async () => {
    const written = [];
    let onClose = () => {};
    const res = { writeHead: () => {}, write: (s) => written.push(s), on: (ev, fn) => ev === "close" && (onClose = fn) };
    app.events.subscribe(res);
    const t = app.tasks.start("zed", "variants", "Variants", async () => ({ outputs: [] }));
    await app.tasks.idle();
    const r = await req(port, "/api/tasks?run=zed");
    assert.equal(r.status, 200);
    assert.equal(r.json[0].id, t.id);
    assert.equal(r.json[0].state, "done");
    onClose();
    assert.match(written.join(""), new RegExp(`event: task\\ndata: \\{"id":"${t.id}"`));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && node --test tests/tasks.test.mjs`
Expected: FAIL: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/web/server/tasks.mjs' imported from …/web/tests/tasks.test.mjs`.

- [ ] **Step 3: Implement**

Modify `web/server/app.mjs` with this change:

```diff
--- a/web/server/app.mjs
+++ b/web/server/app.mjs
@@ -6,6 +6,7 @@ import { createRouter, createHandler } from "./http.mjs";
 import { serveMedia } from "./media.mjs";
 import { createEvents, takeSnapshot } from "./events.mjs";
 import { createFollower } from "./follow.mjs";
+import { createTasks } from "./tasks.mjs";
 import { registerLook } from "./api/look.mjs";
 import { registerGenerate } from "./api/generate.mjs";
 import { registerFrames } from "./api/frames.mjs";
@@ -28,10 +29,12 @@ export function createApp({ key, deps = {}, catalog = loadCatalog(), distDir = j
   const follower = createFollower({ catalog, deps, onChange: () => events?.nudge() });
   const following = follower.has;
   events = createEvents({ pollMs, snapshot: () => takeSnapshot({ following }) });
+  const tasks = createTasks({ onChange: (task) => events.publish({ event: "task", data: task }) });
   router.get("/api/events", ({ res }) => {
     events.subscribe(res);
     return undefined;
   });
+  router.get("/api/tasks", ({ query }) => tasks.list(query.get("run") || undefined));
   registerLook(router, { catalog, deps, following });
   registerGenerate(router, { catalog, deps, follower });
   registerFrames(router);
@@ -50,6 +53,7 @@ export function createApp({ key, deps = {}, catalog = loadCatalog(), distDir = j
   server.router = router;
   server.events = events;
   server.follower = follower;
+  server.tasks = tasks;
   // Studio jobs a previous run left waiting. Safe beside a CLI or MCP waiter: core settles each job once.
   if (resume) follower.resume();
   return server;
```

Modify `web/server/events.mjs` with this change:

```diff
--- a/web/server/events.mjs
+++ b/web/server/events.mjs
@@ -71,6 +71,11 @@ export function createEvents({ pollMs = 2_000, snapshot = takeSnapshot } = {}) {
     nudge: soon,
     /** How many responses are subscribed right now. */
     size: () => clients.size,
+    /** Send `e` ({ event, data }) to every subscriber now: for changes no snapshot holds (finishing tasks). */
+    publish(e) {
+      const text = formatEvent(e);
+      for (const c of clients) c.write(text);
+    },
     /** Attach an HTTP response as a subscriber. */
     subscribe(res) {
       res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
```

Create `web/server/tasks.mjs`:

```js
// Finishing tasks. Assemble, captions, variants and text cards run ffmpeg and
// the render engine for seconds to minutes, so an endpoint starts one here and
// answers at once; core spawns the tools as child processes, so the server
// keeps answering while they run. The page follows each task through SSE
// `task` events (and GET /api/tasks after a reconnect).
//
// One task per film at a time: two tasks in one film could pick the same free
// output name (core numbers outputs when it starts writing) or rewrite the
// same record (assembly.json, variants.json). A second request is refused
// with 409 rather than queued. Tasks are kept in memory, the last 50; their
// outputs are files in the run, which the film page lists from disk.
import { randomBytes } from "node:crypto";
import { redact } from "../../cli/lib/redact.mjs";
import { HttpError } from "./http.mjs";

const KEEP = 50;

/** Seconds of output ffmpeg has written, from the last "time=HH:MM:SS.ss" in `text`; null when there is none. */
export function progressSeconds(text) {
  const last = [...String(text).matchAll(/time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/g)].at(-1);
  return last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : null;
}

/**
 * `onChange(task)` hears every start and end, and progress at most once per
 * `throttleMs`. A task is { id, run, tool, label, state: running | done |
 * failed, startedAt, endedAt, outS, outputs, warnings, error }.
 */
export function createTasks({ onChange = () => {}, throttleMs = 1000, now = () => Date.now() } = {}) {
  const tasks = new Map(); // id -> task, oldest first
  const busy = new Map(); // run -> id of its running task
  const running = new Map(); // id -> promise, for idle()
  const iso = () => new Date(now()).toISOString();
  const copy = (t) => ({ ...t, outputs: [...t.outputs], warnings: [...t.warnings] });

  const tell = (t) => {
    try {
      onChange(copy(t));
    } catch {
      // a listener's problem never stops a task
    }
  };

  const prune = () => {
    for (const [id, t] of tasks) {
      if (tasks.size <= KEEP) break;
      if (t.state !== "running") tasks.delete(id);
    }
  };

  return {
    /**
     * Run `work({ progress })` for film `run` in the background and return the
     * task at once. `work` resolves to { outputs: [{ name, url }], warnings? };
     * pass `progress` as core's `onLine` so ffmpeg's lines move the task along.
     */
    start(run, tool, label, work) {
      const held = busy.get(run);
      if (held) throw new HttpError(409, `${tasks.get(held).label} is still running in ${run}. Wait for it to finish, then try again.`);
      const task = { id: `t-${randomBytes(4).toString("hex")}`, run, tool, label, state: "running", startedAt: iso(), endedAt: null, outS: null, outputs: [], warnings: [], error: null };
      tasks.set(task.id, task);
      busy.set(run, task.id);
      prune();
      tell(task);

      let told = now();
      const progress = (line) => {
        const s = progressSeconds(line);
        if (s == null) return;
        task.outS = s;
        if (now() - told >= throttleMs) {
          told = now();
          tell(task);
        }
      };
      // Deferred a tick so the caller has the task before any of the work runs.
      const p = Promise.resolve()
        .then(() => work({ progress }))
        .then(
          (r) => {
            task.state = "done";
            task.outputs = r?.outputs ?? [];
            task.warnings = r?.warnings ?? [];
          },
          (err) => {
            task.state = "failed";
            task.error = redact(err?.message ?? String(err));
          },
        )
        .finally(() => {
          task.endedAt = iso();
          busy.delete(run);
          running.delete(task.id);
          tell(task);
        });
      running.set(task.id, p);
      return copy(task);
    },
    get: (id) => (tasks.has(id) ? copy(tasks.get(id)) : null),
    /** Newest first; only film `run`'s when given. */
    list: (run) => [...tasks.values()].filter((t) => !run || t.run === run).reverse().map(copy),
    /** Resolves when every task started so far has ended (tests). */
    idle: () => Promise.all([...running.values()]),
  };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && node --test tests/tasks.test.mjs`
Expected: PASS, 8 of 8.

Then run: `cd web && npm run test:server`
Expected: 132 pass, 0 fail. (A `studio: Error: kaboom with sk-a…23` line on stderr is an existing test of redacted logging.)

- [ ] **Step 5: Commit**

```bash
git add web/server/app.mjs web/server/events.mjs web/server/tasks.mjs web/tests/tasks.test.mjs
git diff --cached --stat
git commit -m "Run finishing work as tracked studio tasks with SSE progress

One task per film at a time; ffmpeg's progress is read from core's onLine.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 3: Films: the run folders and one film's files

**Files:**
- Create: `web/server/api/films.mjs`
- Modify: `web/server/app.mjs`
- Create: `web/tests/films.test.mjs` (test)

`GET /api/films` is core's `listRuns()` plus a cover (newest video, else newest image; none for a folder whose name is not a run slug). `GET /api/films/:slug` uses core's `getRun` (an unknown film is core's code 3, HTTP 400) and lists every visible file oldest first with its kind (video, image, audio, srt), its origin read from core's default names (`film.mp4`, `captioned.mp4`, `<name>-9x16.mp4`, a template name, else a take), its media URL, size, time and the job that made it, matched by media URL. `order` is the shot list of the film's last `assembly.json`, which core already writes, so the page can restore the order without a new file.

- [ ] **Step 1: Write the failing test**

Create `web/tests/films.test.mjs`:

```js
import { RUNS, KEY, deps, req, tmp } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { createApp } = await import("../server/app.mjs");
const { openJobs } = await import("../../cli/core/jobs.mjs");

const film = join(RUNS, "film-demo");
mkdirSync(film, { recursive: true });
// Written oldest first; each gets its own modified time so the order is certain.
const files = ["out.mp4", "out-2.mp4", "music.mp3", "captions.srt", "prompt.txt", "film.mp4", "film-9x16.mp4", "captioned.mp4", "kinetic-type.mp4", "ref.png", ".film.mp4.ab12.part"];
files.forEach((name, i) => {
  writeFileSync(join(film, name), "x");
  const t = new Date(Date.UTC(2026, 9, 31, 10, 0, i));
  utimesSync(join(film, name), t, t);
});
writeFileSync(join(film, "assembly.json"), JSON.stringify({ shots: [{ path: join(film, "out-2.mp4") }, { path: join(film, "out.mp4") }, { path: join(film, "gone.mp4") }] }));

const store = openJobs(join(RUNS, ".jobs"));
const j = store.create({ run: "film-demo", capability: "video", model: "seedance-2-5", provider: "kie", estimateUsd: 0.56, input: { prompt: "A fox", duration: 4 } });
store.transition(j.id, "sending");
store.transition(j.id, "submitted", { upstreamTaskId: "task-1" });
store.transition(j.id, "succeeded", { artifacts: [join(film, "out.mp4")], actualUsd: 0.5, costSource: "task-record" });

let app, port;
before(async () => {
  app = createApp({ key: KEY, deps, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());

describe("GET /api/films", () => {
  test("one card per run folder, with its newest video as the cover", async () => {
    const r = await req(port, "/api/films");
    assert.equal(r.status, 200);
    const card = r.json.find((f) => f.run === "film-demo");
    assert.equal(card.takes, 8, "core's count of media files");
    assert.deepEqual(card.cover, { kind: "video", url: "/media/runs/film-demo/kinetic-type.mp4" });
  });

  test("a folder whose name is not a run slug is listed without a cover, and does not break the list", async () => {
    mkdirSync(join(RUNS, "Old Stuff"), { recursive: true });
    const r = await req(port, "/api/films");
    assert.equal(r.status, 200);
    assert.equal(r.json.find((f) => f.run === "Old Stuff").cover, null);
  });
});

describe("GET /api/films/:slug", () => {
  test("lists media and SRT files oldest first, each with its kind and where it came from", async () => {
    const r = await req(port, "/api/films/film-demo");
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(
      r.json.files.map((f) => [f.name, f.kind, f.origin]),
      [
        ["out.mp4", "video", "take"],
        ["out-2.mp4", "video", "take"],
        ["music.mp3", "audio", null],
        ["captions.srt", "srt", null],
        ["film.mp4", "video", "film"],
        ["film-9x16.mp4", "video", "variant"],
        ["captioned.mp4", "video", "captioned"],
        ["kinetic-type.mp4", "video", "card"],
        ["ref.png", "image", "take"],
      ],
    );
    const out = r.json.files[0];
    assert.equal(out.url, "/media/runs/film-demo/out.mp4");
    assert.equal(out.bytes, 1);
    assert.equal(out.job.id, j.id, "a take carries the job that made it");
    assert.equal(out.job.actualUsd, 0.5);
    assert.equal(r.json.files[1].job, null);
  });

  test("the shot order is the last assembly's, for the shots still in the folder", async () => {
    const r = await req(port, "/api/films/film-demo");
    assert.deepEqual(r.json.order, ["out-2.mp4", "out.mp4"]);
  });

  test("an unknown film is 400 with core's code 3; a bad slug is refused too", async () => {
    const r = await req(port, "/api/films/no-such-film");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 3);
    assert.match(r.json.error.message, /No run "no-such-film"/);
    assert.equal((await req(port, "/api/films/Bad%20Slug")).status, 400);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && node --test tests/films.test.mjs`
Expected: FAIL, 5 of 5: each request gets 404 (for example `{"error":{"code":0,"message":"No GET /api/films/film-demo."}}`).

- [ ] **Step 3: Implement**

Create `web/server/api/films.mjs`:

```js
// Films: one card per run folder, and one film's files for its page. Reads
// only; the finishing tools are in finish.mjs. Core's getRun checks the slug,
// refuses an unknown run (code 3) and lists the folder's files.
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { listRuns, getRun } from "../../../cli/core/views.mjs";
import { runDir } from "../../../cli/lib/run.mjs";
import { RATIOS } from "../../../cli/lib/ffmpeg.mjs";
import { TEMPLATES } from "../../../cli/lib/render.mjs";
import { context, jobView } from "../state.mjs";
import { mediaUrl } from "../media.mjs";

const KINDS = [
  [/\.(mp4|mov|webm)$/i, "video"],
  [/\.(png|jpe?g|webp)$/i, "image"],
  [/\.(mp3|wav|m4a|aac|ogg)$/i, "audio"],
  [/\.srt$/i, "srt"],
];

/** video, image, audio or srt from the name; null for records and anything else. */
export const fileKind = (name) => KINDS.find(([re]) => re.test(name))?.[1] ?? null;

// The studio never names an output, so each finishing tool's default name says what made it.
const n = "(?:-\\d+)?";
const ORIGINS = [
  [new RegExp(`-(?:${Object.keys(RATIOS).map((r) => r.replace(":", "x")).join("|")})\\.mp4$`), "variant"],
  [new RegExp(`^film${n}\\.mp4$`), "film"],
  [new RegExp(`^captioned${n}\\.mp4$`), "captioned"],
  [new RegExp(`^(?:${Object.keys(TEMPLATES).join("|")})${n}\\.(?:mp4|mov)$`), "card"],
];

/** For a video or image: film, captioned, variant, card or take. Null for audio and SRT. */
export function fileOrigin(name, kind) {
  if (kind === "image") return "take";
  if (kind !== "video") return null;
  return ORIGINS.find(([re]) => re.test(name))?.[1] ?? "take";
}

const visible = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith(".") && fileKind(d.name))
    .map((d) => ({ name: d.name, kind: fileKind(d.name), modified: statSync(join(dir, d.name)).mtime.toISOString() }));

/** The newest video in the folder, else the newest image, for the film's card. Null for a folder core cannot name as a run. */
function cover(slug) {
  let dir;
  try {
    dir = runDir(slug, { create: false });
  } catch {
    return null; // "Old Stuff/" is listed, but is not a run slug the tools accept
  }
  const files = visible(dir).sort((a, b) => b.modified.localeCompare(a.modified));
  const pick = files.find((f) => f.kind === "video") ?? files.find((f) => f.kind === "image");
  return pick ? { kind: pick.kind, url: mediaUrl(join(dir, pick.name)) } : null;
}

/** The shot order of the film's last assembly (core's assembly.json), for the shots still in the folder. */
function lastOrder(dir, names) {
  let record;
  try {
    record = JSON.parse(readFileSync(join(dir, "assembly.json"), "utf8"));
  } catch {
    return [];
  }
  const real = realpathSync(dir);
  return (record?.shots ?? [])
    .map((s) => String(s?.path ?? ""))
    .filter((p) => names.some((name) => join(real, name) === p))
    .map((p) => p.slice(real.length + 1));
}

export function filmDetail(slug, following) {
  const { store } = context();
  const run = getRun(slug, { store }); // code 3 for a bad slug or an unknown run
  const dir = runDir(slug, { create: false });
  const jobs = store.list().filter((j) => j.run === slug).map((j) => jobView(j, following));
  const byUrl = new Map(jobs.flatMap((j) => j.media.map((u) => [u, j])));
  const sizes = new Map(run.files.map((f) => [f.name, f.bytes]));
  const files = visible(dir)
    .sort((a, b) => a.modified.localeCompare(b.modified) || a.name.localeCompare(b.name))
    .map((f) => {
      const url = mediaUrl(join(dir, f.name));
      return { ...f, origin: fileOrigin(f.name, f.kind), url, bytes: sizes.get(f.name) ?? 0, job: byUrl.get(url) ?? null };
    });
  const videos = files.filter((f) => f.kind === "video").map((f) => f.name);
  return { run: run.run, prompt: run.prompt, files, order: lastOrder(dir, videos) };
}

export function registerFilms(router, { following } = {}) {
  router.get("/api/films", () => listRuns().map((r) => ({ ...r, cover: cover(r.run) })));
  router.get("/api/films/:slug", ({ params }) => filmDetail(params.slug, following));
}
```

Modify `web/server/app.mjs` with this change:

```diff
--- a/web/server/app.mjs
+++ b/web/server/app.mjs
@@ -12,6 +12,7 @@ import { registerGenerate } from "./api/generate.mjs";
 import { registerFrames } from "./api/frames.mjs";
 import { registerLibrary } from "./api/library.mjs";
 import { registerPresets } from "./api/presets.mjs";
+import { registerFilms } from "./api/films.mjs";
 import { loadCatalog } from "../../cli/lib/models.mjs";
 
 export const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
@@ -40,6 +41,7 @@ export function createApp({ key, deps = {}, catalog = loadCatalog(), distDir = j
   registerFrames(router);
   registerLibrary(router, { catalog, following });
   registerPresets(router, { catalog });
+  registerFilms(router, { following });
 
   const server = createServer(createHandler({ key, router, distDir, media: serveMedia }));
   // A malformed request never reaches the handler; drop the socket quietly.
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && node --test tests/films.test.mjs`
Expected: PASS, 5 of 5.

Then run: `cd web && npm run test:server`
Expected: 137 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/server/api/films.mjs web/server/app.mjs web/tests/films.test.mjs
git diff --cached --stat
git commit -m "List films and a film's files for the studio

Covers, kinds, origins from core's default names, each take's job, and the
last assembly's shot order.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 4: What the finishing tools take, and whether they are installed

**Files:**
- Create: `web/server/api/finish.mjs`
- Modify: `web/server/app.mjs`
- Create: `web/server/templates.mjs`
- Create: `web/tests/finish.test.mjs` (test)
- Create: `web/tests/templates.test.mjs` (test)

Core lists the render templates by id and description only (`TEMPLATES` in `cli/lib/render.mjs`); their props live in TypeScript the server cannot import. `web/server/templates.mjs` describes each template's fields for the text-card form, and `tests/templates.test.mjs` reads `render/src/templates/*.tsx` so the list fails loudly when a template changes. `GET /api/finish` returns the tool check (core's `requireFfmpeg` and `requireRemotion` wrapped so they report instead of throwing, with core's install message), the templates, ratios, a fixed transition list (each one checked against `ffmpeg -h filter=xfade`), caption styles and variant modes. `need(check, ...)` refuses a request with code 1 and core's install text when a tool is missing.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/templates.test.mjs`:

```js
import "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { TEMPLATE_FIELDS, templateList } = await import("../server/templates.mjs");
const { TEMPLATES, RENDER_DIR } = await import("../../cli/lib/render.mjs");

/** kinetic-type -> render/src/templates/KineticType.tsx */
const source = (id) => readFileSync(join(RENDER_DIR, "src", "templates", `${id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("")}.tsx`), "utf8");

describe("template fields", () => {
  test("cover exactly core's templates, with core's descriptions", () => {
    assert.deepEqual(Object.keys(TEMPLATE_FIELDS).sort(), Object.keys(TEMPLATES).sort());
    for (const t of templateList()) assert.equal(t.description, TEMPLATES[t.id]);
  });

  test("every field, choice and default duration is still in the template's source", () => {
    for (const [id, spec] of Object.entries(TEMPLATE_FIELDS)) {
      const tsx = source(id);
      assert.match(tsx, new RegExp(`durationS: ${spec.durationS},`), `${id} default duration`);
      for (const f of spec.fields) {
        assert.match(tsx, new RegExp(`\\b${f.name}\\??: `), `${id}.${f.name} is a prop`);
        for (const c of f.choices ?? []) assert.ok(tsx.includes(`"${c}"`), `${id}.${f.name} choice ${c}`);
      }
    }
  });
});
```

Create `web/tests/finish.test.mjs`:

```js
import { RUNS, KEY, deps, req, tmp } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const { createApp } = await import("../server/app.mjs");
const { RENDER_DIR } = await import("../../cli/lib/render.mjs");

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const hasRender = existsSync(join(RENDER_DIR, "node_modules", "remotion"));
mkdirSync(join(RUNS, "finish-demo"), { recursive: true });

let app, port;
before(async () => {
  app = createApp({ key: KEY, deps, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());

describe("GET /api/finish", () => {
  test("says whether ffmpeg and the render engine are installed, and lists what the tools take", async () => {
    const r = await req(port, "/api/finish");
    assert.equal(r.status, 200);
    assert.equal(r.json.tools.ffmpeg.ok, hasFfmpeg);
    assert.equal(r.json.tools.render.ok, hasRender);
    if (!hasRender) assert.match(r.json.tools.render.install, /npm install/);
    assert.deepEqual(r.json.ratios, ["16:9", "9:16", "1:1", "4:5", "4:3", "21:9"]);
    assert.deepEqual(r.json.variantModes, ["blur", "crop", "pad"]);
    assert.deepEqual(r.json.captionStyles, ["social", "subtle"]);
    assert.ok(r.json.transitions.includes("fade"));
    assert.deepEqual(r.json.templates.find((t) => t.id === "kinetic-type").fields.map((f) => f.name), ["lines", "kicker", "footer", "granularity", "align"]);
  });

  test("a missing tool comes with core's install instructions", async () => {
    const missing = createApp({
      key: KEY,
      deps,
      distDir: join(tmp, "nodist"),
      pollMs: 60_000,
      finish: { check: () => ({ ffmpeg: { ok: false, install: "ffmpeg not found on PATH. Finishing commands need it:\n  brew install ffmpeg" }, render: { ok: true, install: null } }) },
    });
    await new Promise((r) => missing.listen(0, "127.0.0.1", r));
    try {
      const r = await req(missing.address().port, "/api/finish");
      assert.equal(r.json.tools.ffmpeg.ok, false);
      assert.match(r.json.tools.ffmpeg.install, /brew install ffmpeg/);
    } finally {
      await missing.closeAll();
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && node --test tests/templates.test.mjs tests/finish.test.mjs`
Expected: FAIL. `templates.test.mjs`: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/web/server/templates.mjs'`. `finish.test.mjs`: 2 of 2 fail, one with `actual: 404, expected: 200`, the other with `TypeError: Cannot read properties of undefined (reading 'ffmpeg')`.

- [ ] **Step 3: Implement**

Create `web/server/api/finish.mjs`:

```js
// Finishing a film with the free local tools: assemble, captions, variants and
// text cards. Each endpoint checks its input, confines every path it is given
// (confinePath against the allowed roots, as the MCP tools do), then starts a
// background task (tasks.mjs) that calls the same core function the CLI and
// the MCP server call. Outputs always land in the film's folder under core's
// next free default name; the studio never takes an output name or path.
import { assemble } from "../../../cli/lib/assemble.mjs";
import { burnCaptions } from "../../../cli/lib/caption.mjs";
import { makeVariants, MODES } from "../../../cli/lib/variants.mjs";
import { render, requireRemotion } from "../../../cli/lib/render.mjs";
import { requireFfmpeg, RATIOS } from "../../../cli/lib/ffmpeg.mjs";
import { usage } from "../../../cli/lib/errors.mjs";
import { templateList } from "../templates.mjs";

/** The core functions the endpoints run; tests replace the slow ones. */
export const CORE_TOOLS = { assemble, burnCaptions, makeVariants, render };

/** ffmpeg names offered for crossfades. A fixed list: the name goes into an ffmpeg filter. */
export const TRANSITIONS = ["fade", "fadeblack", "fadewhite", "dissolve", "wipeleft", "wiperight", "slideleft", "slideright", "circleopen", "circleclose"];
export const CAPTION_STYLES = ["social", "subtle"];

/** Whether ffmpeg (with ffprobe) and the render engine are installed. When not, `install` is core's own message saying how. */
export function toolCheck() {
  const one = (requireTool) => {
    try {
      requireTool();
      return { ok: true, install: null };
    } catch (err) {
      return { ok: false, install: err.message };
    }
  };
  return { ffmpeg: one(requireFfmpeg), render: one(requireRemotion) };
}

export function registerFinish(router, { tasks, tools = CORE_TOOLS, check = toolCheck } = {}) {
  router.get("/api/finish", () => ({
    tools: check(),
    templates: templateList(),
    ratios: Object.keys(RATIOS),
    transitions: TRANSITIONS,
    captionStyles: CAPTION_STYLES,
    variantModes: MODES,
  }));
}

/** Refuse before starting a task when a tool it needs is missing: code 1 with core's install message. */
export function need(check, ...names) {
  const found = check();
  for (const name of names) {
    if (!found[name].ok) throw usage(found[name].install, { tool: name });
  }
}
```

Modify `web/server/app.mjs` with this change:

```diff
--- a/web/server/app.mjs
+++ b/web/server/app.mjs
@@ -13,6 +13,7 @@ import { registerFrames } from "./api/frames.mjs";
 import { registerLibrary } from "./api/library.mjs";
 import { registerPresets } from "./api/presets.mjs";
 import { registerFilms } from "./api/films.mjs";
+import { registerFinish } from "./api/finish.mjs";
 import { loadCatalog } from "../../cli/lib/models.mjs";
 
 export const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
@@ -23,8 +24,10 @@ export const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
  * waitForTask, download, creditsAfter), `upload` and `credits`. Tests pass
  * stubs. `closeAll()` also stops the event watchers. `resume` follows again
  * the studio jobs a previous run of the server left unsettled (main.mjs).
+ * `finish` replaces the finishing tools or their install check (tests):
+ * { tools: { assemble, burnCaptions, makeVariants, render }, check }.
  */
-export function createApp({ key, deps = {}, catalog = loadCatalog(), distDir = join(WEB_DIR, "dist"), pollMs, resume = false } = {}) {
+export function createApp({ key, deps = {}, catalog = loadCatalog(), distDir = join(WEB_DIR, "dist"), pollMs, resume = false, finish = {} } = {}) {
   const router = createRouter();
   let events = null;
   const follower = createFollower({ catalog, deps, onChange: () => events?.nudge() });
@@ -42,6 +45,7 @@ export function createApp({ key, deps = {}, catalog = loadCatalog(), distDir = j
   registerLibrary(router, { catalog, following });
   registerPresets(router, { catalog });
   registerFilms(router, { following });
+  registerFinish(router, { tasks, ...finish });
 
   const server = createServer(createHandler({ key, router, distDir, media: serveMedia }));
   // A malformed request never reaches the handler; drop the socket quietly.
```

Create `web/server/templates.mjs`:

```js
// The render templates' props, for the text-card form. The templates are
// React components in render/src/templates/*.tsx, which the server cannot
// import, and core lists only their ids and one-line descriptions (TEMPLATES
// in cli/lib/render.mjs). Each field below names a prop of a template's Props
// type; tests/templates.test.mjs reads the .tsx sources and fails when one
// drifts. Field types: text, lines (a list, one per row), choice, image (a
// file inside runs/ or library/) and json (a list of objects).
import { TEMPLATES } from "../../cli/lib/render.mjs";

export const TEMPLATE_FIELDS = {
  "kinetic-type": {
    durationS: 6,
    fields: [
      { name: "lines", type: "lines", label: "Lines", required: true, hint: "One line of the headline per row." },
      { name: "kicker", type: "text", label: "Kicker" },
      { name: "footer", type: "text", label: "Footer" },
      { name: "granularity", type: "choice", label: "Builds by", choices: ["word", "line"] },
      { name: "align", type: "choice", label: "Align", choices: ["center", "left"] },
    ],
  },
  "logo-reveal": {
    durationS: 4,
    fields: [
      { name: "wordmark", type: "text", label: "Wordmark", required: true },
      { name: "tagline", type: "text", label: "Tagline" },
      { name: "logo", type: "image", label: "Logo file", hint: "A PNG, JPEG, WebP or SVG inside runs/ or library/, for example zed/logo.png." },
      { name: "background", type: "choice", label: "Background", choices: ["gradient", "solid"] },
    ],
  },
  "stat-reveal": {
    durationS: 7,
    fields: [
      { name: "title", type: "text", label: "Title" },
      {
        name: "stats",
        type: "json",
        label: "Stats",
        required: true,
        hint: "A list of { label, value, prefix?, suffix?, decimals?, bar? }; bar is 0 to 1.",
        example: [
          { label: "Hours saved weekly", value: 4.5, decimals: 1, suffix: "h", bar: 0.75 },
          { label: "Replies drafted", value: 128, bar: 0.55 },
        ],
      },
      { name: "footnote", type: "text", label: "Footnote" },
    ],
  },
  "lower-third": {
    durationS: 4,
    fields: [
      { name: "name", type: "text", label: "Name", required: true },
      { name: "title", type: "text", label: "Title" },
      { name: "side", type: "choice", label: "Side", choices: ["left", "right"] },
    ],
  },
  "ui-demo": {
    durationS: 9,
    fields: [
      { name: "title", type: "text", label: "Title" },
      {
        name: "steps",
        type: "json",
        label: "Steps",
        required: true,
        hint: "A list of { image, caption?, holdS? }; each image is a real screenshot inside runs/ or library/.",
        example: [{ image: "my-film/screen-1.png", caption: "Open the inbox" }],
      },
      { name: "frameStyle", type: "choice", label: "Frame", choices: ["browser", "phone", "none"] },
    ],
  },
};

/** Core's templates, each with its description, default length and fields. */
export const templateList = () =>
  Object.entries(TEMPLATES).map(([id, description]) => ({ id, description, durationS: TEMPLATE_FIELDS[id]?.durationS ?? null, fields: TEMPLATE_FIELDS[id]?.fields ?? [] }));
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && node --test tests/templates.test.mjs tests/finish.test.mjs`
Expected: PASS, 4 of 4.

Then run: `cd web && npm run test:server`
Expected: 141 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/server/api/finish.mjs web/server/app.mjs web/server/templates.mjs web/tests/finish.test.mjs web/tests/templates.test.mjs
git diff --cached --stat
git commit -m "Describe the finishing tools and template props for the studio

Reports missing ffmpeg or render engine with core's install message; a
drift test keeps the template fields in step with the .tsx sources.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 5: Assemble

**Files:**
- Modify: `web/server/api/finish.mjs`
- Modify: `web/tests/finish.test.mjs` (test)

`POST /api/films/:slug/assemble` takes `{ shots, music?, vo?, transition?, transition_s?, aspect_ratio?, shot_audio? }`. A bare name is a file in the film; a name with a slash is under the runs folder; every one goes through core's `checkLocalFile` with the allowed roots (which confines it, refuses hidden folders and checks the type by content), and a refusal names its field. The transition must be one of the fixed list, so nothing the page sends becomes part of an ffmpeg filter. The task calls core's `assemble` (crossfades, two-pass loudness normalisation) with `out` set to core's next free `film.mp4` in the film and writes `assembly.json` with `writeRecord`. The real-ffmpeg test uses two one-second clips and a short tone it makes itself; it skips with "ffmpeg not installed" when ffmpeg is missing.

- [ ] **Step 1: Write the failing test**

Modify `web/tests/finish.test.mjs` with this change:

```diff
--- a/web/tests/finish.test.mjs
+++ b/web/tests/finish.test.mjs
@@ -1,24 +1,67 @@
 import { RUNS, KEY, deps, req, tmp } from "./helpers.mjs";
 import { test, describe, before, after } from "node:test";
 import assert from "node:assert/strict";
-import { existsSync, mkdirSync } from "node:fs";
+import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
 import { join } from "node:path";
 import { spawnSync } from "node:child_process";
 
 const { createApp } = await import("../server/app.mjs");
 const { RENDER_DIR } = await import("../../cli/lib/render.mjs");
+const { CORE_TOOLS } = await import("../server/api/finish.mjs");
 
 const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
 const hasRender = existsSync(join(RENDER_DIR, "node_modules", "remotion"));
-mkdirSync(join(RUNS, "finish-demo"), { recursive: true });
+const FILM = join(RUNS, "finish-demo");
+mkdirSync(FILM, { recursive: true });
+mkdirSync(join(RUNS, "finish-gated"), { recursive: true });
+const ffmpeg = (...args) => spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
+if (hasFfmpeg) {
+  // One-second clips with a tone, and a short music bed: tiny, so a real assemble takes a moment.
+  for (const [name, hz] of [["a.mp4", 440], ["b.mp4", 660]]) {
+    ffmpeg("-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=1", "-f", "lavfi", "-i", `sine=frequency=${hz}:duration=1`, "-pix_fmt", "yuv420p", "-shortest", join(FILM, name));
+  }
+  ffmpeg("-f", "lavfi", "-i", "sine=frequency=220:duration=2", join(FILM, "bed.wav"));
+}
+// Not media, whatever the names say: refused by their content.
+writeFileSync(join(RUNS, "finish-gated", "a.mp4"), "\x00\x00\x00\x18ftypisom");
+writeFileSync(join(RUNS, "finish-gated", "notes.wav"), "plain text");
+mkdirSync(join(RUNS, "finish-gated", ".hidden"), { recursive: true });
+writeFileSync(join(RUNS, "finish-gated", ".hidden", "x.mp4"), "\x00\x00\x00\x18ftypisom");
+writeFileSync(join(tmp, "outside.mp4"), "\x00\x00\x00\x18ftypisom");
 
-let app, port;
+const allOk = () => ({ ffmpeg: { ok: true, install: null }, render: { ok: true, install: null } });
+
+/** A finishing tool that waits until the test lets it finish, and records what it was asked. */
+function gated() {
+  const calls = [];
+  let release = () => {};
+  const done = new Promise((r) => (release = r));
+  const tool = async (args) => {
+    calls.push(args);
+    await done;
+    writeFileSync(args.out ?? join(args.outDir, "x.mp4"), "made");
+    return { out: args.out, variants: [] };
+  };
+  return { calls, tool, release };
+}
+
+let app, port, slow, slowApp, slowPort;
 before(async () => {
   app = createApp({ key: KEY, deps, distDir: join(tmp, "nodist"), pollMs: 60_000 });
   await new Promise((r) => app.listen(0, "127.0.0.1", r));
   port = app.address().port;
+  slow = gated();
+  slowApp = createApp({ key: KEY, deps, distDir: join(tmp, "nodist"), pollMs: 60_000, finish: { tools: { ...CORE_TOOLS, assemble: slow.tool }, check: allOk } });
+  await new Promise((r) => slowApp.listen(0, "127.0.0.1", r));
+  slowPort = slowApp.address().port;
 });
-after(() => app.closeAll());
+after(async () => {
+  slow.release();
+  await slowApp.tasks.idle();
+  await Promise.all([app.closeAll(), slowApp.closeAll()]);
+});
+
+const post = (p, path, body) => req(p, path, { method: "POST", body });
 
 describe("GET /api/finish", () => {
   test("says whether ffmpeg and the render engine are installed, and lists what the tools take", async () => {
@@ -52,3 +95,92 @@ describe("GET /api/finish", () => {
     }
   });
 });
+
+describe("POST /api/films/:slug/assemble", () => {
+  test("joins the chosen shots with a crossfade and music into film.mp4 in the film, then numbers the next one", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
+    const body = { shots: ["b.mp4", "a.mp4"], music: "bed.wav", transition: "fade", transition_s: 0.25, aspect_ratio: "1:1" };
+    const r = await post(port, "/api/films/finish-demo/assemble", body);
+    assert.equal(r.status, 200, r.text);
+    assert.equal(r.json.task.state, "running");
+    assert.equal(r.json.task.tool, "assemble");
+    await app.tasks.idle();
+    const task = app.tasks.get(r.json.task.id);
+    assert.equal(task.state, "done", task.error);
+    assert.deepEqual(task.outputs, [{ name: "film.mp4", url: "/media/runs/finish-demo/film.mp4" }]);
+    const record = JSON.parse(readFileSync(join(FILM, "assembly.json"), "utf8"));
+    assert.deepEqual(record.shots.map((s) => s.path), [join(FILM, "b.mp4"), join(FILM, "a.mp4")]);
+    assert.equal(record.totalS, 1.75);
+    assert.equal(record.audio.loudnessTarget, "-16 LUFS / -1.5 dBTP (EBU R128), two-pass linear");
+
+    const again = await post(port, "/api/films/finish-demo/assemble", { shots: ["a.mp4"], aspect_ratio: "1:1" });
+    await app.tasks.idle();
+    assert.equal(app.tasks.get(again.json.task.id).outputs[0].name, "film-2.mp4", "never over the first film");
+  });
+
+  test("a second finishing task in the same film is refused while the first runs", async () => {
+    const first = await post(slowPort, "/api/films/finish-gated/assemble", { shots: ["a.mp4"] });
+    assert.equal(first.status, 200, first.text);
+    const second = await post(slowPort, "/api/films/finish-gated/assemble", { shots: ["a.mp4"] });
+    assert.equal(second.status, 409);
+    assert.match(second.json.error.message, /Assemble is still running in finish-gated/);
+    const args = slow.calls[0];
+    assert.equal(args.out, join(RUNS, "finish-gated", "film.mp4"), "the output is core's default name inside the film");
+    assert.deepEqual([args.ratio, args.width, args.height, args.transitionS, args.shotAudio], ["16:9", 1920, 1080, 0, "auto"]);
+    slow.release();
+    await slowApp.tasks.idle();
+  });
+
+  test("a shot outside the allowed folders, or in a hidden folder, is refused on its field before any task starts", async () => {
+    const before = slowApp.tasks.list().length;
+    const outside = await post(slowPort, "/api/films/finish-gated/assemble", { shots: [join(tmp, "outside.mp4")] });
+    assert.equal(outside.status, 400);
+    assert.equal(outside.json.error.code, 3);
+    assert.equal(outside.json.error.field, "shots");
+    assert.match(outside.json.error.message, /outside the folders files may be read from/);
+    const hidden = await post(slowPort, "/api/films/finish-gated/assemble", { shots: [".hidden/x.mp4"] });
+    assert.equal(hidden.status, 400);
+    assert.equal(slowApp.tasks.list().length, before);
+  });
+
+  test("music that is not audio is refused by its content", async () => {
+    const r = await post(slowPort, "/api/films/finish-gated/assemble", { shots: ["a.mp4"], music: "notes.wav" });
+    assert.equal(r.status, 400);
+    assert.equal(r.json.error.field, "music");
+    assert.match(r.json.error.message, /is not an audio file/);
+  });
+
+  test("a transition outside the fixed list never reaches ffmpeg", async () => {
+    const r = await post(slowPort, "/api/films/finish-gated/assemble", { shots: ["a.mp4", "a.mp4"], transition: "fade:duration=1,movie=/etc/hosts", transition_s: 0.5 });
+    assert.equal(r.status, 400);
+    assert.equal(r.json.error.field, "transition");
+  });
+
+  test("no shots, an unknown ratio and an unknown film are refused", async () => {
+    assert.equal((await post(slowPort, "/api/films/finish-gated/assemble", { shots: [] })).json.error.field, "shots");
+    assert.equal((await post(slowPort, "/api/films/finish-gated/assemble", { shots: ["a.mp4"], aspect_ratio: "2:1" })).json.error.field, "aspect_ratio");
+    const unknownFilm = await post(slowPort, "/api/films/no-such-film/assemble", { shots: ["a.mp4"] });
+    assert.equal(unknownFilm.status, 400);
+    assert.equal(unknownFilm.json.error.code, 3);
+  });
+
+  test("without ffmpeg it is refused with core's install message, and no task starts", async () => {
+    const noFfmpeg = createApp({
+      key: KEY,
+      deps,
+      distDir: join(tmp, "nodist"),
+      pollMs: 60_000,
+      finish: { check: () => ({ ffmpeg: { ok: false, install: "ffmpeg not found on PATH. Finishing commands need it:\n  brew install ffmpeg" }, render: { ok: true, install: null } }) },
+    });
+    await new Promise((r) => noFfmpeg.listen(0, "127.0.0.1", r));
+    try {
+      const r = await post(noFfmpeg.address().port, "/api/films/finish-gated/assemble", { shots: ["a.mp4"] });
+      assert.equal(r.status, 400);
+      assert.equal(r.json.error.code, 1);
+      assert.equal(r.json.error.tool, "ffmpeg");
+      assert.match(r.json.error.message, /brew install ffmpeg/);
+      assert.deepEqual(noFfmpeg.tasks.list(), []);
+    } finally {
+      await noFfmpeg.closeAll();
+    }
+  });
+});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && node --test tests/finish.test.mjs`
Expected: FAIL, 7 of 9: the new tests get 404 (`No POST /api/films/finish-demo/assemble.`, `No POST /api/films/finish-gated/assemble.`) or `actual: 404` where they expect 400.

- [ ] **Step 3: Implement**

Modify `web/server/api/finish.mjs` with this change:

```diff
--- a/web/server/api/finish.mjs
+++ b/web/server/api/finish.mjs
@@ -4,13 +4,20 @@
 // background task (tasks.mjs) that calls the same core function the CLI and
 // the MCP server call. Outputs always land in the film's folder under core's
 // next free default name; the studio never takes an output name or path.
+import { existsSync } from "node:fs";
+import { basename, isAbsolute, join } from "node:path";
 import { assemble } from "../../../cli/lib/assemble.mjs";
 import { burnCaptions } from "../../../cli/lib/caption.mjs";
 import { makeVariants, MODES } from "../../../cli/lib/variants.mjs";
 import { render, requireRemotion } from "../../../cli/lib/render.mjs";
-import { requireFfmpeg, RATIOS } from "../../../cli/lib/ffmpeg.mjs";
-import { usage } from "../../../cli/lib/errors.mjs";
+import { requireFfmpeg, RATIOS, dimsFor } from "../../../cli/lib/ffmpeg.mjs";
+import { RUNS_DIR, runDir, outPath, writeRecord } from "../../../cli/lib/run.mjs";
+import { unknown, usage } from "../../../cli/lib/errors.mjs";
+import { checkLocalFile } from "../../../cli/core/inputs.mjs";
 import { templateList } from "../templates.mjs";
+import { context } from "../state.mjs";
+import { mediaUrl } from "../media.mjs";
+import * as f from "./fields.mjs";
 
 /** The core functions the endpoints run; tests replace the slow ones. */
 export const CORE_TOOLS = { assemble, burnCaptions, makeVariants, render };
@@ -18,6 +25,38 @@ export const CORE_TOOLS = { assemble, burnCaptions, makeVariants, render };
 /** ffmpeg names offered for crossfades. A fixed list: the name goes into an ffmpeg filter. */
 export const TRANSITIONS = ["fade", "fadeblack", "fadewhite", "dissolve", "wipeleft", "wiperight", "slideleft", "slideright", "circleopen", "circleclose"];
 export const CAPTION_STYLES = ["social", "subtle"];
+const SHOT_AUDIO = ["auto", "keep", "drop"];
+// Size limits are for files sent to a provider; finishing reads local files only.
+const ANY_SIZE = { image: Infinity, video: Infinity, audio: Infinity };
+
+/** The film's folder. Code 1 for a bad slug, code 3 for a film that does not exist. */
+export function filmDir(slug) {
+  const dir = runDir(slug, { create: false });
+  if (!existsSync(dir)) throw unknown(`No film "${slug}". Its folder appears with its first take.`);
+  return dir;
+}
+
+/**
+ * A file the client named, checked by content: a bare name is in the film's
+ * folder, a path with a slash is inside runs/, an absolute path must sit in
+ * an allowed root. The MCP tools' rule. Refused as code 3 on `field`.
+ */
+export function mediaFile(dir, field, name, kinds) {
+  const named = isAbsolute(name) ? name : name.includes("/") ? join(RUNS_DIR, name) : join(dir, name);
+  try {
+    return checkLocalFile(named, { roots: context().roots, kinds, maxBytes: ANY_SIZE }).path;
+  } catch (err) {
+    throw f.invalid(field, err.message);
+  }
+}
+
+const output = (path) => ({ name: basename(path), url: mediaUrl(path) });
+
+function oneOf(body, field, choices, fallback) {
+  const v = f.text(body, field) ?? fallback;
+  if (!choices.includes(v)) throw f.invalid(field, `${field} must be one of ${choices.join(", ")}.`);
+  return v;
+}
 
 /** Whether ffmpeg (with ffprobe) and the render engine are installed. When not, `install` is core's own message saying how. */
 export function toolCheck() {
@@ -41,6 +80,33 @@ export function registerFinish(router, { tasks, tools = CORE_TOOLS, check = tool
     captionStyles: CAPTION_STYLES,
     variantModes: MODES,
   }));
+
+  /** Assemble: the chosen shots in order, optional music and voice-over, crossfades; loudness-normalised by core. */
+  router.post("/api/films/:slug/assemble", ({ params, body = {} }) => {
+    const dir = filmDir(params.slug);
+    const names = f.strings(body, "shots");
+    if (!names.length) throw f.invalid("shots", "Choose at least one shot.");
+    const shots = names.map((s) => mediaFile(dir, "shots", s, ["video"]));
+    const music = f.text(body, "music");
+    const vo = f.text(body, "vo");
+    const a = {
+      shots,
+      music: music ? mediaFile(dir, "music", music, ["audio"]) : null,
+      vo: vo ? mediaFile(dir, "vo", vo, ["audio"]) : null,
+      transition: oneOf(body, "transition", TRANSITIONS, "fade"),
+      transitionS: f.amount(body, "transition_s") ?? 0,
+      ratio: oneOf(body, "aspect_ratio", Object.keys(RATIOS), "16:9"),
+      shotAudio: oneOf(body, "shot_audio", SHOT_AUDIO, "auto"),
+    };
+    need(check, "ffmpeg");
+    const [width, height] = dimsFor(a.ratio);
+    const task = tasks.start(params.slug, "assemble", "Assemble", async ({ progress }) => {
+      const result = await tools.assemble({ ...a, width, height, out: outPath(dir, undefined, "film", ".mp4"), onLine: progress });
+      await writeRecord(dir, "assembly.json", result);
+      return { outputs: [output(result.out)] };
+    });
+    return { task };
+  });
 }
 
 /** Refuse before starting a task when a tool it needs is missing: code 1 with core's install message. */
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && node --test tests/finish.test.mjs`
Expected: PASS, 9 of 9 (the assemble run itself takes about a second).

Then run: `cd web && npm run test:server`
Expected: 148 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/server/api/finish.mjs web/tests/finish.test.mjs
git diff --cached --stat
git commit -m "Assemble a film's chosen shots from the studio

Core's assemble with crossfades, music or voice-over and loudness
normalisation, as a tracked task writing film.mp4 into the film.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 6: Music, voice-over and SRT into the film

**Files:**
- Modify: `web/server/api/films.mjs`
- Modify: `web/server/api/library.mjs`
- Modify: `web/tests/films.test.mjs` (test)

Assemble needs audio in the film, and captions need an SRT. Audio arrives as a raw upload (`POST /api/films/:slug/audio`, the library's `saveBody` streaming to `runs/.incoming/`), is checked as audio by content, and is moved in with core's `claimArtifact`, which never replaces a file. The ceiling is 200 MB rather than core's 30 MB audio limit, because this file is never sent to a provider. An SRT has no signature to sniff, so it arrives as text (`POST /api/films/:slug/srt`): core's `parseSrt` must find at least one cue, and the reply carries the cue count, the end time and core's problems list. It is saved with `landArtifact` as `captions.srt` or the next free number. `library.mjs` exports `label` and `saveBody` for this.

- [ ] **Step 1: Write the failing test**

Modify `web/tests/films.test.mjs` with this change:

```diff
--- a/web/tests/films.test.mjs
+++ b/web/tests/films.test.mjs
@@ -1,7 +1,7 @@
 import { RUNS, KEY, deps, req, tmp } from "./helpers.mjs";
 import { test, describe, before, after } from "node:test";
 import assert from "node:assert/strict";
-import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
+import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
 import { join } from "node:path";
 
 const { createApp } = await import("../server/app.mjs");
@@ -88,3 +88,54 @@ describe("GET /api/films/:slug", () => {
     assert.equal((await req(port, "/api/films/Bad%20Slug")).status, 400);
   });
 });
+
+describe("POST /api/films/:slug/audio", () => {
+  const wav = Buffer.concat([Buffer.from("RIFF\x24\x00\x00\x00WAVEfmt ", "latin1"), Buffer.alloc(64)]);
+  const upload = (film, body, name) => req(port, `/api/films/${film}/audio`, { method: "POST", body, headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name) } });
+
+  test("streams music into the film under a plain name from the file's, never over a file already there", async () => {
+    const r = await upload("film-demo", wav, "My Song (final).wav");
+    assert.equal(r.status, 200, r.text);
+    assert.deepEqual(r.json, { name: "my-song-final.wav", kind: "audio", url: "/media/runs/film-demo/my-song-final.wav", bytes: wav.length });
+    assert.ok(existsSync(join(film, "my-song-final.wav")));
+    const again = await upload("film-demo", wav, "My Song (final).wav");
+    assert.equal(again.json.name, "my-song-final-2.wav");
+  });
+
+  test("a file that is not audio is refused by its content and nothing is kept", async () => {
+    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.alloc(32)]);
+    const r = await upload("film-demo", png, "song.mp3");
+    assert.equal(r.status, 400);
+    assert.equal(r.json.error.field, "file");
+    assert.match(r.json.error.message, /^song\.mp3 is not an audio file/);
+    assert.ok(!existsSync(join(film, "song.mp3")));
+    assert.deepEqual(readdirSync(join(RUNS, ".incoming")), []);
+  });
+
+  test("an empty upload and an unknown film are refused", async () => {
+    assert.equal((await upload("film-demo", Buffer.alloc(0), "x.wav")).json.error.field, "file");
+    const r = await upload("no-such-film", wav, "x.wav");
+    assert.equal(r.status, 400);
+    assert.equal(r.json.error.code, 3);
+  });
+});
+
+describe("POST /api/films/:slug/srt", () => {
+  const srt = "1\n00:00:00,000 --> 00:00:01,500\nHello\n\n2\n00:00:01,000 --> 00:00:03,000\nAgain\n";
+
+  test("saves pasted captions as captions.srt in the film, numbering the next one, and reports core's problems", async () => {
+    const r = await req(port, "/api/films/film-demo/srt", { method: "POST", body: { text: srt } });
+    assert.equal(r.status, 200, r.text);
+    assert.equal(r.json.name, "captions-2.srt", "captions.srt was already there");
+    assert.equal(r.json.cues, 2);
+    assert.deepEqual(r.json.problems, ["Cue 2 starts at 1s before cue 1 ends at 1.5s."]);
+    assert.equal(readFileSync(join(film, "captions-2.srt"), "utf8"), srt);
+  });
+
+  test("text with no readable cue is refused on its field", async () => {
+    const r = await req(port, "/api/films/film-demo/srt", { method: "POST", body: { text: "just words" } });
+    assert.equal(r.status, 400);
+    assert.equal(r.json.error.field, "text");
+    assert.match(r.json.error.message, /No readable cues/);
+  });
+});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && node --test tests/films.test.mjs`
Expected: FAIL, 5 of 10: `No POST /api/films/film-demo/audio.`, `No POST /api/films/film-demo/srt.`, and `actual: 404` in the others.

- [ ] **Step 3: Implement**

Modify `web/server/api/films.mjs` with this change:

```diff
--- a/web/server/api/films.mjs
+++ b/web/server/api/films.mjs
@@ -1,14 +1,27 @@
-// Films: one card per run folder, and one film's files for its page. Reads
-// only; the finishing tools are in finish.mjs. Core's getRun checks the slug,
-// refuses an unknown run (code 3) and lists the folder's files.
-import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
-import { join } from "node:path";
+// Films: one card per run folder, one film's files for its page, and the two
+// ways files get into a film from the page: music or voice-over uploaded as a
+// raw body, and captions pasted as SRT text. The finishing tools are in
+// finish.mjs. Core's getRun checks the slug, refuses an unknown run (code 3)
+// and lists the folder's files.
+import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
+import { writeFile } from "node:fs/promises";
+import { randomBytes } from "node:crypto";
+import { basename, extname, join } from "node:path";
 import { listRuns, getRun } from "../../../cli/core/views.mjs";
-import { runDir } from "../../../cli/lib/run.mjs";
+import { checkLocalFile } from "../../../cli/core/inputs.mjs";
+import { RUNS_DIR, runDir, claimArtifact, landArtifact } from "../../../cli/lib/run.mjs";
+import { parseSrt } from "../../../cli/lib/caption.mjs";
 import { RATIOS } from "../../../cli/lib/ffmpeg.mjs";
 import { TEMPLATES } from "../../../cli/lib/render.mjs";
 import { context, jobView } from "../state.mjs";
 import { mediaUrl } from "../media.mjs";
+import { HttpError } from "../http.mjs";
+import { label, saveBody } from "./library.mjs";
+import { filmDir } from "./finish.mjs";
+import * as f from "./fields.mjs";
+
+/** Music beds run long and are never sent to a provider, so the ceiling is core's largest (video), not its 30 MB audio limit. */
+export const MAX_AUDIO_UPLOAD = 200_000_000;
 
 const KINDS = [
   [/\.(mp4|mov|webm)$/i, "video"],
@@ -86,7 +99,79 @@ export function filmDetail(slug, following) {
   return { run: run.run, prompt: run.prompt, files, order: lastOrder(dir, videos) };
 }
 
-export function registerFilms(router, { following } = {}) {
+/** "My Song (final).mp3" -> "my-song-final": a plain file stem, or `fallback`. */
+export function plainStem(name, fallback) {
+  const stem = basename(name, extname(name))
+    .toLowerCase()
+    .replace(/[^a-z0-9]+/g, "-")
+    .replace(/^-+|-+$/g, "")
+    .slice(0, 40)
+    .replace(/-+$/, "");
+  return stem || fallback;
+}
+
+export function registerFilms(router, { following, maxAudioBytes = MAX_AUDIO_UPLOAD } = {}) {
   router.get("/api/films", () => listRuns().map((r) => ({ ...r, cover: cover(r.run) })));
   router.get("/api/films/:slug", ({ params }) => filmDetail(params.slug, following));
+
+  /**
+   * Music or voice-over for Assemble, as the raw file body. It is streamed to
+   * runs/.incoming/, checked by core as audio, then moved into the film under
+   * a plain name from the client's (claimArtifact never replaces a file).
+   */
+  router.post(
+    "/api/films/:slug/audio",
+    async ({ params, req }) => {
+      const dir = filmDir(params.slug);
+      const incoming = join(RUNS_DIR, ".incoming");
+      mkdirSync(incoming, { recursive: true });
+      const root = realpathSync(incoming);
+      const part = join(root, `${randomBytes(16).toString("hex")}.part`);
+      const name = label(req.headers["x-file-name"]);
+      const drop = () => rmSync(part, { force: true });
+      let size;
+      try {
+        size = await saveBody(req, part, maxAudioBytes);
+      } catch (err) {
+        drop();
+        throw err;
+      }
+      if (size > maxAudioBytes) {
+        drop();
+        throw new HttpError(413, `${name} is over ${Math.round(maxAudioBytes / 1e6)} MB; nothing was saved.`);
+      }
+      if (size === 0) {
+        drop();
+        throw f.invalid("file", `${name} is empty.`);
+      }
+      let info;
+      try {
+        info = checkLocalFile(part, { roots: [root], kinds: ["audio"], maxBytes: { audio: maxAudioBytes } });
+      } catch (err) {
+        drop();
+        err.message = err.message.replaceAll(part, name);
+        err.field = "file";
+        throw err;
+      }
+      const { path } = claimArtifact(part, dir, plainStem(name, "audio"), info.ext);
+      return { name: basename(path), kind: "audio", url: mediaUrl(path), bytes: info.bytes };
+    },
+    { raw: true },
+  );
+
+  /**
+   * Captions arrive as SRT text (pasted, or read from a file by the page): an
+   * SRT has no signature to check by content, and core's parser says at once
+   * whether its cues read. Saved as captions.srt, or the next free number.
+   */
+  router.post("/api/films/:slug/srt", async ({ params, body = {} }) => {
+    const dir = filmDir(params.slug);
+    const text = f.text(body, "text", { required: true });
+    const parsed = parseSrt(text);
+    if (!parsed.cues.length) {
+      throw f.invalid("text", "No readable cues. Each cue is a number, a line like 00:00:01,000 --> 00:00:03,500, then its text, with a blank line between cues.");
+    }
+    const { path } = await landArtifact(dir, "captions", ".srt", (p) => writeFile(p, text));
+    return { name: basename(path), url: mediaUrl(path), cues: parsed.cues.length, problems: parsed.problems, lastEndS: parsed.lastEnd };
+  });
 }
```

Modify `web/server/api/library.mjs` with this change:

```diff
--- a/web/server/api/library.mjs
+++ b/web/server/api/library.mjs
@@ -45,7 +45,7 @@ function sweepIncoming(dir, now = Date.now()) {
 }
 
 /** A label for messages from the client's file name. Never used as a path. */
-function label(header) {
+export function label(header) {
   let name = "";
   try {
     name = decodeURIComponent(String(header ?? ""));
@@ -57,7 +57,7 @@ function label(header) {
 }
 
 /** Stream the request body to `path`, keeping at most `limit` bytes. Returns the full size sent. */
-async function saveBody(req, path, limit) {
+export async function saveBody(req, path, limit) {
   let size = 0;
   const cap = new Transform({
     transform(chunk, _enc, done) {
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && node --test tests/films.test.mjs`
Expected: PASS, 10 of 10.

Then run: `cd web && npm run test:server`
Expected: 153 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/server/api/films.mjs web/server/api/library.mjs web/tests/films.test.mjs
git diff --cached --stat
git commit -m "Add music, voice-over and SRT captions to a film

Audio is checked by content and claimed without replacing anything; SRT
text must parse to at least one cue.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 7: Captions and variants

**Files:**
- Modify: `web/server/api/finish.mjs`
- Modify: `web/tests/finish.test.mjs` (test)

`POST /api/films/:slug/caption` takes `{ video, srt, style }`: the SRT must be an `.srt` file inside the allowed roots, ffmpeg and the render engine must both be there, and the task calls core's `burnCaptions` into the next free `captioned.mp4`, writes `captions.json` and passes core's warnings on. `POST /api/films/:slug/variants` takes `{ video, ratios, mode }` and calls core's `makeVariants` with the film as `outDir`, writing `variants.json`; core names the outputs `<name>-9x16.mp4` and so on, so a second run for the same video and ratio replaces the first, exactly as `kie variants` does. Core's `captionOrderWarning` becomes a task warning. Caption tests stub `burnCaptions` (it needs a headless browser); the variants test runs real ffmpeg.

- [ ] **Step 1: Write the failing test**

Modify `web/tests/finish.test.mjs` with this change:

```diff
--- a/web/tests/finish.test.mjs
+++ b/web/tests/finish.test.mjs
@@ -45,13 +45,36 @@ function gated() {
   return { calls, tool, release };
 }
 
+/** The slow tools, stubbed: the caption overlay and text cards need a headless browser, which tests never start. */
+const calls = { caption: [], variants: [], render: [] };
+const stubs = {
+  burnCaptions: async (a) => {
+    calls.caption.push(a);
+    writeFileSync(a.out, "made");
+    return { out: a.out, cues: 2, style: a.style, warnings: ["1 cue(s) start after the film ends (1.00s) and were dropped."] };
+  },
+  makeVariants: async (a) => {
+    calls.variants.push(a);
+    return { source: { path: a.video }, variants: a.ratios.map((r) => ({ ratio: r, out: join(a.outDir, `x-${r.replace(":", "x")}.mp4`), width: 1, height: 1, mode: a.mode })) };
+  },
+  render: async (a) => {
+    calls.render.push(a);
+    writeFileSync(a.out, "made");
+    return { out: a.out, template: a.template, width: 1920, height: 1080 };
+  },
+};
+const SRT = "1\n00:00:00,000 --> 00:00:00,800\nHello\n";
+writeFileSync(join(RUNS, "finish-gated", "captions.srt"), SRT);
+writeFileSync(join(RUNS, "finish-gated", "notes.txt"), SRT);
+writeFileSync(join(FILM, "captions.srt"), SRT);
+
 let app, port, slow, slowApp, slowPort;
 before(async () => {
   app = createApp({ key: KEY, deps, distDir: join(tmp, "nodist"), pollMs: 60_000 });
   await new Promise((r) => app.listen(0, "127.0.0.1", r));
   port = app.address().port;
   slow = gated();
-  slowApp = createApp({ key: KEY, deps, distDir: join(tmp, "nodist"), pollMs: 60_000, finish: { tools: { ...CORE_TOOLS, assemble: slow.tool }, check: allOk } });
+  slowApp = createApp({ key: KEY, deps, distDir: join(tmp, "nodist"), pollMs: 60_000, finish: { tools: { ...CORE_TOOLS, ...stubs, assemble: slow.tool }, check: allOk } });
   await new Promise((r) => slowApp.listen(0, "127.0.0.1", r));
   slowPort = slowApp.address().port;
 });
@@ -184,3 +207,79 @@ describe("POST /api/films/:slug/assemble", () => {
     }
   });
 });
+
+describe("POST /api/films/:slug/caption", () => {
+  test("burns a saved SRT into a video as captioned.mp4 in the film, passing on core's warnings", async () => {
+    const r = await post(slowPort, "/api/films/finish-gated/caption", { video: "a.mp4", srt: "captions.srt", style: "subtle" });
+    assert.equal(r.status, 200, r.text);
+    await slowApp.tasks.idle();
+    const task = slowApp.tasks.get(r.json.task.id);
+    assert.equal(task.state, "done", task.error);
+    assert.deepEqual(task.outputs, [{ name: "captioned.mp4", url: "/media/runs/finish-gated/captioned.mp4" }]);
+    assert.deepEqual(task.warnings, ["1 cue(s) start after the film ends (1.00s) and were dropped."]);
+    const a = calls.caption.at(-1);
+    assert.deepEqual([a.video, a.srt, a.style], [join(RUNS, "finish-gated", "a.mp4"), join(RUNS, "finish-gated", "captions.srt"), "subtle"]);
+    assert.equal(JSON.parse(readFileSync(join(RUNS, "finish-gated", "captions.json"), "utf8")).cues, 2);
+  });
+
+  test("the captions must be an .srt file inside the allowed folders", async () => {
+    const notSrt = await post(slowPort, "/api/films/finish-gated/caption", { video: "a.mp4", srt: "notes.txt" });
+    assert.equal(notSrt.status, 400);
+    assert.equal(notSrt.json.error.field, "srt");
+    assert.match(notSrt.json.error.message, /an \.srt file/);
+    writeFileSync(join(tmp, "outside.srt"), SRT);
+    const outside = await post(slowPort, "/api/films/finish-gated/caption", { video: "a.mp4", srt: join(tmp, "outside.srt") });
+    assert.equal(outside.json.error.field, "srt");
+    assert.match(outside.json.error.message, /outside the folders/);
+  });
+
+  test("without the render engine it is refused with core's install message", async () => {
+    const noRender = createApp({
+      key: KEY,
+      deps,
+      distDir: join(tmp, "nodist"),
+      pollMs: 60_000,
+      finish: { check: () => ({ ffmpeg: { ok: true, install: null }, render: { ok: false, install: "The graphic-motion renderer is not installed. One time only:\n  cd render && npm install" } }) },
+    });
+    await new Promise((r) => noRender.listen(0, "127.0.0.1", r));
+    try {
+      const r = await post(noRender.address().port, "/api/films/finish-gated/caption", { video: "a.mp4", srt: "captions.srt" });
+      assert.equal(r.status, 400);
+      assert.equal(r.json.error.tool, "render");
+      assert.match(r.json.error.message, /npm install/);
+    } finally {
+      await noRender.closeAll();
+    }
+  });
+});
+
+describe("POST /api/films/:slug/variants", () => {
+  test("reframes a video to 9:16 and 1:1 beside it in the film", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
+    const r = await post(port, "/api/films/finish-demo/variants", { video: "a.mp4", ratios: ["9:16", "1:1"] });
+    assert.equal(r.status, 200, r.text);
+    await app.tasks.idle();
+    const task = app.tasks.get(r.json.task.id);
+    assert.equal(task.state, "done", task.error);
+    assert.deepEqual(task.outputs.map((o) => o.name), ["a-9x16.mp4", "a-1x1.mp4"]);
+    const record = JSON.parse(readFileSync(join(FILM, "variants.json"), "utf8"));
+    assert.deepEqual(record.variants.map((v) => [v.width, v.height, v.mode]), [[1080, 1920, "blur"], [1080, 1080, "blur"]]);
+  });
+
+  test("warns when the video already has captions burned in, using core's caption-order check", async () => {
+    writeFileSync(join(RUNS, "finish-gated", "captions.json"), JSON.stringify({ out: join(RUNS, "finish-gated", "captioned.mp4") }));
+    writeFileSync(join(RUNS, "finish-gated", "captioned.mp4"), "\x00\x00\x00\x18ftypisom");
+    const r = await post(slowPort, "/api/films/finish-gated/variants", { video: "captioned.mp4", ratios: ["9:16"], mode: "pad" });
+    assert.equal(r.status, 200, r.text);
+    await slowApp.tasks.idle();
+    const task = slowApp.tasks.get(r.json.task.id);
+    assert.match(task.warnings[0], /already has captions burned in/);
+    assert.equal(calls.variants.at(-1).mode, "pad");
+    assert.equal(calls.variants.at(-1).outDir, join(RUNS, "finish-gated"));
+  });
+
+  test("no ratio, an unknown ratio or an unknown mode is refused on its field", async () => {
+    assert.equal((await post(slowPort, "/api/films/finish-gated/variants", { video: "a.mp4", ratios: [] })).json.error.field, "ratios");
+    assert.equal((await post(slowPort, "/api/films/finish-gated/variants", { video: "a.mp4", ratios: ["2:1"] })).json.error.field, "ratios");
+    assert.equal((await post(slowPort, "/api/films/finish-gated/variants", { video: "a.mp4", ratios: ["1:1"], mode: "stretch" })).json.error.field, "mode");
+  });
+});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && node --test tests/finish.test.mjs`
Expected: FAIL, 6 of 15: `No POST /api/films/finish-demo/variants.`, `No POST /api/films/finish-gated/caption.`, `No POST /api/films/finish-gated/variants.`, and `actual: 404` in the rest.

- [ ] **Step 3: Implement**

Modify `web/server/api/finish.mjs` with this change:

```diff
--- a/web/server/api/finish.mjs
+++ b/web/server/api/finish.mjs
@@ -4,16 +4,16 @@
 // background task (tasks.mjs) that calls the same core function the CLI and
 // the MCP server call. Outputs always land in the film's folder under core's
 // next free default name; the studio never takes an output name or path.
-import { existsSync } from "node:fs";
+import { existsSync, readFileSync } from "node:fs";
 import { basename, isAbsolute, join } from "node:path";
 import { assemble } from "../../../cli/lib/assemble.mjs";
 import { burnCaptions } from "../../../cli/lib/caption.mjs";
-import { makeVariants, MODES } from "../../../cli/lib/variants.mjs";
+import { makeVariants, MODES, captionOrderWarning } from "../../../cli/lib/variants.mjs";
 import { render, requireRemotion } from "../../../cli/lib/render.mjs";
 import { requireFfmpeg, RATIOS, dimsFor } from "../../../cli/lib/ffmpeg.mjs";
 import { RUNS_DIR, runDir, outPath, writeRecord } from "../../../cli/lib/run.mjs";
 import { unknown, usage } from "../../../cli/lib/errors.mjs";
-import { checkLocalFile } from "../../../cli/core/inputs.mjs";
+import { checkLocalFile, confinePath } from "../../../cli/core/inputs.mjs";
 import { templateList } from "../templates.mjs";
 import { context } from "../state.mjs";
 import { mediaUrl } from "../media.mjs";
@@ -50,6 +50,25 @@ export function mediaFile(dir, field, name, kinds) {
   }
 }
 
+/** An SRT the client named: the same path rule, confined, and only a .srt file (its text is burned into a video). */
+function srtFile(dir, name) {
+  if (!/\.srt$/i.test(name)) throw f.invalid("srt", `${name} is not an .srt file. Save the captions first; they are kept as captions.srt in the film.`);
+  const named = isAbsolute(name) ? name : name.includes("/") ? join(RUNS_DIR, name) : join(dir, name);
+  try {
+    return confinePath(named, context().roots);
+  } catch (err) {
+    throw f.invalid("srt", err.message);
+  }
+}
+
+const readJson = (p) => {
+  try {
+    return JSON.parse(readFileSync(p, "utf8"));
+  } catch {
+    return null;
+  }
+};
+
 const output = (path) => ({ name: basename(path), url: mediaUrl(path) });
 
 function oneOf(body, field, choices, fallback) {
@@ -107,6 +126,44 @@ export function registerFinish(router, { tasks, tools = CORE_TOOLS, check = tool
     });
     return { task };
   });
+
+  /** Captions: an SRT burned into a video (core draws them with the render engine and overlays them with ffmpeg). */
+  router.post("/api/films/:slug/caption", ({ params, body = {} }) => {
+    const dir = filmDir(params.slug);
+    const video = mediaFile(dir, "video", f.text(body, "video", { required: true }), ["video"]);
+    const srt = srtFile(dir, f.text(body, "srt", { required: true }));
+    const style = oneOf(body, "style", CAPTION_STYLES, "social");
+    need(check, "ffmpeg", "render");
+    const task = tasks.start(params.slug, "caption", "Captions", async ({ progress }) => {
+      const result = await tools.burnCaptions({ video, srt, style, out: outPath(dir, undefined, "captioned", ".mp4"), onLine: progress });
+      await writeRecord(dir, "captions.json", result);
+      return { outputs: [output(result.out)], warnings: result.warnings ?? [] };
+    });
+    return { task };
+  });
+
+  /**
+   * Variants: a video reframed to other ratios, written beside it in the film
+   * as <name>-9x16.mp4 and so on. Core names them, so a second run for the
+   * same video and ratio replaces the first, as `kie variants` does.
+   */
+  router.post("/api/films/:slug/variants", ({ params, body = {} }) => {
+    const dir = filmDir(params.slug);
+    const video = mediaFile(dir, "video", f.text(body, "video", { required: true }), ["video"]);
+    const ratios = [...new Set(f.strings(body, "ratios"))];
+    if (!ratios.length) throw f.invalid("ratios", "Choose at least one ratio, such as 9:16 or 1:1.");
+    const unknownRatio = ratios.find((r) => !RATIOS[r]);
+    if (unknownRatio) throw f.invalid("ratios", `Unknown ratio "${unknownRatio}". Known: ${Object.keys(RATIOS).join(", ")}.`);
+    const mode = oneOf(body, "mode", MODES, "blur");
+    need(check, "ffmpeg");
+    const warning = captionOrderWarning(video, dir, readJson);
+    const task = tasks.start(params.slug, "variants", "Variants", async ({ progress }) => {
+      const result = await tools.makeVariants({ video, ratios, mode, outDir: dir, onLine: progress });
+      await writeRecord(dir, "variants.json", result);
+      return { outputs: result.variants.map((v) => output(v.out)), warnings: warning ? [warning] : [] };
+    });
+    return { task };
+  });
 }
 
 /** Refuse before starting a task when a tool it needs is missing: code 1 with core's install message. */
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && node --test tests/finish.test.mjs`
Expected: PASS, 15 of 15.

Then run: `cd web && npm run test:server`
Expected: 159 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/server/api/finish.mjs web/tests/finish.test.mjs
git diff --cached --stat
git commit -m "Burn captions and make 9:16 and 1:1 variants from the studio

Core's burnCaptions and makeVariants as tracked tasks, with core's
caption-order warning.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 8: Text cards

**Files:**
- Modify: `web/server/api/finish.mjs`
- Modify: `web/tests/finish.test.mjs` (test)

`POST /api/films/:slug/card` takes `{ template, props, aspect_ratio?, duration_s? }`. Required fields from `templates.mjs` are checked first (`props.<name>`), then core's `confineProps` (Task 1) confines every image path and refuses URLs, and a card runs 60 seconds at most. The task writes the confined props to `props-<template>.json` in the film, calls core's `render` into the next free `<template>.mp4` and writes `render-<template>.json`. Cards are mp4 only; the alpha output stays in the CLI.

- [ ] **Step 1: Write the failing test**

Modify `web/tests/finish.test.mjs` with this change:

```diff
--- a/web/tests/finish.test.mjs
+++ b/web/tests/finish.test.mjs
@@ -283,3 +283,45 @@ describe("POST /api/films/:slug/variants", () => {
     assert.equal((await post(slowPort, "/api/films/finish-gated/variants", { video: "a.mp4", ratios: ["1:1"], mode: "stretch" })).json.error.field, "mode");
   });
 });
+
+describe("POST /api/films/:slug/card", () => {
+  test("renders a text card from a template and its props into the film", async () => {
+    const r = await post(slowPort, "/api/films/finish-gated/card", { template: "kinetic-type", props: { lines: ["Exactly", "these words"], kicker: "ZED" }, aspect_ratio: "9:16", duration_s: 5 });
+    assert.equal(r.status, 200, r.text);
+    assert.equal(r.json.task.label, "Text card (kinetic-type)");
+    await slowApp.tasks.idle();
+    const task = slowApp.tasks.get(r.json.task.id);
+    assert.equal(task.state, "done", task.error);
+    assert.deepEqual(task.outputs, [{ name: "kinetic-type.mp4", url: "/media/runs/finish-gated/kinetic-type.mp4" }]);
+    const a = calls.render.at(-1);
+    assert.deepEqual([a.template, a.ratio, a.durationS], ["kinetic-type", "9:16", 5]);
+    assert.equal(a.propsPath, join(RUNS, "finish-gated", "props-kinetic-type.json"));
+    assert.deepEqual(JSON.parse(readFileSync(a.propsPath, "utf8")), { lines: ["Exactly", "these words"], kicker: "ZED" });
+    assert.ok(existsSync(join(RUNS, "finish-gated", "render-kinetic-type.json")));
+  });
+
+  test("an image in the props is confined like any other file, and saved as its real path", async () => {
+    writeFileSync(join(RUNS, "finish-gated", "logo.png"), "png");
+    const r = await post(slowPort, "/api/films/finish-gated/card", { template: "logo-reveal", props: { wordmark: "Zed", logo: "finish-gated/logo.png" } });
+    assert.equal(r.status, 200, r.text);
+    await slowApp.tasks.idle();
+    assert.equal(JSON.parse(readFileSync(calls.render.at(-1).propsPath, "utf8")).logo, join(RUNS, "finish-gated", "logo.png"));
+
+    writeFileSync(join(tmp, "logo.png"), "png");
+    const outside = await post(slowPort, "/api/films/finish-gated/card", { template: "logo-reveal", props: { wordmark: "Zed", logo: join(tmp, "logo.png") } });
+    assert.equal(outside.status, 400);
+    assert.equal(outside.json.error.field, "props");
+    assert.match(outside.json.error.message, /outside the folders/);
+    const remote = await post(slowPort, "/api/films/finish-gated/card", { template: "logo-reveal", props: { wordmark: "Zed", logo: "https://example.com/logo.png" } });
+    assert.match(remote.json.error.message, /remote URLs would be fetched from this machine/);
+  });
+
+  test("a missing required prop, an unknown template or a duration over a minute is refused on its field", async () => {
+    const noLines = await post(slowPort, "/api/films/finish-gated/card", { template: "kinetic-type", props: { lines: [] } });
+    assert.equal(noLines.status, 400);
+    assert.equal(noLines.json.error.field, "props.lines");
+    assert.match(noLines.json.error.message, /Lines is required for kinetic-type/);
+    assert.equal((await post(slowPort, "/api/films/finish-gated/card", { template: "captions", props: {} })).json.error.field, "template");
+    assert.equal((await post(slowPort, "/api/films/finish-gated/card", { template: "lower-third", props: { name: "Zed" }, duration_s: 600 })).json.error.field, "duration_s");
+  });
+});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && node --test tests/finish.test.mjs`
Expected: FAIL, 3 of 18: `No POST /api/films/finish-gated/card.` and `actual: 404` where 400 is expected.

- [ ] **Step 3: Implement**

Modify `web/server/api/finish.mjs` with this change:

```diff
--- a/web/server/api/finish.mjs
+++ b/web/server/api/finish.mjs
@@ -5,16 +5,17 @@
 // the MCP server call. Outputs always land in the film's folder under core's
 // next free default name; the studio never takes an output name or path.
 import { existsSync, readFileSync } from "node:fs";
+import { writeFile } from "node:fs/promises";
 import { basename, isAbsolute, join } from "node:path";
 import { assemble } from "../../../cli/lib/assemble.mjs";
 import { burnCaptions } from "../../../cli/lib/caption.mjs";
 import { makeVariants, MODES, captionOrderWarning } from "../../../cli/lib/variants.mjs";
-import { render, requireRemotion } from "../../../cli/lib/render.mjs";
+import { render, requireRemotion, TEMPLATES } from "../../../cli/lib/render.mjs";
 import { requireFfmpeg, RATIOS, dimsFor } from "../../../cli/lib/ffmpeg.mjs";
 import { RUNS_DIR, runDir, outPath, writeRecord } from "../../../cli/lib/run.mjs";
 import { unknown, usage } from "../../../cli/lib/errors.mjs";
-import { checkLocalFile, confinePath } from "../../../cli/core/inputs.mjs";
-import { templateList } from "../templates.mjs";
+import { checkLocalFile, confinePath, confineProps } from "../../../cli/core/inputs.mjs";
+import { templateList, TEMPLATE_FIELDS } from "../templates.mjs";
 import { context } from "../state.mjs";
 import { mediaUrl } from "../media.mjs";
 import * as f from "./fields.mjs";
@@ -26,6 +27,7 @@ export const CORE_TOOLS = { assemble, burnCaptions, makeVariants, render };
 export const TRANSITIONS = ["fade", "fadeblack", "fadewhite", "dissolve", "wipeleft", "wiperight", "slideleft", "slideright", "circleopen", "circleclose"];
 export const CAPTION_STYLES = ["social", "subtle"];
 const SHOT_AUDIO = ["auto", "keep", "drop"];
+const MAX_CARD_S = 60;
 // Size limits are for files sent to a provider; finishing reads local files only.
 const ANY_SIZE = { image: Infinity, video: Infinity, audio: Infinity };
 
@@ -164,6 +166,42 @@ export function registerFinish(router, { tasks, tools = CORE_TOOLS, check = tool
     });
     return { task };
   });
+
+  /**
+   * Text cards: exact titles, logos or numbers rendered from a template by the
+   * render engine. Image paths in the props are confined by core's
+   * confineProps, as for the MCP render tool, and the props are kept in the
+   * film as props-<template>.json beside core's render record.
+   */
+  router.post("/api/films/:slug/card", ({ params, body = {} }) => {
+    const dir = filmDir(params.slug);
+    const template = f.text(body, "template", { required: true });
+    if (!TEMPLATES[template]) throw f.invalid("template", `Unknown template "${template}". Templates: ${Object.keys(TEMPLATES).join(", ")}.`);
+    const props = f.params({ params: body.props }); // a plain object, or {} when absent
+    for (const field of TEMPLATE_FIELDS[template].fields) {
+      const v = props[field.name];
+      const empty = v == null || v === "" || (Array.isArray(v) && !v.length);
+      if (field.required && empty) throw f.invalid(`props.${field.name}`, `${field.label} is required for ${template}.`);
+    }
+    let confined;
+    try {
+      confined = confineProps(props, context().roots);
+    } catch (err) {
+      throw f.invalid("props", err.message);
+    }
+    const ratio = oneOf(body, "aspect_ratio", Object.keys(RATIOS), "16:9");
+    const durationS = f.amount(body, "duration_s");
+    if (durationS > MAX_CARD_S) throw f.invalid("duration_s", `A text card runs ${MAX_CARD_S} seconds at most.`);
+    need(check, "render");
+    const task = tasks.start(params.slug, "card", `Text card (${template})`, async ({ progress }) => {
+      const propsPath = join(dir, `props-${template}.json`);
+      await writeFile(propsPath, JSON.stringify(confined, null, 2) + "\n");
+      const result = await tools.render({ template, propsPath, ratio, durationS, out: outPath(dir, undefined, template, ".mp4"), onLine: progress });
+      await writeRecord(dir, `render-${template}.json`, result);
+      return { outputs: [output(result.out)] };
+    });
+    return { task };
+  });
 }
 
 /** Refuse before starting a task when a tool it needs is missing: code 1 with core's install message. */
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && node --test tests/finish.test.mjs`
Expected: PASS, 18 of 18.

Then run: `cd web && npm run test:server`
Expected: 162 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/server/api/finish.mjs web/tests/finish.test.mjs
git diff --cached --stat
git commit -m "Render text cards from the studio

Template props are checked for required fields and confined by core before
the render engine sees them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 9: Spend fields on jobs, and the Settings API

**Files:**
- Create: `web/server/api/settings.mjs`
- Modify: `web/server/app.mjs`
- Modify: `web/server/http.mjs`
- Modify: `web/server/state.mjs`
- Create: `web/tests/settings.test.mjs` (test)
- Modify: `web/tests/state.test.mjs` (test)

The jobs table needs each job's day and, for an uncertain job, core's `uncertainMessage` (which carries the `kie job resolve` commands when no task id came back); `jobView` adds both. `web/server/api/settings.mjs`:

- `GET /api/settings` returns the two limits with the file they live in, and for each provider whether a key is set, the variable and file it is read from, and its sign-up page. Never the key or any part of it.
- `PUT /api/settings/limits` takes `{ dailyUsd, perJobUsd | null, was }`. The values are validated; `was` must match the file or the write is refused with 409 and `current`, so a page left open never undoes a cap changed by `kie limits` or another tab. The write goes through core's `setDailyLimit` and `setPerJobLimit`, the same writers as the CLI. Like every `/api` call it needs the session key and a local Host header, which other websites cannot supply.
- `POST /api/settings/doctor` runs Task 1's `doctor()` on request only. Its one network call is kie.ai's free balance read.

`HttpError` gains an `extra` object so the 409 can carry `current`.

- [ ] **Step 1: Write the failing tests**

Modify `web/tests/state.test.mjs` with this change:

```diff
--- a/web/tests/state.test.mjs
+++ b/web/tests/state.test.mjs
@@ -47,6 +47,15 @@ describe("jobView", () => {
     assert.equal(jobView(job, (id) => id === job.id).following, true);
     assert.equal(jobView(job, () => false).following, false);
   });
+
+  test("carries the job's local day, and core's uncertain message only for an uncertain job", () => {
+    const store = openJobs(join(RUNS, ".jobs"));
+    const job = store.create({ run: "zed", capability: "video", model: "seedance-2", provider: "kie", estimateUsd: 1 });
+    assert.equal(jobView(job).day, job.day);
+    assert.equal(jobView(job).uncertainMessage, null);
+    const lost = { ...job, state: "uncertain", upstreamTaskId: null };
+    assert.match(jobView(lost).uncertainMessage, new RegExp(`kie job resolve ${job.id} --not-created`));
+  });
 });
 
 describe("spendView", () => {
```

Create `web/tests/settings.test.mjs`:

```js
import { KEY, deps, req, tmp } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { createApp } = await import("../server/app.mjs");
const { loadCatalog } = await import("../../cli/lib/models.mjs");
const { getProvider, providerKey } = await import("../../cli/lib/providers.mjs");

const LIMITS = join(tmp, "limits.json");
const catalog = loadCatalog();
// Every key this machine has, from the environment or ~/.config: none may appear in a response.
const keys = Object.keys(catalog.providers)
  .map((name) => providerKey(getProvider(catalog, name), { required: false }))
  .filter(Boolean);

let app, port;
let reads = 0;
before(async () => {
  const counting = { ...deps, credits: async () => (reads += 1, 100) };
  app = createApp({ key: KEY, deps: counting, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());

const put = (body) => req(port, "/api/settings/limits", { method: "PUT", body });
const noKeys = (text) => keys.every((k) => !text.includes(k));

describe("GET /api/settings", () => {
  test("shows the saved limits and whether each provider has a key, never the key", async () => {
    const r = await req(port, "/api/settings");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.limits, { dailyUsd: 10, perJobUsd: null, file: LIMITS });
    const kie = r.json.providers.find((p) => p.name === "kie");
    assert.deepEqual(kie, { name: "kie", label: "kie.ai", keyConfigured: true, keyEnv: "KIE_API_KEY", keyFile: "~/.config/kie/key", signup: "https://kie.ai/api-key", balanceReadable: true });
    assert.equal(r.json.providers.find((p) => p.name === "wavespeed").balanceReadable, false);
    assert.ok(noKeys(r.text));
    assert.equal(reads, 0, "reading settings never calls a provider");
  });
});

describe("PUT /api/settings/limits", () => {
  test("writes the daily cap and per-job limit through core, as kie limits does", async () => {
    const r = await put({ dailyUsd: 4.5, perJobUsd: 1.25, was: { dailyUsd: 10, perJobUsd: null } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.limits, { dailyUsd: 4.5, perJobUsd: 1.25, file: LIMITS });
    assert.deepEqual(JSON.parse(readFileSync(LIMITS, "utf8")), { dailyUsd: 4.5, allowRoots: [], perJobUsd: 1.25 });
    const spend = await req(port, "/api/spend");
    assert.equal(spend.json.capUsd, 4.5);
    assert.equal(spend.json.perJobUsd, 1.25);
  });

  test("a null per-job limit removes it; a cap of 0 is allowed", async () => {
    const r = await put({ dailyUsd: 0, perJobUsd: null, was: { dailyUsd: 4.5, perJobUsd: 1.25 } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(JSON.parse(readFileSync(LIMITS, "utf8")), { dailyUsd: 0, allowRoots: [] });
  });

  test("a value core would refuse is 400 on its field, and the file is unchanged", async () => {
    const before = readFileSync(LIMITS, "utf8");
    for (const [body, field] of [
      [{ dailyUsd: -1, perJobUsd: null }, "dailyUsd"],
      [{ dailyUsd: "5", perJobUsd: null }, "dailyUsd"],
      [{ dailyUsd: 5, perJobUsd: 0 }, "perJobUsd"],
      [{ dailyUsd: 5, perJobUsd: "off" }, "perJobUsd"],
      [{ dailyUsd: 5, perJobUsd: null }, "was"],
    ]) {
      const r = await put(field === "was" ? body : { ...body, was: { dailyUsd: 0, perJobUsd: null } });
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.json.error.field, field);
    }
    assert.equal(readFileSync(LIMITS, "utf8"), before);
  });

  test("a page holding limits that changed since it loaded is refused with 409, and the file is unchanged", async () => {
    writeFileSync(LIMITS, JSON.stringify({ dailyUsd: 2, allowRoots: [] })); // kie limits --daily 2, in another terminal
    const r = await put({ dailyUsd: 50, perJobUsd: null, was: { dailyUsd: 0, perJobUsd: null } });
    assert.equal(r.status, 409);
    assert.match(r.json.error.message, /changed since this page loaded/);
    assert.equal(r.json.error.current.dailyUsd, 2);
    assert.equal(JSON.parse(readFileSync(LIMITS, "utf8")).dailyUsd, 2);
  });

  test("needs the session key, like every write", async () => {
    const r = await req(port, "/api/settings/limits", { method: "PUT", body: { dailyUsd: 99, perJobUsd: null, was: { dailyUsd: 2, perJobUsd: null } }, key: null });
    assert.equal(r.status, 403);
    assert.equal(JSON.parse(readFileSync(LIMITS, "utf8")).dailyUsd, 2);
  });
});

describe("POST /api/settings/doctor", () => {
  test("runs core's doctor on request: one balance read, checks back, no key in them", async () => {
    const r = await req(port, "/api/settings/doctor", { method: "POST" });
    assert.equal(r.status, 200, r.text);
    assert.equal(reads, 1);
    assert.ok(r.json.checks.some((c) => c.level === "ok" && c.text === "kie.ai: 100 credits"));
    assert.ok(r.json.checks.every((c) => !("keyOf" in c)));
    assert.equal(typeof r.json.failures, "number");
    assert.ok(r.json.ranAt);
    assert.ok(noKeys(r.text));
    assert.ok(existsSync(LIMITS));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && node --test tests/state.test.mjs tests/settings.test.mjs`
Expected: FAIL. `state.test.mjs`: 1 of 7 (the job view has no `day` or `uncertainMessage`). `settings.test.mjs`: 6 of 7, with `No PUT /api/settings/limits.`, `No POST /api/settings/doctor.`, `actual: 404`, and `ENOENT … limits.json` where the test reads the file a write should have made.

- [ ] **Step 3: Implement**

Create `web/server/api/settings.mjs`:

```js
// Settings: the two limits, provider key presence and kie doctor. Limits are
// written through core's setDailyLimit and setPerJobLimit, the same writers
// as `kie limits`; no MCP tool or chat path reaches these routes' code.
//
// A write needs the session key (like every /api call), which another website
// cannot read or send. It also carries the limits the page last showed
// (`was`): when they no longer match the file (changed by `kie limits` in a
// terminal, or in another tab), the write is refused with 409 so a stale page
// never quietly undoes a cap the user just lowered.
import { doctor } from "../../../cli/core/views.mjs";
import { readLimits, setDailyLimit, setPerJobLimit, limitsPath } from "../../../cli/core/spend.mjs";
import { getProvider, providerCredits, providerKey } from "../../../cli/lib/providers.mjs";
import { redact } from "../../../cli/lib/redact.mjs";
import { HttpError } from "../http.mjs";
import * as f from "./fields.mjs";

const limitsView = () => {
  const l = readLimits();
  return { dailyUsd: l.dailyUsd, perJobUsd: l.perJobUsd ?? null, file: limitsPath() };
};

const dollars = (v) => typeof v === "number" && Number.isFinite(v);

function cap(body) {
  const v = body?.dailyUsd;
  if (!dollars(v) || v < 0) throw f.invalid("dailyUsd", "The daily cap is a dollar amount of 0 or more.");
  return v;
}

function perJob(body, field = "perJobUsd") {
  const v = body?.[field];
  if (v == null) return null;
  if (!dollars(v) || v <= 0) throw f.invalid(field, "The per-job limit is a dollar amount above 0, or none.");
  return v;
}

export function registerSettings(router, { catalog, deps = {} }) {
  router.get("/api/settings", () => ({
    limits: limitsView(),
    providers: Object.keys(catalog.providers).map((name) => {
      const prov = getProvider(catalog, name);
      return {
        name,
        label: prov.label,
        keyConfigured: Boolean(providerKey(prov, { required: false })),
        keyEnv: prov.keyEnv,
        keyFile: `~/${prov.keyFile}`,
        signup: prov.signup,
        balanceReadable: Boolean(prov.credits),
      };
    }),
  }));

  router.put("/api/settings/limits", ({ body = {} }) => {
    const dailyUsd = cap(body);
    const perJobUsd = perJob(body);
    const was = body.was;
    if (!was || typeof was !== "object" || !dollars(was.dailyUsd) || !(was.perJobUsd == null || dollars(was.perJobUsd))) {
      throw f.invalid("was", "Send the limits the page showed, as was: { dailyUsd, perJobUsd }.");
    }
    const now = limitsView();
    if (now.dailyUsd !== was.dailyUsd || now.perJobUsd !== (was.perJobUsd ?? null)) {
      throw new HttpError(409, "The limits changed since this page loaded. Check the values now saved, then save again.", { current: now });
    }
    setDailyLimit(dailyUsd);
    setPerJobLimit(perJobUsd ?? "off");
    return { limits: limitsView() };
  });

  /**
   * kie doctor, on request only (the page never runs it on load). Its one
   * network call is kie.ai's balance read, a free GET; WaveSpeed has no balance
   * endpoint. Key hints stay in the CLI: no check here names a key.
   */
  router.post("/api/settings/doctor", async () => {
    const { checks, failures } = await doctor(catalog, { credits: deps.credits ?? providerCredits });
    return { checks: checks.map(({ level, text }) => ({ level, text: redact(text) })), failures, ranAt: new Date().toISOString() };
  });
}
```

Modify `web/server/app.mjs` with this change:

```diff
--- a/web/server/app.mjs
+++ b/web/server/app.mjs
@@ -14,6 +14,7 @@ import { registerLibrary } from "./api/library.mjs";
 import { registerPresets } from "./api/presets.mjs";
 import { registerFilms } from "./api/films.mjs";
 import { registerFinish } from "./api/finish.mjs";
+import { registerSettings } from "./api/settings.mjs";
 import { loadCatalog } from "../../cli/lib/models.mjs";
 
 export const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
@@ -46,6 +47,7 @@ export function createApp({ key, deps = {}, catalog = loadCatalog(), distDir = j
   registerPresets(router, { catalog });
   registerFilms(router, { following });
   registerFinish(router, { tasks, ...finish });
+  registerSettings(router, { catalog, deps });
 
   const server = createServer(createHandler({ key, router, distDir, media: serveMedia }));
   // A malformed request never reaches the handler; drop the socket quietly.
```

Modify `web/server/http.mjs` with this change:

```diff
--- a/web/server/http.mjs
+++ b/web/server/http.mjs
@@ -32,9 +32,11 @@ export const HARDENING = {
 };
 
 export class HttpError extends Error {
-  constructor(status, message) {
+  /** `extra` rides along in the error body, beside the message. */
+  constructor(status, message, extra = {}) {
     super(message);
     this.status = status;
+    this.extra = extra;
   }
 }
 
@@ -93,7 +95,7 @@ export function sendError(res, err) {
     const { code, message, name: _n, stack: _s, data: _d, ...extra } = err;
     return sendJson(res, statusFor(code), { error: { ...extra, code, message: redact(message) } });
   }
-  if (err instanceof HttpError) return fail(res, err.status, err.message);
+  if (err instanceof HttpError) return fail(res, err.status, err.message, err.extra);
   process.stderr.write(`studio: ${redact(err?.stack ?? String(err))}\n`);
   return fail(res, 500, `Unexpected error: ${redact(err?.message ?? String(err))}`);
 }
```

Modify `web/server/state.mjs` with this change:

```diff
--- a/web/server/state.mjs
+++ b/web/server/state.mjs
@@ -1,6 +1,6 @@
 // Per-request context and the shapes the page reads. Context is rebuilt per
 // call, like the MCP server's, so a limits change or a new run is seen at once.
-import { openJobs, countedUsd, localDay, systemTimeZone } from "../../cli/core/jobs.mjs";
+import { openJobs, countedUsd, localDay, systemTimeZone, uncertainMessage } from "../../cli/core/jobs.mjs";
 import { readLimits, dailyPosition } from "../../cli/core/spend.mjs";
 import { openLibrary } from "../../cli/core/assets.mjs";
 import { allowedRoots } from "../../cli/core/inputs.mjs";
@@ -36,6 +36,10 @@ export function jobView(j, following = () => false) {
     media: (j.artifacts ?? []).map(mediaUrl).filter(Boolean),
     updatedAt: j.history?.at(-1)?.at ?? j.createdAt,
     following: Boolean(following(j.id)),
+    // The local day it counts against (the Spend table filters by it).
+    day: j.day ?? null,
+    // Core's instruction for a job that may exist upstream; resolving stays in the CLI.
+    uncertainMessage: j.state === "uncertain" ? uncertainMessage(j) : null,
   };
 }
 
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && node --test tests/state.test.mjs tests/settings.test.mjs`
Expected: PASS, 14 of 14.

Then run: `cd web && npm run test:server`
Expected: 170 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/server/api/settings.mjs web/server/app.mjs web/server/http.mjs web/server/state.mjs web/tests/settings.test.mjs web/tests/state.test.mjs
git diff --cached --stat
git commit -m "Add the Settings API and spend fields on jobs

Limits go through core's setters with a stale-page guard; providers report
key presence only; kie doctor runs on request.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 10: Page types, fixtures and the task hook

**Files:**
- Modify: `web/src/api/types.ts`
- Modify: `web/src/app/useStudio.ts`
- Create: `web/src/films/useTasks.test.ts` (test)
- Create: `web/src/films/useTasks.ts`
- Modify: `web/src/test-fixtures.ts`

The page side starts here. `types.ts` gains the shapes from Tasks 3-9 and the `task` event; `test-fixtures.ts` gains a film, a task, the finish info, a spend view and settings. `emitForTests` lets a test push an SSE event into the listeners. `useTasks(run, onSettled)` loads a film's tasks, keeps them live from `task` events, reloads when the stream reconnects, and calls `onSettled` when one ends so the film page can read its new outputs.

- [ ] **Step 1: Write the failing test**

Create `web/src/films/useTasks.test.ts`:

```ts
import { describe, test, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { mergeTask, useTasks } from "./useTasks";
import { emitForTests } from "../app/useStudio";
import { routes, task } from "../test-fixtures";

describe("mergeTask", () => {
  test("a new task goes first; an update replaces its old copy", () => {
    const a = task({ id: "t-aaaaaaaa", startedAt: "2026-10-31T10:00:00.000Z", state: "done" });
    const b = task({ id: "t-bbbbbbbb", startedAt: "2026-10-31T10:05:00.000Z" });
    let list = mergeTask([a], b);
    expect(list.map((t) => t.id)).toEqual(["t-bbbbbbbb", "t-aaaaaaaa"]);
    list = mergeTask(list, { ...b, state: "failed", error: "ffmpeg exited 1" });
    expect(list.map((t) => [t.id, t.state])).toEqual([["t-bbbbbbbb", "failed"], ["t-aaaaaaaa", "done"]]);
  });
});

describe("useTasks", () => {
  test("loads the film's tasks, takes this film's task events, and says when one settles", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/tasks": () => [task({ id: "t-old00000", state: "done" })] })));
    const settled = vi.fn();
    const { result } = renderHook(() => useTasks("zed", settled));
    await waitFor(() => expect(result.current.map((t) => t.id)).toEqual(["t-old00000"]));
    act(() => emitForTests({ event: "task", data: task({ id: "t-new00000", outS: 1.5 }) }));
    act(() => emitForTests({ event: "task", data: task({ id: "t-other000", run: "other" }) }));
    expect(result.current.map((t) => t.id)).toEqual(["t-new00000", "t-old00000"]);
    expect(settled).not.toHaveBeenCalled();
    act(() => emitForTests({ event: "task", data: task({ id: "t-new00000", state: "done", outputs: [{ name: "film.mp4", url: "/media/runs/zed/film.mp4" }] }) }));
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ id: "t-new00000", state: "done" }));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run src/films`
Expected: FAIL: `Failed to resolve import "./useTasks" from "src/films/useTasks.test.ts". Does the file exist?`

- [ ] **Step 3: Implement**

Modify `web/src/api/types.ts` with this change:

```diff
--- a/web/src/api/types.ts
+++ b/web/src/api/types.ts
@@ -27,6 +27,10 @@ export interface JobView {
   updatedAt: string;
   /** The studio server is waiting on this job right now. */
   following: boolean;
+  /** The local day (YYYY-MM-DD) the job counts against. */
+  day: string | null;
+  /** Core's instruction for an uncertain job, with the `kie job resolve` commands when no task id came back. */
+  uncertainMessage: string | null;
 }
 
 export interface SpendView {
@@ -163,8 +167,126 @@ export interface FramesResult {
   durationS: number;
 }
 
+export interface FilmSummary extends RunSummary {
+  cover: { kind: "video" | "image"; url: string } | null;
+}
+
+export type FileKind = "video" | "image" | "audio" | "srt";
+/** What made a file, from its default name: a generated take, or a finishing tool's output. */
+export type FileOrigin = "take" | "film" | "captioned" | "variant" | "card";
+
+export interface FilmFile {
+  name: string;
+  kind: FileKind;
+  origin: FileOrigin | null;
+  url: string | null;
+  bytes: number;
+  modified: string;
+  /** The job that made this take, when there is one. */
+  job: JobView | null;
+}
+
+export interface FilmDetail {
+  run: string;
+  prompt: string | null;
+  /** Oldest first. */
+  files: FilmFile[];
+  /** Shot names in the order of the film's last assembly. */
+  order: string[];
+}
+
+export interface TaskView {
+  id: string;
+  run: string;
+  tool: "assemble" | "caption" | "variants" | "card";
+  label: string;
+  state: "running" | "done" | "failed";
+  startedAt: string;
+  endedAt: string | null;
+  /** Seconds of output ffmpeg has written so far. */
+  outS: number | null;
+  outputs: { name: string; url: string | null }[];
+  warnings: string[];
+  error: string | null;
+}
+
+export interface TemplateField {
+  name: string;
+  type: "text" | "lines" | "choice" | "image" | "json";
+  label: string;
+  required?: boolean;
+  hint?: string;
+  choices?: string[];
+  example?: unknown;
+}
+
+export interface TemplateInfo {
+  id: string;
+  description: string;
+  durationS: number | null;
+  fields: TemplateField[];
+}
+
+export interface ToolState {
+  ok: boolean;
+  /** Core's message saying how to install it, when missing. */
+  install: string | null;
+}
+
+export interface FinishInfo {
+  tools: { ffmpeg: ToolState; render: ToolState };
+  templates: TemplateInfo[];
+  ratios: string[];
+  transitions: string[];
+  captionStyles: string[];
+  variantModes: string[];
+}
+
+export interface SavedAudio {
+  name: string;
+  kind: "audio";
+  url: string | null;
+  bytes: number;
+}
+
+export interface SavedSrt {
+  name: string;
+  url: string | null;
+  cues: number;
+  problems: string[];
+  lastEndS: number;
+}
+
+export interface LimitsView {
+  dailyUsd: number;
+  perJobUsd: number | null;
+  file: string;
+}
+
+export interface ProviderInfo {
+  name: string;
+  label: string;
+  keyConfigured: boolean;
+  keyEnv: string;
+  keyFile: string;
+  signup: string;
+  balanceReadable: boolean;
+}
+
+export interface SettingsView {
+  limits: LimitsView;
+  providers: ProviderInfo[];
+}
+
+export interface DoctorResult {
+  checks: { level: "ok" | "warn" | "fail" | "info"; text: string }[];
+  failures: number;
+  ranAt: string;
+}
+
 export type StudioEvent =
   | { event: "hello"; data: { at: string } }
   | { event: "job"; data: JobView }
   | { event: "spend"; data: SpendView }
-  | { event: "library"; data: AssetSummary[] };
+  | { event: "library"; data: AssetSummary[] }
+  | { event: "task"; data: TaskView };
```

Modify `web/src/app/useStudio.ts` with this change:

```diff
--- a/web/src/app/useStudio.ts
+++ b/web/src/app/useStudio.ts
@@ -14,6 +14,11 @@ export function onStudioEvent(fn: Listener): () => void {
   };
 }
 
+/** Page tests: deliver `e` to the screens as if it came over the stream. */
+export function emitForTests(e: StudioEvent) {
+  listeners.forEach((fn) => fn(e));
+}
+
 export function useRoute(): string {
   return useSyncExternalStore(
     (cb) => {
```

Create `web/src/films/useTasks.ts`:

```ts
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { TaskView } from "../api/types";
import { onStudioEvent } from "../app/useStudio";

const byNewest = (a: TaskView, b: TaskView) => b.startedAt.localeCompare(a.startedAt);

/** `t` in place of its old copy, newest first. */
export function mergeTask(list: TaskView[], t: TaskView): TaskView[] {
  return [t, ...list.filter((x) => x.id !== t.id)].sort(byNewest);
}

/**
 * The film's finishing tasks, kept live by SSE task events and reloaded when
 * the stream reconnects. `onSettled` hears each task that ends while watched,
 * so the film page can list its new outputs.
 */
export function useTasks(run: string, onSettled: (t: TaskView) => void = () => {}): TaskView[] {
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const settled = useRef(onSettled);
  settled.current = onSettled;

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<TaskView[]>(`/api/tasks?run=${encodeURIComponent(run)}`)
        .then((list) => alive && setTasks(list))
        .catch(() => {});
    setTasks([]);
    load();
    const stop = onStudioEvent((e) => {
      if (e.event === "hello") load();
      if (e.event !== "task" || e.data.run !== run) return;
      setTasks((prev) => mergeTask(prev, e.data));
      if (e.data.state !== "running") settled.current(e.data);
    });
    return () => {
      alive = false;
      stop();
    };
  }, [run]);

  return tasks;
}
```

Modify `web/src/test-fixtures.ts` with this change:

```diff
--- a/web/src/test-fixtures.ts
+++ b/web/src/test-fixtures.ts
@@ -1,5 +1,5 @@
 // Shared test data for page tests. Not a test file itself, so importing it runs no tests.
-import type { Estimate, JobView, ModelInfo } from "./api/types";
+import type { Estimate, FilmDetail, FilmFile, FinishInfo, JobView, ModelInfo, SettingsView, SpendView, TaskView } from "./api/types";
 
 export const job = (over: Partial<JobView> = {}): JobView => ({
   id: "j-20261031-abc123",
@@ -24,6 +24,8 @@ export const job = (over: Partial<JobView> = {}): JobView => ({
   createdAt: "2026-10-31T10:00:00.000Z",
   updatedAt: "2026-10-31T10:01:00.000Z",
   following: false,
+  day: "2026-10-31",
+  uncertainMessage: null,
   ...over,
 });
 
@@ -60,6 +62,91 @@ export const model = (over: Partial<ModelInfo> = {}): ModelInfo => ({
   ...over,
 });
 
+export const filmFile = (over: Partial<FilmFile> = {}): FilmFile => ({
+  name: "out.mp4",
+  kind: "video",
+  origin: "take",
+  url: "/media/runs/zed/out.mp4",
+  bytes: 1_200_000,
+  modified: "2026-10-31T10:01:00.000Z",
+  job: null,
+  ...over,
+});
+
+export const film = (over: Partial<FilmDetail> = {}): FilmDetail => ({
+  run: "zed",
+  prompt: "A fox runs.",
+  files: [
+    filmFile({ job: job() }),
+    filmFile({ name: "out-2.mp4", url: "/media/runs/zed/out-2.mp4", modified: "2026-10-31T10:05:00.000Z" }),
+    filmFile({ name: "bed.mp3", kind: "audio", origin: null, url: "/media/runs/zed/bed.mp3" }),
+    filmFile({ name: "film.mp4", origin: "film", url: "/media/runs/zed/film.mp4", modified: "2026-10-31T10:09:00.000Z" }),
+  ],
+  order: [],
+  ...over,
+});
+
+export const task = (over: Partial<TaskView> = {}): TaskView => ({
+  id: "t-0a1b2c3d",
+  run: "zed",
+  tool: "assemble",
+  label: "Assemble",
+  state: "running",
+  startedAt: "2026-10-31T10:10:00.000Z",
+  endedAt: null,
+  outS: null,
+  outputs: [],
+  warnings: [],
+  error: null,
+  ...over,
+});
+
+export const finishInfo = (over: Partial<FinishInfo> = {}): FinishInfo => ({
+  tools: { ffmpeg: { ok: true, install: null }, render: { ok: true, install: null } },
+  templates: [
+    {
+      id: "kinetic-type",
+      description: "Headline builds word by word. Use when the copy must be exactly right.",
+      durationS: 6,
+      fields: [
+        { name: "lines", type: "lines", label: "Lines", required: true, hint: "One line of the headline per row." },
+        { name: "kicker", type: "text", label: "Kicker" },
+        { name: "granularity", type: "choice", label: "Builds by", choices: ["word", "line"] },
+      ],
+    },
+    {
+      id: "stat-reveal",
+      description: "Animated counters and bars from real numbers you supply.",
+      durationS: 7,
+      fields: [{ name: "stats", type: "json", label: "Stats", required: true, example: [{ label: "Replies", value: 128 }] }],
+    },
+  ],
+  ratios: ["16:9", "9:16", "1:1", "4:5", "4:3", "21:9"],
+  transitions: ["fade", "dissolve"],
+  captionStyles: ["social", "subtle"],
+  variantModes: ["blur", "crop", "pad"],
+  ...over,
+});
+
+export const spend = (over: Partial<SpendView> = {}): SpendView => ({
+  capUsd: 10,
+  spentUsd: 2.1,
+  availableUsd: 7.9,
+  perJobUsd: null,
+  unsettled: 0,
+  days: Array.from({ length: 14 }, (_, i) => ({ day: `2026-10-${String(18 + i).padStart(2, "0")}`, usd: i === 13 ? 2.1 : i % 3 === 0 ? 0 : 0.5 + i / 10 })),
+  ...over,
+});
+
+export const settings = (over: Partial<SettingsView> = {}): SettingsView => ({
+  limits: { dailyUsd: 10, perJobUsd: null, file: "/Users/x/.config/kie/limits.json" },
+  providers: [
+    { name: "kie", label: "kie.ai", keyConfigured: true, keyEnv: "KIE_API_KEY", keyFile: "~/.config/kie/key", signup: "https://kie.ai/api-key", balanceReadable: true },
+    { name: "wavespeed", label: "WaveSpeed", keyConfigured: false, keyEnv: "WAVESPEED_API_KEY", keyFile: "~/.config/wavespeed/key", signup: "https://wavespeed.ai", balanceReadable: false },
+  ],
+  ...over,
+});
+
 /** A fetch stub that answers by path. Unlisted paths never resolve, like a slow server. */
 export function routes(table: Record<string, (init?: RequestInit) => unknown>) {
   return (input: RequestInfo | URL, init?: RequestInit) => {
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run && npx tsc -p .`
Expected: 15 files and 82 tests pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/types.ts web/src/app/useStudio.ts web/src/films/useTasks.test.ts web/src/films/useTasks.ts web/src/test-fixtures.ts
git diff --cached --stat
git commit -m "Add page types, fixtures and a live task hook for Films

Co-located with the films screens that use them next.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 11: Films list and film page

**Files:**
- Modify: `web/src/app/App.test.tsx` (test)
- Modify: `web/src/app/App.tsx`
- Create: `web/src/films/FilmPage.test.tsx` (test)
- Create: `web/src/films/FilmPage.tsx`
- Create: `web/src/films/FilmsScreen.test.tsx` (test)
- Create: `web/src/films/FilmsScreen.tsx`
- Create: `web/src/films/films.css`

`#/films` lists the run folders as cards (cover, name in mono, take count, date); `#/films/<name>` opens the film page. The page shows the video takes as shots in the last assembly's order, then newer takes oldest first; each moves up or down and has a "Use" checkbox, and a take's cost from its job shows in mono amber. Every finished output (film, captioned, variant, text card) gets a `<video controls>` player and a Download link (`<a download>`). A finished take landing in the film (a `job` event) reloads the page's files while keeping the user's order. The App passes the rest of the hash to the Films screen.

- [ ] **Step 1: Write the failing tests**

Create `web/src/films/FilmsScreen.test.tsx`:

```tsx
import { describe, test, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { FilmsScreen } from "./FilmsScreen";
import { routes } from "../test-fixtures";

const films = [
  { run: "zed", modified: "2026-10-31T10:09:00.000Z", files: 5, takes: 2, cover: { kind: "video", url: "/media/runs/zed/film.mp4" } },
  { run: "old-stuff", modified: "2026-10-20T08:00:00.000Z", files: 0, takes: 0, cover: null },
];

describe("FilmsScreen", () => {
  test("lists each run folder as a link to its film page, with its cover and take count", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => films })));
    render(<FilmsScreen />);
    const zed = await screen.findByRole("link", { name: /zed/ });
    expect(zed).toHaveAttribute("href", "#/films/zed");
    expect(within(zed).getByText("2 takes")).toBeInTheDocument();
    expect(zed.querySelector("video")).toHaveAttribute("src", "/media/runs/zed/film.mp4");
    const old = screen.getByRole("link", { name: /old-stuff/ });
    expect(within(old).getByText("0 takes")).toBeInTheDocument();
    expect(old.querySelector("video, img")).toBeNull();
  });

  test("says where films come from when there are none", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films": () => [] })));
    render(<FilmsScreen />);
    expect(await screen.findByText(/No films yet/)).toBeInTheDocument();
  });

  test("opens the film page when the route names a film", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/zed": () => ({ run: "zed", prompt: null, files: [], order: [] }) })));
    render(<FilmsScreen slug="zed" />);
    expect(await screen.findByRole("heading", { name: "zed" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All films" })).toHaveAttribute("href", "#/films");
  });
});
```

Create `web/src/films/FilmPage.test.tsx`:

```tsx
import { describe, test, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { FilmPage, shotOrder } from "./FilmPage";
import { emitForTests } from "../app/useStudio";
import { film, filmFile, job, routes } from "../test-fixtures";

describe("shotOrder", () => {
  test("keeps the last assembly's order, then adds new takes oldest first", () => {
    const files = [
      filmFile({ name: "a.mp4", modified: "2026-10-31T10:00:00.000Z" }),
      filmFile({ name: "b.mp4", modified: "2026-10-31T10:01:00.000Z" }),
      filmFile({ name: "c.mp4", modified: "2026-10-31T10:02:00.000Z" }),
      filmFile({ name: "film.mp4", origin: "film" }),
      filmFile({ name: "still.png", kind: "image" }),
    ];
    expect(shotOrder(files, ["c.mp4", "gone.mp4", "a.mp4"])).toEqual(["c.mp4", "a.mp4", "b.mp4"]);
  });
});

describe("FilmPage", () => {
  test("lists the takes as shots that move up and down and can be left out", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/zed": () => film() })));
    render(<FilmPage slug="zed" />);
    const shots = await screen.findByRole("list", { name: "Shots" });
    const names = () =>
      within(shots)
        .getAllByRole("listitem")
        .map((li) => li.querySelector(".mono")?.textContent);
    expect(names()).toEqual(["out.mp4", "out-2.mp4"]);
    expect(screen.getByRole("button", { name: "Move out.mp4 up" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move out.mp4 down" }));
    expect(names()).toEqual(["out-2.mp4", "out.mp4"]);
    expect(screen.getByRole("button", { name: "Move out.mp4 down" })).toBeDisabled();
    const use = screen.getByRole("checkbox", { name: "Use out-2.mp4" });
    expect(use).toBeChecked();
    fireEvent.click(use);
    expect(use).not.toBeChecked();
    expect(screen.getByText("1 of 2 shots chosen")).toBeInTheDocument();
  });

  test("shows a take's cost from its job, in mono", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/zed": () => film({ files: [filmFile({ job: job({ actualUsd: 0.5 }) })] }) })));
    render(<FilmPage slug="zed" />);
    const cost = await screen.findByText("$0.50");
    expect(cost).toHaveClass("mono");
  });

  test("gives every output a player and a download link", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/zed": () => film() })));
    render(<FilmPage slug="zed" />);
    const outputs = await screen.findByRole("list", { name: "Outputs" });
    const item = within(outputs).getByRole("listitem");
    expect(item.querySelector("video")).toHaveAttribute("src", "/media/runs/zed/film.mp4");
    expect(item.querySelector("video")).toHaveAttribute("controls");
    const link = within(item).getByRole("link", { name: "Download film.mp4" });
    expect(link).toHaveAttribute("href", "/media/runs/zed/film.mp4");
    expect(link).toHaveAttribute("download", "film.mp4");
  });

  test("says so when nothing is finished yet", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/zed": () => film({ files: [filmFile()] }) })));
    render(<FilmPage slug="zed" />);
    expect(await screen.findByText(/Nothing finished yet/)).toBeInTheDocument();
  });

  test("reads the film again when a take lands in it", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/zed": () => (++calls === 1 ? film({ files: [filmFile()] }) : film()) })));
    render(<FilmPage slug="zed" />);
    await screen.findByText("out.mp4");
    act(() => emitForTests({ event: "job", data: job({ run: "other" }) }));
    act(() => emitForTests({ event: "job", data: job({ state: "succeeded" }) }));
    expect(await screen.findByText("out-2.mp4")).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  test("shows core's message for a film that does not exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(routes({ "/api/films/nope": () => new Response(JSON.stringify({ error: { code: 3, message: "No run named nope." } }), { status: 400 }) })),
    );
    render(<FilmPage slug="nope" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No run named nope.");
  });
});
```

Modify `web/src/app/App.test.tsx` with this change:

```diff
--- a/web/src/app/App.test.tsx
+++ b/web/src/app/App.test.tsx
@@ -28,6 +28,14 @@ describe("App", () => {
     expect(screen.getByText("Daily totals and every job will show here.")).toBeInTheDocument();
   });
 
+  test("#/films/<name> opens that film's page", async () => {
+    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));
+    window.location.hash = "#/films/zed";
+    render(<App />);
+    expect(screen.getByRole("heading", { name: "zed" })).toBeInTheDocument();
+    expect(screen.getByRole("link", { name: "Films" })).toHaveAttribute("aria-current", "page");
+  });
+
   test("the Studio is the default screen, with its prompt bar", () => {
     vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));
     render(<App />);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run src/films src/app/App.test.tsx`
Expected: FAIL. `FilmsScreen.test.tsx` and `FilmPage.test.tsx` do not load (`Failed to resolve import "./FilmsScreen"` / `"./FilmPage"`). `App.test.tsx`: 1 of 5 fails, `Unable to find an accessible element with the role "heading" and name "zed"`.

- [ ] **Step 3: Implement**

Modify `web/src/app/App.tsx` with this change:

```diff
--- a/web/src/app/App.tsx
+++ b/web/src/app/App.tsx
@@ -6,24 +6,25 @@ import { useRoute, useStudio } from "./useStudio";
 import { StudioScreen } from "../studio/StudioScreen";
 import { LibraryScreen } from "../library/LibraryScreen";
 import { PresetsScreen } from "../presets/PresetsScreen";
+import { FilmsScreen } from "../films/FilmsScreen";
 import "./App.css";
 
 const LATER = {
-  films: ["Films", "Your run folders, ready to finish, will show here."],
   spend: ["Spend", "Daily totals and every job will show here."],
   settings: ["Settings", "Chat connection, limits and provider keys will show here."],
 } as const;
 
-function Screen({ tab }: { tab: TabId }) {
+function Screen({ tab, rest }: { tab: TabId; rest: string[] }) {
   if (tab === "studio") return <StudioScreen />;
   if (tab === "library") return <LibraryScreen />;
   if (tab === "presets") return <PresetsScreen />;
+  if (tab === "films") return <FilmsScreen slug={rest[0]} />;
   const [title, next] = LATER[tab];
   return <Placeholder title={title} next={next} />;
 }
 
 export function App() {
-  const { tab } = parseRoute(useRoute());
+  const { tab, rest } = parseRoute(useRoute());
   const { spend, online } = useStudio();
   return (
     <div className="app">
@@ -38,7 +39,7 @@ export function App() {
         </div>
       )}
       <main className="app__main" data-tab={tab}>
-        <Screen tab={tab} />
+        <Screen tab={tab} rest={rest} />
       </main>
     </div>
   );
```

Create `web/src/films/FilmPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { FilmDetail, FilmFile } from "../api/types";
import { onStudioEvent } from "../app/useStudio";
import { takeCost } from "../studio/format";

const OUTPUT_LABEL = { film: "Film", captioned: "Captioned", variant: "Variant", card: "Text card" } as const;

const isShot = (f: FilmFile) => f.kind === "video" && f.origin === "take";
const isOutput = (f: FilmFile) => f.origin != null && f.origin !== "take";

/** The shot names in the last assembly's order, then any newer takes oldest first. */
export function shotOrder(files: FilmFile[], order: string[]): string[] {
  const takes = files
    .filter(isShot)
    .sort((a, b) => a.modified.localeCompare(b.modified))
    .map((f) => f.name);
  const kept = order.filter((n) => takes.includes(n));
  return [...kept, ...takes.filter((n) => !kept.includes(n))];
}

export interface Shot {
  name: string;
  on: boolean;
}

/** Keep the user's order and choices across reloads; new takes join at the end, switched on. */
function mergeShots(prev: Shot[], names: string[]): Shot[] {
  const kept = prev.filter((s) => names.includes(s.name));
  return [...kept, ...names.filter((n) => !kept.some((s) => s.name === n)).map((name) => ({ name, on: true }))];
}

function move(list: Shot[], i: number, by: -1 | 1): Shot[] {
  const next = [...list];
  [next[i], next[i + by]] = [next[i + by], next[i]];
  return next;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function FilmPage({ slug }: { slug: string }) {
  const [detail, setDetail] = useState<FilmDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);

  const load = useCallback(
    () =>
      api<FilmDetail>(`/api/films/${encodeURIComponent(slug)}`)
        .then((d) => {
          setDetail(d);
          setError(null);
          setShots((prev) => mergeShots(prev, shotOrder(d.files, d.order)));
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : String(e))),
    [slug],
  );

  useEffect(() => {
    setDetail(null);
    setShots([]);
    load();
  }, [load]);
  // A finished take lands in the run folder, so read the film again.
  useEffect(() => onStudioEvent((e) => e.event === "job" && e.data.run === slug && e.data.state === "succeeded" && load()), [slug, load]);

  const byName = new Map((detail?.files ?? []).map((f) => [f.name, f]));
  const outputs = (detail?.files ?? []).filter(isOutput).reverse();
  const chosen = shots.filter((s) => s.on).length;

  return (
    <div className="film">
      <header className="film__head">
        <a className="film__back" href="#/films">
          All films
        </a>
        <h1 className="mono">{slug}</h1>
        {detail?.prompt && <p className="film__prompt">{detail.prompt}</p>}
      </header>

      {error && (
        <p className="film__error" role="alert">
          {error}
        </p>
      )}

      {detail && (
        <div className="film__body">
          <div className="film__main">
            <section className="film__section" aria-labelledby="film-shots">
              <div className="film__section-head">
                <h2 id="film-shots">Shots</h2>
                <span className="film__count">
                  {chosen} of {shots.length} shots chosen
                </span>
              </div>
              {shots.length ? (
                <ol className="shots" aria-label="Shots">
                  {shots.map((s, i) => {
                    const f = byName.get(s.name);
                    return (
                      <li key={s.name} className="shot" data-on={s.on}>
                        {f?.url ? <video className="shot__thumb" src={f.url} preload="metadata" muted /> : <span className="shot__thumb" />}
                        <label className="shot__use">
                          <input
                            type="checkbox"
                            checked={s.on}
                            aria-label={`Use ${s.name}`}
                            onChange={() => setShots((list) => list.map((x) => (x.name === s.name ? { ...x, on: !x.on } : x)))}
                          />
                          <span className="mono">{s.name}</span>
                        </label>
                        <span className="mono shot__cost">{f?.job ? takeCost(f.job) : ""}</span>
                        <span className="shot__move">
                          <button
                            type="button"
                            className="button button--quiet"
                            aria-label={`Move ${s.name} up`}
                            disabled={i === 0}
                            onClick={() => setShots((l) => move(l, i, -1))}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            className="button button--quiet"
                            aria-label={`Move ${s.name} down`}
                            disabled={i === shots.length - 1}
                            onClick={() => setShots((l) => move(l, i, 1))}
                          >
                            Down
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="film__none">No video takes in this film yet. Generate some in the Studio.</p>
              )}
            </section>

            <section className="film__section" aria-labelledby="film-outputs">
              <h2 id="film-outputs">Outputs</h2>
              {outputs.length ? (
                <ul className="outputs" aria-label="Outputs">
                  {outputs.map((f) => (
                    <li key={f.name} className="output">
                      {f.url && <video className="output__player" src={f.url} controls preload="metadata" />}
                      <div className="output__info">
                        <span className="mono">{f.name}</span>
                        <span className="output__meta">
                          {OUTPUT_LABEL[f.origin as keyof typeof OUTPUT_LABEL]} · {when(f.modified)}
                        </span>
                        {f.url && (
                          <a className="button" href={f.url} download={f.name} aria-label={`Download ${f.name}`}>
                            Download
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="film__none">Nothing finished yet. Assemble the shots, add captions or make a text card.</p>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
```

Create `web/src/films/FilmsScreen.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { FilmSummary } from "../api/types";
import { FilmPage } from "./FilmPage";
import "./films.css";

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

function FilmList() {
  const [films, setFilms] = useState<FilmSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<FilmSummary[]>("/api/films")
      .then(setFilms)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  return (
    <div className="films">
      <header className="films__head">
        <h1>Films</h1>
        <p>Each run folder is a film. Open one to put its takes in order and finish it.</p>
      </header>
      {error && (
        <p className="film__error" role="alert">
          {error}
        </p>
      )}
      {films && !films.length && <p className="film__none">No films yet. Generate a take in the Studio and its run folder shows here.</p>}
      {films && films.length > 0 && (
        <ul className="films__grid">
          {films.map((f) => (
            <li key={f.run}>
              <a className="film-card" href={`#/films/${encodeURIComponent(f.run)}`}>
                {f.cover?.kind === "video" && <video className="film-card__cover" src={f.cover.url} preload="metadata" muted />}
                {f.cover?.kind === "image" && <img className="film-card__cover" src={f.cover.url} alt="" />}
                {!f.cover && <span className="film-card__cover" />}
                <span className="film-card__name mono">{f.run}</span>
                <span className="film-card__meta">
                  <span className="mono">{f.takes === 1 ? "1 take" : `${f.takes} takes`}</span> · {when(f.modified)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The hash part as typed; a stray % must not break the page. */
function decoded(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** `#/films` lists the films; `#/films/<name>` opens one. */
export function FilmsScreen({ slug }: { slug?: string }) {
  return slug ? <FilmPage key={slug} slug={decoded(slug)} /> : <FilmList />;
}
```

Create `web/src/films/films.css`:

```css
/* Films: run folders as cards, then a film page with shots and outputs. Tokens only.
   Amber is for costs only here. */

.films, .film { display: flex; flex-direction: column; gap: var(--space-4); }
.films__head h1, .film__head h1 { margin: 0 0 var(--space-1); font-size: var(--text-xl); font-weight: 600; }
.films__head p, .film__prompt { margin: 0; color: var(--text-2); max-width: 70ch; font-size: var(--text-sm); }
.film__error { margin: 0; color: var(--bad-ink); }
.film__none { margin: 0; color: var(--text-2); font-size: var(--text-sm); }

.films__grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--space-4); }
.film-card {
  display: flex; flex-direction: column; gap: var(--space-1); padding-bottom: var(--space-3);
  border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-1);
  color: var(--text); text-decoration: none; overflow: hidden;
  transition: border-color var(--dur-fast) var(--ease-out);
}
.film-card:hover { border-color: var(--text-3); }
.film-card__cover { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: var(--surface-2); margin-bottom: var(--space-1); }
.film-card__name { padding: 0 var(--space-3); font-size: var(--text-md); }
.film-card__meta { padding: 0 var(--space-3); color: var(--text-2); font-size: var(--text-xs); }

.film__back { color: var(--text-2); font-size: var(--text-sm); }
.film__back:hover { color: var(--text); }
.film__body { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: var(--space-5); align-items: start; }
.film__main { display: flex; flex-direction: column; gap: var(--space-5); min-width: 0; }
.film__section { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.film__section h2 { margin: 0; font-size: var(--text-xs); font-weight: 500; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.06em; }
.film__section-head { display: flex; justify-content: space-between; align-items: baseline; }
.film__count { font-size: var(--text-xs); color: var(--text-2); }

.shots { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.shot {
  display: grid; grid-template-columns: 96px minmax(0, 1fr) auto auto; align-items: center; gap: var(--space-3);
  padding: var(--space-1) var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-1);
}
.shot[data-on="false"] { opacity: 0.55; }
.shot__thumb { display: block; width: 96px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: var(--radius-sm); background: var(--surface-2); }
.shot__use { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); min-width: 0; }
.shot__use .mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shot__cost { color: var(--accent); font-size: var(--text-xs); }
.shot__move { display: flex; gap: var(--space-1); }

.outputs { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--space-3); }
.output { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-1); overflow: hidden; }
.output__player { display: block; width: 100%; max-height: 320px; background: var(--bg); }
.output__info { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2) var(--space-3) var(--space-3); font-size: var(--text-sm); }
.output__meta { color: var(--text-2); font-size: var(--text-xs); }
.output__info .button { align-self: flex-start; margin-top: var(--space-1); text-decoration: none; }

@media (max-width: 1100px) {
  .film__body { grid-template-columns: minmax(0, 1fr); }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run && npx tsc -p .`
Expected: 17 files and 93 tests pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/App.test.tsx web/src/app/App.tsx web/src/films/FilmPage.test.tsx web/src/films/FilmPage.tsx web/src/films/FilmsScreen.test.tsx web/src/films/FilmsScreen.tsx web/src/films/films.css
git diff --cached --stat
git commit -m "Show films and a film's shots and outputs in the studio

Shots reorder with up and down; each output has a player and a download.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 12: Finish panel: tool check, Assemble and task progress

**Files:**
- Create: `web/src/films/AssembleForm.tsx`
- Modify: `web/src/films/FilmPage.test.tsx` (test)
- Modify: `web/src/films/FilmPage.tsx`
- Create: `web/src/films/FinishPanel.test.tsx` (test)
- Create: `web/src/films/FinishPanel.tsx`
- Create: `web/src/films/TaskList.tsx`
- Modify: `web/src/films/films.css`
- Create: `web/src/films/finishing.ts`

The film page gains a Finish panel. When ffmpeg or the render engine is missing it says which tools are off and shows core's install text in a `<pre>`. The task list shows each task's label and state with an elapsed clock, the seconds ffmpeg has written (mono), then its outputs, warnings or error. The Assemble form sends the checked shots in the order shown, with music and voice-over picked from the film's audio files (an "Add audio" button uploads one), a transition and its seconds, and the frame. Every tool button is off while a task runs in the film; the server's 409 would refuse a second one anyway, and any refusal shows as an alert.

- [ ] **Step 1: Write the failing tests**

Create `web/src/films/FinishPanel.test.tsx`:

```tsx
import { describe, test, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FinishPanel } from "./FinishPanel";
import { emitForTests } from "../app/useStudio";
import { film, finishInfo, routes, task } from "../test-fixtures";

const tools = (over: object) => ({ ...finishInfo().tools, ...over });

function setup(table: Record<string, (init?: RequestInit) => unknown> = {}, props: Partial<Parameters<typeof FinishPanel>[0]> = {}) {
  const fetch = vi.fn(routes({ "/api/finish": () => finishInfo(), "/api/tasks": () => [], ...table }));
  vi.stubGlobal("fetch", fetch);
  const onChanged = vi.fn();
  render(<FinishPanel film={film()} shots={["out-2.mp4", "out.mp4"]} onChanged={onChanged} {...props} />);
  return { fetch, onChanged };
}

const sent = (fetch: ReturnType<typeof vi.fn>, path: string) => {
  const call = fetch.mock.calls.find(([p]) => String(p) === path);
  return call ? JSON.parse(String(call[1]?.body)) : undefined;
};

describe("FinishPanel: tools", () => {
  test("says how to install ffmpeg when it is missing, and turns Assemble off", async () => {
    setup({
      "/api/finish": () => finishInfo({ tools: tools({ ffmpeg: { ok: false, install: "ffmpeg is not installed.\nInstall it: brew install ffmpeg" } }) }),
    });
    const notice = await screen.findByRole("status", { name: "Missing tools" });
    expect(within(notice).getByText(/brew install ffmpeg/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assemble" })).toBeDisabled();
  });

  test("shows no notice when both tools are there", async () => {
    setup();
    await screen.findByRole("button", { name: "Assemble" });
    expect(screen.queryByRole("status", { name: "Missing tools" })).toBeNull();
  });
});

describe("FinishPanel: Assemble", () => {
  test("sends the chosen shots in order with the music, transition and ratio picked", async () => {
    const { fetch } = setup({ "/api/films/zed/assemble": () => ({ task: task() }) });
    await screen.findByRole("button", { name: "Assemble" });
    fireEvent.change(screen.getByLabelText("Music"), { target: { value: "bed.mp3" } });
    fireEvent.change(screen.getByLabelText("Transition"), { target: { value: "dissolve" } });
    fireEvent.change(screen.getByLabelText("Seconds", { selector: "#assemble-seconds" }), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText("Frame", { selector: "#assemble-ratio" }), { target: { value: "9:16" } });
    fireEvent.click(screen.getByRole("button", { name: "Assemble" }));
    await waitFor(() =>
      expect(sent(fetch, "/api/films/zed/assemble")).toEqual({
        shots: ["out-2.mp4", "out.mp4"],
        music: "bed.mp3",
        transition: "dissolve",
        transition_s: 0.5,
        aspect_ratio: "9:16",
      }),
    );
    expect(await screen.findByText(/Assemble · running/)).toBeInTheDocument();
  });

  test("is off with no shots chosen", async () => {
    setup({}, { shots: [] });
    expect(await screen.findByRole("button", { name: "Assemble" })).toBeDisabled();
    expect(screen.getByText("Choose at least one shot on the left.")).toBeInTheDocument();
  });

  test("shows the server's refusal", async () => {
    setup({
      "/api/films/zed/assemble": () =>
        new Response(JSON.stringify({ error: { code: 5, message: "Captions is still running in zed. Wait for it to finish, then try again." } }), {
          status: 409,
        }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Assemble" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Captions is still running in zed.");
  });

  test("adds an audio file to the film, as the raw body with its name", async () => {
    const { fetch, onChanged } = setup({ "/api/films/zed/audio": () => ({ name: "voice.m4a", kind: "audio", url: "/media/runs/zed/voice.m4a", bytes: 9 }) });
    await screen.findByRole("button", { name: "Assemble" });
    const file = new File(["RIFF"], "voice.m4a", { type: "audio/mp4" });
    fireEvent.change(screen.getByLabelText("Add an audio file"), { target: { files: [file] } });
    expect(await screen.findByText("Added voice.m4a. Pick it under Music or Voice-over.")).toBeInTheDocument();
    const [, init] = fetch.mock.calls.find(([p]) => String(p) === "/api/films/zed/audio")!;
    expect((init!.headers as Record<string, string>)["x-file-name"]).toBe("voice.m4a");
    expect(init!.body).toBe(file);
    expect(onChanged).toHaveBeenCalled();
  });
});

describe("FinishPanel: tasks", () => {
  test("a running task shows its progress and holds the buttons; when it ends its outputs show and the film reloads", async () => {
    const { onChanged } = setup();
    const button = await screen.findByRole("button", { name: "Assemble" });
    act(() => emitForTests({ event: "task", data: task({ outS: 3.2 }) }));
    const tasks = screen.getByRole("list", { name: "Tasks" });
    expect(within(tasks).getByText(/Assemble · running/)).toBeInTheDocument();
    expect(within(tasks).getByText("3.2s written")).toHaveClass("mono");
    expect(button).toBeDisabled();
    act(() =>
      emitForTests({
        event: "task",
        data: task({
          state: "done",
          endedAt: "2026-10-31T10:11:00.000Z",
          outputs: [{ name: "film.mp4", url: "/media/runs/zed/film.mp4" }],
          warnings: ["Music is shorter than the film."],
        }),
      }),
    );
    expect(within(tasks).getByText(/Assemble · done/)).toBeInTheDocument();
    expect(within(tasks).getByRole("link", { name: "film.mp4" })).toHaveAttribute("href", "/media/runs/zed/film.mp4");
    expect(within(tasks).getByText("Music is shorter than the film.")).toBeInTheDocument();
    expect(button).toBeEnabled();
    expect(onChanged).toHaveBeenCalled();
  });

  test("a failed task shows why", async () => {
    setup({ "/api/tasks": () => [task({ state: "failed", endedAt: "2026-10-31T10:11:00.000Z", error: "ffmpeg exited with code 1" })] });
    expect(await screen.findByText("ffmpeg exited with code 1")).toBeInTheDocument();
    expect(screen.getByText(/Assemble · failed/)).toBeInTheDocument();
  });
});
```

Modify `web/src/films/FilmPage.test.tsx` with this change:

```diff
--- a/web/src/films/FilmPage.test.tsx
+++ b/web/src/films/FilmPage.test.tsx
@@ -1,8 +1,8 @@
 import { describe, test, expect, vi } from "vitest";
-import { act, fireEvent, render, screen, within } from "@testing-library/react";
+import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
 import { FilmPage, shotOrder } from "./FilmPage";
 import { emitForTests } from "../app/useStudio";
-import { film, filmFile, job, routes } from "../test-fixtures";
+import { film, filmFile, finishInfo, job, routes, task } from "../test-fixtures";
 
 describe("shotOrder", () => {
   test("keeps the last assembly's order, then adds new takes oldest first", () => {
@@ -38,6 +38,25 @@ describe("FilmPage", () => {
     expect(screen.getByText("1 of 2 shots chosen")).toBeInTheDocument();
   });
 
+  test("Assemble takes the chosen shots in the order shown", async () => {
+    const fetch = vi.fn(
+      routes({
+        "/api/films/zed": () => film(),
+        "/api/finish": () => finishInfo(),
+        "/api/tasks": () => [],
+        "/api/films/zed/assemble": () => ({ task: task() }),
+      }),
+    );
+    vi.stubGlobal("fetch", fetch);
+    render(<FilmPage slug="zed" />);
+    fireEvent.click(await screen.findByRole("button", { name: "Move out.mp4 down" }));
+    fireEvent.click(screen.getByRole("checkbox", { name: "Use out.mp4" }));
+    fireEvent.click(await screen.findByRole("button", { name: "Assemble" }));
+    await waitFor(() => expect(fetch.mock.calls.some(([p]) => String(p) === "/api/films/zed/assemble")).toBe(true));
+    const [, init] = fetch.mock.calls.find(([p]) => String(p) === "/api/films/zed/assemble")!;
+    expect(JSON.parse(String(init!.body)).shots).toEqual(["out-2.mp4"]);
+  });
+
   test("shows a take's cost from its job, in mono", async () => {
     vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/zed": () => film({ files: [filmFile({ job: job({ actualUsd: 0.5 }) })] }) })));
     render(<FilmPage slug="zed" />);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run src/films`
Expected: FAIL. `FinishPanel.test.tsx` does not load (`Failed to resolve import "./FinishPanel"`). `FilmPage.test.tsx`: 1 of 8 fails, `Unable to find role="button" and name "Assemble"`.

- [ ] **Step 3: Implement**

Create `web/src/films/AssembleForm.tsx`:

```tsx
import { useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { FilmDetail, FinishInfo, SavedAudio, TaskView } from "../api/types";
import { filesOf, useStart } from "./finishing";

interface Props {
  film: FilmDetail;
  info: FinishInfo;
  shots: string[];
  busy: boolean;
  onStarted: (t: TaskView) => void;
  onChanged: () => void;
}

/** Joins the chosen shots in order, with crossfades and an optional music bed or voice-over; core normalises the loudness. */
export function AssembleForm({ film, info, shots, busy, onStarted, onChanged }: Props) {
  const [music, setMusic] = useState("");
  const [vo, setVo] = useState("");
  const [transition, setTransition] = useState(info.transitions[0] ?? "fade");
  const [seconds, setSeconds] = useState("0");
  const [ratio, setRatio] = useState("16:9");
  const [added, setAdded] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const { start, error, sending } = useStart(onStarted);
  const audio = filesOf(film.files, "audio");
  const off = !info.tools.ffmpeg.ok;

  async function add(file: File) {
    setAdded(null);
    setUploadError(null);
    try {
      const saved = await api<SavedAudio>(`/api/films/${encodeURIComponent(film.run)}/audio`, { file: { data: file, name: file.name } });
      setAdded(saved.name);
      onChanged();
    } catch (e) {
      setUploadError(e instanceof ApiError ? e.message : String(e));
    }
  }

  function submit() {
    start(`/api/films/${encodeURIComponent(film.run)}/assemble`, {
      shots,
      ...(music && { music }),
      ...(vo && { vo }),
      transition,
      transition_s: Number(seconds) || 0,
      aspect_ratio: ratio,
    });
  }

  return (
    <section className="finish__tool" aria-labelledby="assemble-title">
      <h3 id="assemble-title">Assemble</h3>
      <p className="finish__hint">
        {shots.length ? `${shots.length === 1 ? "1 shot" : `${shots.length} shots`}, in the order on the left.` : "Choose at least one shot on the left."}
      </p>
      <div className="finish__grid">
        <label htmlFor="assemble-music">Music</label>
        <select id="assemble-music" value={music} onChange={(e) => setMusic(e.target.value)}>
          <option value="">None</option>
          {audio.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name}
            </option>
          ))}
        </select>
        <label htmlFor="assemble-vo">Voice-over</label>
        <select id="assemble-vo" value={vo} onChange={(e) => setVo(e.target.value)}>
          <option value="">None</option>
          {audio.map((f) => (
            <option key={f.name} value={f.name}>
              {f.name}
            </option>
          ))}
        </select>
        <label htmlFor="assemble-transition">Transition</label>
        <span className="finish__pair">
          <select id="assemble-transition" value={transition} onChange={(e) => setTransition(e.target.value)}>
            {info.transitions.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <label htmlFor="assemble-seconds" className="finish__inline">
            Seconds
          </label>
          <input
            id="assemble-seconds"
            className="mono"
            type="number"
            min="0"
            max="5"
            step="0.25"
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
          />
        </span>
        <label htmlFor="assemble-ratio">Frame</label>
        <select id="assemble-ratio" value={ratio} onChange={(e) => setRatio(e.target.value)}>
          {info.ratios.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </div>
      <p className="finish__hint">Seconds 0 cuts straight between shots. The sound is levelled to streaming loudness.</p>
      <div className="finish__actions">
        <button type="button" className="button" disabled={off || busy || sending || !shots.length} onClick={submit}>
          Assemble
        </button>
        <button type="button" className="button button--quiet" onClick={() => picker.current?.click()}>
          Add audio
        </button>
        <input
          ref={picker}
          type="file"
          accept="audio/*"
          hidden
          aria-label="Add an audio file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) add(file);
            e.target.value = "";
          }}
        />
      </div>
      {added && <p className="finish__note">Added {added}. Pick it under Music or Voice-over.</p>}
      {uploadError && (
        <p className="finish__error" role="alert">
          {uploadError}
        </p>
      )}
      {error && (
        <p className="finish__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
```

Modify `web/src/films/FilmPage.tsx` with this change:

```diff
--- a/web/src/films/FilmPage.tsx
+++ b/web/src/films/FilmPage.tsx
@@ -3,6 +3,7 @@ import { api, ApiError } from "../api/client";
 import type { FilmDetail, FilmFile } from "../api/types";
 import { onStudioEvent } from "../app/useStudio";
 import { takeCost } from "../studio/format";
+import { FinishPanel } from "./FinishPanel";
 
 const OUTPUT_LABEL = { film: "Film", captioned: "Captioned", variant: "Variant", card: "Text card" } as const;
 
@@ -165,6 +166,7 @@ export function FilmPage({ slug }: { slug: string }) {
               )}
             </section>
           </div>
+          <FinishPanel film={detail} shots={shots.filter((s) => s.on).map((s) => s.name)} onChanged={load} />
         </div>
       )}
     </div>
```

Create `web/src/films/FinishPanel.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { FilmDetail, FinishInfo, TaskView } from "../api/types";
import { AssembleForm } from "./AssembleForm";
import { TaskList } from "./TaskList";
import { mergeTask, useTasks } from "./useTasks";

interface Props {
  film: FilmDetail;
  /** The chosen shot names, in order. */
  shots: string[];
  /** Read the film again: a task ended or a file was added. */
  onChanged: () => void;
}

function MissingTools({ info }: { info: FinishInfo }) {
  const { ffmpeg, render } = info.tools;
  if (ffmpeg.ok && render.ok) return null;
  return (
    <section className="finish__missing" role="status" aria-label="Missing tools">
      {!ffmpeg.ok && (
        <>
          <p>ffmpeg isn't installed, so Assemble, Captions and Variants are off.</p>
          {ffmpeg.install && <pre className="mono">{ffmpeg.install}</pre>}
        </>
      )}
      {!render.ok && (
        <>
          <p>The render engine isn't set up, so Captions and Text cards are off.</p>
          {render.install && <pre className="mono">{render.install}</pre>}
        </>
      )}
    </section>
  );
}

/** The finishing tools for one film. Each runs as a server task; one at a time per film. */
export function FinishPanel({ film, shots, onChanged }: Props) {
  const [info, setInfo] = useState<FinishInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<TaskView | null>(null);
  const heard = useTasks(film.run, onChanged);

  useEffect(() => {
    api<FinishInfo>("/api/finish")
      .then(setInfo)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  // The POST answers with the task before its first event may arrive.
  const tasks = started && !heard.some((t) => t.id === started.id) ? mergeTask(heard, started) : heard;
  const busy = tasks.some((t) => t.state === "running");

  if (error)
    return (
      <aside className="finish">
        <p className="finish__error" role="alert">
          {error}
        </p>
      </aside>
    );
  if (!info) return <aside className="finish" aria-busy="true" />;
  return (
    <aside className="finish" aria-label="Finish">
      <h2>Finish</h2>
      <MissingTools info={info} />
      <TaskList tasks={tasks} />
      <AssembleForm film={film} info={info} shots={shots} busy={busy} onStarted={setStarted} onChanged={onChanged} />
    </aside>
  );
}
```

Create `web/src/films/TaskList.tsx`:

```tsx
import type { TaskView } from "../api/types";
import { elapsed } from "../studio/format";
import { useNow } from "../studio/useJobs";

function status(t: TaskView, now: number): string {
  if (t.state === "running") return `${t.label} · running ${elapsed(t.startedAt, now)}`;
  const took = t.endedAt ? ` in ${elapsed(t.startedAt, Date.parse(t.endedAt))}` : "";
  return `${t.label} · ${t.state}${took}`;
}

/** This film's finishing tasks, newest first: progress while running, then outputs or the reason it failed. */
export function TaskList({ tasks }: { tasks: TaskView[] }) {
  const now = useNow();
  if (!tasks.length) return null;
  return (
    <ul className="tasks" aria-label="Tasks">
      {tasks.map((t) => (
        <li key={t.id} className="task" data-state={t.state}>
          <p className="task__status">
            {status(t, now)}
            {t.state === "running" && t.outS != null && (
              <>
                {" · "}
                <span className="mono">{t.outS.toFixed(1)}s written</span>
              </>
            )}
          </p>
          {t.outputs.length > 0 && (
            <p className="task__outputs">
              {t.outputs.map((o) =>
                o.url ? (
                  <a key={o.name} className="mono" href={o.url} target="_blank" rel="noreferrer">
                    {o.name}
                  </a>
                ) : (
                  <span key={o.name} className="mono">
                    {o.name}
                  </span>
                ),
              )}
            </p>
          )}
          {t.warnings.map((w) => (
            <p key={w} className="task__warning">
              {w}
            </p>
          ))}
          {t.error && <p className="task__error">{t.error}</p>}
        </li>
      ))}
    </ul>
  );
}
```

Modify `web/src/films/films.css` with this change:

```diff
--- a/web/src/films/films.css
+++ b/web/src/films/films.css
@@ -50,3 +50,40 @@
 @media (max-width: 1100px) {
   .film__body { grid-template-columns: minmax(0, 1fr); }
 }
+
+/* Finish panel: one column of tools beside the shots. */
+.finish {
+  display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-3);
+  border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-1);
+}
+.finish[aria-busy="true"] { min-height: 240px; }
+.finish > h2 { margin: 0; font-size: var(--text-lg); font-weight: 500; }
+.finish h3 { margin: 0; font-size: var(--text-xs); font-weight: 500; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.06em; }
+.finish__tool { display: flex; flex-direction: column; gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--line); font-size: var(--text-sm); }
+.finish__grid { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--space-2) var(--space-3); align-items: center; }
+.finish__grid > label, .finish__inline { color: var(--text-2); }
+.finish__pair { display: flex; align-items: center; gap: var(--space-2); }
+.finish select, .finish input:not([type="checkbox"]):not([type="radio"]), .finish textarea {
+  background: var(--surface-2); color: var(--text); border: 1px solid var(--line); border-radius: var(--radius-sm);
+  padding: 5px var(--space-2); font-size: var(--text-sm); min-width: 0;
+}
+.finish textarea { font-family: inherit; resize: vertical; }
+.finish textarea.mono { font-family: var(--font-mono); font-size: var(--text-xs); }
+.finish input[type="number"] { width: 6em; }
+.finish__hint { margin: 0; color: var(--text-3); font-size: var(--text-xs); }
+.finish__note { margin: 0; color: var(--text-2); font-size: var(--text-xs); }
+.finish__error { margin: 0; color: var(--bad-ink); font-size: var(--text-sm); white-space: pre-line; }
+.finish__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
+.finish__missing { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--warn); border-radius: var(--radius-sm); font-size: var(--text-sm); }
+.finish__missing p { margin: 0; }
+.finish__missing pre { margin: 0; padding: var(--space-2); background: var(--surface-2); border-radius: var(--radius-sm); font-size: var(--text-xs); white-space: pre-wrap; }
+
+.tasks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
+.task { display: flex; flex-direction: column; gap: 2px; font-size: var(--text-xs); }
+.task p { margin: 0; }
+.task__status { color: var(--text-2); }
+.task[data-state="running"] .task__status { color: var(--text); }
+.task__outputs { display: flex; flex-wrap: wrap; gap: var(--space-2); }
+.task__outputs a { color: var(--text); }
+.task__warning { color: var(--warn); }
+.task__error { color: var(--bad-ink); white-space: pre-line; }
```

Create `web/src/films/finishing.ts`:

```ts
import { useState } from "react";
import { api, ApiError } from "../api/client";
import type { FilmFile, TaskView } from "../api/types";

/** The files of one kind in the film, newest first, for the pickers. */
export const filesOf = (files: FilmFile[], kind: FilmFile["kind"]) => files.filter((f) => f.kind === kind).reverse();

/**
 * Posts a finishing request. The server answers at once with the task it
 * started (or refuses), and the task's progress arrives as SSE task events.
 */
export function useStart(onStarted: (t: TaskView) => void) {
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  async function start(path: string, body: unknown) {
    setSending(true);
    setError(null);
    try {
      const { task } = await api<{ task: TaskView }>(path, { method: "POST", body });
      onStarted(task);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }
  return { start, error, sending };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run && npx tsc -p .`
Expected: 18 files and 102 tests pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/films/AssembleForm.tsx web/src/films/FilmPage.test.tsx web/src/films/FilmPage.tsx web/src/films/FinishPanel.test.tsx web/src/films/FinishPanel.tsx web/src/films/TaskList.tsx web/src/films/films.css web/src/films/finishing.ts
git diff --cached --stat
git commit -m "Assemble a film from the studio's film page

Missing tools show core's install text; tasks show live progress, outputs
and warnings.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 13: Finish panel: Captions, Variants and Text cards

**Files:**
- Create: `web/src/films/CaptionsForm.tsx`
- Create: `web/src/films/CardForm.tsx`
- Create: `web/src/films/FinishForms.test.tsx` (test)
- Modify: `web/src/films/FinishPanel.tsx`
- Create: `web/src/films/VariantsForm.tsx`
- Modify: `web/src/films/films.css`

Captions are two steps: paste SRT text (or "Load .srt", which reads a file into the box with `File.text()`), Save it into the film (the reply's cue count and core's problems show), then Burn a saved SRT into a chosen video. Variants offer 9:16 and 1:1 with a fill mode, for the film or a take; earlier variants are not offered, since reframing one again loses picture. The Text card form is built from the template's fields: text as an input, lines as a textarea split into a list, choices as a select with "Template default", JSON as a mono textarea filled with the example (bad JSON is refused in the page before anything is sent), and an image field as a path with the film's images suggested. Captions and Text cards are off without the render engine; Variants need only ffmpeg.

- [ ] **Step 1: Write the failing test**

Create `web/src/films/FinishForms.test.tsx`:

```tsx
import { describe, test, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FinishPanel } from "./FinishPanel";
import { film, filmFile, finishInfo, routes, task } from "../test-fixtures";

const withSrt = () => film({ files: [...film().files, filmFile({ name: "captions.srt", kind: "srt", origin: null, url: "/media/runs/zed/captions.srt" })] });
const SRT = "1\n00:00:00,000 --> 00:00:01,500\nHello\n";

function setup(table: Record<string, (init?: RequestInit) => unknown> = {}, detail = film()) {
  const fetch = vi.fn(routes({ "/api/finish": () => finishInfo(), "/api/tasks": () => [], ...table }));
  vi.stubGlobal("fetch", fetch);
  const onChanged = vi.fn();
  render(<FinishPanel film={detail} shots={["out.mp4"]} onChanged={onChanged} />);
  return { fetch, onChanged };
}

const sent = (fetch: ReturnType<typeof vi.fn>, path: string) => {
  const call = fetch.mock.calls.find(([p]) => String(p) === path);
  return call ? JSON.parse(String(call[1]?.body)) : undefined;
};

describe("Captions", () => {
  test("Save captions sends the pasted SRT, then picks the saved file and says how many cues read", async () => {
    const { fetch, onChanged } = setup({
      "/api/films/zed/srt": () => ({ name: "captions-2.srt", url: "/media/runs/zed/captions-2.srt", cues: 1, problems: ["Cue 2 has no text."], lastEndS: 1.5 }),
    });
    fireEvent.change(await screen.findByLabelText("SRT text"), { target: { value: SRT } });
    fireEvent.click(screen.getByRole("button", { name: "Save captions" }));
    expect(await screen.findByText("Saved captions-2.srt: 1 cue, ending at 1.5s.")).toBeInTheDocument();
    expect(screen.getByText("Cue 2 has no text.")).toBeInTheDocument();
    expect(sent(fetch, "/api/films/zed/srt")).toEqual({ text: SRT });
    expect(onChanged).toHaveBeenCalled();
  });

  test("says why an SRT was refused", async () => {
    setup({
      "/api/films/zed/srt": () => new Response(JSON.stringify({ error: { code: 1, message: "No readable cues.", field: "text" } }), { status: 400 }),
    });
    fireEvent.change(await screen.findByLabelText("SRT text"), { target: { value: "nonsense" } });
    fireEvent.click(screen.getByRole("button", { name: "Save captions" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No readable cues.");
  });

  test("Load .srt reads a file into the box", async () => {
    setup();
    await screen.findByLabelText("SRT text");
    fireEvent.change(screen.getByLabelText("Load an .srt file"), { target: { files: [new File([SRT], "talk.srt")] } });
    await waitFor(() => expect(screen.getByLabelText("SRT text")).toHaveValue(SRT));
  });

  test("Burn captions sends the video, the saved SRT and the style", async () => {
    const { fetch } = setup({ "/api/films/zed/caption": () => ({ task: task({ tool: "caption", label: "Captions" }) }) }, withSrt());
    fireEvent.change(await screen.findByLabelText("Video to caption"), { target: { value: "out.mp4" } });
    fireEvent.change(screen.getByLabelText("Style"), { target: { value: "subtle" } });
    fireEvent.click(screen.getByRole("button", { name: "Burn captions" }));
    await waitFor(() => expect(sent(fetch, "/api/films/zed/caption")).toEqual({ video: "out.mp4", srt: "captions.srt", style: "subtle" }));
  });

  test("Burn captions and Make card are off when the render engine is missing", async () => {
    setup(
      { "/api/finish": () => finishInfo({ tools: { ffmpeg: { ok: true, install: null }, render: { ok: false, install: "cd render && npm install" } } }) },
      withSrt(),
    );
    expect(await screen.findByRole("button", { name: "Burn captions" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Make card" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Make variants" })).toBeEnabled();
  });
});

describe("Variants", () => {
  test("offers the film and takes to reframe, not earlier variants", async () => {
    setup({}, film({ files: [...film().files, filmFile({ name: "film-9x16.mp4", origin: "variant", modified: "2026-10-31T10:20:00.000Z" })] }));
    const picker = await screen.findByLabelText("Video to reframe");
    expect(picker).toHaveValue("film.mp4");
    expect(within(picker).queryByText("film-9x16.mp4")).toBeNull();
    expect(within(screen.getByLabelText("Video to caption")).getByText("film-9x16.mp4")).toBeInTheDocument();
  });

  test("Make variants sends the video, the ratios ticked and the mode", async () => {
    const { fetch } = setup({ "/api/films/zed/variants": () => ({ task: task({ tool: "variants", label: "Variants" }) }) });
    expect(await screen.findByLabelText("Video to reframe")).toHaveValue("film.mp4");
    fireEvent.click(screen.getByRole("checkbox", { name: "1:1" }));
    fireEvent.change(screen.getByLabelText("Fill"), { target: { value: "crop" } });
    fireEvent.click(screen.getByRole("button", { name: "Make variants" }));
    await waitFor(() => expect(sent(fetch, "/api/films/zed/variants")).toEqual({ video: "film.mp4", ratios: ["9:16"], mode: "crop" }));
  });
});

describe("Text cards", () => {
  test("lists the template's props as fields and sends the ones filled in", async () => {
    const { fetch } = setup({ "/api/films/zed/card": () => ({ task: task({ tool: "card", label: "Text card (kinetic-type)" }) }) });
    expect(await screen.findByLabelText("Template")).toHaveValue("kinetic-type");
    expect(screen.getByText("One line of the headline per row.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Lines"), { target: { value: "Inbox zero\n\nby lunch" } });
    fireEvent.change(screen.getByLabelText("Kicker"), { target: { value: "New" } });
    fireEvent.change(screen.getByLabelText("Builds by"), { target: { value: "line" } });
    fireEvent.change(screen.getByLabelText("Seconds", { selector: "#card-seconds" }), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Make card" }));
    await waitFor(() =>
      expect(sent(fetch, "/api/films/zed/card")).toEqual({
        template: "kinetic-type",
        props: { lines: ["Inbox zero", "by lunch"], kicker: "New", granularity: "line" },
        aspect_ratio: "16:9",
        duration_s: 5,
      }),
    );
  });

  test("a list field starts from the example and bad JSON is refused before anything is sent", async () => {
    const { fetch } = setup();
    fireEvent.change(await screen.findByLabelText("Template"), { target: { value: "stat-reveal" } });
    const stats = screen.getByLabelText("Stats") as HTMLTextAreaElement;
    expect(JSON.parse(stats.value)).toEqual([{ label: "Replies", value: 128 }]);
    fireEvent.change(stats, { target: { value: "[{" } });
    fireEvent.click(screen.getByRole("button", { name: "Make card" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Stats is not valid JSON");
    expect(fetch.mock.calls.some(([p]) => String(p) === "/api/films/zed/card")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run src/films/FinishForms.test.tsx`
Expected: FAIL, 9 of 9: `Unable to find a label with the text of: SRT text` (3), `… Template` (2), `… Video to reframe` (2), `… Video to caption` (1), and `Unable to find role="button" and name "Burn captions"` (1).

- [ ] **Step 3: Implement**

Create `web/src/films/CaptionsForm.tsx`:

```tsx
import { useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { FilmDetail, FinishInfo, SavedSrt, TaskView } from "../api/types";
import { filesOf, useStart } from "./finishing";

interface Props {
  film: FilmDetail;
  info: FinishInfo;
  busy: boolean;
  onStarted: (t: TaskView) => void;
  onChanged: () => void;
}

/**
 * Captions in two steps: save SRT text into the film (pasted, or read from a
 * file here in the page), then burn a saved SRT into a video.
 */
export function CaptionsForm({ film, info, busy, onStarted, onChanged }: Props) {
  const videos = filesOf(film.files, "video");
  const srts = filesOf(film.files, "srt");
  const [video, setVideo] = useState("");
  const [srt, setSrt] = useState("");
  const [style, setStyle] = useState(info.captionStyles[0] ?? "social");
  const [text, setText] = useState("");
  const [saved, setSaved] = useState<SavedSrt | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const { start, error, sending } = useStart(onStarted);
  // Until the user picks, take the newest of each.
  const chosenVideo = video || videos[0]?.name || "";
  const chosenSrt = srt || srts[0]?.name || "";
  const off = !info.tools.ffmpeg.ok || !info.tools.render.ok;

  async function save() {
    setSaved(null);
    setSaveError(null);
    try {
      const r = await api<SavedSrt>(`/api/films/${encodeURIComponent(film.run)}/srt`, { method: "POST", body: { text } });
      setSaved(r);
      setSrt(r.name);
      onChanged();
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : String(e));
    }
  }

  return (
    <section className="finish__tool" aria-labelledby="captions-title">
      <h3 id="captions-title">Captions</h3>
      <label htmlFor="caption-text" className="finish__inline">
        SRT text
      </label>
      <textarea
        id="caption-text"
        className="mono"
        rows={5}
        value={text}
        placeholder={"1\n00:00:00,000 --> 00:00:02,000\nFirst line"}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="finish__actions">
        <button type="button" className="button" disabled={!text.trim()} onClick={save}>
          Save captions
        </button>
        <button type="button" className="button button--quiet" onClick={() => picker.current?.click()}>
          Load .srt
        </button>
        <input
          ref={picker}
          type="file"
          accept=".srt,application/x-subrip,text/plain"
          hidden
          aria-label="Load an .srt file"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) setText(await file.text());
          }}
        />
      </div>
      {saved && (
        <p className="finish__note">
          Saved {saved.name}: {saved.cues === 1 ? "1 cue" : `${saved.cues} cues`}, ending at {saved.lastEndS}s.
        </p>
      )}
      {saved?.problems.map((p) => (
        <p key={p} className="task__warning">
          {p}
        </p>
      ))}
      {saveError && (
        <p className="finish__error" role="alert">
          {saveError}
        </p>
      )}

      <div className="finish__grid">
        <label htmlFor="caption-video">Video to caption</label>
        <select id="caption-video" value={chosenVideo} onChange={(e) => setVideo(e.target.value)}>
          {videos.map((f) => (
            <option key={f.name}>{f.name}</option>
          ))}
        </select>
        <label htmlFor="caption-srt">Captions file</label>
        <select id="caption-srt" value={chosenSrt} onChange={(e) => setSrt(e.target.value)}>
          {!srts.length && <option value="">Save captions first</option>}
          {srts.map((f) => (
            <option key={f.name}>{f.name}</option>
          ))}
        </select>
        <label htmlFor="caption-style">Style</label>
        <select id="caption-style" value={style} onChange={(e) => setStyle(e.target.value)}>
          {info.captionStyles.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="finish__actions">
        <button
          type="button"
          className="button"
          disabled={off || busy || sending || !chosenVideo || !chosenSrt}
          onClick={() => start(`/api/films/${encodeURIComponent(film.run)}/caption`, { video: chosenVideo, srt: chosenSrt, style })}
        >
          Burn captions
        </button>
      </div>
      {error && (
        <p className="finish__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
```

Create `web/src/films/CardForm.tsx`:

```tsx
import { useState } from "react";
import type { FilmDetail, FinishInfo, TaskView, TemplateField, TemplateInfo } from "../api/types";
import { filesOf, useStart } from "./finishing";

interface Props {
  film: FilmDetail;
  info: FinishInfo;
  busy: boolean;
  onStarted: (t: TaskView) => void;
}

/** What each field starts as: a list field shows its example so the shape is plain. */
const startValues = (t: TemplateInfo | undefined) =>
  Object.fromEntries((t?.fields ?? []).map((f) => [f.name, f.type === "json" && f.example !== undefined ? JSON.stringify(f.example, null, 2) : ""]));

/** The props to send: filled fields only, lines split into a list and JSON parsed. Throws a sentence on bad JSON. */
export function cardProps(fields: TemplateField[], values: Record<string, string>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = (values[f.name] ?? "").trim();
    if (!raw) continue;
    if (f.type === "lines")
      props[f.name] = raw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    else if (f.type === "json") {
      try {
        props[f.name] = JSON.parse(raw);
      } catch (e) {
        throw new Error(`${f.label} is not valid JSON: ${(e as Error).message}`);
      }
    } else props[f.name] = raw;
  }
  return props;
}

function Field({ field, value, images, onChange }: { field: TemplateField; value: string; images: string[]; onChange: (v: string) => void }) {
  const id = `card-${field.name}`;
  const head = (
    <span className="card-field__head">
      <label htmlFor={id}>{field.label}</label>
      {field.required && <span className="finish__required">required</span>}
    </span>
  );
  let control;
  if (field.type === "choice")
    control = (
      <select id={id} aria-required={field.required || undefined} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Template default</option>
        {field.choices?.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    );
  else if (field.type === "lines" || field.type === "json")
    control = (
      <textarea
        id={id}
        aria-required={field.required || undefined}
        className={field.type === "json" ? "mono" : undefined}
        rows={field.type === "json" ? 6 : 3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  else
    control = (
      <input
        id={id}
        aria-required={field.required || undefined}
        className={field.type === "image" ? "mono" : undefined}
        list={field.type === "image" ? "card-images" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  return (
    <div className="card-field">
      {head}
      {control}
      {field.hint && <p className="finish__hint">{field.hint}</p>}
      {field.type === "image" && (
        <datalist id="card-images">
          {images.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      )}
    </div>
  );
}

/** Exact titles, logos and numbers, rendered from a template by the render engine as an mp4 in the film. */
export function CardForm({ film, info, busy, onStarted }: Props) {
  const [templateId, setTemplateId] = useState(info.templates[0]?.id ?? "");
  const template = info.templates.find((t) => t.id === templateId);
  const [values, setValues] = useState<Record<string, string>>(() => startValues(template));
  const [ratio, setRatio] = useState("16:9");
  const [seconds, setSeconds] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const { start, error, sending } = useStart(onStarted);
  const images = filesOf(film.files, "image").map((f) => `${film.run}/${f.name}`);

  function pick(id: string) {
    setTemplateId(id);
    setValues(startValues(info.templates.find((t) => t.id === id)));
    setInvalid(null);
  }

  function submit() {
    if (!template) return;
    let props;
    try {
      props = cardProps(template.fields, values);
    } catch (e) {
      setInvalid((e as Error).message);
      return;
    }
    setInvalid(null);
    start(`/api/films/${encodeURIComponent(film.run)}/card`, {
      template: template.id,
      props,
      aspect_ratio: ratio,
      ...(seconds && { duration_s: Number(seconds) }),
    });
  }

  return (
    <section className="finish__tool" aria-labelledby="card-title">
      <h3 id="card-title">Text card</h3>
      <div className="finish__grid">
        <label htmlFor="card-template">Template</label>
        <select id="card-template" value={templateId} onChange={(e) => pick(e.target.value)}>
          {info.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.id}
            </option>
          ))}
        </select>
      </div>
      {template && <p className="finish__hint">{template.description}</p>}
      {template?.fields.map((f) => (
        <Field
          key={`${template.id}-${f.name}`}
          field={f}
          value={values[f.name] ?? ""}
          images={images}
          onChange={(v) => setValues((old) => ({ ...old, [f.name]: v }))}
        />
      ))}
      <div className="finish__grid">
        <label htmlFor="card-ratio">Frame</label>
        <span className="finish__pair">
          <select id="card-ratio" value={ratio} onChange={(e) => setRatio(e.target.value)}>
            {info.ratios.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <label htmlFor="card-seconds" className="finish__inline">
            Seconds
          </label>
          <input
            id="card-seconds"
            className="mono"
            type="number"
            min="1"
            max="60"
            step="0.5"
            placeholder={template?.durationS != null ? String(template.durationS) : ""}
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
          />
        </span>
      </div>
      <div className="finish__actions">
        <button type="button" className="button" disabled={!info.tools.render.ok || busy || sending || !template} onClick={submit}>
          Make card
        </button>
      </div>
      {(invalid || error) && (
        <p className="finish__error" role="alert">
          {invalid ?? error}
        </p>
      )}
    </section>
  );
}
```

Modify `web/src/films/FinishPanel.tsx` with this change:

```diff
--- a/web/src/films/FinishPanel.tsx
+++ b/web/src/films/FinishPanel.tsx
@@ -2,6 +2,9 @@ import { useEffect, useState } from "react";
 import { api, ApiError } from "../api/client";
 import type { FilmDetail, FinishInfo, TaskView } from "../api/types";
 import { AssembleForm } from "./AssembleForm";
+import { CaptionsForm } from "./CaptionsForm";
+import { CardForm } from "./CardForm";
+import { VariantsForm } from "./VariantsForm";
 import { TaskList } from "./TaskList";
 import { mergeTask, useTasks } from "./useTasks";
 
@@ -66,6 +69,9 @@ export function FinishPanel({ film, shots, onChanged }: Props) {
       <MissingTools info={info} />
       <TaskList tasks={tasks} />
       <AssembleForm film={film} info={info} shots={shots} busy={busy} onStarted={setStarted} onChanged={onChanged} />
+      <CaptionsForm film={film} info={info} busy={busy} onStarted={setStarted} onChanged={onChanged} />
+      <VariantsForm film={film} info={info} busy={busy} onStarted={setStarted} />
+      <CardForm film={film} info={info} busy={busy} onStarted={setStarted} />
     </aside>
   );
 }
```

Create `web/src/films/VariantsForm.tsx`:

```tsx
import { useState } from "react";
import type { FilmDetail, FinishInfo, TaskView } from "../api/types";
import { filesOf, useStart } from "./finishing";

const OFFERED = ["9:16", "1:1"];

interface Props {
  film: FilmDetail;
  info: FinishInfo;
  busy: boolean;
  onStarted: (t: TaskView) => void;
}

/** Reframes a video for vertical and square feeds, written beside it as <name>-9x16.mp4 and <name>-1x1.mp4. */
export function VariantsForm({ film, info, busy, onStarted }: Props) {
  // Reframing a variant again loses picture, so variants are not offered here.
  const videos = filesOf(film.files, "video").filter((f) => f.origin !== "variant");
  const [video, setVideo] = useState("");
  const [ratios, setRatios] = useState<string[]>(OFFERED);
  const [mode, setMode] = useState(info.variantModes[0] ?? "blur");
  const { start, error, sending } = useStart(onStarted);
  const chosenVideo = video || videos[0]?.name || "";

  return (
    <section className="finish__tool" aria-labelledby="variants-title">
      <h3 id="variants-title">Variants</h3>
      <div className="finish__grid">
        <label htmlFor="variants-video">Video to reframe</label>
        <select id="variants-video" value={chosenVideo} onChange={(e) => setVideo(e.target.value)}>
          {videos.map((f) => (
            <option key={f.name}>{f.name}</option>
          ))}
        </select>
        <span className="finish__inline">Frames</span>
        <span className="finish__pair">
          {OFFERED.map((r) => (
            <label key={r} className="finish__check">
              <input
                type="checkbox"
                checked={ratios.includes(r)}
                onChange={() => setRatios((list) => (list.includes(r) ? list.filter((x) => x !== r) : OFFERED.filter((x) => x === r || list.includes(x))))}
              />
              <span className="mono">{r}</span>
            </label>
          ))}
        </span>
        <label htmlFor="variants-mode">Fill</label>
        <select id="variants-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
          {info.variantModes.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </div>
      <p className="finish__hint">
        Blur fills the edges with a blurred copy; crop cuts to the new frame; pad adds bars. Burn captions after reframing so they stay in frame.
      </p>
      <div className="finish__actions">
        <button
          type="button"
          className="button"
          disabled={!info.tools.ffmpeg.ok || busy || sending || !chosenVideo || !ratios.length}
          onClick={() => start(`/api/films/${encodeURIComponent(film.run)}/variants`, { video: chosenVideo, ratios, mode })}
        >
          Make variants
        </button>
      </div>
      {error && (
        <p className="finish__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
```

Modify `web/src/films/films.css` with this change:

```diff
--- a/web/src/films/films.css
+++ b/web/src/films/films.css
@@ -87,3 +87,7 @@
 .task__outputs a { color: var(--text); }
 .task__warning { color: var(--warn); }
 .task__error { color: var(--bad-ink); white-space: pre-line; }
+.finish__check { display: inline-flex; align-items: center; gap: var(--space-1); }
+.finish__required { color: var(--text-3); font-size: var(--text-xs); }
+.card-field { display: flex; flex-direction: column; gap: var(--space-1); }
+.card-field__head { display: flex; align-items: baseline; gap: var(--space-2); color: var(--text-2); }
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run && npx tsc -p .`
Expected: 19 files and 111 tests pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/films/CaptionsForm.tsx web/src/films/CardForm.tsx web/src/films/FinishForms.test.tsx web/src/films/FinishPanel.tsx web/src/films/VariantsForm.tsx web/src/films/films.css
git diff --cached --stat
git commit -m "Add captions, variants and text cards to the studio's film page

Text card fields come from the template's props; JSON is checked before
sending.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 14: Spend screen

**Files:**
- Modify: `web/src/app/App.test.tsx` (test)
- Modify: `web/src/app/App.tsx`
- Create: `web/src/spend/SpendScreen.test.tsx` (test)
- Create: `web/src/spend/SpendScreen.tsx`
- Create: `web/src/spend/spend.css`

Read the dataviz skill before this task. The Spend tab shows today against the cap as a stat tile (mono figure, amber meter, what is left, the per-job limit, unsettled jobs), then the 14 days from `spendView` as columns: one series, so no legend; amber bars at most 24px wide with a 4px rounded top, square at the baseline; hairline gridlines at 0, half and a clean top (`niceMax`); day numbers and axis values in mono text colours, never amber. Each day is a button (hit target the whole column) with an accessible name like `2026-10-31: $2.10`; hover or focus shows a tooltip with the value first, a click filters the jobs to that day, and "Show as a table" gives the same numbers as a table. The jobs table (`/api/jobs?limit=1000`, live from `job` events) lists time, model, cost (mono amber), cost source, state and film (a link to the film), with Film and Day filters in one row above it. Check again appears for submitted or uncertain jobs that have an upstream id and makes one free status read through `/api/jobs/:id/check`. An uncertain job with no upstream id shows core's `uncertainMessage` and a Copy button for each `kie job resolve` command (`navigator.clipboard`). Amber was checked with the dataviz validator against `--surface-1` (#161412): contrast passes 3:1; its lightness-band failure applies to categorical palettes of several hues, not to this single cost colour.

- [ ] **Step 1: Write the failing tests**

Create `web/src/spend/SpendScreen.test.tsx`:

```tsx
import { describe, test, expect, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SpendScreen, niceMax, resolveCommands } from "./SpendScreen";
import { emitForTests } from "../app/useStudio";
import { job, routes, spend } from "../test-fixtures";

const NO_ID = job({
  id: "j-20261031-nid999",
  state: "uncertain",
  upstreamTaskId: null,
  actualUsd: null,
  estimateUsd: 0.8,
  createdAt: "2026-10-31T11:00:00.000Z",
  uncertainMessage:
    "Job j-20261031-nid999 may exist at kie, but no task id came back. Do not resubmit. Check the provider's task log, then record what happened:\n" +
    "  kie job resolve j-20261031-nid999 --task <task id>     (it exists; rejoin it)\n" +
    "  kie job resolve j-20261031-nid999 --not-created        (it does not; release the hold)",
});

const jobs = () => [
  NO_ID,
  job({
    id: "j-20261031-unc111",
    state: "uncertain",
    upstreamTaskId: "task-9",
    createdAt: "2026-10-31T10:30:00.000Z",
    uncertainMessage: "Job may still be running.",
  }),
  job(),
  job({ id: "j-20261025-old000", run: "other", day: "2026-10-25", actualUsd: 0.25, costSource: "estimate", createdAt: "2026-10-25T09:00:00.000Z" }),
];

function setup(table: Record<string, (init?: RequestInit) => unknown> = {}) {
  const fetch = vi.fn(routes({ "/api/spend": () => spend(), "/api/jobs": () => jobs(), ...table }));
  vi.stubGlobal("fetch", fetch);
  render(<SpendScreen />);
  return fetch;
}

/** One row per job; the line under a row with a note or resolve commands is not counted. */
const rows = () =>
  within(screen.getByRole("table", { name: "Jobs" }))
    .getAllByRole("row")
    .filter((r) => r.hasAttribute("data-state"));

describe("niceMax and resolveCommands", () => {
  test("niceMax rounds the tallest day up to a clean axis top", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(2.1)).toBe(2.5);
    expect(niceMax(0.34)).toBe(0.5);
    expect(niceMax(7)).toBe(10);
  });

  test("resolveCommands takes the kie job resolve lines out of core's message", () => {
    expect(resolveCommands(NO_ID.uncertainMessage!)).toEqual([
      "kie job resolve j-20261031-nid999 --task <task id>",
      "kie job resolve j-20261031-nid999 --not-created",
    ]);
    expect(resolveCommands("Job may still be running.")).toEqual([]);
  });
});

describe("SpendScreen", () => {
  test("shows today's spend against the daily cap, in mono", async () => {
    setup();
    const today = await screen.findByRole("region", { name: "Today" });
    expect(within(today).getByText("$2.10")).toHaveClass("mono");
    expect(within(today).getByText("of $10.00")).toBeInTheDocument();
    expect(within(today).getByText("$7.90 left")).toBeInTheDocument();
  });

  test("draws one bar per day, each named for screen readers, with the value on focus and a table view", async () => {
    setup();
    const chart = await screen.findByRole("group", { name: "Spend per day, last 14 days" });
    const bars = within(chart).getAllByRole("button");
    expect(bars).toHaveLength(14);
    expect(bars[13]).toHaveAccessibleName("2026-10-31: $2.10");
    fireEvent.focus(bars[13]);
    expect(within(chart).getByRole("tooltip")).toHaveTextContent("$2.10");
    const table = screen.getByRole("table", { name: "Spend per day" });
    expect(within(table).getAllByRole("row")).toHaveLength(15);
  });

  test("lists every job with its time, model, cost, cost source, state and film", async () => {
    setup();
    await waitFor(() => expect(rows()).toHaveLength(4));
    const row = rows()[2];
    expect(within(row).getByText("seedance-2-5")).toHaveClass("mono");
    expect(within(row).getByText("$0.50")).toHaveClass("mono");
    expect(within(row).getByText("task-record")).toBeInTheDocument();
    expect(within(row).getByText("succeeded")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "zed" })).toHaveAttribute("href", "#/films/zed");
  });

  test("filters the jobs by film, and by day from the filter or a bar", async () => {
    setup();
    await waitFor(() => expect(rows()).toHaveLength(4));
    fireEvent.change(screen.getByLabelText("Film"), { target: { value: "other" } });
    expect(rows()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Film"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "2026-10-25: $1.20" }));
    expect(screen.getByLabelText("Day")).toHaveValue("2026-10-25");
    expect(rows()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: "" } });
    expect(rows()).toHaveLength(4);
  });

  test("Check again reads an uncertain job's status once and says what it found", async () => {
    const fetch = setup({
      "/api/jobs/j-20261031-unc111/check": () => ({ outcome: "pending", following: false, message: "Still running at kie.", job: jobs()[1] }),
    });
    await waitFor(() => expect(rows()).toHaveLength(4));
    fireEvent.click(within(rows()[1]).getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Still running at kie.")).toBeInTheDocument();
    expect(fetch.mock.calls.find(([p]) => String(p) === "/api/jobs/j-20261031-unc111/check")?.[1]?.method).toBe("POST");
    expect(within(rows()[0]).queryByRole("button", { name: "Check again" })).toBeNull();
  });

  test("an uncertain job with no task id shows core's message and copies each resolve command", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setup();
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(screen.getByText(/no task id came back/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy kie job resolve j-20261031-nid999 --not-created" }));
    expect(writeText).toHaveBeenCalledWith("kie job resolve j-20261031-nid999 --not-created");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  test("job and spend events keep the screen live", async () => {
    setup();
    await waitFor(() => expect(rows()).toHaveLength(4));
    act(() => emitForTests({ event: "job", data: job({ id: "j-20261031-new777", createdAt: "2026-10-31T12:00:00.000Z", model: "kling-3" }) }));
    expect(within(rows()[0]).getByText("kling-3")).toBeInTheDocument();
    act(() => emitForTests({ event: "spend", data: spend({ spentUsd: 3, availableUsd: 7 }) }));
    expect(within(screen.getByRole("region", { name: "Today" })).getByText("$3.00")).toBeInTheDocument();
  });
});
```

Modify `web/src/app/App.test.tsx` with this change:

```diff
--- a/web/src/app/App.test.tsx
+++ b/web/src/app/App.test.tsx
@@ -25,7 +25,8 @@ describe("App", () => {
     window.location.hash = "#/spend";
     render(<App />);
     expect(screen.getByRole("heading", { name: "Spend" })).toBeInTheDocument();
-    expect(screen.getByText("Daily totals and every job will show here.")).toBeInTheDocument();
+    expect(screen.getByRole("table", { name: "Jobs" })).toBeInTheDocument();
+    expect(screen.queryByText("Daily totals and every job will show here.")).toBeNull();
   });
 
   test("#/films/<name> opens that film's page", async () => {
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run src/spend src/app/App.test.tsx`
Expected: FAIL. `SpendScreen.test.tsx` does not load (`Failed to resolve import "./SpendScreen"`). `App.test.tsx`: 1 of 5 fails, `Unable to find an accessible element with the role "table" and name "Jobs"`.

- [ ] **Step 3: Implement**

Modify `web/src/app/App.tsx` with this change:

```diff
--- a/web/src/app/App.tsx
+++ b/web/src/app/App.tsx
@@ -7,10 +7,10 @@ import { StudioScreen } from "../studio/StudioScreen";
 import { LibraryScreen } from "../library/LibraryScreen";
 import { PresetsScreen } from "../presets/PresetsScreen";
 import { FilmsScreen } from "../films/FilmsScreen";
+import { SpendScreen } from "../spend/SpendScreen";
 import "./App.css";
 
 const LATER = {
-  spend: ["Spend", "Daily totals and every job will show here."],
   settings: ["Settings", "Chat connection, limits and provider keys will show here."],
 } as const;
 
@@ -19,6 +19,7 @@ function Screen({ tab, rest }: { tab: TabId; rest: string[] }) {
   if (tab === "library") return <LibraryScreen />;
   if (tab === "presets") return <PresetsScreen />;
   if (tab === "films") return <FilmsScreen slug={rest[0]} />;
+  if (tab === "spend") return <SpendScreen />;
   const [title, next] = LATER[tab];
   return <Placeholder title={title} next={next} />;
 }
```

Create `web/src/spend/SpendScreen.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { CheckResult, JobView, SpendView } from "../api/types";
import { onStudioEvent } from "../app/useStudio";
import { takeCost, usd } from "../studio/format";
import { mergeJob, mergeJobs } from "../studio/useJobs";
import "./spend.css";

/** A clean top for the y axis: the tallest day rounded up to 1, 2, 2.5 or 5 of its power of ten. */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= max - 1e-9)!;
  return Math.round(step * power * 1e6) / 1e6;
}

/** The `kie job resolve` commands in core's message for an uncertain job with no task id. */
export function resolveCommands(message: string): string[] {
  return [...message.matchAll(/^\s*(kie job resolve \S+ (?:--task <task id>|--not-created))/gm)].map((m) => m[1]);
}

const time = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const CHECKABLE = new Set(["submitted", "uncertain"]);

function Today({ spend }: { spend: SpendView }) {
  const share = spend.capUsd > 0 ? Math.min(1, spend.spentUsd / spend.capUsd) : 1;
  return (
    <section className="spend-today" aria-labelledby="spend-today">
      <h2 id="spend-today">Today</h2>
      <p className="spend-today__figure">
        <span className="mono">{usd(spend.spentUsd)}</span> <span className="spend-today__of">of {usd(spend.capUsd)}</span>
      </p>
      <div className="spend-today__bar" aria-hidden="true">
        <span style={{ transform: `scaleX(${share})` }} />
      </div>
      <p className="spend-today__note">
        <span className="mono">{usd(spend.availableUsd)} left</span>
        {" · "}per job {spend.perJobUsd != null ? <span className="mono">{usd(spend.perJobUsd)}</span> : "no limit"}
      </p>
      {spend.unsettled > 0 && (
        <p className="spend-today__note">{spend.unsettled === 1 ? "1 job is" : `${spend.unsettled} jobs are`} still settling; their holds count until then.</p>
      )}
      <p className="spend-today__hint">
        Change the limits in <a href="#/settings">Settings</a>.
      </p>
    </section>
  );
}

function DayChart({ days, picked, onPick }: { days: SpendView["days"]; picked: string; onPick: (day: string) => void }) {
  const [shown, setShown] = useState<number | null>(null);
  const top = niceMax(Math.max(0, ...days.map((d) => d.usd)));
  const ticks = [top, top / 2, 0];
  return (
    <section className="spend-chart" aria-labelledby="spend-chart">
      <h2 id="spend-chart">Last 14 days</h2>
      <div className="spend-chart__frame">
        <div className="spend-chart__axis" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="mono">
              {usd(t)}
            </span>
          ))}
        </div>
        <div className="spend-chart__plot" role="group" aria-label="Spend per day, last 14 days" onPointerLeave={() => setShown(null)}>
          {ticks.map((t) => (
            <span key={t} className="spend-chart__grid" style={{ bottom: `${(t / top) * 100}%` }} aria-hidden="true" />
          ))}
          {days.map((d, i) => (
            <button
              key={d.day}
              type="button"
              className="spend-chart__day"
              aria-label={`${d.day}: ${usd(d.usd)}`}
              aria-pressed={picked === d.day}
              onPointerEnter={() => setShown(i)}
              onFocus={() => setShown(i)}
              onBlur={() => setShown(null)}
              onClick={() => onPick(picked === d.day ? "" : d.day)}
            >
              <span className="spend-chart__bar" style={{ height: d.usd > 0 ? `max(2px, ${(d.usd / top) * 100}%)` : 0 }} />
              <span className="spend-chart__label mono" aria-hidden="true">
                {d.day.slice(8)}
              </span>
            </button>
          ))}
          {shown != null && days[shown] && (
            <div role="tooltip" className="spend-chart__tip" style={{ left: `${((shown + 0.5) / days.length) * 100}%` }}>
              <strong className="mono">{usd(days[shown].usd)}</strong>
              <span className="mono">{days[shown].day}</span>
            </div>
          )}
        </div>
      </div>
      <details className="spend-chart__table">
        <summary>Show as a table</summary>
        <table aria-label="Spend per day">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Spent</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day}>
                <td className="mono">{d.day}</td>
                <td className="mono">{usd(d.usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="resolve">
      <code className="mono">{command}</code>
      <button
        type="button"
        className="button button--quiet"
        aria-label={`Copy ${command}`}
        onClick={() =>
          navigator.clipboard
            ?.writeText(command)
            .then(() => setCopied(true))
            .catch(() => {})
        }
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

function JobRow({ job }: { job: JobView }) {
  const [note, setNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const canCheck = CHECKABLE.has(job.state) && job.upstreamTaskId != null;
  const commands = job.state === "uncertain" && !job.upstreamTaskId && job.uncertainMessage ? resolveCommands(job.uncertainMessage) : [];

  async function check() {
    setChecking(true);
    setNote(null);
    try {
      setNote((await api<CheckResult>(`/api/jobs/${job.id}/check`, { method: "POST" })).message);
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <tr data-state={job.state}>
        <td className="mono">{time(job.createdAt)}</td>
        <td className="mono">{job.model}</td>
        <td className="mono jobs__cost">{takeCost(job)}</td>
        <td className="mono jobs__source">{job.costSource}</td>
        <td className="jobs__state">{job.state}</td>
        <td>
          <a className="mono" href={`#/films/${encodeURIComponent(job.run)}`}>
            {job.run}
          </a>
        </td>
        <td>
          {canCheck && (
            <button type="button" className="button button--quiet" disabled={checking} onClick={check}>
              Check again
            </button>
          )}
        </td>
      </tr>
      {(note || commands.length > 0) && (
        <tr className="jobs__more">
          <td colSpan={7}>
            {note && <p className="jobs__note">{note}</p>}
            {commands.length > 0 && (
              <>
                <pre className="jobs__message">{job.uncertainMessage}</pre>
                {commands.map((c) => (
                  <CopyCommand key={c} command={c} />
                ))}
              </>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function SpendScreen() {
  const [spend, setSpend] = useState<SpendView | null>(null);
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [film, setFilm] = useState("");
  const [day, setDay] = useState("");

  useEffect(() => {
    const load = () => {
      api<SpendView>("/api/spend")
        .then(setSpend)
        .catch(() => {});
      api<JobView[]>("/api/jobs?limit=1000")
        .then((list) => setJobs((held) => mergeJobs(held, list)))
        .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
    };
    load();
    return onStudioEvent((e) => {
      if (e.event === "hello") load();
      if (e.event === "spend") setSpend(e.data);
      if (e.event === "job") setJobs((prev) => mergeJob(prev, e.data));
    });
  }, []);

  const films = [...new Set(jobs.map((j) => j.run))].sort();
  const days = [...new Set(jobs.map((j) => j.day).filter((d): d is string => !!d))].sort().reverse();
  const shown = jobs.filter((j) => (!film || j.run === film) && (!day || j.day === day));

  return (
    <div className="spend">
      <header className="spend__head">
        <h1>Spend</h1>
      </header>
      {spend && (
        <div className="spend__top">
          <Today spend={spend} />
          <DayChart days={spend.days} picked={day} onPick={setDay} />
        </div>
      )}
      <section className="jobs" aria-labelledby="jobs-title">
        <div className="jobs__head">
          <h2 id="jobs-title">Jobs</h2>
          <label htmlFor="jobs-film">Film</label>
          <select id="jobs-film" value={film} onChange={(e) => setFilm(e.target.value)}>
            <option value="">All films</option>
            {films.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <label htmlFor="jobs-day">Day</label>
          <select id="jobs-day" value={day} onChange={(e) => setDay(e.target.value)}>
            <option value="">All days</option>
            {[...new Set([...days, ...(day ? [day] : [])])].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <span className="jobs__count mono">{shown.length === 1 ? "1 job" : `${shown.length} jobs`}</span>
        </div>
        {error && (
          <p className="jobs__error" role="alert">
            {error}
          </p>
        )}
        <table className="jobs__table" aria-label="Jobs">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Model</th>
              <th scope="col">Cost</th>
              <th scope="col">Cost source</th>
              <th scope="col">State</th>
              <th scope="col">Film</th>
              <th scope="col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {shown.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </tbody>
        </table>
        {!shown.length && !error && <p className="jobs__none">No jobs match.</p>}
      </section>
    </div>
  );
}
```

Create `web/src/spend/spend.css`:

```css
/* Spend: today against the cap, 14 days of bars, then every job. Tokens only.
   Amber marks money: the meter, the bars and the cost column. Text stays in text tokens. */

.spend { display: flex; flex-direction: column; gap: var(--space-5); }
.spend__head h1 { margin: 0; font-size: var(--text-xl); font-weight: 600; }
.spend__top { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: var(--space-4); align-items: stretch; }
.spend h2 { margin: 0; font-size: var(--text-xs); font-weight: 500; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.06em; }

.spend-today, .spend-chart {
  display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4);
  border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-1);
}
.spend-today__figure { margin: 0; display: flex; align-items: baseline; gap: var(--space-2); }
.spend-today__figure .mono { font-size: 32px; color: var(--text); font-weight: 500; }
.spend-today__of { color: var(--text-2); font-size: var(--text-md); }
.spend-today__bar { height: 6px; border-radius: 3px; background: var(--surface-3); overflow: hidden; }
.spend-today__bar span { display: block; height: 100%; background: var(--accent); transform-origin: left; transition: transform 250ms var(--ease-out); }
.spend-today__note { margin: 0; color: var(--text-2); font-size: var(--text-sm); }
.spend-today__hint { margin: auto 0 0; color: var(--text-3); font-size: var(--text-xs); }
.spend-today__hint a { color: var(--text-2); }

.spend-chart__frame { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--space-2); height: 180px; padding-bottom: 20px; }
.spend-chart__axis { display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end; color: var(--text-3); font-size: var(--text-xs); margin: -7px 0; }
.spend-chart__plot { position: relative; display: grid; grid-template-columns: repeat(14, minmax(0, 1fr)); align-items: end; border-bottom: 1px solid var(--line); }
.spend-chart__grid { position: absolute; left: 0; right: 0; height: 1px; background: var(--line); pointer-events: none; }
.spend-chart__day {
  position: relative; height: 100%; display: flex; align-items: flex-end; justify-content: center;
  padding: 0; border: 0; background: transparent; cursor: pointer; border-radius: var(--radius-sm);
}
.spend-chart__day:hover, .spend-chart__day:focus-visible { background: var(--surface-2); }
.spend-chart__day[aria-pressed="true"] { background: var(--surface-3); }
.spend-chart__bar { display: block; width: min(24px, 60%); background: var(--accent); border-radius: 4px 4px 0 0; }
.spend-chart__day:hover .spend-chart__bar, .spend-chart__day:focus-visible .spend-chart__bar { filter: brightness(1.15); }
.spend-chart__label { position: absolute; bottom: -20px; left: 0; right: 0; text-align: center; font-size: var(--text-xs); color: var(--text-3); }
.spend-chart__tip {
  position: absolute; top: 0; transform: translateX(-50%); pointer-events: none; z-index: 1;
  display: flex; flex-direction: column; gap: 2px; padding: var(--space-1) var(--space-2);
  background: var(--surface-3); border: 1px solid var(--line); border-radius: var(--radius-sm); white-space: nowrap;
}
.spend-chart__tip strong { color: var(--text); font-size: var(--text-sm); }
.spend-chart__tip span { color: var(--text-2); font-size: var(--text-xs); }
.spend-chart__table summary { color: var(--text-2); font-size: var(--text-xs); cursor: pointer; }
.spend-chart__table table { margin-top: var(--space-2); border-collapse: collapse; font-size: var(--text-xs); }
.spend-chart__table th, .spend-chart__table td { padding: 2px var(--space-3) 2px 0; text-align: left; }
.spend-chart__table th { color: var(--text-3); font-weight: 500; }

.jobs { display: flex; flex-direction: column; gap: var(--space-2); }
.jobs__head { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; font-size: var(--text-sm); }
.jobs__head h2 { margin-right: var(--space-3); }
.jobs__head label { color: var(--text-2); }
.jobs__head select {
  background: var(--surface-2); color: var(--text); border: 1px solid var(--line); border-radius: var(--radius-sm);
  padding: 4px var(--space-2); font-size: var(--text-sm);
}
.jobs__count { margin-left: auto; color: var(--text-2); font-size: var(--text-xs); }
.jobs__error { margin: 0; color: var(--bad-ink); }
.jobs__none { margin: 0; color: var(--text-2); font-size: var(--text-sm); }
.jobs__table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.jobs__table th { text-align: left; font-size: var(--text-xs); font-weight: 500; color: var(--text-3); padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--line); }
.jobs__table td { padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--line); vertical-align: middle; }
.jobs__table td.mono { font-size: var(--text-xs); white-space: nowrap; }
.jobs__table a { color: var(--text); }
.jobs__cost { color: var(--accent); }
.jobs__source { color: var(--text-2); }
.jobs__state { color: var(--text-2); font-size: var(--text-xs); }
tr[data-state="uncertain"] .jobs__state, tr[data-state="failed-unconfirmed"] .jobs__state { color: var(--warn); }
tr[data-state="failed-charged"] .jobs__state { color: var(--bad-ink); }
.jobs__more td { background: var(--surface-1); }
.jobs__note { margin: 0; color: var(--text-2); font-size: var(--text-xs); }
.jobs__message { margin: 0 0 var(--space-2); font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-2); white-space: pre-wrap; }
.resolve { display: flex; align-items: center; gap: var(--space-2); }
.resolve code { font-size: var(--text-xs); color: var(--text); }

@media (max-width: 900px) {
  .spend__top { grid-template-columns: minmax(0, 1fr); }
  .jobs__table { display: block; overflow-x: auto; }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run && npx tsc -p .`
Expected: 20 files and 120 tests pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/App.test.tsx web/src/app/App.tsx web/src/spend/SpendScreen.test.tsx web/src/spend/SpendScreen.tsx web/src/spend/spend.css
git diff --cached --stat
git commit -m "Show spend in the studio: today, 14 days and every job

Check again reads a job once; an uncertain job without a task id offers
core's kie job resolve commands to copy.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 15: Settings screen

**Files:**
- Modify: `web/src/app/App.css`
- Modify: `web/src/app/App.test.tsx` (test)
- Modify: `web/src/app/App.tsx`
- Delete: `web/src/app/Placeholder.tsx`
- Create: `web/src/settings/SettingsScreen.test.tsx` (test)
- Create: `web/src/settings/SettingsScreen.tsx`
- Create: `web/src/settings/settings.css`

The Settings tab, the last placeholder. Spending limits: the daily cap and per-job limit (empty means none) with the file they are saved in; the page refuses bad amounts before sending, sends the values it last showed as `was`, and on 409 says the limits changed elsewhere and shows what is saved now, so the next save is based on it. Providers: key found or no key, the variable and file to set it in, and a sign-up link when missing; never the key. "Run kie doctor" runs only on click and lists core's checks with ok, warn, FAIL or note tags. Chat keeps a short placeholder for Plan 8. With every tab built, `Placeholder.tsx` and its styles go.

- [ ] **Step 1: Write the failing tests**

Create `web/src/settings/SettingsScreen.test.tsx`:

```tsx
import { describe, test, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SettingsScreen } from "./SettingsScreen";
import { routes, settings } from "../test-fixtures";

function setup(table: Record<string, (init?: RequestInit) => unknown> = {}) {
  const fetch = vi.fn(routes({ "/api/settings": () => settings(), ...table }));
  vi.stubGlobal("fetch", fetch);
  render(<SettingsScreen />);
  return fetch;
}

const calls = (fetch: ReturnType<typeof vi.fn>, path: string) => fetch.mock.calls.filter(([p]) => String(p) === path);
const lastBody = (fetch: ReturnType<typeof vi.fn>, path: string) => JSON.parse(String(calls(fetch, path).at(-1)![1]!.body));

describe("SettingsScreen: limits", () => {
  test("shows the saved limits and the file they live in", async () => {
    setup();
    expect(await screen.findByLabelText("Daily cap")).toHaveValue(10);
    expect(screen.getByLabelText("Per-job limit")).toHaveValue(null);
    expect(screen.getByText("/Users/x/.config/kie/limits.json")).toHaveClass("mono");
    expect(screen.getByRole("button", { name: "Save limits" })).toBeDisabled();
  });

  test("saves new limits with the values the page showed, so a stale page cannot undo a change", async () => {
    const fetch = setup({ "/api/settings/limits": () => ({ limits: { dailyUsd: 5, perJobUsd: 1.5, file: "/Users/x/.config/kie/limits.json" } }) });
    fireEvent.change(await screen.findByLabelText("Daily cap"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Per-job limit"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limits" }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(calls(fetch, "/api/settings/limits")[0][1]!.method).toBe("PUT");
    expect(lastBody(fetch, "/api/settings/limits")).toEqual({ dailyUsd: 5, perJobUsd: 1.5, was: { dailyUsd: 10, perJobUsd: null } });
  });

  test("refuses a bad amount before sending anything", async () => {
    const fetch = setup();
    fireEvent.change(await screen.findByLabelText("Daily cap"), { target: { value: "-1" } });
    expect(screen.getByText("The daily cap is a dollar amount of 0 or more.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save limits" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Daily cap"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Per-job limit"), { target: { value: "0" } });
    expect(screen.getByText("The per-job limit is a dollar amount above 0. Leave it empty for none.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save limits" })).toBeDisabled();
    expect(calls(fetch, "/api/settings/limits")).toHaveLength(0);
  });

  test("when the limits changed elsewhere, says so, shows what is saved now, and the next save is based on it", async () => {
    let n = 0;
    const fetch = setup({
      "/api/settings/limits": () =>
        ++n === 1
          ? new Response(
              JSON.stringify({
                error: {
                  code: 0,
                  message: "The limits changed since this page loaded. Check the values now saved, then save again.",
                  current: { dailyUsd: 3, perJobUsd: 0.5, file: "/Users/x/.config/kie/limits.json" },
                },
              }),
              { status: 409 },
            )
          : { limits: { dailyUsd: 6, perJobUsd: null, file: "/Users/x/.config/kie/limits.json" } },
    });
    fireEvent.change(await screen.findByLabelText("Daily cap"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limits" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The limits changed since this page loaded.");
    expect(alert).toHaveTextContent("Saved now: daily cap $3.00, per job $0.50.");
    fireEvent.click(screen.getByRole("button", { name: "Save limits" }));
    await screen.findByText("Saved.");
    expect(lastBody(fetch, "/api/settings/limits").was).toEqual({ dailyUsd: 3, perJobUsd: 0.5 });
  });
});

describe("SettingsScreen: providers, doctor and chat", () => {
  test("says whether each provider's key is set and where it goes, never the key", async () => {
    setup();
    const list = await screen.findByRole("list", { name: "Providers" });
    const [kie, wave] = within(list).getAllByRole("listitem");
    expect(within(kie).getByText("Key found")).toBeInTheDocument();
    expect(within(wave).getByText("No key")).toBeInTheDocument();
    expect(within(wave).getByText("WAVESPEED_API_KEY")).toHaveClass("mono");
    expect(within(wave).getByText("~/.config/wavespeed/key")).toHaveClass("mono");
    expect(within(wave).getByRole("link", { name: "Get a WaveSpeed key" })).toHaveAttribute("href", "https://wavespeed.ai");
  });

  test("runs kie doctor only when asked, and lists what it found", async () => {
    const fetch = setup({
      "/api/settings/doctor": () => ({
        checks: [
          { level: "ok", text: "node 22.1.0" },
          { level: "fail", text: "kie.ai: balance check failed (HTTP 401)" },
        ],
        failures: 1,
        ranAt: "2026-10-31T10:00:00.000Z",
      }),
    });
    await screen.findByLabelText("Daily cap");
    expect(calls(fetch, "/api/settings/doctor")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Run kie doctor" }));
    const checks = await screen.findByRole("list", { name: "Doctor checks" });
    expect(within(checks).getAllByRole("listitem")).toHaveLength(2);
    expect(within(checks).getByText("kie.ai: balance check failed (HTTP 401)")).toBeInTheDocument();
    expect(screen.getByText("1 problem found.")).toBeInTheDocument();
    await waitFor(() => expect(calls(fetch, "/api/settings/doctor")[0][1]!.method).toBe("POST"));
  });

  test("keeps a place for the chat connection", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByText(/arrives with the chat build/)).toBeInTheDocument();
  });
});
```

Modify `web/src/app/App.test.tsx` with this change:

```diff
--- a/web/src/app/App.test.tsx
+++ b/web/src/app/App.test.tsx
@@ -16,17 +16,22 @@ describe("App", () => {
     expect(screen.getByRole("link", { name: "Studio" })).toHaveAttribute("aria-current", "page");
   });
 
-  test("each built tab shows its screen; the rest keep their placeholder", async () => {
+  test("each tab shows its screen", async () => {
     vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));
     window.location.hash = "#/presets";
     const { unmount } = render(<App />);
     expect(screen.getByRole("heading", { name: "Presets" })).toBeInTheDocument();
     unmount();
     window.location.hash = "#/spend";
-    render(<App />);
+    const second = render(<App />);
     expect(screen.getByRole("heading", { name: "Spend" })).toBeInTheDocument();
     expect(screen.getByRole("table", { name: "Jobs" })).toBeInTheDocument();
-    expect(screen.queryByText("Daily totals and every job will show here.")).toBeNull();
+    second.unmount();
+    window.location.hash = "#/settings";
+    render(<App />);
+    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
+    expect(screen.getByRole("heading", { name: "Chat" })).toBeInTheDocument();
+    expect(screen.queryByText("Chat connection, limits and provider keys will show here.")).toBeNull();
   });
 
   test("#/films/<name> opens that film's page", async () => {
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run src/settings src/app/App.test.tsx`
Expected: FAIL. `SettingsScreen.test.tsx` does not load (`Failed to resolve import "./SettingsScreen"`). `App.test.tsx`: 1 of 5 fails, `Unable to find an accessible element with the role "heading" and name "Chat"`.

- [ ] **Step 3: Implement**

Modify `web/src/app/App.css` with this change:

```diff
--- a/web/src/app/App.css
+++ b/web/src/app/App.css
@@ -45,8 +45,6 @@
 .app__main { flex: 1; min-height: 0; overflow-y: auto; padding: var(--space-6) var(--space-4) var(--space-5); }
 /* The Studio scrolls its feed itself, so the prompt bar stays on screen. */
 .app__main[data-tab="studio"] { overflow: hidden; padding-top: var(--space-4); padding-bottom: var(--space-4); }
-.placeholder h1 { font-size: var(--text-xl); font-weight: 600; line-height: 1.2; margin: 0 0 var(--space-2); }
-.placeholder p { color: var(--text-2); margin: 0; max-width: 65ch; }
 
 /* Narrow windows: brand and spend share the first row, the tabs scroll on their own row. */
 @media (max-width: 760px) {
```

Modify `web/src/app/App.tsx` with this change:

```diff
--- a/web/src/app/App.tsx
+++ b/web/src/app/App.tsx
@@ -1,6 +1,5 @@
 import { Nav } from "./Nav";
 import { SpendMeter } from "./SpendMeter";
-import { Placeholder } from "./Placeholder";
 import { parseRoute, type TabId } from "./route";
 import { useRoute, useStudio } from "./useStudio";
 import { StudioScreen } from "../studio/StudioScreen";
@@ -8,20 +7,16 @@ import { LibraryScreen } from "../library/LibraryScreen";
 import { PresetsScreen } from "../presets/PresetsScreen";
 import { FilmsScreen } from "../films/FilmsScreen";
 import { SpendScreen } from "../spend/SpendScreen";
+import { SettingsScreen } from "../settings/SettingsScreen";
 import "./App.css";
 
-const LATER = {
-  settings: ["Settings", "Chat connection, limits and provider keys will show here."],
-} as const;
-
 function Screen({ tab, rest }: { tab: TabId; rest: string[] }) {
   if (tab === "studio") return <StudioScreen />;
   if (tab === "library") return <LibraryScreen />;
   if (tab === "presets") return <PresetsScreen />;
   if (tab === "films") return <FilmsScreen slug={rest[0]} />;
   if (tab === "spend") return <SpendScreen />;
-  const [title, next] = LATER[tab];
-  return <Placeholder title={title} next={next} />;
+  return <SettingsScreen />;
 }
 
 export function App() {
```

Delete `web/src/app/Placeholder.tsx` (nothing imports it any more):

```bash
git rm web/src/app/Placeholder.tsx
```

Create `web/src/settings/SettingsScreen.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { DoctorResult, LimitsView, SettingsView } from "../api/types";
import { usd } from "../studio/format";
import "./settings.css";

type Limits = Pick<LimitsView, "dailyUsd" | "perJobUsd">;

/** The form's text as limits, or the sentence saying what is wrong. Empty per-job means none. */
export function readLimitsForm(cap: string, perJob: string): { limits: Limits; problem: null } | { limits: null; problem: string } {
  const daily = cap.trim() === "" ? NaN : Number(cap);
  if (!Number.isFinite(daily) || daily < 0) return { limits: null, problem: "The daily cap is a dollar amount of 0 or more." };
  if (perJob.trim() === "") return { limits: { dailyUsd: daily, perJobUsd: null }, problem: null };
  const each = Number(perJob);
  if (!Number.isFinite(each) || each <= 0) return { limits: null, problem: "The per-job limit is a dollar amount above 0. Leave it empty for none." };
  return { limits: { dailyUsd: daily, perJobUsd: each }, problem: null };
}

const describe = (l: Limits) => `daily cap ${usd(l.dailyUsd)}, per job ${l.perJobUsd != null ? usd(l.perJobUsd) : "no limit"}`;
const TAG = { ok: "ok", warn: "warn", fail: "FAIL", info: "note" } as const;

function LimitsForm({ initial }: { initial: LimitsView }) {
  // What the file held when last read; sent as `was` so a stale page is refused.
  const [saved, setSaved] = useState<Limits>({ dailyUsd: initial.dailyUsd, perJobUsd: initial.perJobUsd });
  const [cap, setCap] = useState(String(initial.dailyUsd));
  const [perJob, setPerJob] = useState(initial.perJobUsd != null ? String(initial.perJobUsd) : "");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const form = readLimitsForm(cap, perJob);
  const changed = form.limits != null && (form.limits.dailyUsd !== saved.dailyUsd || form.limits.perJobUsd !== saved.perJobUsd);

  async function save() {
    if (!form.limits) return;
    setSending(true);
    setNote(null);
    setError(null);
    try {
      const r = await api<{ limits: LimitsView }>("/api/settings/limits", { method: "PUT", body: { ...form.limits, was: saved } });
      setSaved({ dailyUsd: r.limits.dailyUsd, perJobUsd: r.limits.perJobUsd });
      setNote("Saved.");
    } catch (e) {
      const current = e instanceof ApiError ? (e.detail.current as LimitsView | undefined) : undefined;
      if (current) setSaved({ dailyUsd: current.dailyUsd, perJobUsd: current.perJobUsd });
      const message = e instanceof ApiError ? e.message : String(e);
      setError(current ? `${message} Saved now: ${describe(current)}.` : message);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="settings__section" aria-labelledby="limits-title">
      <h2 id="limits-title">Spending limits</h2>
      <p className="settings__hint">
        Every paid job checks these before it is sent. Saved in <span className="mono">{initial.file}</span>, the same file{" "}
        <span className="mono">kie limits</span> writes.
      </p>
      <div className="settings__grid">
        <label htmlFor="limit-daily">Daily cap</label>
        <span className="settings__money">
          <span aria-hidden="true">$</span>
          <input id="limit-daily" className="mono" type="number" min="0" step="0.5" value={cap} onChange={(e) => setCap(e.target.value)} />
        </span>
        <label htmlFor="limit-job">Per-job limit</label>
        <span className="settings__money">
          <span aria-hidden="true">$</span>
          <input
            id="limit-job"
            className="mono"
            type="number"
            min="0"
            step="0.25"
            placeholder="none"
            value={perJob}
            onChange={(e) => setPerJob(e.target.value)}
          />
        </span>
      </div>
      {form.problem && <p className="settings__problem">{form.problem}</p>}
      <div className="settings__actions">
        <button type="button" className="button" disabled={!changed || sending} onClick={save}>
          Save limits
        </button>
        {note && <span className="settings__note">{note}</span>}
      </div>
      {error && (
        <p className="settings__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function Doctor() {
  const [result, setResult] = useState<DoctorResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      setResult(await api<DoctorResult>("/api/settings/doctor", { method: "POST" }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="settings__section" aria-labelledby="doctor-title">
      <h2 id="doctor-title">Check the setup</h2>
      <p className="settings__hint">
        Runs kie doctor: provider keys, the kie.ai balance and the model catalog. Its one network request is the free balance read; nothing is generated.
      </p>
      <div className="settings__actions">
        <button type="button" className="button" disabled={running} onClick={run}>
          Run kie doctor
        </button>
        {running && <span className="settings__note">Checking…</span>}
      </div>
      {error && (
        <p className="settings__error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <>
          <ul className="doctor" aria-label="Doctor checks">
            {result.checks.map((c, i) => (
              <li key={i} data-level={c.level}>
                <span className="doctor__tag mono">{TAG[c.level]}</span>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
          <p className="settings__note">
            {result.failures === 0 ? "No problems found." : result.failures === 1 ? "1 problem found." : `${result.failures} problems found.`}
          </p>
        </>
      )}
    </section>
  );
}

export function SettingsScreen() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<SettingsView>("/api/settings")
      .then(setView)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  return (
    <div className="settings">
      <header className="settings__head">
        <h1>Settings</h1>
      </header>
      {error && (
        <p className="settings__error" role="alert">
          {error}
        </p>
      )}
      {view && (
        <>
          <LimitsForm initial={view.limits} />
          <section className="settings__section" aria-labelledby="providers-title">
            <h2 id="providers-title">Providers</h2>
            <p className="settings__hint">Keys stay on this computer. The studio only says whether one is set.</p>
            <ul className="providers" aria-label="Providers">
              {view.providers.map((p) => (
                <li key={p.name} className="provider">
                  <span className="provider__name">{p.label}</span>
                  <span className="provider__key" data-ok={p.keyConfigured}>
                    {p.keyConfigured ? "Key found" : "No key"}
                  </span>
                  <span className="provider__where">
                    Set <span className="mono">{p.keyEnv}</span> or put the key in <span className="mono">{p.keyFile}</span>
                  </span>
                  {!p.keyConfigured && (
                    <a className="provider__signup" href={p.signup} target="_blank" rel="noreferrer">
                      Get a {p.label} key
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <Doctor />
        </>
      )}
      <section className="settings__section" aria-labelledby="chat-title">
        <h2 id="chat-title">Chat</h2>
        <p className="settings__hint">Connecting a chat assistant to the studio arrives with the chat build.</p>
      </section>
    </div>
  );
}
```

Create `web/src/settings/settings.css`:

```css
/* Settings: limits, provider keys, kie doctor, and the chat place. Tokens only; no amber here. */

.settings { display: flex; flex-direction: column; gap: var(--space-4); max-width: 760px; }
.settings__head h1 { margin: 0; font-size: var(--text-xl); font-weight: 600; }
.settings__section {
  display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4);
  border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-1); font-size: var(--text-sm);
}
.settings__section h2 { margin: 0; font-size: var(--text-md); font-weight: 600; }
.settings__hint { margin: 0; color: var(--text-2); max-width: 70ch; }
.settings__grid { display: grid; grid-template-columns: max-content max-content; gap: var(--space-2) var(--space-3); align-items: center; }
.settings__grid > label { color: var(--text-2); }
.settings__money { display: inline-flex; align-items: center; gap: var(--space-1); color: var(--text-2); }
.settings__money input {
  width: 8em; background: var(--surface-2); color: var(--text); border: 1px solid var(--line); border-radius: var(--radius-sm);
  padding: 5px var(--space-2); font-size: var(--text-sm);
}
.settings__actions { display: flex; align-items: center; gap: var(--space-3); }
.settings__note { margin: 0; color: var(--text-2); }
.settings__problem { margin: 0; color: var(--warn); }
.settings__error { margin: 0; color: var(--bad-ink); }

.providers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.provider { display: grid; grid-template-columns: 120px 90px minmax(0, 1fr) auto; gap: var(--space-3); align-items: baseline; padding: var(--space-2) 0; border-top: 1px solid var(--line); }
.provider__name { font-weight: 500; }
.provider__key { font-size: var(--text-xs); color: var(--warn); }
.provider__key[data-ok="true"] { color: var(--ok); }
.provider__where { color: var(--text-2); font-size: var(--text-xs); }
.provider__signup { color: var(--text); font-size: var(--text-xs); }

.doctor { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; font-size: var(--text-xs); }
.doctor li { display: grid; grid-template-columns: 3.5em minmax(0, 1fr); gap: var(--space-2); }
.doctor__tag { color: var(--text-3); }
.doctor li[data-level="ok"] .doctor__tag { color: var(--ok); }
.doctor li[data-level="warn"] .doctor__tag { color: var(--warn); }
.doctor li[data-level="fail"] .doctor__tag { color: var(--bad-ink); }

@media (max-width: 760px) {
  .provider { grid-template-columns: minmax(0, 1fr) auto; }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run && npx tsc -p .`
Expected: 21 files and 127 tests pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/App.css web/src/app/App.test.tsx web/src/app/App.tsx web/src/settings/SettingsScreen.test.tsx web/src/settings/SettingsScreen.tsx web/src/settings/settings.css
git diff --cached --stat
git commit -m "Add the studio's Settings: limits, provider keys and kie doctor

Limit writes carry the values the page showed, so a stale page cannot undo
a change made elsewhere. The last placeholder goes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above (the deletion staged by `git rm` included).

---

### Task 16: Full check and a look in the browser

No code. Nothing here spends money: the clips come from ffmpeg's test sources, the jobs are local records written by core's own store, the API key is fake, and the only network request is `kie doctor`'s free balance read, which fails with that key.

- [ ] **Step 1: Every suite, the type check and the build**

Run: `cd web && npm run test:server && npx vitest run && npx tsc -p . && npm run build`
Expected: 170 server tests pass; 21 files and 127 page tests pass; no type errors; Vite prints `built in …`.

Run: `npm test && npm run test:mcp`
Expected: core 298 and MCP 36 pass, 0 fail.

Run: `grep -rn "e""xec(" cli mcp/server.mjs web/server web/src web/tests`
Expected: no output.

- [ ] **Step 2: Throwaway folders, clips and job records**

```bash
export KIE_RUNS_DIR=/private/tmp/studio-p7/runs KIE_LIBRARY_DIR=/private/tmp/studio-p7/library KIE_LIMITS_FILE=/private/tmp/studio-p7/limits.json KIE_API_KEY=not-a-real-key
mkdir -p "$KIE_RUNS_DIR/walk-film" "$KIE_LIBRARY_DIR"
ffmpeg -v error -f lavfi -i testsrc=size=640x360:rate=24:duration=2 -f lavfi -i sine=frequency=440:duration=2 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$KIE_RUNS_DIR/walk-film/out.mp4"
ffmpeg -v error -f lavfi -i testsrc2=size=640x360:rate=24:duration=2 -f lavfi -i sine=frequency=660:duration=2 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$KIE_RUNS_DIR/walk-film/out-2.mp4"
ffmpeg -v error -f lavfi -i sine=frequency=220:duration=5 /private/tmp/studio-p7/bed.wav
```

Save this as `/private/tmp/studio-p7/seed.mjs` (outside the repo; it only writes job records into the throwaway runs folder) and run it from the repo root with `REPO="$PWD" node /private/tmp/studio-p7/seed.mjs`:

```js
// Three local job records: a paid take, an uncertain job with no task id, and an older image.
const { openJobs } = await import(process.env.REPO + "/cli/core/jobs.mjs");
const dir = process.env.KIE_RUNS_DIR + "/.jobs";
const today = openJobs(dir);
const a = today.create({ run: "walk-film", capability: "video", model: "seedance-2", provider: "kie", estimateUsd: 0.56, prompt: "Test pattern", durationS: 2, resolution: "480p" });
today.transition(a.id, "sending");
today.transition(a.id, "submitted", { upstreamTaskId: "walk-task-1" });
today.transition(a.id, "succeeded", { actualUsd: 0.5, costSource: "task-record", artifacts: [process.env.KIE_RUNS_DIR + "/walk-film/out.mp4"] });
const b = today.create({ run: "walk-film", capability: "video", model: "seedance-2", provider: "kie", estimateUsd: 0.8, prompt: "Lost one" });
today.transition(b.id, "sending");
today.transition(b.id, "uncertain", { note: "seeded for the walk-through" });
const past = openJobs(dir, { now: () => new Date(Date.now() - 4 * 86400000) });
const c = past.create({ run: "older-film", capability: "image", model: "nano-banana", provider: "kie", estimateUsd: 0.04 });
past.transition(c.id, "sending");
past.transition(c.id, "submitted", { upstreamTaskId: "walk-task-2" });
past.transition(c.id, "succeeded", { actualUsd: 0.04, costSource: "task-record" });
console.log("seeded", a.id, b.id, c.id);
```

Expected: `seeded j-… j-… j-…`. The uncertain job has no task id, so the server's resume never polls it.

- [ ] **Step 3: Start the studio**

In the same shell: `node web/server/main.mjs --no-open`
Expected: `Studio running at http://127.0.0.1:4317/  (Ctrl-C to stop)` (or the next free port), and no key printed.

- [ ] **Step 4: Click through with the gstack `browse` skill at 1440×900, 1280×800 and 700×900**

Run `browse` from `/private/tmp/studio-p7` so it has no repository `.gitignore` to edit.

- Films: one card, `walk-film`, "2 takes". Open it: two shots with thumbnails; `out.mp4` shows `$0.50` in mono amber; Up on the first and Down on the last are disabled; "2 of 2 shots chosen".
- If the render engine is not installed, the Finish panel says Captions and Text cards are off and shows core's install text; Assemble and Variants stay on. (With `render/node_modules` present, both are on.)
- Upload `/private/tmp/studio-p7/bed.wav` with Add audio ("Added bed.wav. Pick it under Music or Voice-over."), pick it as Music, transition `dissolve`, seconds `0.5`, press Assemble. The task line reads "Assemble · done in 0:01" with `film.mp4`, and Outputs gains `film.mp4` with a player and a Download button.
- Paste two SRT cues into SRT text and press Save captions: "Saved captions.srt: 2 cues, ending at 2.5s." Burn captions follows the render engine's state.
- Variants with the default `film.mp4`, 9:16 and 1:1, blur: `film-9x16.mp4` and `film-1x1.mp4` appear in Outputs. "Video to reframe" still offers `film.mp4`, not the variants.
- Spend: "Today $1.30 of $10.00" (the $0.50 take plus the $0.80 hold of the uncertain job), one job still settling. Hover the last bar: the tooltip reads `$1.30` over the date. Click the bar four days back: Day becomes that date and the table shows 1 job; click it again for all 3. The uncertain row shows core's message and two Copy buttons for the `kie job resolve` commands, and no Check again (it has no task id). Do not press Check again on any other row.
- Settings: limits file `/private/tmp/studio-p7/limits.json`; set the daily cap to 8 and Save limits ("Saved."). In a second shell with the same exports run `node cli/kie.mjs limits --daily 6` (free; it writes only the throwaway file), then set 7 in the page and save: the alert says the limits changed and "Saved now: daily cap $6.00, per job no limit.", and the file still holds 6. Providers show key found or no key, never a key. Run kie doctor: `kie.ai: credit endpoint gave no balance` is the one FAIL (the fake key), "1 problem found."
- At 700px wide the Finish panel and the Spend chart stack under the rest, and nothing overlaps.
- Check the smallest text: `$B js` over all text elements reports 11px at least; amber appears only on the meter, the bars, the shot cost and the Cost column. `grep -c not-a-real-key` on the server's output is 0.

- [ ] **Step 5: Stop the server and clean up**

Ctrl-C, then `rm -rf /private/tmp/studio-p7` and `unset KIE_RUNS_DIR KIE_LIBRARY_DIR KIE_LIMITS_FILE KIE_API_KEY`. `git status --short` shows only `.gstack/` untracked; if `.gitignore` changed, `git checkout -- .gitignore`. Nothing to commit.

---

## Decisions for the reviewer

Places where the spec or core left a choice:

1. **Long-running tools are tracked tasks, not synchronous requests.** Assemble and captions can run for minutes and captions start a headless browser, so each finishing endpoint checks its input, starts a task and answers `{ task }` at once. Core spawns ffmpeg and the render engine as child processes, so the server keeps answering. Progress is `outS`, read with `matchAll` from the `time=` in the stderr core already hands to `onLine`, sent as SSE `task` events (at most once a second while running, always at start and end); `GET /api/tasks?run=` lets a reloaded page catch up. Tasks live in memory (the last 50); their outputs are files on disk, so a restart loses only the progress lines.
2. **One task per film, refused rather than queued.** Two tools in one film could pick the same next free name or rewrite the same record; a second request gets 409 naming the running one, and the page disables the buttons meanwhile. A CLI or MCP run in the same folder is not coordinated with (as before). Re-running variants for the same video and ratio replaces the earlier variant, because core names them that way, exactly as `kie variants` does.
3. **SRT transport is text.** An SRT has no signature for `checkLocalFile` to sniff, core's `parseSrt` gives immediate feedback (cue count, end time, problems), and it is small and often edited. The page pastes it or reads a chosen `.srt` with `File.text()`, then `POST /api/films/:slug/srt` saves it as `captions.srt` or the next free number through `landArtifact`. The caption endpoint accepts only `.srt` files inside the allowed roots.
4. **Music and voice-over are raw uploads with a 200 MB ceiling,** checked as audio by content and moved in with `claimArtifact` (never replacing a file). Core's 30 MB audio limit exists for provider uploads; these files never leave the machine.
5. **Outputs never take a name from the page.** Every tool writes core's next free default name inside the film (`film.mp4`, `captioned.mp4`, `<template>.mp4`; variants beside their source). Inputs are a bare name in the film, a path under the runs folder, or an absolute path, and each goes through `checkLocalFile`/`confinePath` with the allowed roots. Transitions come from a fixed list checked against ffmpeg's xfade list, so nothing from the page reaches a filter graph.
6. **Limits-write protection.** The session key and Host check (Plan 5) stop other websites. A local process can read the key from `index.html`, but a local process can edit `limits.json` directly anyway, so the key is the right boundary. On top, each write carries `was` (the values the page showed); if the file changed (`kie limits`, another tab) the write is refused with 409 and the current values, so a stale page never quietly raises a cap. Writes go only through core's `setDailyLimit` and `setPerJobLimit`. Nothing in the MCP server or a chat path reaches these routes.
7. **Doctor's network use.** `doctor()` makes one request: kie.ai's balance read, a free GET (WaveSpeed has no balance endpoint). The studio runs it only on POST from the "Run kie doctor" button, never on load. Key hints (`abcd…yz`) stay in the CLI's printing; the data has `keyOf` instead, and the server drops it and redacts the text.
8. **Provider keys.** Settings shows found or missing, the variable and the file, and a sign-up link. The key and its hint are never sent; a test checks the response against every provider's real key.
9. **Text cards.** `web/server/templates.mjs` describes each template's props (text, lines, choice, image, json); a test reads the `.tsx` sources so it cannot drift silently. Image props are confined by core's `confineProps`; the confined props are saved as `props-<template>.json` beside core's `render-<template>.json`. Cards are mp4 only (the alpha output stays in the CLI); duration is capped at 60 s.
10. **Shot order** is restored from the last `assembly.json` (core's own record), not a new file; until then takes are oldest first. The page keeps the user's order and choices across reloads. `shot_audio` is accepted by the API but the form leaves it on core's `auto`.
11. **Variants** are offered for the film and takes only; reframing a variant again loses picture.
12. **Spend chart.** One series, so no legend: the heading names it. Columns ≤24px with a 4px rounded top, square at the baseline; hairline grid at 0, half and a clean top; labels in text colours, the bars in amber (the brief's cost colour; the dataviz validator passes its contrast against `--surface-1`, and its lightness-band check is for multi-hue categorical palettes). Each day is a button with its value in its name, a hover and focus tooltip, a click that filters the jobs table, and a table view.
13. **Jobs table** reads `/api/jobs?limit=1000` (the server's cap) and stays live from `job` events. Check again is offered only for submitted or uncertain jobs with an upstream id (one free status read, as in the Studio); an uncertain job without one shows core's `uncertainMessage` and copies each `kie job resolve` command. Resolving stays in the CLI.
14. **Tests.** Assemble and variants run real ffmpeg on one-second clips and skip with "ffmpeg not installed" without it. Captions and cards stub `burnCaptions` and `render`, which need a headless browser.
15. **What core lacked, and where it went:** doctor as data (`doctor()` added to `cli/core/views.mjs`); `confineProps` outside the MCP server (moved to `cli/core/inputs.mjs`); a machine-readable props schema for the templates (`web/server/templates.mjs`, with a drift test); a tool check that reports instead of throwing (the studio wraps `requireFfmpeg` and `requireRemotion`); a file's origin (read from core's default names in `films.mjs`); a job's day and resolve text in the view (`jobView`). Not changed, noted: `setDailyLimit` and `setPerJobLimit` write the file directly rather than through a temp file and rename, and the Settings write calls them one after the other.

---

## Self-review

- **Spec coverage (build order 7-8).** Films list: Tasks 3, 11. Film page with takes in order, up/down: Tasks 3, 11. Assemble with chosen shots, music or voice-over, crossfades, loudness: Tasks 5, 6, 12. Captions with the SRT: Tasks 6, 7, 13. Variants 9:16 and 1:1: Tasks 7, 13. Text cards with the templates' props: Tasks 4, 8, 13. Player and download for each output: Task 11. Tool check with install help: Tasks 4, 12. Spend today against the cap, 14-day bars, jobs table with film and day filters, Check again, `uncertainMessage` with the resolve commands: Tasks 9, 14. Settings limits with validation and stale-write guard, key presence, doctor on demand, chat placeholder: Tasks 1, 9, 15.
- **Required tests.** Paths confined and hidden folders refused: Task 5 (shots), 6 (audio by content), 7 (SRT), 8 (props). Outputs stay in the run: Tasks 5, 7, 8. Missing tool refused with core's message: Tasks 4, 5, 7. One task per film: Tasks 2, 5. Limits validation, 409 on a stale write, no key in any response: Task 9. Each screen's states and the page's refusals: Tasks 11-15.
- **No money, no network.** Server tests run with the throwing `fetch`; `doctor` tests inject the balance reader; page tests stub `fetch`; Task 16 uses a fake key, local job records and ffmpeg test sources, and its one request is the free balance read.
- **Names line up.** `createTasks().start/get/list/idle` (Task 2) are what `finish.mjs` (Tasks 5, 7, 8) and `app.mjs` use. `TaskView`, `FilmDetail`, `FinishInfo`, `SavedAudio`, `SavedSrt`, `SettingsView`, `DoctorResult` (Task 10) match the server's replies in Tasks 2-9. `filesOf` and `useStart` (Task 12) are what the forms in Task 13 use. `mergeJob`/`mergeJobs` (Plan 6) keep the Spend table live.
- **Each task ends green.** Every task was built in this order in a scratch worktree of the branch: each failing step failed as written above and each suite count is the one it printed. Task 16's walk-through was done at 1440, 1280 and 700 pixels wide.
