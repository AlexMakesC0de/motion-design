# Studio Plan 6: Studio, Library and Presets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Studio, Library and Presets tabs work: write a prompt, see core's live price on Generate (or why it is disabled), generate a video or image through `cli/core`, watch the take settle in the feed, open it, reuse it, pull frames, save images to the library, upload assets by drag and drop, and start from a preset.

**Architecture:** New server modules in `web/server/api/` call `cli/core` exactly as `mcp/server.mjs` does (`expandRefs`, `writeRecord`, `submitJob`, `waitJob`, `extractFrames`, `openLibrary`), so pricing, the per-job limit, the daily cap, provider fallback and job states stay in core. Generate answers as soon as the job is submitted; a small in-process follower waits on it, and the existing SSE job events carry the result to the page. On the page, one shared prompt store (a `useSyncExternalStore` module) is filled by the prompt bar, Reuse, the Library and the Presets gallery.

**Tech Stack:** Node ≥20 (ESM, `node:test`), React 19, Vite 8, Vitest 5 with Testing Library (`fireEvent`, no user-event) and jsdom, TypeScript 6. No new dependencies.

Spec: [`docs/superpowers/specs/2026-10-30-studio-web-app-design.md`](../specs/2026-10-30-studio-web-app-design.md), build order steps 4-6 (Studio, Library, Presets). Follows [Plan 5](2026-10-30-plan-5-studio-server-and-shell.md); Plan 7 does Films, Spend and Settings, Plan 8 the chat.

**Repo rules for every task:**
- Work on the `studio-web-app` branch. Never `git stash`. Run `git diff --cached --stat` before each commit and commit only the task's files. Leave the untracked `.gstack/` folder alone.
- End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never run a paid command, and never press Generate in a running studio without Alex's say-so. Tests stub every provider call; `web/tests/helpers.mjs` already replaces `globalThis.fetch` with a function that throws, and page tests stub `fetch` per test.
- A hook blocks any file containing the four letters e-x-e-c followed by an opening parenthesis. Use `String.prototype.match` / `matchAll` and `spawn`/`spawnSync`, never the RegExp method of that name.
- Never print or log the session key or any API key.
- Visual direction B from the spec: colours and sizes come from `web/src/theme/tokens.css` variables only; the mono face (`.mono` or `font-family: var(--font-mono)`) for every number, id and cost; amber (`--accent`) only on Generate, the spend meter and costs; no text under 11px. Target 1280-1440px wide; below 760px the layout stacks.

**How to copy a "Modify" step:** each one is a unified diff against the file as the previous task left it. Apply it by hand, or save the block to a file and run `git apply that-file.diff` from the repo root.

---

## Where things stand

Plan 5 left: `web/server/` (router with the key check and a 1 MB JSON body limit, media with the cookie and Range, SSE events `hello`, `job`, `spend`, `library`, read-only API in `api/look.mjs`), `web/src/` (six-tab shell, spend meter, placeholders) and 66 server tests plus 16 page tests, all green. Core functions this plan uses, all unchanged:

| Core | What this plan relies on |
|---|---|
| `submitJob` (`cli/core/generate.mjs`) | Reserves against the per-job limit and the cap, submits, returns at once. Falls over to the next provider only on a create-time code-4 rejection and marks that job `failedOver`. An ambiguous create (no task id) leaves the job `uncertain` and throws code 5. |
| `waitJob(catalog, store, id, { timeoutMs, deps })` | Polls once before checking its deadline, so `timeoutMs: 1` is exactly one status read. A timeout returns `outcome: "pending"` with "still running after N s". An uncertain job with no upstream id throws code 5 with the `kie job resolve` instruction. |
| `expandRefs`, `writeRecord`, `recordUse` | The same ref handling and records the MCP tools write (`via: "studio"` here). |
| `extractFrames` (`cli/core/frames.mjs`) | The free 8-frame sheet plus first and last frames. |
| `openLibrary` (`cli/core/assets.mjs`) | `KINDS` = character, product, location, style. Images only: `save` checks each with `checkLocalFile(..., { kinds: ["image"] })`. |
| `checkLocalFile`, `confinePath`, `MAX_BYTES` (`cli/core/inputs.mjs`) | Type by content, size per kind (image 30 MB, video 200 MB, audio 30 MB), allowed roots, no hidden path segments under a root. |
| `listPresets`, `listModels`, `estimate` (`cli/core/views.mjs`) | Preset cards, model capabilities, the live price and every refusal reason. |

---

## File map

| File | Responsibility |
|---|---|
| `web/server/http.mjs` (modify) | a route can take the raw request stream (`{ raw: true }`) for uploads |
| `web/server/follow.mjs` | background waiter for jobs this server submitted |
| `web/server/api/fields.mjs` | request shape checks, each a code-3 error naming its field |
| `web/server/api/generate.mjs` | `POST /api/generate/video`, `POST /api/generate/image`, `POST /api/jobs/:id/check` |
| `web/server/api/frames.mjs` | `POST /api/frames` |
| `web/server/api/library.mjs` | `GET /api/vocab`, `GET /api/library`, `GET /api/library/:name`, `POST /api/library/incoming` (raw upload), `POST /api/library` (save) |
| `web/server/stills.mjs` | the fixed list of preset stills from `docs/images/sources.json` |
| `web/server/api/presets.mjs` | `GET /api/presets`, `GET /api/presets/:id` |
| `web/server/media.mjs` (modify) | serves `/media/presets/<id>.png` from that list only |
| `web/server/api/look.mjs` (modify) | library and preset reads move out; `/api/models` gains resolution choices |
| `web/server/app.mjs` (modify) | wires the follower and the new modules |
| `web/tests/*.test.mjs` | `follow`, `generate`, `frames`, `library`, `presets`; `helpers.mjs` gains `generateStubs`; `http.test.mjs` gains raw routes |
| `web/src/api/types.ts`, `client.ts` (modify) | new response types; `api()` can send a file as the raw body |
| `web/src/test-fixtures.ts` | page test data and a `fetch` stub keyed by path |
| `web/src/studio/format.ts` | take cost, spec line, status line and refusal wording |
| `web/src/studio/promptStore.ts` | the shared draft (prompt, chips, refs) and the working film |
| `web/src/studio/TakeTile.tsx`, `useJobs.ts` | one take in the feed; the live job list |
| `web/src/studio/useEstimate.ts`, `PromptBar.tsx` | live price; the prompt bar and its chips |
| `web/src/studio/TakeViewer.tsx`, `FilmPicker.tsx`, `StudioScreen.tsx`, `studio.css` | the take viewer, "Working in", the Studio screen |
| `web/src/library/SaveAssetForm.tsx`, `LibraryScreen.tsx`, `library.css` | save form shared with the viewer; the Library screen |
| `web/src/presets/PresetsScreen.tsx`, `presets.css` | the Presets gallery |
| `web/src/theme/controls.css`, `base.css` (modify) | shared button and save-form styles |
| `web/src/app/App.tsx`, `App.css`, `App.test.tsx` (modify) | the three screens replace their placeholders |

---

### Task 1: Raw-body routes for uploads

**Files:**
- Modify: `web/server/http.mjs`
- Modify: `web/tests/http.test.mjs` (test)

Uploads must not go through the 1 MB JSON limit or base64. A route registered with `{ raw: true }` gets the unread request stream as `req` and `body` stays undefined. The key check still runs first, because it happens before routing.

- [ ] **Step 1: Write the failing test**

Modify `web/tests/http.test.mjs` with this change (unified diff: drop the `-` lines, add the `+` lines; `git apply` takes it as is):

```diff
--- a/web/tests/http.test.mjs
+++ b/web/tests/http.test.mjs
@@ -17,6 +17,15 @@
 router.get("/api/ping", () => ({ ok: true }));
 router.get("/api/runs/:slug", ({ params }) => ({ slug: params.slug }));
 router.post("/api/echo", ({ body }) => body);
+router.post(
+  "/api/count",
+  async ({ req, body }) => {
+    let bytes = 0;
+    for await (const c of req) bytes += c.length;
+    return { bytes, body: body ?? null };
+  },
+  { raw: true },
+);
 router.get("/api/over", () => {
   throw budget("Refused, nothing spent. Over the cap.");
 });
@@ -90,6 +99,17 @@
   test("a body over 1 MB is 413", async () => {
     const r = await req(port, "/api/echo", { method: "POST", body: Buffer.alloc(1_100_000, 32) });
     assert.equal(r.status, 413);
+  });
+
+  test("a raw route gets the unread stream, past the 1 MB JSON limit", async () => {
+    const r = await req(port, "/api/count", { method: "POST", body: Buffer.alloc(2_500_000, 7), headers: { "content-type": "application/octet-stream" } });
+    assert.equal(r.status, 200);
+    assert.deepEqual(r.json, { bytes: 2_500_000, body: null });
+  });
+
+  test("a raw route still needs the key", async () => {
+    const r = await req(port, "/api/count", { method: "POST", body: Buffer.alloc(10), key: null });
+    assert.equal(r.status, 403);
   });
 
   test("an unknown API path is 404 JSON", async () => {
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && node --test tests/http.test.mjs`
Expected: FAIL, 1 of 27: "a raw route gets the unread stream" gets `actual: 413` (the JSON limit) where it expects 200.

- [ ] **Step 3: Implement**

Modify `web/server/http.mjs` with this change (unified diff: drop the `-` lines, add the `+` lines; `git apply` takes it as is):

```diff
--- a/web/server/http.mjs
+++ b/web/server/http.mjs
@@ -53,13 +53,15 @@
 
 export function createRouter() {
   const routes = [];
-  const add = (method) => (pattern, handler) => {
+  // `raw: true` hands the handler the unread request stream instead of a parsed
+  // JSON body, for uploads; the 1 MB JSON limit does not apply to such a route.
+  const add = (method) => (pattern, handler, { raw = false } = {}) => {
     const names = [];
     const source = pattern.replace(/:([a-zA-Z]+)/g, (_, n) => {
       names.push(n);
       return "([^/]+)";
     });
-    routes.push({ method, re: new RegExp(`^${source}$`), names, handler });
+    routes.push({ method, re: new RegExp(`^${source}$`), names, handler, raw });
   };
   return {
     get: add("GET"),
@@ -70,7 +72,7 @@
       for (const r of routes) {
         if (r.method !== method) continue;
         const m = path.match(r.re);
-        if (m) return { handler: r.handler, params: Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
+        if (m) return { handler: r.handler, raw: r.raw, params: Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
       }
       return null;
     },
@@ -185,7 +187,7 @@
           throw new HttpError(400, "Bad path.");
         }
         if (!hit) return fail(res, 404, `No ${req.method} ${url.pathname}.`);
-        const body = req.method === "GET" ? undefined : await readJson(req);
+        const body = req.method === "GET" || hit.raw ? undefined : await readJson(req);
         const out = await hit.handler({ params: hit.params, query: url.searchParams, body, req, res });
         if (out === undefined) return; // the handler wrote the response itself (a stream)
         return sendJson(res, 200, out);
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && node --test tests/http.test.mjs`
Expected: PASS, 27 of 27.

Then run: `cd web && npm run test:server`
Expected: 68 pass, 0 fail. (A `studio: Error: kaboom with sk-a…23` line on stderr is an existing test of redacted logging, not a failure.)

- [ ] **Step 5: Commit**

```bash
git add web/server/http.mjs web/tests/http.test.mjs
git diff --cached --stat
git commit -m "Let a studio route take the raw request body

Uploads stream past the 1 MB JSON limit; the key check still applies.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 2: Background follower

**Files:**
- Create: `web/server/follow.mjs`
- Modify: `web/tests/helpers.mjs` (test helper)
- Create: `web/tests/follow.test.mjs` (test)

Generate answers as soon as the job is submitted. Something still has to wait on the provider, download the file and settle the cost: that is `waitJob`, called here in the background. `follow(id)` defers with `Promise.resolve().then(...)` so the HTTP answer goes out first; tests call `idle()` to wait for it. It retries a still-running job up to `rounds` times and logs (redacted) instead of throwing. It never follows a job it did not submit, because a CLI or MCP waiter may already be downloading it.

`generateStubs()` in the helpers gives the provider stubs every later server test uses, in the MCP test helpers' shape (`mcp/tests/helpers.mjs`).

- [ ] **Step 1: Write the failing test**

Modify `web/tests/helpers.mjs` with this change (unified diff: drop the `-` lines, add the `+` lines; `git apply` takes it as is):

```diff
--- a/web/tests/helpers.mjs
+++ b/web/tests/helpers.mjs
@@ -1,7 +1,7 @@
 // Every server test imports this first. It points runs/, library/ and the
 // limits file at a temp folder BEFORE cli modules load (they read these at
 // import), and makes any real network call throw.
-import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
+import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
 import { request } from "node:http";
 import { tmpdir } from "node:os";
 import { join } from "node:path";
@@ -23,6 +23,37 @@
 
 /** Stubs for every call that would reach a provider. */
 export const deps = { credits: async () => 100 };
+
+/**
+ * Fake provider calls for the generate and follow tests, with a call log.
+ * Same shape as mcp/tests/helpers.mjs: `generate` replaces preflight,
+ * createTask, waitForTask, download and creditsAfter inside cli/core.
+ */
+export function generateStubs({ estimateUsd = 0.56 } = {}) {
+  const calls = { create: [], wait: 0, download: 0, upload: 0 };
+  const generate = {
+    preflight: async (_catalog, _route, o) => ({ estimatedUsd: estimateUsd, basis: "stub", cap: o.budgetUsd ?? 3, creditsBefore: 100 }),
+    createTask: async (prov, _family, model, input) => {
+      calls.create.push({ provider: prov.name, model, input });
+      return { taskId: `task-${calls.create.length}` };
+    },
+    waitForTask: async () => {
+      calls.wait += 1;
+      return { state: "success", urls: ["https://cdn.test/result.mp4"], data: { state: "success", creditsConsumed: 6 }, elapsedS: 2 };
+    },
+    download: async (_url, path) => {
+      calls.download += 1;
+      writeFileSync(path, "fake media");
+      return path;
+    },
+    creditsAfter: async () => 94,
+  };
+  const upload = async () => {
+    calls.upload += 1;
+    return { url: `https://files.test/${calls.upload}.png` };
+  };
+  return { calls, generate, deps: { ...deps, generate, upload } };
+}
 
 /**
  * One HTTP request through node:http (fetch is disabled, and fetch cannot
```

Create `web/tests/follow.test.mjs`:

```js
import { RUNS, generateStubs } from "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const { createFollower } = await import("../server/follow.mjs");
const { openJobs } = await import("../../cli/core/jobs.mjs");
const { loadCatalog } = await import("../../cli/lib/models.mjs");
const { uncertain } = await import("../../cli/lib/errors.mjs");

const catalog = loadCatalog();
const store = openJobs(join(RUNS, ".jobs"));

/** A job record as submitJob leaves it: submitted, with an upstream id. */
function submittedJob(run = "follow-demo") {
  mkdirSync(join(RUNS, run), { recursive: true });
  let j = store.create({
    run,
    capability: "video",
    model: "seedance-2-5",
    provider: "kie",
    family: "jobs",
    providerModel: "bytedance/seedance-2-5",
    artifactBase: "out",
    estimateUsd: 0.56,
    input: { prompt: "A fox", duration: 4, resolution: "480p" },
  });
  j = store.transition(j.id, "sending");
  return store.transition(j.id, "submitted", { upstreamTaskId: "task-9" });
}

describe("createFollower", () => {
  test("a followed job settles in the background, then is let go", async () => {
    const { calls, deps } = generateStubs();
    const f = createFollower({ catalog, deps });
    const job = submittedJob();
    f.follow(job.id);
    assert.equal(f.has(job.id), true);
    await f.idle();
    const done = store.get(job.id);
    assert.equal(done.state, "succeeded");
    assert.equal(done.artifacts.length, 1);
    assert.equal(calls.download, 1);
    assert.equal(f.has(job.id), false);
  });

  test("following the same job twice waits on it once", async () => {
    const { calls, deps } = generateStubs();
    const f = createFollower({ catalog, deps });
    const job = submittedJob();
    f.follow(job.id);
    f.follow(job.id);
    await f.idle();
    assert.equal(calls.wait, 1);
  });

  test("a job still running is waited on again, up to the round limit, and stays submitted", async () => {
    const { deps } = generateStubs();
    let waits = 0;
    deps.generate.waitForTask = async () => {
      waits += 1;
      throw uncertain("still running", "task-9", { timedOut: true });
    };
    const f = createFollower({ catalog, deps, rounds: 2 });
    const job = submittedJob();
    assert.equal(await f.follow(job.id), "pending");
    assert.equal(waits, 2);
    assert.equal(store.get(job.id).state, "submitted");
  });

  test("an unexpected error is logged with secrets redacted, and the job is let go unchanged", async () => {
    const { deps } = generateStubs();
    deps.generate.waitForTask = async () => {
      throw new Error("boom sk-abcdefghijklmnopqrstuvwxyz0123");
    };
    const lines = [];
    const f = createFollower({ catalog, deps, log: (m) => lines.push(m) });
    const job = submittedJob();
    assert.equal(await f.follow(job.id), "error");
    assert.match(lines.join(""), /boom/);
    assert.doesNotMatch(lines.join(""), /sk-abcdefghijklmnopqrstuvwxyz0123/);
    assert.equal(f.has(job.id), false);
    assert.equal(store.get(job.id).state, "submitted");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && node --test tests/follow.test.mjs`
Expected: FAIL, `Cannot find module '.../web/server/follow.mjs'`.

- [ ] **Step 3: Implement**

Create `web/server/follow.mjs`:

```js
// Waits on jobs this server submitted, in the background, so the page never
// holds a request open for minutes. waitJob does the polling, the download and
// the cost settling; events.mjs sees the job file change and tells the page.
//
// Only jobs submitted here are followed. A job the CLI or an MCP client is
// already waiting on would otherwise be downloaded twice.
import { openJobs } from "../../cli/core/jobs.mjs";
import { waitJob } from "../../cli/core/generate.mjs";
import { redact } from "../../cli/lib/redact.mjs";

export function createFollower({ catalog, deps = {}, timeoutMs = 20 * 60_000, rounds = 3, log = (m) => process.stderr.write(m) } = {}) {
  const running = new Map();

  async function run(id) {
    try {
      for (let i = 0; i < rounds; i++) {
        const w = await waitJob(catalog, openJobs(), id, { timeoutMs, deps: deps.generate });
        if (w.outcome !== "pending") return w.outcome;
      }
      return "pending"; // still running after every round: Check again picks it up from here
    } catch (err) {
      log(`studio: stopped following ${id}: ${redact(err?.message ?? String(err))}\n`);
      return "error";
    }
  }

  return {
    /** Start waiting on `id` unless already waiting. Resolves to the last outcome; never rejects. */
    follow(id) {
      if (running.has(id)) return running.get(id);
      // Deferred a tick so `running` holds the promise before any of it runs.
      const p = Promise.resolve()
        .then(() => run(id))
        .finally(() => running.delete(id));
      running.set(id, p);
      return p;
    },
    has: (id) => running.has(id),
    /** Resolves when every job followed so far has settled or been let go (tests). */
    idle: () => Promise.all([...running.values()]),
  };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && node --test tests/follow.test.mjs`
Expected: PASS, 4 of 4.

Then run: `cd web && npm run test:server`
Expected: 72 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/server/follow.mjs web/tests/follow.test.mjs web/tests/helpers.mjs
git diff --cached --stat
git commit -m "Follow submitted studio jobs in the background

waitJob runs off the request path for jobs this server submitted, a few rounds at most,
with errors logged redacted. Adds generateStubs to the server test helpers.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 3: Generate endpoints

**Files:**
- Create: `web/server/api/fields.mjs`
- Create: `web/server/api/generate.mjs`
- Modify: `web/server/app.mjs`
- Create: `web/tests/generate.test.mjs` (test)

The two spending endpoints take the MCP tools' argument shapes (`generate_video`, `generate_image`: snake_case `duration_s`, `aspect_ratio`, `budget_usd`, `refs: [{ source, role }]`) and do what those tools do. Shape errors are code 3 with a `field` so the page can point at the chip. When core's `validateVideoRequest` reports problems, the endpoint asks it again one setting at a time to name the field.

The tests cover the happy path (answer at once, then the follower settles the take), the per-job limit and the cap through HTTP (402, code 2, `createTask` never called, no job written) and invalid input (400, code 3, with the field). `WAVESPEED_API_KEY` is set to a fake value so the WaveSpeed route is usable for Task 4's fallback test; every provider call is a stub.

- [ ] **Step 1: Write the failing test**

Create `web/tests/generate.test.mjs`:

```js
import { KEY, RUNS, tmp, req, generateStubs } from "./helpers.mjs";
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// WaveSpeed routes are usable only with a key; this one is fake, and every provider call is a stub.
process.env.WAVESPEED_API_KEY = "test-ws-key-not-real";

const { createApp } = await import("../server/app.mjs");
const { openJobs } = await import("../../cli/core/jobs.mjs");
const { provider } = await import("../../cli/lib/errors.mjs");

const { calls, generate, deps } = generateStubs();
const realCreate = generate.createTask;
const store = openJobs(join(RUNS, ".jobs"));
const LIMITS = process.env.KIE_LIMITS_FILE;
const video = { run: "gen-web", prompt: "A fox runs through snow.", model: "seedance-2-5", duration_s: 4, resolution: "480p", aspect_ratio: "16:9" };
const post = (path, body) => req(port, path, { method: "POST", body });

let app, port;
before(async () => {
  app = createApp({ key: KEY, deps, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());
beforeEach(() => {
  generate.createTask = realCreate;
  rmSync(LIMITS, { force: true });
});

describe("POST /api/generate/video", () => {
  test("submits once through core, answers at once with the local job id, then the follower finishes the take", async () => {
    const sent = calls.create.length;
    const r = await post("/api/generate/video", { ...video, provider: "kie" });
    assert.equal(r.status, 200, r.text);
    assert.match(r.json.localJobId, /^j-\d{8}-[0-9a-f]{6}$/);
    assert.equal(r.json.state, "submitted");
    assert.equal(r.json.provider, "kie");
    assert.equal(r.json.job.durationS, 4);
    assert.equal(calls.create.length, sent + 1);
    assert.equal(readFileSync(join(RUNS, "gen-web", "prompt.txt"), "utf8"), video.prompt);
    assert.equal(JSON.parse(readFileSync(join(RUNS, "gen-web", "inputs.json"), "utf8")).via, "studio");

    await app.follower.idle();
    const job = (await req(port, "/api/jobs?run=gen-web")).json.find((j) => j.id === r.json.localJobId);
    assert.equal(job.state, "succeeded");
    assert.equal(job.media.length, 1);
    assert.match(job.media[0], /^\/media\/runs\/gen-web\/out/);
  });

  test("over the per-job limit: 402, code 2, nothing sent, no job written", async () => {
    writeFileSync(LIMITS, JSON.stringify({ dailyUsd: 10, perJobUsd: 0.5 }));
    const sent = calls.create.length;
    const jobs = store.list().length;
    const r = await post("/api/generate/video", video);
    assert.equal(r.status, 402);
    assert.equal(r.json.error.code, 2);
    assert.match(r.json.error.message, /per-job limit/);
    assert.equal(r.json.error.perJobUsd, 0.5);
    assert.equal(calls.create.length, sent);
    assert.equal(store.list().length, jobs);
  });

  test("over today's cap: 402, code 2, nothing sent, no job written", async () => {
    writeFileSync(LIMITS, JSON.stringify({ dailyUsd: 0.1 }));
    const sent = calls.create.length;
    const jobs = store.list().length;
    const r = await post("/api/generate/video", video);
    assert.equal(r.status, 402);
    assert.equal(r.json.error.code, 2);
    assert.match(r.json.error.message, /today's \$0\.10 cap/);
    assert.equal(calls.create.length, sent);
    assert.equal(store.list().length, jobs);
  });

  test("a duration the model does not take: 400, code 3, the field named, nothing sent", async () => {
    const sent = calls.create.length;
    const r = await post("/api/generate/video", { ...video, duration_s: 2 });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 3);
    assert.equal(r.json.error.field, "duration_s");
    assert.match(r.json.error.message, /seedance-2-5 generates .*not 2s/);
    assert.equal(calls.create.length, sent);
  });

  test("a missing prompt, a bad run name and a non-integer duration are each 400 with code 3 and their field", async () => {
    const cases = [
      [{ ...video, prompt: "  " }, "prompt"],
      [{ ...video, run: "Not A Slug" }, "run"],
      [{ ...video, duration_s: 4.5 }, "duration_s"],
      [{ ...video, refs: "zed" }, "refs"],
    ];
    for (const [body, field] of cases) {
      const r = await post("/api/generate/video", body);
      assert.equal(r.status, 400, field);
      assert.equal(r.json.error.code, 3, field);
      assert.equal(r.json.error.field, field);
    }
    assert.equal(existsSync(join(RUNS, "Not A Slug")), false);
  });
});

describe("POST /api/generate/image", () => {
  test("defaults to gpt-image-2 and writes the image prompt", async () => {
    const r = await post("/api/generate/image", { run: "gen-image", prompt: "A red robot, studio light.", provider: "kie" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.job.model, "gpt-image-2");
    assert.ok(existsSync(join(RUNS, "gen-image", "image-prompt.txt")));
    await app.follower.idle();
  });

  test("a resolution the model does not offer is 400 with code 3 on that field", async () => {
    const r = await post("/api/generate/image", { run: "gen-image", prompt: "x", model: "gpt-image-2-5", resolution: "8K" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.field, "resolution");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && node --test tests/generate.test.mjs`
Expected: FAIL, 7 of 7: `No POST /api/generate/video.` / `No POST /api/generate/image.` (404).

- [ ] **Step 3: Implement**

`app.mjs` now builds the catalog once (`loadCatalog()` as the default) and shares it with the follower and every module.

Create `web/server/api/fields.mjs`:

```js
// Shape checks for request bodies. Each failure is core's code 3 ("invalid
// request") naming the field, so the page can point at the chip at fault.
// What a value means (a duration a model takes, a cap) is core's business.
import { unknown } from "../../../cli/lib/errors.mjs";
import { runDir } from "../../../cli/lib/run.mjs";

export const invalid = (field, message) => unknown(message, { field });

export function text(body, field, { required = false } = {}) {
  const v = body?.[field];
  if (v == null || (typeof v === "string" && v.trim() === "")) {
    if (required) throw invalid(field, `${field} is required.`);
    return undefined;
  }
  if (typeof v !== "string") throw invalid(field, `${field} must be text.`);
  return v;
}

export function wholeNumber(body, field) {
  const v = body?.[field];
  if (v == null) return undefined;
  if (!Number.isInteger(v) || v <= 0) throw invalid(field, `${field} must be a whole number above 0.`);
  return v;
}

export function amount(body, field) {
  const v = body?.[field];
  if (v == null) return undefined;
  if (typeof v !== "number" || !(v > 0)) throw invalid(field, `${field} must be a dollar amount above 0.`);
  return v;
}

export function flag(body, field) {
  const v = body?.[field];
  if (v == null) return false;
  if (typeof v !== "boolean") throw invalid(field, `${field} must be true or false.`);
  return v;
}

export function strings(body, field) {
  const v = body?.[field];
  if (v == null) return [];
  if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) throw invalid(field, `${field} must be a list of text.`);
  return v;
}

/** refs: [{ source, role }], the MCP tools' shape. Roles are checked by core. */
export function refs(body) {
  const v = body?.refs;
  if (v == null) return [];
  const ok = Array.isArray(v) && v.every((r) => r && typeof r.source === "string" && typeof r.role === "string");
  if (!ok) throw invalid("refs", "refs must be a list of { source, role }.");
  return v.map(({ source, role }) => ({ source, role }));
}

/** params: route fields such as generate_audio, checked by core against the route's contract. */
export function params(body) {
  const v = body?.params;
  if (v == null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw invalid("params", "params must be an object.");
  return v;
}

/** A run folder slug, checked (not created) by core's runDir; a bad one is reported against the field. */
export function run(body) {
  const slug = text(body, "run", { required: true });
  try {
    runDir(slug, { create: false });
  } catch (err) {
    throw invalid("run", err.message);
  }
  return slug;
}
```

Create `web/server/api/generate.mjs`:

```js
// The two spending endpoints and Check again. They take the MCP tools' argument
// shapes (generate_video, generate_image, wait_job) and do what those tools do:
// expand refs, record the inputs, then reserve and submit through cli/core.
// Pricing, the per-job limit, the daily cap and job states all stay in core.
// Neither endpoint waits: the follower does, and the take reaches the page
// as an SSE job event.
import { resolveModel, validateVideoRequest } from "../../../cli/lib/models.mjs";
import { loadPresets, findPreset, routeFor } from "../../../cli/lib/presets.mjs";
import { RUNS_DIR, runDir, writeRecord } from "../../../cli/lib/run.mjs";
import { uploadFile } from "../../../cli/lib/upload.mjs";
import { unknown, usage } from "../../../cli/lib/errors.mjs";
import { submitJob } from "../../../cli/core/generate.mjs";
import { expandRefs } from "../../../cli/core/refs.mjs";
import { context, jobView } from "../state.mjs";
import * as f from "./fields.mjs";

export function registerGenerate(router, { catalog, deps = {}, follower }) {
  const upload = deps.upload ?? ((path, opts) => uploadFile(catalog, path, opts));

  /** The fields generate_video and generate_image share. */
  function common(body) {
    return {
      run: f.run(body),
      prompt: f.text(body, "prompt", { required: true }),
      refs: f.refs(body),
      resolution: f.text(body, "resolution"),
      aspect_ratio: f.text(body, "aspect_ratio"),
      params: f.params(body),
      budget_usd: f.amount(body, "budget_usd"),
      provider: f.text(body, "provider"),
    };
  }

  async function submit(capability, model, a, values, { promptFile, inputsFile, artifactBase, useI2v, extra = {} }) {
    const dir = runDir(a.run);
    const { store, limits, roots, library } = context();
    const expanded = await expandRefs(a.refs, { catalog, library, roots, baseDir: RUNS_DIR, upload });
    await writeRecord(dir, promptFile, a.prompt);
    await writeRecord(dir, inputsFile, {
      model: model.id,
      ...extra,
      refs: expanded.refs,
      refMapping: expanded.refMapping,
      params: a.params,
      via: "studio",
    });

    const sub = await submitJob(
      catalog,
      {
        capability,
        model,
        run: a.run,
        artifactBase,
        budgetUsd: a.budget_usd,
        only: a.provider,
        values: { ...values, refs: expanded.refs, params: a.params, _useI2v: useI2v(expanded.refs) },
        record: { refMapping: expanded.refMapping, assets: expanded.assets, via: "studio" },
      },
      { store, limits, deps: deps.generate },
    );
    // Submitted and paid for: nothing after this may throw, or the page loses the job id.
    const warnings = [];
    for (const name of expanded.assets) {
      try {
        library.recordUse(name, a.run);
      } catch (err) {
        warnings.push(`Could not record that asset "${name}" was used in ${a.run} (${err.message}); the job is submitted.`);
      }
    }
    follower.follow(sub.job.id);
    return {
      localJobId: sub.job.id,
      upstreamTaskId: sub.job.upstreamTaskId == null ? null : String(sub.job.upstreamTaskId),
      state: sub.job.state,
      provider: sub.job.provider,
      providerModel: sub.job.providerModel,
      failedOver: Boolean(sub.job.failedOver),
      estimateUsd: sub.estimateUsd,
      basis: sub.basis,
      refMapping: expanded.refMapping,
      warnings,
      job: jobView(sub.job),
    };
  }

  router.post("/api/generate/video", async ({ body = {} }) => {
    const a = { ...common(body), model: f.text(body, "model"), preset: f.text(body, "preset"), duration_s: f.wholeNumber(body, "duration_s") };
    let modelId = a.model;
    let durationS = a.duration_s;
    let aspectRatio = a.aspect_ratio;
    let presetId = null;
    if (a.preset) {
      const preset = findPreset(loadPresets(), a.preset);
      const route = routeFor(preset, catalog, { override: a.model });
      modelId ??= route.modelId;
      durationS ??= route.defaults.duration_s;
      aspectRatio ??= route.defaults.aspect_ratio;
      presetId = preset.id;
    }
    if (!modelId) throw f.invalid("model", "Pick a model, or a preset that supplies one.");
    const model = resolveModel(catalog, modelId, "video");
    const problems = validateVideoRequest(catalog, model, { durationS, aspectRatio, refs: a.refs });
    if (problems.length) {
      // Ask core about one setting at a time to name the field at fault.
      const field = validateVideoRequest(catalog, model, { durationS }).length
        ? "duration_s"
        : validateVideoRequest(catalog, model, { aspectRatio }).length
          ? "aspect_ratio"
          : "refs";
      throw unknown(`Refused before submitting, nothing was spent. ${problems.join(" ")}`, { field, problems });
    }
    return submit(
      "video",
      model,
      a,
      { prompt: a.prompt, duration: durationS, aspect_ratio: aspectRatio, resolution: a.resolution },
      {
        promptFile: "prompt.txt",
        inputsFile: "inputs.json",
        artifactBase: "out",
        useI2v: (refs) => refs.some((r) => r.role === "first_frame"),
        extra: { preset: presetId, durationS, aspectRatio },
      },
    );
  });

  router.post("/api/generate/image", async ({ body = {} }) => {
    const a = { ...common(body), model: f.text(body, "model"), quality: f.text(body, "quality"), background: f.text(body, "background") };
    const model = resolveModel(catalog, a.model ?? "gpt-image-2", "image");
    if (a.resolution && model.resolutions && !model.resolutions.includes(a.resolution)) {
      throw f.invalid("resolution", `${model.id} supports resolutions ${model.resolutions.join(", ")}.`);
    }
    if (a.quality && model.qualities && !model.qualities.includes(a.quality)) {
      throw f.invalid("quality", `${model.id} supports qualities ${model.qualities.join(", ")}.`);
    }
    return submit(
      "image",
      model,
      a,
      { prompt: a.prompt, resolution: a.resolution, quality: a.quality, aspect_ratio: a.aspect_ratio, background: a.background },
      { promptFile: "image-prompt.txt", inputsFile: "image-inputs.json", artifactBase: "ref", useI2v: (refs) => refs.length > 0 },
    );
  });

}
```

Modify `web/server/app.mjs` with this change (unified diff: drop the `-` lines, add the `+` lines; `git apply` takes it as is):

```diff
--- a/web/server/app.mjs
+++ b/web/server/app.mjs
@@ -5,23 +5,29 @@
 import { createRouter, createHandler } from "./http.mjs";
 import { serveMedia } from "./media.mjs";
 import { createEvents } from "./events.mjs";
+import { createFollower } from "./follow.mjs";
 import { registerLook } from "./api/look.mjs";
+import { registerGenerate } from "./api/generate.mjs";
+import { loadCatalog } from "../../cli/lib/models.mjs";
 
 export const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
 
 /**
  * An http.Server for the studio. `deps` replaces anything that reaches a
- * provider (tests pass stubs). `closeAll()` also stops the event watchers.
- * Later plans register more endpoints on `server.router` before listen().
+ * provider, in the MCP server's shape: `generate` (preflight, createTask,
+ * waitForTask, download, creditsAfter), `upload` and `credits`. Tests pass
+ * stubs. `closeAll()` also stops the event watchers.
  */
-export function createApp({ key, deps = {}, catalog, distDir = join(WEB_DIR, "dist"), pollMs } = {}) {
+export function createApp({ key, deps = {}, catalog = loadCatalog(), distDir = join(WEB_DIR, "dist"), pollMs } = {}) {
   const router = createRouter();
+  const follower = createFollower({ catalog, deps });
   const events = createEvents({ pollMs });
   router.get("/api/events", ({ res }) => {
     events.subscribe(res);
     return undefined;
   });
   registerLook(router, { catalog, deps });
+  registerGenerate(router, { catalog, deps, follower });
 
   const server = createServer(createHandler({ key, router, distDir, media: serveMedia }));
   // A malformed request never reaches the handler; drop the socket quietly.
@@ -34,5 +40,6 @@
     });
   server.router = router;
   server.events = events;
+  server.follower = follower;
   return server;
 }
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && node --test tests/generate.test.mjs`
Expected: PASS, 7 of 7.

Then run: `cd web && npm run test:server`
Expected: 79 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/server/api/fields.mjs web/server/api/generate.mjs web/server/app.mjs web/tests/generate.test.mjs
git diff --cached --stat
git commit -m "Add the studio generate endpoints

POST /api/generate/video and /api/generate/image take the MCP tool shapes and submit
through cli/core, so the per-job limit, the cap and fallback stay in core. Bad input is
code 3 naming the field. The follower waits on the job; SSE brings the take to the page.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 4: Fallback, uncertain jobs and Check again

**Files:**
- Modify: `web/server/api/generate.mjs`
- Modify: `web/tests/generate.test.mjs` (test)

Two tests pin core behaviour through HTTP and pass straight away: a create that kie rejects falls over to WaveSpeed and both jobs show their provider; a create that dies without a task id is 409 code 5 with the local job id, kept `uncertain`, never resent.

Then **Check again** (`POST /api/jobs/:id/check`): one free status read through `waitJob` with `timeoutMs: 1`. If the follower is already waiting on the job it says so instead of polling twice. An uncertain job with no upstream id comes back as core's code 5 with the `kie job resolve` instruction; resolving stays a human step in the CLI.

- [ ] **Step 1: Write the failing test**

Modify `web/tests/generate.test.mjs` with this change (unified diff: drop the `-` lines, add the `+` lines; `git apply` takes it as is):

```diff
--- a/web/tests/generate.test.mjs
+++ b/web/tests/generate.test.mjs
@@ -117,3 +117,85 @@
     assert.equal(r.json.error.field, "resolution");
   });
 });
+
+describe("when a provider has trouble", () => {
+  test("a create kie rejects outright falls over to WaveSpeed, and both jobs show their provider", async () => {
+    generate.createTask = async (prov, ...rest) => {
+      if (prov.name === "kie") throw provider("kie.ai rejected the request (code 500: busy)");
+      return realCreate(prov, ...rest);
+    };
+    const r = await post("/api/generate/video", { ...video, run: "gen-fallback" });
+    assert.equal(r.status, 200, r.text);
+    assert.equal(r.json.provider, "wavespeed");
+    assert.equal(r.json.failedOver, true);
+    await app.follower.idle();
+    const jobs = (await req(port, "/api/jobs?run=gen-fallback")).json;
+    const kie = jobs.find((j) => j.provider === "kie");
+    const ws = jobs.find((j) => j.provider === "wavespeed");
+    assert.equal(kie.state, "failed-confirmed-free");
+    assert.equal(kie.countedUsd, 0);
+    assert.equal(ws.failedOver, true);
+  });
+
+  test("a create that dies without an id: 409, code 5 with the local id; the job is kept as uncertain, never resubmitted", async () => {
+    let sent = 0;
+    generate.createTask = async () => {
+      sent += 1;
+      throw new Error("socket hang up");
+    };
+    const r = await post("/api/generate/video", { ...video, run: "gen-uncertain" });
+    assert.equal(r.status, 409);
+    assert.equal(r.json.error.code, 5);
+    assert.match(r.json.error.localJobId, /^j-/);
+    assert.match(r.json.error.message, /Do not resubmit/);
+    assert.equal(sent, 1, "no fallback after an ambiguous create");
+    const [job] = (await req(port, "/api/jobs?run=gen-uncertain")).json;
+    assert.equal(job.id, r.json.error.localJobId);
+    assert.equal(job.state, "uncertain");
+    assert.equal(job.countedUsd, 0.56, "an uncertain job keeps holding its estimate");
+  });
+});
+
+describe("POST /api/jobs/:id/check", () => {
+  test("an uncertain job with no upstream id: 409, code 5, core's resolve instruction; the job stays uncertain", async () => {
+    const [job] = (await req(port, "/api/jobs?run=gen-uncertain")).json;
+    const waits = calls.wait;
+    const r = await post(`/api/jobs/${job.id}/check`);
+    assert.equal(r.status, 409);
+    assert.equal(r.json.error.code, 5);
+    assert.match(r.json.error.message, /kie job resolve/);
+    assert.equal(calls.wait, waits, "nothing to poll without an upstream id");
+    assert.equal(store.get(job.id).state, "uncertain");
+  });
+
+  test("an uncertain job that has an upstream id is read once and settles", async () => {
+    let j = store.create({ run: "gen-check", capability: "video", model: "seedance-2-5", provider: "kie", family: "jobs", providerModel: "bytedance/seedance-2-5", artifactBase: "out", estimateUsd: 0.56, input: { prompt: "x", duration: 4 } });
+    j = store.transition(j.id, "sending");
+    j = store.transition(j.id, "uncertain", { upstreamTaskId: "task-late" });
+    const r = await post(`/api/jobs/${j.id}/check`);
+    assert.equal(r.status, 200, r.text);
+    assert.equal(r.json.outcome, "succeeded");
+    assert.equal(r.json.job.state, "succeeded");
+  });
+
+  test("a submitted job still running is reported as pending and left submitted", async () => {
+    let j = store.create({ run: "gen-check", capability: "video", model: "seedance-2-5", provider: "kie", family: "jobs", providerModel: "bytedance/seedance-2-5", artifactBase: "out", estimateUsd: 0.56, input: { prompt: "x", duration: 4 } });
+    j = store.transition(j.id, "sending");
+    j = store.transition(j.id, "submitted", { upstreamTaskId: "task-slow" });
+    const realWait = generate.waitForTask;
+    const { uncertain } = await import("../../cli/lib/errors.mjs");
+    generate.waitForTask = async () => {
+      throw uncertain("still running", "task-slow", { timedOut: true });
+    };
+    const r = await post(`/api/jobs/${j.id}/check`);
+    generate.waitForTask = realWait;
+    assert.equal(r.status, 200, r.text);
+    assert.equal(r.json.outcome, "pending");
+    assert.match(r.json.message, /Still running at kie/);
+    assert.equal(store.get(j.id).state, "submitted");
+  });
+
+  test("a job id that is not one is 400", async () => {
+    assert.equal((await post("/api/jobs/nope/check")).status, 400);
+  });
+});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && node --test tests/generate.test.mjs`
Expected: FAIL, 4 of 13: the three check tests that expect an answer get `No POST /api/jobs/j-…/check.` (404), and "a job id that is not one" gets 404 where it expects 400. The two provider-trouble tests pass.

- [ ] **Step 3: Implement**

Modify `web/server/api/generate.mjs` with this change (unified diff: drop the `-` lines, add the `+` lines; `git apply` takes it as is):

```diff
--- a/web/server/api/generate.mjs
+++ b/web/server/api/generate.mjs
@@ -9,7 +9,7 @@
 import { RUNS_DIR, runDir, writeRecord } from "../../../cli/lib/run.mjs";
 import { uploadFile } from "../../../cli/lib/upload.mjs";
 import { unknown, usage } from "../../../cli/lib/errors.mjs";
-import { submitJob } from "../../../cli/core/generate.mjs";
+import { submitJob, waitJob } from "../../../cli/core/generate.mjs";
 import { expandRefs } from "../../../cli/core/refs.mjs";
 import { context, jobView } from "../state.mjs";
 import * as f from "./fields.mjs";
@@ -143,4 +143,30 @@
     );
   });
 
+  /**
+   * Check again: one free status read through waitJob (a 1 ms deadline means
+   * a single poll). An uncertain job with no upstream id is code 5 with core's
+   * resolve instruction; resolving stays a human step in the CLI.
+   */
+  router.post("/api/jobs/:id/check", async ({ params }) => {
+    const { store } = context();
+    if (follower.has(params.id)) {
+      return { outcome: "pending", following: true, message: "The studio is already watching this job; it updates by itself.", job: jobView(store.get(params.id)) };
+    }
+    const w = await waitJob(catalog, store, params.id, { timeoutMs: 1, deps: deps.generate });
+    return { outcome: w.outcome, following: false, message: checkMessage(w), job: jobView(w.job) };
+  });
 }
+
+function checkMessage(w) {
+  const job = w.job;
+  if (w.outcome === "succeeded") return "Finished.";
+  if (w.outcome === "failed") {
+    return job.state === "failed-confirmed-free" ? `Failed, not charged: ${job.error ?? "no reason given"}` : `Failed, may have been charged: ${job.error ?? "no reason given"}`;
+  }
+  if (w.outcome === "pending") {
+    // A 1 ms deadline makes core say "after 0 s"; say what actually happened.
+    return /still running after/.test(w.message ?? "") ? `Still running at ${job.provider}. Checked just now; check again later.` : (w.message ?? "Still running.");
+  }
+  return w.message ?? "The task finished without a file. Do not resubmit.";
+}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && node --test tests/generate.test.mjs`
Expected: PASS, 13 of 13.

Then run: `cd web && npm run test:server`
Expected: 85 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/server/api/generate.mjs web/tests/generate.test.mjs
git diff --cached --stat
git commit -m "Check a studio job again with one status read

POST /api/jobs/:id/check reads the provider once through waitJob, or says the studio is
already following the job. Pins fallback and uncertain handling through HTTP.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 5: Frames endpoint

**Files:**
- Create: `web/server/api/frames.mjs`
- Modify: `web/server/app.mjs`
- Create: `web/tests/frames.test.mjs` (test)

`POST /api/frames { run, video }` runs core's free `extractFrames` into `<run>/<video>-frames/` and returns media URLs plus run-relative paths (the viewer saves a frame to the library by that path). The video is confined to `runs/` and `library/` by `confinePath`, which also refuses hidden segments like `.jobs/`. The first test needs ffmpeg and is skipped without it.

- [ ] **Step 1: Write the failing test**

Create `web/tests/frames.test.mjs`:

```js
import { KEY, RUNS, tmp, req } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const { createApp } = await import("../server/app.mjs");

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
mkdirSync(join(RUNS, "frames-demo"), { recursive: true });
if (hasFfmpeg) {
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=2", "-pix_fmt", "yuv420p", join(RUNS, "frames-demo", "out.mp4")]);
}
writeFileSync(join(tmp, "outside.mp4"), "not inside any allowed root");

let app, port;
before(async () => {
  app = createApp({ key: KEY, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());

const frames = (body) => req(port, "/api/frames", { method: "POST", body });

describe("POST /api/frames", () => {
  test("writes the sheet, first and last frame into the run and returns media URLs", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const r = await frames({ run: "frames-demo", video: "out.mp4" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.sheet, "/media/runs/frames-demo/out-frames/sheet.jpg");
    assert.equal(r.json.firstPath, "frames-demo/out-frames/first.png");
    assert.equal(r.json.times.length, 8);
    assert.ok(existsSync(join(RUNS, "frames-demo", "out-frames", "last.png")));
  });

  test("a video outside the allowed folders is refused: 400, code 3, nothing read", async () => {
    const r = await frames({ run: "frames-demo", video: "../outside.mp4" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 3);
    assert.equal(r.json.error.field, "video");
    assert.match(r.json.error.message, /outside the folders files may be read from/);
  });

  test("a hidden folder inside runs/ is refused too", async () => {
    mkdirSync(join(RUNS, ".jobs"), { recursive: true });
    writeFileSync(join(RUNS, ".jobs", "x.mp4"), "x");
    const r = await frames({ run: "frames-demo", video: ".jobs/x.mp4" });
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /hidden folder/);
  });

  test("an unknown run and a missing video are 400 on their fields", async () => {
    assert.equal((await frames({ run: "Bad Run", video: "out.mp4" })).json.error.field, "run");
    assert.equal((await frames({ run: "frames-demo" })).json.error.field, "video");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && node --test tests/frames.test.mjs`
Expected: FAIL, 4 of 4: `No POST /api/frames.` and 404s where 400s are expected.

- [ ] **Step 3: Implement**

Create `web/server/api/frames.mjs`:

```js
// Frames: the free 8-frame contact sheet, first and last frame of a take,
// written into its run folder. Same arguments and confinement as the MCP
// frames tool: a bare name is a file in the run; anything with a slash is a
// path inside runs/ (or an absolute path), and it must sit in an allowed root.
import { basename, extname, isAbsolute, join, relative } from "node:path";
import { RUNS_DIR, runDir } from "../../../cli/lib/run.mjs";
import { confinePath } from "../../../cli/core/inputs.mjs";
import { extractFrames } from "../../../cli/lib/frames.mjs";
import { context } from "../state.mjs";
import { mediaUrl } from "../media.mjs";
import * as f from "./fields.mjs";

export function registerFrames(router) {
  router.post("/api/frames", async ({ body = {} }) => {
    const run = f.run(body);
    const video = f.text(body, "video", { required: true });
    const dir = runDir(run, { create: false });
    const { roots } = context();
    const named = video.includes("/") || isAbsolute(video) ? (isAbsolute(video) ? video : join(RUNS_DIR, video)) : join(dir, video);
    let path;
    try {
      path = confinePath(named, roots);
    } catch (err) {
      throw f.invalid("video", err.message);
    }
    const r = await extractFrames(path, { outDir: join(dir, `${basename(path, extname(path))}-frames`) });
    return {
      sheet: mediaUrl(r.sheet),
      first: mediaUrl(r.first),
      last: mediaUrl(r.last),
      // Paths inside runs/, the form POST /api/library takes to save a frame as an asset.
      firstPath: relative(RUNS_DIR, r.first),
      lastPath: relative(RUNS_DIR, r.last),
      times: r.times,
      durationS: r.durationS,
    };
  });
}
```

Modify `web/server/app.mjs` with this change (unified diff: drop the `-` lines, add the `+` lines; `git apply` takes it as is):

```diff
--- a/web/server/app.mjs
+++ b/web/server/app.mjs
@@ -8,6 +8,7 @@
 import { createFollower } from "./follow.mjs";
 import { registerLook } from "./api/look.mjs";
 import { registerGenerate } from "./api/generate.mjs";
+import { registerFrames } from "./api/frames.mjs";
 import { loadCatalog } from "../../cli/lib/models.mjs";
 
 export const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
@@ -28,6 +29,7 @@
   });
   registerLook(router, { catalog, deps });
   registerGenerate(router, { catalog, deps, follower });
+  registerFrames(router);
 
   const server = createServer(createHandler({ key, router, distDir, media: serveMedia }));
   // A malformed request never reaches the handler; drop the socket quietly.
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && node --test tests/frames.test.mjs`
Expected: PASS, 4 of 4 (the first is skipped, not failed, on a machine without ffmpeg).

Then run: `cd web && npm run test:server`
Expected: 89 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/server/api/frames.mjs web/server/app.mjs web/tests/frames.test.mjs
git diff --cached --stat
git commit -m "Add the studio frames endpoint

POST /api/frames runs core's free 8-frame sheet on a take, confined to runs/ and library/.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 6: Library API: upload, save, detail

**Files:**
- Create: `web/server/api/library.mjs`
- Modify: `web/server/api/look.mjs`
- Modify: `web/server/app.mjs`
- Create: `web/tests/library.test.mjs` (test)

**Upload transport.** `POST /api/library/incoming` is a raw route: the body is the file itself, one request per file, its name in `X-File-Name` (URI-encoded, used only as a label in messages). The server streams it to `library/.incoming/<32 hex>.part` and stops writing past `MAX_UPLOAD` (200 MB, the largest of core's `MAX_BYTES`; the stream is drained so the client gets a clean 413). Core's `checkLocalFile` then decides by content and per-kind size; a refused file is deleted at once and core's message comes back with the label in place of the temp path. An accepted file is renamed to `<id>.<ext>` and the page gets a token `incoming:<id>.<ext>`. Drops nobody saved are swept after a day.

**Save.** `POST /api/library { name, kind, description, images, replace }`, where each image is an upload token or a path inside `runs/` (save from take). The incoming folder goes first in `roots`: under the library root `.incoming` is a hidden segment, which `confinePath` refuses.

**Detail.** `GET /api/library/:name` adds `takes`: job records whose `assets` list holds the name (the CLI, the MCP and the studio all write it). Core's asset record only keeps run slugs (`usedIn`).

The list and detail routes move out of `look.mjs` into this module; the existing look tests keep passing because they go through `createApp`.

- [ ] **Step 1: Write the failing test**

Create `web/tests/library.test.mjs`:

```js
import { KEY, RUNS, LIBRARY, tmp, req } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { png, mp4 } from "../../tests/fixtures/images.mjs";

const { createApp } = await import("../server/app.mjs");
const { createRouter, createHandler } = await import("../server/http.mjs");
const { registerLibrary } = await import("../server/api/library.mjs");
const { openJobs } = await import("../../cli/core/jobs.mjs");
const { loadCatalog } = await import("../../cli/lib/models.mjs");

const INCOMING = join(LIBRARY, ".incoming");
mkdirSync(join(RUNS, "lib-demo"), { recursive: true });
writeFileSync(join(RUNS, "lib-demo", "ref.png"), png(640, 480));
writeFileSync(join(tmp, "outside.png"), png(10, 10));

let app, port;
before(async () => {
  app = createApp({ key: KEY, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());

const drop = (body, name, p = port) =>
  req(p, "/api/library/incoming", { method: "POST", body, headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name) } });
const save = (body) => req(port, "/api/library", { method: "POST", body });
const leftovers = () => (existsSync(INCOMING) ? readdirSync(INCOMING) : []);

describe("upload", () => {
  test("an image is checked by core and waits in library/.incoming under a name the server picked", async () => {
    const r = await drop(png(1024, 768), "bottle.png");
    assert.equal(r.status, 200, r.text);
    assert.match(r.json.token, /^incoming:[0-9a-f]{32}\.png$/);
    assert.deepEqual([r.json.kind, r.json.width, r.json.height, r.json.name], ["image", 1024, 768, "bottle.png"]);
    assert.ok(leftovers().includes(r.json.token.slice("incoming:".length)));
  });

  test("the client's file name is a label only: a traversal name writes nothing outside .incoming", async () => {
    const r = await drop(png(8, 8), "../../escape.png");
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.name, "escape.png");
    assert.equal(existsSync(join(tmp, "escape.png")), false);
    assert.equal(existsSync(join(LIBRARY, "escape.png")), false);
    assert.equal(existsSync(join(RUNS, "escape.png")), false);
  });

  test("a video is refused with core's reason, named by the file, and nothing is kept", async () => {
    const before = leftovers().length;
    const r = await drop(mp4(), "clip.mp4");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 3);
    assert.equal(r.json.error.field, "file");
    assert.match(r.json.error.message, /^clip\.mp4 is not a image file \(checked by its content/);
    assert.doesNotMatch(r.json.error.message, /\.incoming/);
    assert.equal(leftovers().length, before);
  });

  test("an image over core's 30 MB limit is refused with the size, and nothing is kept", async () => {
    const before = leftovers().length;
    const big = Buffer.alloc(30_500_000);
    png(100, 100).copy(big);
    const r = await drop(big, "huge.png");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 3);
    assert.match(r.json.error.message, /^huge\.png is 30\.5MB, over the 30\.0MB limit for image/);
    assert.equal(leftovers().length, before);
  });

  test("an empty body is refused", async () => {
    const r = await drop(Buffer.alloc(0), "empty.png");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.field, "file");
  });

  test("a body over the route's ceiling is 413 and nothing is kept", async () => {
    const router = createRouter();
    registerLibrary(router, { catalog: loadCatalog(), maxUploadBytes: 1_000 });
    const small = createServer(createHandler({ key: KEY, router, distDir: join(tmp, "nodist") }));
    await new Promise((r) => small.listen(0, "127.0.0.1", r));
    const before = leftovers().length;
    const r = await drop(Buffer.alloc(5_000, 1), "big.png", small.address().port);
    await new Promise((r) => small.close(r));
    assert.equal(r.status, 413);
    assert.match(r.json.error.message, /big\.png is over/);
    assert.equal(leftovers().length, before);
  });

  test("the 1 MB JSON limit still holds on every other route", async () => {
    const r = await req(port, "/api/library", { method: "POST", body: Buffer.alloc(1_100_000, 32) });
    assert.equal(r.status, 413);
  });
});

describe("save", () => {
  test("an upload saves as an asset; the list shows its cover and the upload is cleared", async () => {
    const up = await drop(png(512, 512), "bottle.png");
    const r = await save({ name: "bottle", kind: "product", description: "A green glass bottle.", images: [up.json.token] });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.images[0].url, "/media/library/bottle/1.png");
    assert.deepEqual(r.json.takes, []);
    assert.ok(!leftovers().includes(up.json.token.slice("incoming:".length)));
    const list = (await req(port, "/api/library")).json;
    assert.deepEqual(list.map((a) => [a.name, a.cover]), [["bottle", "/media/library/bottle/1.png"]]);
  });

  test("a take's image saves from its path inside runs/ (save from take)", async () => {
    const r = await save({ name: "lib-ref", kind: "style", description: "Warm light.", images: ["lib-demo/ref.png"] });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.images[0].width, 640);
  });

  test("a path outside the allowed folders is refused: 400, code 3, nothing saved", async () => {
    const r = await save({ name: "escapee", kind: "style", description: "x", images: ["../outside.png"] });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 3);
    assert.match(r.json.error.message, /outside the folders files may be read from/);
    assert.equal(existsSync(join(LIBRARY, "escapee")), false);
  });

  test("a forged upload token is refused", async () => {
    for (const token of ["incoming:../../outside.png", "incoming:0123.png"]) {
      const r = await save({ name: "forged", kind: "style", description: "x", images: [token] });
      assert.equal(r.status, 400, token);
      assert.equal(r.json.error.field, "images");
    }
  });

  test("core's own checks come back as code 3: a bad kind, an existing name", async () => {
    const kind = await save({ name: "zed", kind: "robot", description: "x", images: ["lib-demo/ref.png"] });
    assert.equal(kind.json.error.code, 3);
    assert.match(kind.json.error.message, /kind must be one of character, product, location, style/);
    const again = await save({ name: "lib-ref", kind: "style", description: "x", images: ["lib-demo/ref.png"] });
    assert.match(again.json.error.message, /already exists/);
  });
});

describe("read", () => {
  test("one asset lists the runs and the takes that used it", async () => {
    const store = openJobs(join(RUNS, ".jobs"));
    const job = store.create({ run: "lib-demo", capability: "video", model: "seedance-2-5", provider: "kie", estimateUsd: 0.56, assets: ["bottle"], input: { prompt: "x" } });
    const r = await req(port, "/api/library/bottle");
    assert.deepEqual(r.json.takes.map((t) => t.id), [job.id]);
    assert.deepEqual(r.json.usedIn, []);
  });

  test("vocab lists core's asset kinds and reference roles", async () => {
    const r = await req(port, "/api/vocab");
    assert.deepEqual(r.json.kinds, ["character", "product", "location", "style"]);
    assert.ok(r.json.roles.includes("first_frame"));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && node --test tests/library.test.mjs tests/look.test.mjs`
Expected: FAIL, `Cannot find module '.../web/server/api/library.mjs'` (the look tests still pass: 12 of 13).

- [ ] **Step 3: Implement**

Create `web/server/api/library.mjs`:

```js
// The asset library: list, one asset with the takes that used it, upload and
// save. Saving is core's openLibrary().save, which checks every image with
// checkLocalFile (type by content, size limit, allowed folders) before
// anything is written.
//
// Uploads arrive as the raw file body, one request per file, so a 30 MB image
// is streamed to disk instead of held in memory as base64. The file lands in
// library/.incoming/ under a name this server picks; the client's file name is
// only ever used as a label in messages. Core then checks it, and a refused
// file is deleted at once.
import { createWriteStream, existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomBytes } from "node:crypto";
import { basename, isAbsolute, join } from "node:path";
import { LIBRARY_DIR, RUNS_DIR } from "../../../cli/lib/run.mjs";
import { KINDS } from "../../../cli/core/assets.mjs";
import { checkLocalFile, MAX_BYTES } from "../../../cli/core/inputs.mjs";
import { HttpError } from "../http.mjs";
import { context, jobView } from "../state.mjs";
import { mediaUrl } from "../media.mjs";
import * as f from "./fields.mjs";

const TOKEN = /^incoming:([0-9a-f]{32}\.(?:png|jpg|webp))$/;
const STALE_MS = 24 * 3_600_000;
/** The largest file any core check accepts; core then applies the per-kind limit with its own message. */
export const MAX_UPLOAD = Math.max(...Object.values(MAX_BYTES));

export const incomingDir = () => {
  const dir = join(LIBRARY_DIR, ".incoming");
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
};

/** Drops nobody saved: removed after a day. */
function sweepIncoming(dir, now = Date.now()) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    try {
      if (now - statSync(p).mtimeMs > STALE_MS) rmSync(p, { force: true });
    } catch {
      // gone already
    }
  }
}

/** A label for messages from the client's file name. Never used as a path. */
function label(header) {
  let name = "";
  try {
    name = decodeURIComponent(String(header ?? ""));
  } catch {
    name = "";
  }
  name = basename(name.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120);
  return name || "The file";
}

/** Stream the request body to `path`, keeping at most `limit` bytes. Returns the full size sent. */
async function saveBody(req, path, limit) {
  let size = 0;
  const cap = new Transform({
    transform(chunk, _enc, done) {
      size += chunk.length;
      // Past the limit, keep reading (so the client is not cut off mid-write) but stop storing.
      if (size <= limit) done(null, chunk);
      else done();
    },
  });
  await pipeline(req, cap, createWriteStream(path));
  return size;
}

export function assetDetail(name) {
  const { library, store } = context();
  const a = library.get(name);
  return {
    name: a.name,
    kind: a.kind,
    description: a.description,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    images: a.images.map((im) => ({ n: im.n, file: im.file, width: im.width ?? null, height: im.height ?? null, bytes: im.bytes, mime: im.mime ?? null, url: mediaUrl(im.path) })),
    // Runs come from the asset record; takes from job records, which keep the
    // assets each job's refs used (the CLI, MCP and this server all record them).
    usedIn: a.usedIn ?? [],
    takes: store
      .list()
      .filter((j) => Array.isArray(j.assets) && j.assets.includes(a.name))
      .reverse()
      .map(jobView),
  };
}

export function registerLibrary(router, { catalog, maxUploadBytes = MAX_UPLOAD } = {}) {
  router.get("/api/vocab", () => ({ kinds: KINDS, roles: catalog.roles }));

  router.get("/api/library", () => {
    const { library } = context();
    return library.list().map((s) => {
      const a = library.get(s.name);
      return { ...s, cover: mediaUrl(a.images[0]?.path), usedIn: a.usedIn ?? [] };
    });
  });

  router.get("/api/library/:name", ({ params }) => assetDetail(params.name));

  router.post(
    "/api/library/incoming",
    async ({ req }) => {
      const dir = incomingDir();
      sweepIncoming(dir);
      const id = randomBytes(16).toString("hex");
      const part = join(dir, `${id}.part`);
      const name = label(req.headers["x-file-name"]);
      let size;
      try {
        size = await saveBody(req, part, maxUploadBytes);
      } catch (err) {
        rmSync(part, { force: true });
        throw err;
      }
      if (size > maxUploadBytes) {
        rmSync(part, { force: true });
        throw new HttpError(413, `${name} is over ${Math.round(maxUploadBytes / 1e6)} MB; nothing was saved.`);
      }
      if (size === 0) {
        rmSync(part, { force: true });
        throw f.invalid("file", `${name} is empty.`);
      }
      let info;
      try {
        // The library holds images only; core decides what is one, and how big it may be.
        info = checkLocalFile(part, { roots: [dir], kinds: ["image"] });
      } catch (err) {
        rmSync(part, { force: true });
        err.message = err.message.replaceAll(part, name);
        err.field = "file";
        throw err;
      }
      const file = `${id}${info.ext}`;
      renameSync(part, join(dir, file));
      return { token: `incoming:${file}`, name, kind: info.kind, mime: info.mime, bytes: info.bytes, width: info.width, height: info.height };
    },
    { raw: true },
  );

  router.post("/api/library", ({ body = {} }) => {
    const name = f.text(body, "name", { required: true });
    const kind = f.text(body, "kind", { required: true });
    const description = f.text(body, "description", { required: true });
    const images = f.strings(body, "images");
    const replace = f.flag(body, "replace");
    const { library, roots } = context();
    const incoming = incomingDir();
    const uploads = [];
    const paths = images.map((src) => {
      if (src.startsWith("incoming:")) {
        const m = src.match(TOKEN);
        if (!m || !existsSync(join(incoming, m[1]))) throw f.invalid("images", `"${src}" is not an upload waiting to be saved. Drop the file again.`);
        uploads.push(join(incoming, m[1]));
        return join(incoming, m[1]);
      }
      // The MCP save_asset rule: relative means inside runs/.
      return isAbsolute(src) ? src : join(RUNS_DIR, src);
    });
    // incoming first: it sits inside library/ under a hidden name, which the library root would refuse.
    library.save({ name, kind, description, images: paths, replace }, { roots: [incoming, ...roots] });
    for (const p of uploads) rmSync(p, { force: true });
    return assetDetail(name);
  });
}
```

Modify `web/server/api/look.mjs` with this change (unified diff: drop the `-` lines, add the `+` lines; `git apply` takes it as is):

```diff
--- a/web/server/api/look.mjs
+++ b/web/server/api/look.mjs
@@ -46,13 +46,6 @@
     return spendView(store, limits);
   });
 
-  router.get("/api/library", () => context().library.list());
-
-  router.get("/api/library/:name", ({ params }) => {
-    const a = context().library.get(params.name);
-    return { ...a, images: a.images.map(({ path, upload: _u, ...im }) => ({ ...im, url: mediaUrl(path) })) };
-  });
-
   router.post("/api/estimate", ({ body = {} }) => {
     const { store, limits } = context();
     return estimate(
```

Modify `web/server/app.mjs` with this change (unified diff: drop the `-` lines, add the `+` lines; `git apply` takes it as is):

```diff
--- a/web/server/app.mjs
+++ b/web/server/app.mjs
@@ -9,6 +9,7 @@
 import { registerLook } from "./api/look.mjs";
 import { registerGenerate } from "./api/generate.mjs";
 import { registerFrames } from "./api/frames.mjs";
+import { registerLibrary } from "./api/library.mjs";
 import { loadCatalog } from "../../cli/lib/models.mjs";
 
 export const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
@@ -30,6 +31,7 @@
   registerLook(router, { catalog, deps });
   registerGenerate(router, { catalog, deps, follower });
   registerFrames(router);
+  registerLibrary(router, { catalog });
 
   const server = createServer(createHandler({ key, router, distDir, media: serveMedia }));
   // A malformed request never reaches the handler; drop the socket quietly.
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && node --test tests/library.test.mjs tests/look.test.mjs`
Expected: PASS, 26 of 26.

Then run: `cd web && npm run test:server`
Expected: 103 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/server/api/library.mjs web/server/api/look.mjs web/server/app.mjs web/tests/library.test.mjs
git diff --cached --stat
git commit -m "Add library upload and save to the studio server

Raw-body uploads land in library/.incoming under a server-picked name and are checked by
core by content and size; refused files are deleted. Saves take upload tokens or paths in
runs/. Asset detail lists the takes whose refs used it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 7: Preset stills, preset endpoints, resolution choices

**Files:**
- Create: `web/server/stills.mjs`
- Create: `web/server/api/presets.mjs`
- Modify: `web/server/media.mjs`
- Modify: `web/server/api/look.mjs`
- Modify: `web/server/app.mjs`
- Create: `web/tests/presets.test.mjs` (test)

**Stills.** Every preset has a still at `docs/images/<preset-id>.png`, listed under `stills` in `docs/images/sources.json`. `stills.mjs` reads that list, keeps only safe names (`[a-z0-9-]+.png`) that exist, and `media.mjs` serves `/media/presets/<id>.png` from it alone, behind the same cookie as other media. A preset with no still gets `still: null` and a text card on the page.

**Presets.** `GET /api/presets` is core's `listPresets` without server paths, plus `hasPrompt` and `still`. `GET /api/presets/:id` adds the source prompt text that "Use this" puts in the prompt bar.

**Resolutions.** `listModels` gives video models an empty `resolutions` list; each route's captured contract has them. `/api/models` now adds `resolutionOptions` and `defaultResolution` from the first usable route (`input.enums.resolution`, else its `pricing.usdPerSecond` keys; default from `input.defaults.resolution`).

- [ ] **Step 1: Write the failing test**

Create `web/tests/presets.test.mjs`:

```js
import { KEY, tmp, req } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { createApp } = await import("../server/app.mjs");
const { presetStills, stillUrl } = await import("../server/stills.mjs");

let app, port;
before(async () => {
  app = createApp({ key: KEY, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());

describe("presetStills", () => {
  test("lists only files named in sources.json that exist, with safe names", () => {
    const dir = join(tmp, "stills");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.png"), "png");
    writeFileSync(
      join(dir, "sources.json"),
      JSON.stringify({ stills: [{ preset: "a", file: "a.png" }, { preset: "b", file: "missing.png" }, { preset: "c", file: "../secret.png" }] }),
    );
    const stills = presetStills(dir);
    assert.deepEqual([...stills.keys()], ["a"]);
    assert.equal(stillUrl("a", stills), "/media/presets/a.png");
    assert.equal(stillUrl("b", stills), null);
  });

  test("no sources.json means no stills, not an error", () => {
    assert.equal(presetStills(join(tmp, "nowhere")).size, 0);
  });
});

describe("preset endpoints", () => {
  test("the gallery lists every preset with its still URL and no server paths", async () => {
    const r = await req(port, "/api/presets");
    assert.equal(r.status, 200);
    const kt = r.json.find((p) => p.id === "kinetic-typography");
    assert.equal(kt.still, "/media/presets/kinetic-typography.png");
    assert.equal(kt.hasPrompt, true);
    assert.equal(kt.model, "minimax-h3");
    assert.ok(r.json.every((p) => !("sourcePromptPath" in p)));
  });

  test("one preset carries its source prompt text", async () => {
    const r = await req(port, "/api/presets/kinetic-typography");
    assert.equal(r.status, 200);
    assert.ok(r.json.prompt.length > 1000);
    assert.equal(r.json.durationS, 15);
  });

  test("an unknown preset is 400 with code 3", async () => {
    const r = await req(port, "/api/presets/nope");
    assert.equal(r.json.error.code, 3);
  });

  test("a still is served as a PNG with the media cookie; anything else under /media/presets is 404", async () => {
    const cookie = { cookie: `studio=${KEY}` };
    const r = await req(port, "/media/presets/kinetic-typography.png", { key: null, headers: cookie });
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "image/png");
    assert.equal(r.buf.subarray(1, 4).toString("latin1"), "PNG");
    assert.equal((await req(port, "/media/presets/nope.png", { key: null, headers: cookie })).status, 404);
    assert.equal((await req(port, "/media/presets/sources.json", { key: null, headers: cookie })).status, 404);
    assert.equal((await req(port, "/media/presets/kinetic-typography.png", { key: null })).status, 403);
  });
});

describe("model resolution choices", () => {
  test("a video model gets its first usable route's resolutions and default", async () => {
    const r = await req(port, "/api/models?capability=video");
    const s = r.json.find((m) => m.id === "seedance-2-5");
    assert.deepEqual(s.resolutionOptions, ["480p", "720p", "1080p"]);
    assert.equal(s.defaultResolution, "720p");
  });

  test("an image model keeps the resolutions listModels gives", async () => {
    const r = await req(port, "/api/models?capability=image");
    assert.deepEqual(r.json.find((m) => m.id === "gpt-image-2-5").resolutionOptions, ["1K", "2K", "4K"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && node --test tests/presets.test.mjs tests/look.test.mjs tests/media.test.mjs`
Expected: FAIL, `Cannot find module '.../web/server/stills.mjs'` (the look and media tests still pass: 27 of 28).

- [ ] **Step 3: Implement**

Create `web/server/stills.mjs`:

```js
// Preview stills for the preset gallery. They are unretouched frames of each
// preset's source video, kept in docs/images/ and listed with their preset id
// in docs/images/sources.json. Only files listed there are ever served.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../cli/lib/run.mjs";

export const STILLS_DIR = join(REPO_ROOT, "docs", "images");

/** Preset id → absolute path of its still. Empty when the list is missing or unreadable. */
export function presetStills(dir = STILLS_DIR) {
  const map = new Map();
  let list;
  try {
    list = JSON.parse(readFileSync(join(dir, "sources.json"), "utf8")).stills ?? [];
  } catch {
    return map; // no stills: the gallery shows text cards
  }
  for (const s of list) {
    if (typeof s?.preset !== "string" || typeof s?.file !== "string" || !/^[a-z0-9-]+\.png$/.test(s.file)) continue;
    const path = join(dir, s.file);
    if (existsSync(path)) map.set(s.preset, path);
  }
  return map;
}

export const stillUrl = (id, stills = presetStills()) => (stills.has(id) ? `/media/presets/${encodeURIComponent(id)}.png` : null);
```

Create `web/server/api/presets.mjs`:

```js
// The preset gallery. listPresets is core's view; this adds the still's URL
// and, for one preset, the source prompt text that "Use this" puts in the
// prompt bar. The absolute prompt path stays on the server.
import { existsSync, readFileSync } from "node:fs";
import { listPresets } from "../../../cli/core/views.mjs";
import { unknown } from "../../../cli/lib/errors.mjs";
import { presetStills, stillUrl } from "../stills.mjs";

const card = (p, stills) => {
  const { sourcePromptPath, guide: _guide, ...rest } = p;
  return { ...rest, hasPrompt: Boolean(sourcePromptPath && existsSync(sourcePromptPath)), still: stillUrl(p.id, stills) };
};

export function registerPresets(router, { catalog }) {
  router.get("/api/presets", () => {
    const stills = presetStills();
    return listPresets(catalog).map((p) => card(p, stills));
  });

  router.get("/api/presets/:id", ({ params }) => {
    const all = listPresets(catalog);
    const p = all.find((x) => x.id === params.id);
    if (!p) throw unknown(`No preset "${params.id}". Presets: ${all.map((x) => x.id).join(", ")}.`);
    const prompt = p.sourcePromptPath && existsSync(p.sourcePromptPath) ? readFileSync(p.sourcePromptPath, "utf8") : null;
    return { ...card(p, presetStills()), prompt };
  });
}
```

Modify `web/server/media.mjs` with this change (unified diff: drop the `-` lines, add the `+` lines; `git apply` takes it as is):

```diff
--- a/web/server/media.mjs
+++ b/web/server/media.mjs
@@ -1,10 +1,12 @@
 // Serves run outputs and library images to <video> and <img>. Only two roots,
 // real paths only, no hidden segments: the same confinement the MCP tools use.
+// Preset stills come from a fixed list (stills.mjs), never from a client path.
 import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
 import { extname, join, relative, sep } from "node:path";
 import { LIBRARY_DIR, RUNS_DIR, isInside } from "../../cli/lib/run.mjs";
 import { confinePath } from "../../cli/core/inputs.mjs";
 import { HARDENING, HttpError, streamFile } from "./http.mjs";
+import { presetStills } from "./stills.mjs";
 
 const TYPES = {
   ".mp4": "video/mp4",
@@ -34,6 +36,13 @@
 }
 
 export async function serveMedia(req, res, pathname) {
+  const still = pathname.match(/^\/media\/presets\/([a-z0-9-]+)\.png$/);
+  if (still) {
+    const file = presetStills().get(still[1]);
+    if (!file) throw new HttpError(404, "Not found.");
+    res.writeHead(200, { ...HARDENING, "content-type": "image/png", "content-length": statSync(file).size, "cache-control": "no-cache" });
+    return streamFile(res, file);
+  }
   const m = pathname.match(/^\/media\/(runs|library)\/(.+)$/);
   if (!m) throw new HttpError(404, "Not found.");
   let rel;
```

Modify `web/server/api/look.mjs` with this change (unified diff: drop the `-` lines, add the `+` lines; `git apply` takes it as is):

```diff
--- a/web/server/api/look.mjs
+++ b/web/server/api/look.mjs
@@ -1,8 +1,8 @@
 // Read-only endpoints. Each one calls a cli/core view and turns paths into
 // media URLs; none reserves or submits. /api/spend (like the event snapshot)
 // calls store.sweep(), which settles abandoned records, so it can write.
-import { loadCatalog } from "../../../cli/lib/models.mjs";
-import { status, listModels, listPresets, estimate, listRuns, getRun } from "../../../cli/core/views.mjs";
+import { loadCatalog, routesFor } from "../../../cli/lib/models.mjs";
+import { status, listModels, estimate, listRuns, getRun } from "../../../cli/core/views.mjs";
 import { context, jobView, spendView } from "../state.mjs";
 import { mediaUrl } from "../media.mjs";
 
@@ -12,9 +12,9 @@
     return status(catalog, { store, limits, ...(deps.credits ? { credits: deps.credits } : {}) });
   });
 
-  router.get("/api/models", ({ query }) => listModels(catalog, { capability: query.get("capability") || undefined }));
-
-  router.get("/api/presets", () => listPresets(catalog));
+  router.get("/api/models", ({ query }) =>
+    listModels(catalog, { capability: query.get("capability") || undefined }).map((m) => ({ ...m, ...resolutionChoices(catalog, m) })),
+  );
 
   router.get("/api/runs", () => listRuns());
 
@@ -64,3 +64,18 @@
     );
   });
 }
+
+/**
+ * Resolution choices for the prompt bar's chip. listModels carries image
+ * models' resolutions; a video model keeps its list on each route's captured
+ * contract, so this reads the first usable route's enum (the route submitJob
+ * tries first), falling back to the resolutions it has prices for.
+ */
+export function resolutionChoices(catalog, m) {
+  if (m.resolutions.length) return { resolutionOptions: m.resolutions, defaultResolution: null };
+  const model = catalog.list.find((x) => x.id === m.id);
+  const route = routesFor(catalog, model).find((r) => r.usable) ?? null;
+  const options = route?.input?.enums?.resolution ?? Object.keys(route?.pricing?.usdPerSecond ?? {});
+  const fallback = route?.input?.defaults?.resolution;
+  return { resolutionOptions: options.map(String), defaultResolution: fallback != null ? String(fallback) : null };
+}
```

Modify `web/server/app.mjs` with this change (unified diff: drop the `-` lines, add the `+` lines; `git apply` takes it as is):

```diff
--- a/web/server/app.mjs
+++ b/web/server/app.mjs
@@ -10,6 +10,7 @@
 import { registerGenerate } from "./api/generate.mjs";
 import { registerFrames } from "./api/frames.mjs";
 import { registerLibrary } from "./api/library.mjs";
+import { registerPresets } from "./api/presets.mjs";
 import { loadCatalog } from "../../cli/lib/models.mjs";
 
 export const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
@@ -32,6 +33,7 @@
   registerGenerate(router, { catalog, deps, follower });
   registerFrames(router);
   registerLibrary(router, { catalog });
+  registerPresets(router, { catalog });
 
   const server = createServer(createHandler({ key, router, distDir, media: serveMedia }));
   // A malformed request never reaches the handler; drop the socket quietly.
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && node --test tests/presets.test.mjs tests/look.test.mjs tests/media.test.mjs`
Expected: PASS, 35 of 35.

Then run: `cd web && npm run test:server`
Expected: 111 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add web/server/api/look.mjs web/server/api/presets.mjs web/server/app.mjs web/server/media.mjs web/server/stills.mjs web/tests/presets.test.mjs
git diff --cached --stat
git commit -m "Serve preset stills and resolution choices to the studio

Preset stills come from the fixed list in docs/images/sources.json, never a client path.
/api/presets/:id carries the source prompt; /api/models adds each video model's
resolution choices from its first usable route.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 8: Page types, file upload in the client, test fixtures

**Files:**
- Modify: `web/src/api/client.ts`
- Modify: `web/src/api/types.ts`
- Create: `web/src/test-fixtures.ts`
- Modify: `web/src/api/client.test.ts` (test)

`api(path, { file: { data, name } })` sends a Blob as the raw body with `content-type: application/octet-stream` and the URI-encoded name in `X-File-Name`, defaulting to POST. `types.ts` gains the shapes the new endpoints return. `src/test-fixtures.ts` holds page test data (`job()`, `estimate()`, `model()`) and `routes()`, a `fetch` stub keyed by path whose unlisted paths never resolve. It is not a `*.test.*` file, so importing it runs no tests.

- [ ] **Step 1: Write the failing test**

Modify `web/src/api/client.test.ts` with this change (unified diff: drop the `-` lines, add the `+` lines; `git apply` takes it as is):

```diff
--- a/web/src/api/client.test.ts
+++ b/web/src/api/client.test.ts
@@ -19,6 +19,19 @@
     expect(init.method).toBe("POST");
     expect(init.body).toBe('{"model":"x"}');
     expect(init.headers["content-type"]).toBe("application/json");
+  });
+
+  test("a file goes as the raw body, named in X-File-Name, never as JSON", async () => {
+    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
+    vi.stubGlobal("fetch", fetchMock);
+    const data = new Blob([new Uint8Array([1, 2, 3])]);
+    await api("/api/library/incoming", { file: { data, name: "zed pose.png" } });
+    const init = fetchMock.mock.calls[0][1];
+    expect(init.method).toBe("POST");
+    expect(init.body).toBe(data);
+    expect(init.headers["content-type"]).toBe("application/octet-stream");
+    expect(init.headers["x-file-name"]).toBe("zed%20pose.png");
+    expect(init.headers["x-studio-key"]).toBe("k-123");
   });
 
   test("an error response becomes an ApiError with core's code", async () => {
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run src/api/client.test.ts`
Expected: FAIL, 1 of 7: `expected 'GET' to be 'POST'`.

- [ ] **Step 3: Implement**

Modify `web/src/api/client.ts` with this change (unified diff: drop the `-` lines, add the `+` lines; `git apply` takes it as is):

```diff
--- a/web/src/api/client.ts
+++ b/web/src/api/client.ts
@@ -37,16 +37,28 @@
   }
 }
 
-export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
+export interface ApiInit {
+  method?: string;
+  /** Sent as JSON. */
+  body?: unknown;
+  /** Sent as the raw request body (uploads), with its name in X-File-Name. */
+  file?: { data: Blob; name: string };
+  signal?: AbortSignal;
+}
+
+export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
   const send = () => {
     const headers: Record<string, string> = { "x-studio-key": key };
-    if (init.body !== undefined) headers["content-type"] = "application/json";
-    return fetch(path, {
-      method: init.method ?? "GET",
-      headers,
-      body: init.body === undefined ? undefined : JSON.stringify(init.body),
-      signal: init.signal,
-    });
+    let body: BodyInit | undefined;
+    if (init.file) {
+      headers["content-type"] = "application/octet-stream";
+      headers["x-file-name"] = encodeURIComponent(init.file.name);
+      body = init.file.data;
+    } else if (init.body !== undefined) {
+      headers["content-type"] = "application/json";
+      body = JSON.stringify(init.body);
+    }
+    return fetch(path, { method: init.method ?? (init.file ? "POST" : "GET"), headers, body, signal: init.signal });
   };
   let res: Response;
   try {
```

Modify `web/src/api/types.ts` with this change (unified diff: drop the `-` lines, add the `+` lines; `git apply` takes it as is):

```diff
--- a/web/src/api/types.ts
+++ b/web/src/api/types.ts
@@ -16,7 +16,8 @@
   costSource: string;
   capability: "video" | "image" | "audio" | null;
   prompt: string | null;
-  durationS: number | null;
+  /** Some routes record the duration as text ("5"); show it with Number(). */
+  durationS: number | string | null;
   resolution: string | null;
   aspectRatio: string | null;
   failedOver: boolean;
@@ -41,6 +42,123 @@
   description: string;
   imageCount: number;
   updatedAt: string;
+  /** Only from GET /api/library; the SSE library event sends core's list without them. */
+  cover?: string | null;
+  usedIn?: string[];
+}
+
+export interface AssetDetail {
+  name: string;
+  kind: string;
+  description: string;
+  createdAt: string;
+  updatedAt: string;
+  images: { n: number; file: string; width: number | null; height: number | null; bytes: number; mime: string | null; url: string | null }[];
+  /** Film (run) slugs, from the asset record. */
+  usedIn: string[];
+  /** Jobs whose refs used this asset, newest first. */
+  takes: JobView[];
+}
+
+export interface IncomingFile {
+  token: string;
+  name: string;
+  kind: string;
+  mime: string;
+  bytes: number;
+  width: number | null;
+  height: number | null;
+}
+
+export interface Vocab {
+  kinds: string[];
+  roles: string[];
+}
+
+export interface ModelInfo {
+  id: string;
+  capability: "video" | "image" | "audio";
+  durationsS: number[];
+  aspectRatios: string[];
+  resolutions: string[];
+  resolutionOptions: string[];
+  defaultResolution: string | null;
+  refRoles: string[];
+  nativeAudio: boolean;
+  notes: string | null;
+  routes: { provider: string; price: string; verified: boolean; usable: boolean; skipReason: string | null }[];
+}
+
+export interface Estimate {
+  model: string;
+  provider: string | null;
+  providerModel: string | null;
+  routeUsable: boolean;
+  estimateUsd: number | null;
+  basis: string | null;
+  budgetUsd: number | null;
+  withinBudget: boolean;
+  perJobUsd: number | null;
+  withinPerJob: boolean;
+  availableTodayUsd: number;
+  withinDailyCap: boolean;
+  problems: string[];
+  allowed: boolean;
+}
+
+export interface RunSummary {
+  run: string;
+  modified: string;
+  files: number;
+  takes: number;
+}
+
+export interface PresetInfo {
+  id: string;
+  title: string;
+  tagline: string | null;
+  bestFor: string | null;
+  durationS: number | null;
+  aspectRatio: string | null;
+  model: string | null;
+  fidelity: string | null;
+  hasPrompt: boolean;
+  still: string | null;
+}
+
+export interface PresetDetail extends PresetInfo {
+  prompt: string | null;
+}
+
+export interface SubmitResult {
+  localJobId: string;
+  upstreamTaskId: string | null;
+  state: JobState;
+  provider: string;
+  providerModel: string;
+  failedOver: boolean;
+  estimateUsd: number;
+  basis: string;
+  refMapping: string[];
+  warnings: string[];
+  job: JobView;
+}
+
+export interface CheckResult {
+  outcome: "succeeded" | "failed" | "pending" | "no-artifact";
+  following: boolean;
+  message: string;
+  job: JobView;
+}
+
+export interface FramesResult {
+  sheet: string | null;
+  first: string | null;
+  last: string | null;
+  firstPath: string;
+  lastPath: string;
+  times: number[];
+  durationS: number;
 }
 
 export type StudioEvent =
```

Create `web/src/test-fixtures.ts`:

```ts
// Shared test data for page tests. Not a test file itself, so importing it runs no tests.
import type { Estimate, JobView, ModelInfo } from "./api/types";

export const job = (over: Partial<JobView> = {}): JobView => ({
  id: "j-20261031-abc123",
  state: "succeeded",
  run: "zed",
  model: "seedance-2-5",
  provider: "kie",
  providerModel: "bytedance/seedance-2-5",
  upstreamTaskId: "task-1",
  estimateUsd: 0.56,
  actualUsd: 0.5,
  countedUsd: 0.5,
  costSource: "task-record",
  capability: "video",
  prompt: "A fox runs.",
  durationS: 4,
  resolution: "480p",
  aspectRatio: "16:9",
  failedOver: false,
  error: null,
  media: ["/media/runs/zed/out.mp4"],
  createdAt: "2026-10-31T10:00:00.000Z",
  updatedAt: "2026-10-31T10:01:00.000Z",
  ...over,
});

export const estimate = (over: Partial<Estimate> = {}): Estimate => ({
  model: "seedance-2-5",
  provider: "kie",
  providerModel: "bytedance/seedance-2-5",
  routeUsable: true,
  estimateUsd: 0.56,
  basis: "4s × $0.14/s",
  budgetUsd: 3,
  withinBudget: true,
  perJobUsd: null,
  withinPerJob: true,
  availableTodayUsd: 9.44,
  withinDailyCap: true,
  problems: [],
  allowed: true,
  ...over,
});

export const model = (over: Partial<ModelInfo> = {}): ModelInfo => ({
  id: "seedance-2-5",
  capability: "video",
  durationsS: [4, 5, 6, 8, 10],
  aspectRatios: ["16:9", "9:16", "1:1"],
  resolutions: [],
  resolutionOptions: ["480p", "720p", "1080p"],
  defaultResolution: "720p",
  refRoles: ["identity", "style", "first_frame", "last_frame"],
  nativeAudio: true,
  notes: null,
  routes: [{ provider: "kie", price: "480p $0.14/s", verified: true, usable: true, skipReason: null }],
  ...over,
});

/** A fetch stub that answers by path. Unlisted paths never resolve, like a slow server. */
export function routes(table: Record<string, (init?: RequestInit) => unknown>) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split("?")[0];
    const answer = table[path];
    if (!answer) return new Promise<Response>(() => {});
    const value = answer(init);
    if (value instanceof Response) return Promise.resolve(value);
    return Promise.resolve(new Response(JSON.stringify(value), { status: 200 }));
  };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run src/api/client.test.ts`
Expected: PASS, 7 of 7.

Then run: `cd web && npx vitest run && npx tsc -p .`
Expected: 5 files, 17 tests pass; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/client.test.ts web/src/api/client.ts web/src/api/types.ts web/src/test-fixtures.ts
git diff --cached --stat
git commit -m "Add page types and file upload to the studio client

api() can send a file as the raw body. Adds the response types for generate, check,
frames, library and presets, and shared page test fixtures.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 9: Take formatting

**Files:**
- Create: `web/src/studio/format.ts`
- Create: `web/src/studio/format.test.ts` (test)

Pure functions the tile, viewer and prompt bar share:

- `takeCost`: actual cost, else `~estimate`, else `—`. `takeSpec`: `model · 5s · 720p`.
- `takeStatus`: `running m:ss`, `still checking`, or for a failed take the charge line from the job state: `refused by kie, not charged` (a create-time refusal), `not charged`, `charged $x`, `may have been charged`, `not sent, not charged`, with the reason as the first line of the error.
- `refusalReason`: the disabled-with-reason sentence from core's `estimate`: its first problem, "over the per-job limit by $X, raise it in Settings", "over today's cap by $X, raise it in Settings", or "over this job's $3.00 budget". A gap never shows as $0.00.

- [ ] **Step 1: Write the failing test**

Create `web/src/studio/format.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { elapsed, frameRatio, mediaFile, onlyBudgetBlocks, refusalReason, takeCost, takeSpec, takeStatus } from "./format";
import type { JobView } from "../api/types";
import { estimate, job } from "../test-fixtures";

const NOW = Date.parse("2026-10-31T10:01:05.000Z");

describe("tile text", () => {
  test("spec line and cost: actual when known, ~estimate otherwise", () => {
    expect(takeSpec(job())).toBe("seedance-2-5 · 4s · 480p");
    expect(takeSpec(job({ durationS: "5", resolution: null }))).toBe("seedance-2-5 · 5s");
    expect(takeCost(job())).toBe("$0.50");
    expect(takeCost(job({ actualUsd: null }))).toBe("~$0.56");
  });

  test("running shows elapsed time", () => {
    expect(elapsed("2026-10-31T10:00:00.000Z", NOW)).toBe("1:05");
    expect(takeStatus(job({ state: "submitted" }), NOW)).toEqual({ kind: "running", label: "running 1:05" });
  });

  test("each failed state says whether it was charged", () => {
    const label = (over: Partial<JobView>) => {
      const s = takeStatus(job({ error: "kie.ai: task failed: content policy\nmore", ...over }), NOW);
      return s.kind === "failed" ? [s.label, s.reason] : null;
    };
    expect(label({ state: "failed-confirmed-free", costSource: "create-rejected" })).toEqual(["refused by kie, not charged", "kie.ai: task failed: content policy"]);
    expect(label({ state: "failed-confirmed-free", costSource: "task-record" })?.[0]).toBe("not charged");
    expect(label({ state: "failed-charged", actualUsd: 0.4 })?.[0]).toBe("charged $0.40");
    expect(label({ state: "failed-unconfirmed" })?.[0]).toBe("may have been charged");
    expect(label({ state: "refused" })).toEqual(["not sent, not charged", "Stopped before sending."]);
  });

  test("uncertain is still checking; succeeded is done", () => {
    expect(takeStatus(job({ state: "uncertain" }), NOW)).toEqual({ kind: "uncertain", label: "still checking" });
    expect(takeStatus(job(), NOW)).toEqual({ kind: "done" });
  });

  test("media helpers", () => {
    expect(mediaFile("/media/runs/zed/out%202.mp4")).toBe("out 2.mp4");
    expect(frameRatio("9:16")).toBe("9 / 16");
    expect(frameRatio(null)).toBe("1 / 1");
  });
});

describe("refusalReason", () => {
  test("allowed is null", () => {
    expect(refusalReason(estimate())).toBeNull();
  });

  test("over today's cap names the gap", () => {
    expect(refusalReason(estimate({ withinDailyCap: false, availableTodayUsd: 0.16, allowed: false }))).toBe("over today's cap by $0.40, raise it in Settings");
  });

  test("over the per-job limit names the gap", () => {
    expect(refusalReason(estimate({ withinPerJob: false, perJobUsd: 0.5, allowed: false }))).toBe("over the per-job limit by $0.06, raise it in Settings");
  });

  test("a problem from core is shown as core worded it", () => {
    expect(refusalReason(estimate({ problems: ["seedance-2-5 generates 4/5/6s, not 2s."], allowed: false }))).toBe("seedance-2-5 generates 4/5/6s, not 2s.");
  });

  test("only the job budget blocking can be lifted", () => {
    const e = estimate({ estimateUsd: 4.2, withinBudget: false, allowed: false });
    expect(refusalReason(e)).toBe("over this job's $3.00 budget");
    expect(onlyBudgetBlocks(e)).toBe(true);
    expect(onlyBudgetBlocks(estimate({ withinBudget: false, withinDailyCap: false }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run src/studio/format.test.ts`
Expected: FAIL, `Failed to resolve import "./format"`.

- [ ] **Step 3: Implement**

Create `web/src/studio/format.ts`:

```ts
import type { Estimate, JobView } from "../api/types";

export const usd = (n: number) => `$${n.toFixed(2)}`;

/** A positive gap in dollars, never shown as $0.00. */
const gap = (a: number, b: number) => usd(Math.max(0.01, a - b));

const RUNNING = new Set(["reserved", "sending", "submitted"]);

/** The actual cost when known, else the estimate marked with ~. */
export function takeCost(job: JobView): string {
  if (job.actualUsd != null) return usd(job.actualUsd);
  if (job.estimateUsd != null) return `~${usd(job.estimateUsd)}`;
  return "—";
}

/** `model-id · 5s · 720p`, the engine line every tile shows before its cost. */
export function takeSpec(job: JobView): string {
  const parts = [job.model];
  if (job.durationS != null && job.durationS !== "") parts.push(`${Number(job.durationS)}s`);
  if (job.resolution) parts.push(job.resolution);
  return parts.join(" · ");
}

/** m:ss since `fromIso`. */
export function elapsed(fromIso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export type TakeStatus =
  | { kind: "running"; label: string }
  | { kind: "done" }
  | { kind: "uncertain"; label: string }
  | { kind: "failed"; label: string; reason: string };

/** What a tile says about its job, from the job state core recorded. */
export function takeStatus(job: JobView, now: number): TakeStatus {
  if (RUNNING.has(job.state)) return { kind: "running", label: `running ${elapsed(job.createdAt, now)}` };
  if (job.state === "uncertain") return { kind: "uncertain", label: "still checking" };
  if (job.state === "succeeded") return { kind: "done" };
  const reason = job.state === "refused" ? "Stopped before sending." : (job.error ?? "No reason given.").split("\n")[0];
  const label =
    job.state === "failed-confirmed-free"
      ? job.costSource === "create-rejected"
        ? `refused by ${job.provider}, not charged`
        : "not charged"
      : job.state === "failed-charged"
        ? job.actualUsd != null
          ? `charged ${usd(job.actualUsd)}`
          : "charged"
        : job.state === "failed-unconfirmed"
          ? "may have been charged"
          : "not sent, not charged";
  return { kind: "failed", label, reason };
}

/**
 * Why Generate is disabled, from core's estimate, or null when it may run.
 * Core decides; this only words its verdict and the gap.
 */
export function refusalReason(est: Estimate | null): string | null {
  if (!est) return null;
  if (est.problems.length) return est.problems[0];
  if (!est.routeUsable) return `No usable route for ${est.model}. Check provider keys in Settings.`;
  if (est.estimateUsd == null) return `No price for ${est.model} at these settings.`;
  if (!est.withinPerJob && est.perJobUsd != null) return `over the per-job limit by ${gap(est.estimateUsd, est.perJobUsd)}, raise it in Settings`;
  if (!est.withinDailyCap) return `over today's cap by ${gap(est.estimateUsd, est.availableTodayUsd)}, raise it in Settings`;
  if (!est.withinBudget && est.budgetUsd != null) return `over this job's ${usd(est.budgetUsd)} budget`;
  return null;
}

/** Only the job's own budget stands in the way, which the user may lift for this job. */
export function onlyBudgetBlocks(est: Estimate | null): boolean {
  return Boolean(est && !est.problems.length && est.routeUsable && est.estimateUsd != null && est.withinPerJob && est.withinDailyCap && !est.withinBudget);
}

/** The file name at the end of a /media URL. */
export function mediaFile(url: string): string {
  return decodeURIComponent(url.split("/").pop() ?? "");
}

export const isVideo = (url: string) => /\.(mp4|mov|webm)$/i.test(url);

/** CSS aspect-ratio for a take's frame; square when unknown. */
export function frameRatio(aspectRatio: string | null): string {
  const m = aspectRatio?.match(/^(\d+):(\d+)$/);
  return m ? `${m[1]} / ${m[2]}` : "1 / 1";
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run src/studio/format.test.ts`
Expected: PASS, 10 of 10.

Then run: `cd web && npx vitest run && npx tsc -p .`
Expected: 6 files, 27 tests pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/studio/format.test.ts web/src/studio/format.ts
git diff --cached --stat
git commit -m "Add take formatting for the studio page

Cost, spec line, status and charge wording for takes, and the disabled-with-reason sentence
from core's estimate.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 10: Shared prompt store

**Files:**
- Create: `web/src/studio/promptStore.ts`
- Create: `web/src/studio/promptStore.test.ts` (test)

One module-level store read through `useSyncExternalStore`, so the prompt bar, Reuse in the viewer, Library's "Use in prompt" and Presets' "Use this" all write the same draft. The working film lives in `localStorage` under `studio.run`.

- `fitToModel` keeps values the new model takes, else picks 5s, 16:9 and the route default resolution, and drops refs whose role the model does not take.
- `reuseJob` copies prompt, model, duration, aspect ratio and resolution, not refs (job records keep provider URLs, not asset names and roles).
- `applyPreset` fills the source prompt, the preset's model, duration and aspect ratio, and keeps the preset id so Generate sends `preset`.
- `estimateBody` is the camelCase shape `/api/estimate` already takes; `generateBody` is the MCP snake_case shape.

- [ ] **Step 1: Write the failing test**

Create `web/src/studio/promptStore.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { addRef, applyPreset, estimateBody, fitToModel, generateBody, getDraft, getRun, removeRef, resetForTests, reuseJob, setRun } from "./promptStore";
import { job, model } from "../test-fixtures";

beforeEach(() => resetForTests());

describe("promptStore", () => {
  test("Reuse copies a take's prompt and settings, and clears refs, preset and budget", () => {
    resetForTests({ refs: [{ source: "zed", role: "identity" }], preset: "x", budgetUsd: 5 });
    reuseJob(job({ durationS: "5", resolution: "720p", aspectRatio: "9:16" }));
    expect(getDraft()).toMatchObject({ prompt: "A fox runs.", model: "seedance-2-5", durationS: 5, resolution: "720p", aspectRatio: "9:16", refs: [], preset: null, budgetUsd: null });
  });

  test("Use this puts the preset's prompt and defaults in, and remembers the preset", () => {
    applyPreset({ id: "kinetic-typography", model: "minimax-h3", durationS: 15, aspectRatio: "16:9", prompt: "SOURCE" });
    expect(getDraft()).toMatchObject({ prompt: "SOURCE", model: "minimax-h3", durationS: 15, preset: "kinetic-typography" });
  });

  test("refs: adding the same asset and role twice keeps one; remove by index", () => {
    addRef({ source: "zed", role: "identity" });
    addRef({ source: "zed", role: "identity" });
    addRef({ source: "bottle", role: "style" });
    expect(getDraft().refs).toEqual([{ source: "zed", role: "identity" }, { source: "bottle", role: "style" }]);
    removeRef(0);
    expect(getDraft().refs).toEqual([{ source: "bottle", role: "style" }]);
  });

  test("fitToModel keeps settings the model takes and swaps the rest", () => {
    const m = model({ durationsS: [6, 10], aspectRatios: ["16:9"], resolutionOptions: ["768P", "2K"], defaultResolution: "768P", refRoles: ["first_frame"] });
    const d = { ...getDraft(), durationS: 10, aspectRatio: "21:9", resolution: "480p", refs: [{ source: "zed", role: "identity" }] };
    expect(fitToModel(m, d)).toEqual({ model: "seedance-2-5", durationS: 10, aspectRatio: "16:9", resolution: "768P", refs: [], budgetUsd: null });
  });

  test("the working film is remembered", () => {
    setRun("zethus-hero");
    expect(getRun()).toBe("zethus-hero");
    expect(localStorage.getItem("studio.run")).toBe("zethus-hero");
  });

  test("request bodies: camelCase for estimate, the MCP names for generate", () => {
    resetForTests({ prompt: "A fox", model: "seedance-2-5", durationS: 4, resolution: "480p", aspectRatio: "16:9", preset: "p1" });
    expect(estimateBody(getDraft(), model())).toEqual({ model: "seedance-2-5", durationS: 4, resolution: "480p", aspectRatio: "16:9", refs: [], budgetUsd: undefined });
    expect(generateBody(getDraft(), model(), "zed")).toEqual({
      run: "zed", prompt: "A fox", model: "seedance-2-5", duration_s: 4, preset: "p1", resolution: "480p", aspect_ratio: "16:9", refs: [], budget_usd: undefined,
    });
    const image = generateBody(getDraft(), model({ capability: "image" }), "zed");
    expect(image).not.toHaveProperty("duration_s");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run src/studio/promptStore.test.ts`
Expected: FAIL, `Failed to resolve import "./promptStore"`.

- [ ] **Step 3: Implement**

Create `web/src/studio/promptStore.ts`:

```ts
// The prompt bar's state, shared by every screen that fills it: Reuse on a
// take, "Use this" on a preset, "Use in prompt" on an asset. One module-level
// store read with useSyncExternalStore, so the bar keeps its draft when you
// switch tabs. The working film is kept here too, and remembered across reloads.
import { useSyncExternalStore } from "react";
import type { JobView, ModelInfo } from "../api/types";

export interface RefDraft {
  source: string;
  role: string;
}

export interface Draft {
  prompt: string;
  model: string;
  durationS: number | null;
  aspectRatio: string | null;
  resolution: string | null;
  refs: RefDraft[];
  preset: string | null;
  /** A per-job budget the user raised for this job; null keeps the catalog default. */
  budgetUsd: number | null;
}

export const EMPTY_DRAFT: Draft = {
  prompt: "",
  model: "",
  durationS: null,
  aspectRatio: null,
  resolution: null,
  refs: [],
  preset: null,
  budgetUsd: null,
};

const RUN_KEY = "studio.run";
const readRun = () => {
  try {
    return localStorage.getItem(RUN_KEY) ?? "";
  } catch {
    return "";
  }
};

let state = { draft: EMPTY_DRAFT, run: readRun() };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const getDraft = () => state.draft;
export const getRun = () => state.run;

export function setDraft(patch: Partial<Draft>) {
  state = { ...state, draft: { ...state.draft, ...patch } };
  emit();
}

export function setRun(run: string) {
  state = { ...state, run };
  try {
    localStorage.setItem(RUN_KEY, run);
  } catch {
    // private mode: the choice lasts for this page only
  }
  emit();
}

export function resetForTests(draft: Partial<Draft> = {}, run = "") {
  state = { draft: { ...EMPTY_DRAFT, ...draft }, run };
  emit();
}

export const useDraft = () => useSyncExternalStore(subscribe, getDraft);
export const useRun = () => useSyncExternalStore(subscribe, getRun);

/** Settings that suit `m`, keeping what the draft has where the model takes it. */
export function fitToModel(m: ModelInfo, d: Draft): Partial<Draft> {
  const keep = <T,>(options: T[], current: T | null, preferred: T | null): T | null => {
    if (!options.length) return null;
    if (current != null && options.includes(current)) return current;
    if (preferred != null && options.includes(preferred)) return preferred;
    return options[0];
  };
  return {
    model: m.id,
    durationS: m.capability === "video" ? keep(m.durationsS, d.durationS, 5) : null,
    aspectRatio: keep(m.aspectRatios, d.aspectRatio, "16:9"),
    resolution: keep(m.resolutionOptions, d.resolution, m.defaultResolution),
    refs: m.capability === "video" ? d.refs.filter((r) => m.refRoles.includes(r.role)) : d.refs,
    budgetUsd: null,
  };
}

/** Reuse: a take's prompt and settings back into the bar. Refs are not restored: a job keeps provider URLs, not the asset and role. */
export function reuseJob(job: JobView) {
  setDraft({
    prompt: job.prompt ?? "",
    model: job.model,
    durationS: job.durationS == null || job.durationS === "" ? null : Number(job.durationS),
    aspectRatio: job.aspectRatio,
    resolution: job.resolution,
    refs: [],
    preset: null,
    budgetUsd: null,
  });
}

/** Use this: a preset's source prompt and defaults. The prompt is the source to adapt, not to send as is. */
export function applyPreset(p: { id: string; model: string | null; durationS: number | null; aspectRatio: string | null; prompt: string | null }) {
  setDraft({
    prompt: p.prompt ?? "",
    model: p.model ?? state.draft.model,
    durationS: p.durationS,
    aspectRatio: p.aspectRatio,
    resolution: null,
    refs: [],
    preset: p.id,
    budgetUsd: null,
  });
}

export function addRef(ref: RefDraft) {
  const refs = state.draft.refs.filter((r) => !(r.source === ref.source && r.role === ref.role));
  setDraft({ refs: [...refs, ref] });
}

export function removeRef(index: number) {
  setDraft({ refs: state.draft.refs.filter((_, i) => i !== index) });
}

/** POST /api/estimate's body (camelCase, as that endpoint has always taken). */
export function estimateBody(d: Draft, m: ModelInfo) {
  return {
    model: d.model,
    durationS: m.capability === "video" ? (d.durationS ?? undefined) : undefined,
    resolution: d.resolution ?? undefined,
    aspectRatio: d.aspectRatio ?? undefined,
    refs: d.refs,
    budgetUsd: d.budgetUsd ?? undefined,
  };
}

/** POST /api/generate/{video,image}'s body: the MCP generate tools' argument names. */
export function generateBody(d: Draft, m: ModelInfo, run: string) {
  return {
    run,
    prompt: d.prompt,
    model: d.model,
    ...(m.capability === "video" ? { duration_s: d.durationS ?? undefined, preset: d.preset ?? undefined } : {}),
    resolution: d.resolution ?? undefined,
    aspect_ratio: d.aspectRatio ?? undefined,
    refs: d.refs,
    budget_usd: d.budgetUsd ?? undefined,
  };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run src/studio/promptStore.test.ts`
Expected: PASS, 6 of 6.

Then run: `cd web && npx vitest run && npx tsc -p .`
Expected: 7 files, 33 tests pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/studio/promptStore.test.ts web/src/studio/promptStore.ts
git diff --cached --stat
git commit -m "Add the studio prompt store

One shared draft for the prompt bar, Reuse, the Library and Presets, and the working film
kept in localStorage.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 11: Take tiles and the live job list

**Files:**
- Create: `web/src/studio/TakeTile.tsx`
- Create: `web/src/studio/useJobs.ts`
- Create: `web/src/studio/TakeTile.test.tsx` (test)
- Create: `web/src/studio/useJobs.test.ts` (test)

`TakeTile` is one take: the frame (video that plays on hover, image, or an empty frame while running) as a button named "Open take <id>", then the mono spec line with the cost in amber and `→ wavespeed` for a fallback, then the status line. The tests cover every state: succeeded, running, failed refused-at-create, failed may-have-been-charged, failed charged, uncertain and fallback.

`useJobs(run)` loads `/api/jobs?run=…&limit=200`, merges SSE `job` events into the list (newest first) and reloads on `hello` after a reconnect. `useNow` ticks once a second for the running clock.

- [ ] **Step 1: Write the failing test**

Create `web/src/studio/TakeTile.test.tsx`:

```tsx
import { describe, test, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TakeTile } from "./TakeTile";
import { job } from "../test-fixtures";

const NOW = Date.parse("2026-10-31T10:01:05.000Z");
const tile = (over: Parameters<typeof job>[0] = {}) => render(<TakeTile job={job(over)} now={NOW} onOpen={vi.fn()} />);

describe("TakeTile", () => {
  test("succeeded: the footage and the engine line in mono, cost in its own span", () => {
    const { container } = tile();
    expect(container.querySelector("video")).toHaveAttribute("src", "/media/runs/zed/out.mp4");
    expect(screen.getByText("seedance-2-5 · 4s · 480p").closest("p")).toHaveClass("mono");
    expect(screen.getByText("$0.50")).toHaveClass("take__cost");
  });

  test("running: elapsed time and the estimate, no footage yet", () => {
    const { container } = tile({ state: "submitted", actualUsd: null, media: [] });
    expect(screen.getByText("running 1:05")).toBeInTheDocument();
    expect(screen.getByText("~$0.56")).toBeInTheDocument();
    expect(container.querySelector("video")).toBeNull();
  });

  test("failed and refused at create: the reason and not charged", () => {
    tile({ state: "failed-confirmed-free", costSource: "create-rejected", actualUsd: 0, error: "kie.ai rejected the request (code 500: busy)" });
    expect(screen.getByText("kie.ai rejected the request (code 500: busy)")).toBeInTheDocument();
    expect(screen.getByText("refused by kie, not charged")).toBeInTheDocument();
  });

  test("failed with no cost record: may have been charged", () => {
    tile({ state: "failed-unconfirmed", actualUsd: null, error: "kie.ai: task task-1 failed: timeout" });
    expect(screen.getByText("may have been charged")).toBeInTheDocument();
  });

  test("failed and charged: says how much", () => {
    tile({ state: "failed-charged", actualUsd: 0.4, error: "content policy" });
    expect(screen.getByText("charged $0.40")).toBeInTheDocument();
  });

  test("uncertain: still checking, keeping the job id", () => {
    tile({ state: "uncertain", upstreamTaskId: null, media: [] });
    expect(screen.getByText(/still checking/)).toBeInTheDocument();
    expect(screen.getByText("j-20261031-abc123")).toBeInTheDocument();
  });

  test("a fallback take shows where it ran", () => {
    tile({ provider: "wavespeed", failedOver: true });
    expect(screen.getByText("→ wavespeed")).toBeInTheDocument();
  });

  test("clicking the frame opens the take", () => {
    const onOpen = vi.fn();
    render(<TakeTile job={job()} now={NOW} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Open take j-20261031-abc123" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "j-20261031-abc123" }));
  });
});
```

Create `web/src/studio/useJobs.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { mergeJob } from "./useJobs";
import { job } from "../test-fixtures";

describe("mergeJob", () => {
  test("a new job goes first; an update replaces the old copy in place of order", () => {
    const a = job({ id: "j-20261031-aaaaaa", createdAt: "2026-10-31T09:00:00.000Z" });
    const b = job({ id: "j-20261031-bbbbbb", createdAt: "2026-10-31T10:00:00.000Z", state: "submitted" });
    let list = mergeJob([a], b);
    expect(list.map((j) => j.id)).toEqual(["j-20261031-bbbbbb", "j-20261031-aaaaaa"]);
    list = mergeJob(list, { ...a, state: "failed-charged" });
    expect(list.map((j) => [j.id, j.state])).toEqual([["j-20261031-bbbbbb", "submitted"], ["j-20261031-aaaaaa", "failed-charged"]]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run src/studio/TakeTile.test.tsx src/studio/useJobs.test.ts`
Expected: FAIL, `Failed to resolve import "./TakeTile"` and `"./useJobs"`.

- [ ] **Step 3: Implement**

Create `web/src/studio/TakeTile.tsx`:

```tsx
import type { JobView } from "../api/types";
import { frameRatio, isVideo, takeCost, takeSpec, takeStatus } from "./format";

/** One take in the feed: the footage, then the engine line and what happened. */
export function TakeTile({ job, now, onOpen }: { job: JobView; now: number; onOpen: (job: JobView) => void }) {
  const status = takeStatus(job, now);
  const media = status.kind === "done" ? (job.media[0] ?? null) : null;
  return (
    <article className="take" data-state={status.kind}>
      <button type="button" className="take__frame" style={{ aspectRatio: frameRatio(job.aspectRatio) }} onClick={() => onOpen(job)} aria-label={`Open take ${job.id}`}>
        {media && isVideo(media) && (
          <video
            src={media}
            muted
            loop
            playsInline
            preload="metadata"
            onMouseEnter={(e) => void e.currentTarget.play()?.catch(() => {})}
            onMouseLeave={(e) => e.currentTarget.pause()}
          />
        )}
        {media && !isVideo(media) && <img src={media} alt="" loading="lazy" />}
        {!media && <span className="take__empty" aria-hidden="true" />}
      </button>
      <div className="take__info">
        <p className="take__spec mono">
          <span>{takeSpec(job)}</span>
          <span aria-hidden="true"> · </span>
          <span className="take__cost">{takeCost(job)}</span>
          {job.failedOver && <span className="take__via">→ {job.provider}</span>}
        </p>
        {status.kind === "running" && <p className="take__status mono">{status.label}</p>}
        {status.kind === "uncertain" && (
          <p className="take__status take__status--uncertain">
            {status.label} <code className="mono">{job.id}</code>
          </p>
        )}
        {status.kind === "failed" && (
          <p className="take__status take__status--failed">
            <span className="take__reason">{status.reason}</span> <span className="take__charged">{status.label}</span>
          </p>
        )}
      </div>
    </article>
  );
}
```

Create `web/src/studio/useJobs.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { JobView } from "../api/types";
import { onStudioEvent } from "../app/useStudio";

/** `job` in place of its old version, newest first. */
export function mergeJob(list: JobView[], job: JobView): JobView[] {
  return [job, ...list.filter((j) => j.id !== job.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The film's takes, kept live by SSE job events; reloaded when the stream reconnects. */
export function useJobs(run: string) {
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    const q = run ? `run=${encodeURIComponent(run)}&limit=200` : "limit=200";
    return api<JobView[]>(`/api/jobs?${q}`)
      .then((list) => {
        setJobs(list);
        setError(null);
      })
      .catch((e: ApiError) => setError(e.message));
  }, [run]);

  useEffect(() => {
    setJobs([]);
    reload();
  }, [reload]);

  useEffect(
    () =>
      onStudioEvent((e) => {
        if (e.event === "hello") reload();
        if (e.event === "job" && (!run || e.data.run === run)) setJobs((prev) => mergeJob(prev, e.data));
      }),
    [run, reload],
  );

  return { jobs, error, reload };
}

/** The current time, ticking every `ms`, for elapsed clocks. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run src/studio/TakeTile.test.tsx src/studio/useJobs.test.ts`
Expected: PASS, 9 of 9.

Then run: `cd web && npx vitest run && npx tsc -p .`
Expected: 9 files, 42 tests pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/studio/TakeTile.test.tsx web/src/studio/TakeTile.tsx web/src/studio/useJobs.test.ts web/src/studio/useJobs.ts
git diff --cached --stat
git commit -m "Add take tiles and the live job feed

Each tile shows the engine line in mono with its cost, and every state in plain words:
running, still checking, refused and not charged, charged, fallback.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 12: Prompt bar with live price

**Files:**
- Create: `web/src/studio/useEstimate.ts`
- Create: `web/src/studio/PromptBar.tsx`
- Create: `web/src/theme/controls.css`
- Modify: `web/src/theme/base.css`
- Create: `web/src/studio/PromptBar.test.tsx` (test)

`useEstimate` posts the draft to `/api/estimate` 300 ms after the last change (aborting the previous request) and again on every SSE `spend` event, since the cap moves as other jobs spend. `PromptBar` holds the textarea and the chips (native labelled selects for model, duration, aspect ratio and resolution; `+ @asset` opens an asset and role picker). The Generate button shows core's price (`Generate $0.56`) or is disabled with the reason in a `role="status"` line beside it. When only the catalog's default job budget blocks, "Allow $X for this job" sets `budget_usd`; the per-job limit and the cap still apply in core. A refusal at submit time shows as an alert.

`controls.css` holds the shared button and save-form styles, imported once from `base.css`.

- [ ] **Step 1: Write the failing test**

Create `web/src/studio/PromptBar.test.tsx`:

```tsx
import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PromptBar } from "./PromptBar";
import { getDraft, resetForTests } from "./promptStore";
import { estimate, job, model, routes } from "../test-fixtures";
import type { Estimate } from "../api/types";

const ready = { prompt: "A fox runs through snow.", model: "seedance-2-5", durationS: 4, resolution: "480p", aspectRatio: "16:9" };

function bar(answer: Partial<Estimate>, extra: Record<string, (init?: RequestInit) => unknown> = {}) {
  const fetchMock = vi.fn(routes({ "/api/estimate": () => estimate(answer), ...extra }));
  vi.stubGlobal("fetch", fetchMock);
  const onSubmitted = vi.fn();
  render(<PromptBar models={[model()]} assets={[{ name: "zed", kind: "character", description: "Zed.", imageCount: 1, updatedAt: "" }]} roles={["identity", "style"]} run="zed" onSubmitted={onSubmitted} />);
  return { fetchMock, onSubmitted };
}

beforeEach(() => resetForTests(ready, "zed"));

describe("PromptBar", () => {
  test("the Generate button carries core's live price", async () => {
    const { fetchMock } = bar({});
    const button = await screen.findByRole("button", { name: "Generate $0.56" });
    expect(button).toBeEnabled();
    const sent = JSON.parse(fetchMock.mock.calls.find((c) => c[0] === "/api/estimate")![1]!.body as string);
    expect(sent).toMatchObject({ model: "seedance-2-5", durationS: 4, resolution: "480p", aspectRatio: "16:9" });
  });

  test("over today's cap: disabled, saying by how much", async () => {
    bar({ withinDailyCap: false, availableTodayUsd: 0.16, allowed: false });
    expect(await screen.findByText("over today's cap by $0.40, raise it in Settings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate $0.56" })).toBeDisabled();
  });

  test("over the per-job limit: disabled, saying by how much", async () => {
    bar({ withinPerJob: false, perJobUsd: 0.5, allowed: false });
    expect(await screen.findByText("over the per-job limit by $0.06, raise it in Settings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate $0.56" })).toBeDisabled();
  });

  test("a setting the model does not take: disabled with core's words", async () => {
    bar({ problems: ["seedance-2-5 generates 4/5/6s, not 2s."], allowed: false });
    expect(await screen.findByText("seedance-2-5 generates 4/5/6s, not 2s.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate/ })).toBeDisabled();
  });

  test("an empty prompt: disabled until one is written", async () => {
    resetForTests({ ...ready, prompt: "" }, "zed");
    bar({});
    expect(await screen.findByText("Write a prompt.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "A fox" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate $0.56" })).toBeEnabled());
  });

  test("only the job budget in the way: one click lifts it for this job", async () => {
    bar({ estimateUsd: 4.2, withinBudget: false, allowed: false });
    fireEvent.click(await screen.findByRole("button", { name: "Allow $4.20 for this job" }));
    expect(getDraft().budgetUsd).toBe(4.2);
  });

  test("Generate posts the MCP shape to the video endpoint and hands back the result", async () => {
    const submitted = { localJobId: "j-20261031-abc123", job: job({ state: "submitted" }) };
    const { fetchMock, onSubmitted } = bar({}, { "/api/generate/video": () => submitted });
    fireEvent.click(await screen.findByRole("button", { name: "Generate $0.56" }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(submitted));
    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/generate/video")!;
    expect(JSON.parse(call[1]!.body as string)).toMatchObject({ run: "zed", prompt: ready.prompt, duration_s: 4, aspect_ratio: "16:9" });
  });

  test("a refusal at submit is shown as an alert", async () => {
    const refused = () => new Response(JSON.stringify({ error: { code: 2, message: "Refused, nothing spent. Over the cap." } }), { status: 402 });
    bar({}, { "/api/generate/video": refused });
    fireEvent.click(await screen.findByRole("button", { name: "Generate $0.56" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Refused, nothing spent. Over the cap.");
  });

  test("an @asset chip is added with a role and can be removed", async () => {
    bar({});
    fireEvent.click(screen.getByRole("button", { name: "+ @asset" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Role" }), { target: { value: "style" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(getDraft().refs).toEqual([{ source: "zed", role: "style" }]);
    fireEvent.click(screen.getByRole("button", { name: "Remove @zed style" }));
    expect(getDraft().refs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run src/studio/PromptBar.test.tsx`
Expected: FAIL, `Failed to resolve import "./PromptBar"`.

- [ ] **Step 3: Implement**

Create `web/src/studio/useEstimate.ts`:

```ts
import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Estimate, ModelInfo } from "../api/types";
import { onStudioEvent } from "../app/useStudio";
import { estimateBody, type Draft } from "./promptStore";

/**
 * Core's estimate for the draft, asked `delay` ms after the last change and
 * again whenever today's spend moves (another job may have used the cap).
 * Free: /api/estimate reserves nothing and calls no provider.
 */
export function useEstimate(draft: Draft, model: ModelInfo | null, delay = 300) {
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spendTick, setSpendTick] = useState(0);
  const body = model ? JSON.stringify(estimateBody(draft, model)) : null;

  useEffect(() => onStudioEvent((e) => e.event === "spend" && setSpendTick((n) => n + 1)), []);

  useEffect(() => {
    if (!body) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<Estimate>("/api/estimate", { method: "POST", body: JSON.parse(body), signal: ctrl.signal })
        .then((e) => {
          setEstimate(e);
          setError(null);
        })
        .catch((e: ApiError) => {
          if (ctrl.signal.aborted) return;
          setEstimate(null);
          setError(e.message);
        });
    }, delay);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [body, delay, spendTick]);

  return { estimate: body ? estimate : null, error: body ? error : null };
}
```

Create `web/src/studio/PromptBar.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { AssetSummary, ModelInfo, SubmitResult } from "../api/types";
import { onlyBudgetBlocks, refusalReason, usd } from "./format";
import { addRef, fitToModel, generateBody, removeRef, setDraft, useDraft } from "./promptStore";
import { useEstimate } from "./useEstimate";

interface Props {
  models: ModelInfo[];
  assets: AssetSummary[];
  /** Every reference role core knows; image models take any of them. */
  roles: string[];
  run: string;
  onSubmitted: (r: SubmitResult) => void;
}

/** A chip: a labelled native select, so it works from the keyboard and with screen readers. */
function Chip<T extends string | number>({ label, value, options, format = String, onChange }: { label: string; value: T | null; options: T[]; format?: (v: T) => string; onChange: (v: T) => void }) {
  if (!options.length) return null;
  return (
    <label className="chip">
      <span className="chip__label">{label}</span>
      <select
        className="chip__select mono"
        value={value == null ? "" : String(value)}
        onChange={(e) => {
          const hit = options.find((o) => String(o) === e.target.value);
          if (hit != null) onChange(hit);
        }}
      >
        {value == null && <option value="">—</option>}
        {value != null && !options.includes(value) && <option value={String(value)}>{format(value)} (not offered)</option>}
        {options.map((o) => (
          <option key={String(o)} value={String(o)}>
            {format(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

function RefPicker({ assets, roles }: { assets: AssetSummary[]; roles: string[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  if (!roles.length) return null;
  if (!open) {
    return (
      <button type="button" className="chip chip--add" onClick={() => setOpen(true)} disabled={!assets.length} title={assets.length ? undefined : "Save an asset in the Library first"}>
        + @asset
      </button>
    );
  }
  const pickedName = name || assets[0]?.name || "";
  const pickedRole = role || roles[0];
  return (
    <span className="ref-picker" role="group" aria-label="Add an asset reference">
      <select aria-label="Asset" className="chip__select mono" value={pickedName} onChange={(e) => setName(e.target.value)}>
        {assets.map((a) => (
          <option key={a.name} value={a.name}>
            @{a.name}
          </option>
        ))}
      </select>
      <select aria-label="Role" className="chip__select mono" value={pickedRole} onChange={(e) => setRole(e.target.value)}>
        {roles.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="chip"
        onClick={() => {
          if (pickedName) addRef({ source: pickedName, role: pickedRole });
          setOpen(false);
        }}
      >
        Add
      </button>
      <button type="button" className="chip chip--quiet" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </span>
  );
}

export function PromptBar({ models, assets, roles, run, onSubmitted }: Props) {
  const draft = useDraft();
  const model = models.find((m) => m.id === draft.model) ?? null;
  const { estimate, error: estimateError } = useEstimate(draft, model);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // First visit: start on the first video model, with settings it takes.
  useEffect(() => {
    if (draft.model || !models.length) return;
    const first = models.find((m) => m.capability === "video") ?? models[0];
    setDraft(fitToModel(first, draft));
  }, [models, draft]);

  const reason = estimateError ?? refusalReason(estimate) ?? (!run ? "Pick a film to work in." : !draft.prompt.trim() ? "Write a prompt." : null);
  const price = estimate?.estimateUsd != null ? usd(estimate.estimateUsd) : "…";
  const roleChoices = model?.capability === "video" ? model.refRoles : roles;

  async function generate() {
    if (!model) return;
    setSending(true);
    setFailure(null);
    try {
      const path = model.capability === "image" ? "/api/generate/image" : "/api/generate/video";
      const r = await api<SubmitResult>(path, { method: "POST", body: generateBody(draft, model, run) });
      onSubmitted(r);
    } catch (e) {
      setFailure(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="prompt-bar" aria-label="Prompt">
      {draft.preset && (
        <p className="prompt-bar__note">
          From preset <span className="mono">{draft.preset}</span>: this is the source prompt. Adapt it to your subject before generating.
        </p>
      )}
      <textarea
        className="prompt-bar__text"
        aria-label="Prompt"
        placeholder="Describe the shot…"
        rows={3}
        value={draft.prompt}
        onChange={(e) => setDraft({ prompt: e.target.value })}
      />
      <div className="prompt-bar__row">
        <div className="prompt-bar__chips">
          <Chip
            label="Model"
            value={draft.model || null}
            options={models.map((m) => m.id)}
            onChange={(id) => {
              const m = models.find((x) => x.id === id);
              if (m) setDraft(fitToModel(m, draft));
            }}
          />
          {model?.capability === "video" && <Chip label="Duration" value={draft.durationS} options={model.durationsS} format={(s) => `${s}s`} onChange={(durationS) => setDraft({ durationS, budgetUsd: null })} />}
          {model && <Chip label="Aspect ratio" value={draft.aspectRatio} options={model.aspectRatios} onChange={(aspectRatio) => setDraft({ aspectRatio })} />}
          {model && <Chip label="Resolution" value={draft.resolution} options={model.resolutionOptions} onChange={(resolution) => setDraft({ resolution, budgetUsd: null })} />}
          {draft.refs.map((r, i) => (
            <span key={`${r.source}:${r.role}`} className="chip chip--ref mono">
              @{r.source} · {r.role}
              <button type="button" className="chip__remove" aria-label={`Remove @${r.source} ${r.role}`} onClick={() => removeRef(i)}>
                ×
              </button>
            </span>
          ))}
          <RefPicker assets={assets} roles={roleChoices} />
        </div>
        <div className="prompt-bar__go">
          <button type="button" className="generate" disabled={Boolean(reason) || sending || !estimate} aria-describedby={reason ? "generate-reason" : undefined} onClick={generate}>
            {sending ? "Sending…" : "Generate"} <span className="mono">{price}</span>
          </button>
        </div>
      </div>
      {reason && (
        <p id="generate-reason" className="prompt-bar__reason" role="status">
          {reason}
          {onlyBudgetBlocks(estimate) && estimate?.estimateUsd != null && (
            <button type="button" className="prompt-bar__lift" onClick={() => setDraft({ budgetUsd: estimate.estimateUsd })}>
              Allow {usd(estimate.estimateUsd)} for this job
            </button>
          )}
        </p>
      )}
      {failure && (
        <p className="prompt-bar__failure" role="alert">
          {failure}
        </p>
      )}
    </section>
  );
}
```

Create `web/src/theme/controls.css`:

```css
/* Buttons and the save-to-library form, shared by the Studio, Library and Presets screens. Tokens only. */

.button {
  display: inline-flex; align-items: center; gap: var(--space-2);
  padding: 6px var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
  background: var(--surface-2); color: var(--text); font-size: var(--text-sm); cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}
.button:hover:not(:disabled) { background: var(--surface-3); }
.button:disabled { color: var(--text-3); cursor: not-allowed; }
.button--quiet { background: transparent; border-color: transparent; color: var(--text-2); }
.button--quiet:hover:not(:disabled) { color: var(--text); }

.save-asset { display: grid; gap: var(--space-1); padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-2); font-size: var(--text-sm); }
.save-asset label { color: var(--text-2); }
.save-asset input:not([type="checkbox"]), .save-asset select, .save-asset textarea {
  background: var(--surface-1); color: var(--text); border: 1px solid var(--line); border-radius: var(--radius-sm);
  padding: 5px var(--space-2); font: inherit; font-size: var(--text-sm);
}
.save-asset__hint { margin: 0 0 var(--space-1); color: var(--text-3); font-size: var(--text-xs); }
.save-asset__replace { display: flex; gap: var(--space-2); align-items: center; font-size: var(--text-xs); margin-top: var(--space-1); }
.save-asset__error { margin: 0; color: var(--bad-ink); font-size: var(--text-sm); }
.save-asset__actions { display: flex; gap: var(--space-2); margin-top: var(--space-2); }
```

Modify `web/src/theme/base.css` with this change (unified diff: drop the `-` lines, add the `+` lines; `git apply` takes it as is):

```diff
--- a/web/src/theme/base.css
+++ b/web/src/theme/base.css
@@ -4,6 +4,7 @@
 @import "@fontsource/ibm-plex-mono/400.css";
 @import "@fontsource/ibm-plex-mono/500.css";
 @import "./tokens.css";
+@import "./controls.css";
 
 *, *::before, *::after { box-sizing: border-box; }
 html, body, #root { height: 100%; }
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run src/studio/PromptBar.test.tsx`
Expected: PASS, 9 of 9.

Then run: `cd web && npx vitest run && npx tsc -p .`
Expected: 10 files, 51 tests pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/studio/PromptBar.test.tsx web/src/studio/PromptBar.tsx web/src/studio/useEstimate.ts web/src/theme/base.css web/src/theme/controls.css
git diff --cached --stat
git commit -m "Add the studio prompt bar with live price

Generate carries core's live estimate, or is disabled with the reason (over the cap or the
per-job limit by how much, or core's own words). Chips for model, duration, aspect ratio,
resolution and @asset refs.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 13: Take viewer, film picker and the Studio screen

**Files:**
- Create: `web/src/library/SaveAssetForm.tsx`
- Create: `web/src/studio/TakeViewer.tsx`
- Create: `web/src/studio/FilmPicker.tsx`
- Create: `web/src/studio/studio.css`
- Create: `web/src/studio/StudioScreen.tsx`
- Create: `web/src/studio/TakeViewer.test.tsx` (test)
- Create: `web/src/studio/StudioScreen.test.tsx` (test)

`TakeViewer` is a dialog: the take large, the facts in mono (cost in amber, route, ratio, state, job id), the prompt, and the buttons. **Reuse** fills the prompt bar and closes. **Save to library** (image takes) opens `SaveAssetForm` with the take's path in its run. **Frames** (video takes) calls `/api/frames`, shows the sheet, and offers to save the first or last frame, since the library keeps images. **Check again** (submitted or uncertain takes) shows core's answer. Escape closes.

`FilmPicker` is "Working in": a select of run folders plus "New film…", which takes a slug (`a-z`, `0-9`, dashes). `StudioScreen` loads films (picking the newest when none is set), video and image models (audio models are left out), the library and the vocabulary, and lays out the feed (newest first, filtered to the working film), the prompt bar under it and a collapsed chat rail reading "Arrives in a later build." The feed is a CSS grid, not true masonry.

- [ ] **Step 1: Write the failing test**

Create `web/src/studio/TakeViewer.test.tsx`:

```tsx
import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TakeViewer } from "./TakeViewer";
import { getDraft, resetForTests } from "./promptStore";
import { job, routes } from "../test-fixtures";

const NOW = Date.parse("2026-10-31T10:01:05.000Z");
const KINDS = ["character", "product", "location", "style"];

beforeEach(() => resetForTests({ prompt: "something else", refs: [{ source: "zed", role: "identity" }] }, "zed"));

describe("TakeViewer", () => {
  test("Reuse fills the prompt bar with the take's prompt and settings, then closes", () => {
    const onClose = vi.fn();
    render(<TakeViewer job={job({ durationS: 5, resolution: "720p", aspectRatio: "9:16" })} kinds={KINDS} now={NOW} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Reuse" }));
    expect(getDraft()).toMatchObject({ prompt: "A fox runs.", model: "seedance-2-5", durationS: 5, resolution: "720p", aspectRatio: "9:16", refs: [] });
    expect(onClose).toHaveBeenCalled();
  });

  test("Frames asks for the take's file in its run and shows the sheet", async () => {
    const fetchMock = vi.fn(
      routes({ "/api/frames": () => ({ sheet: "/media/runs/zed/out-frames/sheet.jpg", first: null, last: null, firstPath: "zed/out-frames/first.png", lastPath: "zed/out-frames/last.png", times: [], durationS: 4 }) }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<TakeViewer job={job()} kinds={KINDS} now={NOW} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Frames" }));
    expect(await screen.findByAltText("8 frames from out.mp4")).toHaveAttribute("src", "/media/runs/zed/out-frames/sheet.jpg");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ run: "zed", video: "out.mp4" });
    fireEvent.click(screen.getByRole("button", { name: "Save first frame to library" }));
    expect(screen.getByRole("form", { name: "Save to library" })).toBeInTheDocument();
  });

  test("an image take saves to the library from its path in the run", async () => {
    const fetchMock = vi.fn(routes({ "/api/library": () => ({ name: "zed", images: [], usedIn: [], takes: [] }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<TakeViewer job={job({ capability: "image", media: ["/media/runs/zed/ref.png"] })} kinds={KINDS} now={NOW} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save to library" }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Zed, the mascot." } });
    fireEvent.click(screen.getByRole("button", { name: "Save 1 image" }));
    expect(await screen.findByText("Saved as @zed.")).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({ name: "zed", kind: "character", images: ["zed/ref.png"] });
  });

  test("an uncertain take offers Check again and shows core's answer", async () => {
    const refusal = () => new Response(JSON.stringify({ error: { code: 5, message: "Job j-20261031-abc123 may exist at kie, but no task id came back. Do not resubmit." } }), { status: 409 });
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/jobs/j-20261031-abc123/check": refusal })));
    render(<TakeViewer job={job({ state: "uncertain", upstreamTaskId: null, media: [] })} kinds={KINDS} now={NOW} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Do not resubmit."));
  });

  test("Escape closes", () => {
    const onClose = vi.fn();
    render(<TakeViewer job={job()} kinds={KINDS} now={NOW} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
```

Create `web/src/studio/StudioScreen.test.tsx`:

```tsx
import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { StudioScreen } from "./StudioScreen";
import { resetForTests } from "./promptStore";
import { estimate, job, model, routes } from "../test-fixtures";

const older = job({ id: "j-20261031-aaaaaa", createdAt: "2026-10-31T09:00:00.000Z", prompt: "Older take." });
const newer = job({ id: "j-20261031-bbbbbb", createdAt: "2026-10-31T10:00:00.000Z", prompt: "Newer take.", durationS: 5, resolution: "720p" });

beforeEach(() => {
  resetForTests({}, "");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      routes({
        "/api/runs": () => [{ run: "zed", modified: "", files: 2, takes: 2 }],
        "/api/models": () => [model(), model({ id: "suno-music", capability: "audio" })],
        "/api/library": () => [],
        "/api/vocab": () => ({ kinds: ["character"], roles: ["identity"] }),
        "/api/jobs": () => [newer, older],
        "/api/estimate": () => estimate(),
      }),
    ),
  );
});

describe("StudioScreen", () => {
  test("opens on the newest film and shows its takes, newest first", async () => {
    render(<StudioScreen />);
    expect(await screen.findByRole("combobox", { name: "Working in" })).toHaveValue("zed");
    const feed = screen.getByRole("region", { name: "Takes" });
    const opens = await within(feed).findAllByRole("button", { name: /Open take/ });
    expect(opens.map((b) => b.getAttribute("aria-label"))).toEqual(["Open take j-20261031-bbbbbb", "Open take j-20261031-aaaaaa"]);
  });

  test("audio models are left out of the model chip", async () => {
    render(<StudioScreen />);
    const chip = await screen.findByRole("combobox", { name: "Model" });
    expect(within(chip).queryByRole("option", { name: "suno-music" })).toBeNull();
  });

  test("Reuse in the viewer fills the prompt bar", async () => {
    render(<StudioScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Open take j-20261031-bbbbbb" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reuse" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("Newer take.");
    expect(screen.getByRole("combobox", { name: "Duration" })).toHaveValue("5");
    expect(screen.getByRole("combobox", { name: "Resolution" })).toHaveValue("720p");
  });

  test("the chat panel is a collapsed placeholder for now", async () => {
    render(<StudioScreen />);
    expect(screen.getByRole("complementary", { name: "Chat" })).toHaveTextContent("Arrives in a later build.");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run src/studio/TakeViewer.test.tsx src/studio/StudioScreen.test.tsx`
Expected: FAIL, `Failed to resolve import "./StudioScreen"` and `"./TakeViewer"`.

- [ ] **Step 3: Implement**

Create `web/src/library/SaveAssetForm.tsx`:

```tsx
import { useId, useState } from "react";
import { api, ApiError } from "../api/client";
import type { AssetDetail } from "../api/types";

interface Props {
  /** Upload tokens ("incoming:…") or paths inside runs/ ("zed/out.png"). */
  images: string[];
  kinds: string[];
  /** A name to start from, such as the film's. */
  suggestedName?: string;
  onSaved: (asset: AssetDetail) => void;
  onCancel: () => void;
}

/** Name, kind and description for a new asset. Core checks all three and the images. */
export function SaveAssetForm({ images, kinds, suggestedName = "", onSaved, onCancel }: Props) {
  const id = useId();
  const [name, setName] = useState(suggestedName);
  const [kind, setKind] = useState(kinds[0] ?? "");
  const [description, setDescription] = useState("");
  const [replace, setReplace] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onSaved(await api<AssetDetail>("/api/library", { method: "POST", body: { name, kind, description, images, replace } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="save-asset" onSubmit={save} aria-label="Save to library">
      <label htmlFor={`${id}-name`}>Name</label>
      <input id={`${id}-name`} className="mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="zed" autoComplete="off" />
      <p className="save-asset__hint">Lowercase letters, digits and hyphens. You will use it as @{name || "name"}.</p>
      <label htmlFor={`${id}-kind`}>Kind</label>
      <select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value)}>
        {kinds.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-description`}>Description</label>
      <textarea id={`${id}-description`} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Reused word for word in prompts." />
      <label className="save-asset__replace">
        <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace an asset with this name (the old one is kept in its history)
      </label>
      {error && (
        <p className="save-asset__error" role="alert">
          {error}
        </p>
      )}
      <div className="save-asset__actions">
        <button type="submit" className="button" disabled={saving || !name || !description.trim() || !images.length}>
          {saving ? "Saving…" : `Save ${images.length} image${images.length === 1 ? "" : "s"}`}
        </button>
        <button type="button" className="button button--quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
```

Create `web/src/studio/TakeViewer.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { CheckResult, FramesResult, JobView } from "../api/types";
import { SaveAssetForm } from "../library/SaveAssetForm";
import { isVideo, mediaFile, takeCost, takeSpec, takeStatus } from "./format";
import { reuseJob } from "./promptStore";

const CHECKABLE = new Set(["submitted", "uncertain"]);

/** One take, large, with what was asked for and what it cost, and the three things to do with it. */
export function TakeViewer({ job, kinds, now, onClose }: { job: JobView; kinds: string[]; now: number; onClose: () => void }) {
  const [frames, setFrames] = useState<FramesResult | null>(null);
  const [saving, setSaving] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<"frames" | "check" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const media = job.media[0] ?? null;
  const status = takeStatus(job, now);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async <T,>(what: "frames" | "check", fn: () => Promise<T>) => {
    setBusy(what);
    setNote(null);
    try {
      return await fn();
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : String(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const showFrames = () =>
    run("frames", () => api<FramesResult>("/api/frames", { method: "POST", body: { run: job.run, video: mediaFile(media!) } })).then((r) => r && setFrames(r));
  const checkAgain = () => run("check", () => api<CheckResult>(`/api/jobs/${job.id}/check`, { method: "POST" })).then((r) => r && setNote(r.message));

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-labelledby="viewer-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="viewer__panel">
        <div className="viewer__media">
          {media && isVideo(media) && <video src={media} controls autoPlay loop playsInline />}
          {media && !isVideo(media) && <img src={media} alt={job.prompt ?? "Take"} />}
          {!media && <p className="viewer__nomedia">{status.kind === "running" ? "Still generating." : "No file for this take."}</p>}
          {frames?.sheet && <img className="viewer__sheet" src={frames.sheet} alt={`8 frames from ${mediaFile(media ?? "")}`} />}
        </div>
        <aside className="viewer__side">
          <header className="viewer__head">
            <h2 id="viewer-title" className="mono">
              {takeSpec(job)}
            </h2>
            <button ref={closeRef} type="button" className="button button--quiet" onClick={onClose} aria-label="Close">
              ×
            </button>
          </header>
          <dl className="viewer__facts mono">
            <dt>cost</dt>
            <dd className="viewer__cost">
              {takeCost(job)} <span className="viewer__source">{job.costSource}</span>
            </dd>
            <dt>route</dt>
            <dd>
              {job.provider} · {job.providerModel ?? "?"}
              {job.failedOver && " (fallback)"}
            </dd>
            <dt>ratio</dt>
            <dd>{job.aspectRatio ?? "—"}</dd>
            <dt>state</dt>
            <dd>{job.state}</dd>
            <dt>job</dt>
            <dd>{job.id}</dd>
          </dl>
          {status.kind === "failed" && (
            <p className="viewer__failed">
              {status.reason} <strong>{status.label}</strong>
            </p>
          )}
          {job.prompt && <p className="viewer__prompt">{job.prompt}</p>}
          <div className="viewer__actions">
            <button
              type="button"
              className="button"
              onClick={() => {
                reuseJob(job);
                onClose();
              }}
            >
              Reuse
            </button>
            {media && !isVideo(media) && (
              <button type="button" className="button" onClick={() => setSaving([`${job.run}/${mediaFile(media)}`])}>
                Save to library
              </button>
            )}
            {media && isVideo(media) && (
              <button type="button" className="button" disabled={busy === "frames"} onClick={showFrames}>
                {busy === "frames" ? "Reading frames…" : "Frames"}
              </button>
            )}
            {CHECKABLE.has(job.state) && (
              <button type="button" className="button" disabled={busy === "check"} onClick={checkAgain}>
                {busy === "check" ? "Checking…" : "Check again"}
              </button>
            )}
          </div>
          {media && isVideo(media) && !frames && <p className="viewer__hint">The library keeps images. Open Frames to save a frame of this take.</p>}
          {frames && (
            <div className="viewer__actions">
              <button type="button" className="button button--quiet" onClick={() => setSaving([frames.firstPath])}>
                Save first frame to library
              </button>
              <button type="button" className="button button--quiet" onClick={() => setSaving([frames.lastPath])}>
                Save last frame to library
              </button>
            </div>
          )}
          {note && (
            <p className="viewer__note" role="status">
              {note}
            </p>
          )}
          {saving && (
            <SaveAssetForm
              images={saving}
              kinds={kinds}
              suggestedName={job.run}
              onSaved={(a) => {
                setSaving(null);
                setNote(`Saved as @${a.name}.`);
              }}
              onCancel={() => setSaving(null)}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
```

Create `web/src/studio/FilmPicker.tsx`:

```tsx
import { useState } from "react";
import type { RunSummary } from "../api/types";

// Mirrors core's run slug rule for instant feedback; the server checks it again.
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/;
const NEW = "__new__";

/** "Working in": the run folder new takes are filed in. A new film's folder is made by its first take. */
export function FilmPicker({ runs, run, onChange }: { runs: RunSummary[]; run: string; onChange: (run: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [slug, setSlug] = useState("");
  const valid = SLUG.test(slug);
  const known = runs.some((r) => r.run === run);

  if (adding) {
    return (
      <form
        className="film-picker"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onChange(slug);
          setAdding(false);
          setSlug("");
        }}
      >
        <label className="film-picker__label" htmlFor="new-film">
          New film
        </label>
        <input id="new-film" className="mono" value={slug} onChange={(e) => setSlug(e.target.value.trim())} placeholder="zethus-hero" autoFocus autoComplete="off" />
        <button type="submit" className="button" disabled={!valid}>
          Start
        </button>
        <button type="button" className="button button--quiet" onClick={() => setAdding(false)}>
          Cancel
        </button>
        {slug && !valid && <span className="film-picker__hint">Lowercase letters, digits and hyphens.</span>}
      </form>
    );
  }

  return (
    <div className="film-picker">
      <label className="film-picker__label" htmlFor="film">
        Working in
      </label>
      <select id="film" className="mono" value={run} onChange={(e) => (e.target.value === NEW ? setAdding(true) : onChange(e.target.value))}>
        {!run && <option value="">Pick a film</option>}
        {run && !known && <option value={run}>{run} (new)</option>}
        {runs.map((r) => (
          <option key={r.run} value={r.run}>
            {r.run}
          </option>
        ))}
        <option value={NEW}>New film…</option>
      </select>
    </div>
  );
}
```

Create `web/src/studio/studio.css`:

```css
/* Studio: feed in the middle, prompt bar at the bottom, chat rail on the right.
   Tokens only (theme/tokens.css). Amber is for Generate and costs, nothing else. */

.studio { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-4); height: 100%; }
.studio__main { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: var(--space-3); min-height: 0; }

/* Working in */
.film-picker { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; font-size: var(--text-sm); }
.film-picker__label { color: var(--text-2); }
.film-picker select, .film-picker input {
  background: var(--surface-2); color: var(--text); border: 1px solid var(--line); border-radius: var(--radius-sm);
  padding: 5px var(--space-2); font-size: var(--text-sm);
}
.film-picker__hint { color: var(--warn); font-size: var(--text-xs); }

/* Feed */
.feed { overflow-y: auto; min-height: 0; padding-right: var(--space-1); }
.feed__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--space-4) var(--space-3); align-items: start; }
.feed__empty, .feed__error { color: var(--text-2); margin: var(--space-6) 0; max-width: 60ch; }
.feed__error { color: var(--bad-ink); }

.take { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.take__frame {
  display: block; width: 100%; padding: 0; border: 1px solid var(--line); border-radius: var(--radius-md);
  background: var(--surface-1); overflow: hidden; cursor: zoom-in;
}
.take__frame video, .take__frame img { display: block; width: 100%; height: 100%; object-fit: cover; }
.take__empty { display: block; width: 100%; height: 100%; background: var(--surface-2); }
.take[data-state="running"] .take__empty {
  background: linear-gradient(100deg, var(--surface-2) 30%, var(--surface-3) 50%, var(--surface-2) 70%);
  background-size: 200% 100%; animation: take-wait 1.6s linear infinite;
}
@keyframes take-wait { to { background-position: -200% 0; } }
.take[data-state="failed"] .take__frame { border-color: var(--bad); }
.take[data-state="failed"] .take__empty { background: var(--bad-surface); }
.take[data-state="uncertain"] .take__frame { border-color: var(--warn); border-style: dashed; }

.take__info { display: flex; flex-direction: column; gap: 2px; }
.take__spec { margin: 0; font-size: var(--text-xs); color: var(--text-2); display: flex; flex-wrap: wrap; column-gap: 0; }
.take__cost { color: var(--accent); }
.take__via { margin-left: var(--space-2); color: var(--text); }
.take__status { margin: 0; font-size: var(--text-xs); color: var(--text-2); }
.take__status--uncertain { color: var(--warn); }
.take__status--failed { color: var(--bad-ink); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.take__charged { font-weight: 500; white-space: nowrap; }

/* Prompt bar */
.prompt-bar {
  display: flex; flex-direction: column; gap: var(--space-2);
  padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface-1);
}
.prompt-bar__note { margin: 0; font-size: var(--text-xs); color: var(--text-2); }
.prompt-bar__text {
  width: 100%; resize: vertical; min-height: 64px; max-height: 40vh;
  background: transparent; color: var(--text); border: 0; font: inherit; font-size: var(--text-md); line-height: 1.5;
}
.prompt-bar__text:focus-visible { outline: none; }
.prompt-bar:focus-within { border-color: var(--surface-3); }
.prompt-bar__row { display: flex; align-items: flex-end; gap: var(--space-3); }
.prompt-bar__chips { display: flex; flex-wrap: wrap; gap: var(--space-2); flex: 1; min-width: 0; }
.prompt-bar__go { margin-left: auto; }
.prompt-bar__reason { margin: 0; font-size: var(--text-sm); color: var(--warn); display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.prompt-bar__lift { background: none; border: 0; padding: 0; color: var(--text); text-decoration: underline; cursor: pointer; font-size: var(--text-sm); }
.prompt-bar__failure { margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); background: var(--bad-surface); color: var(--bad-ink); font-size: var(--text-sm); white-space: pre-line; }

.chip {
  display: inline-flex; align-items: center; gap: var(--space-1);
  padding: 3px var(--space-2); border: 1px solid var(--line); border-radius: 999px;
  background: var(--surface-2); color: var(--text); font-size: var(--text-xs);
}
.chip__label { color: var(--text-3); }
.chip__select { background: transparent; color: var(--text); border: 0; font-size: var(--text-xs); padding: 0; cursor: pointer; }
.chip__select option { background: var(--surface-2); }
.chip--add { cursor: pointer; color: var(--text-2); }
.chip--add:hover:not(:disabled) { color: var(--text); background: var(--surface-3); }
.chip--add:disabled { color: var(--text-3); cursor: not-allowed; }
.chip--quiet { background: transparent; border-color: transparent; color: var(--text-2); cursor: pointer; }
.chip--ref { padding-right: var(--space-1); }
.chip__remove { border: 0; background: none; color: var(--text-2); cursor: pointer; padding: 0 var(--space-1); font-size: var(--text-sm); line-height: 1; }
.chip__remove:hover { color: var(--text); }
.ref-picker { display: inline-flex; align-items: center; gap: var(--space-1); padding: 2px var(--space-2); border: 1px solid var(--surface-3); border-radius: 999px; }

.generate {
  display: inline-flex; align-items: center; gap: var(--space-2);
  padding: var(--space-2) var(--space-4); border: 0; border-radius: var(--radius-md);
  background: var(--accent); color: var(--accent-ink); font-weight: 600; font-size: var(--text-md); cursor: pointer;
  transition: filter var(--dur-fast) var(--ease-out);
}
.generate:hover:not(:disabled) { filter: brightness(1.08); }
.generate:disabled { background: var(--surface-3); color: var(--text-3); cursor: not-allowed; }

/* Chat rail: collapsed until the chat plan lands. */
.chat-slot {
  width: 44px; display: flex; flex-direction: column; align-items: center; gap: var(--space-2);
  padding: var(--space-3) 0; border-left: 1px solid var(--line);
}
.chat-slot__title { writing-mode: vertical-rl; color: var(--text-2); font-size: var(--text-sm); }
.chat-slot__note { writing-mode: vertical-rl; margin: 0; color: var(--text-3); font-size: var(--text-xs); }

/* Take viewer */
.viewer {
  position: fixed; inset: 0; z-index: 10; display: grid; place-items: center; padding: var(--space-5);
  background: color-mix(in srgb, var(--bg) 86%, transparent);
}
.viewer__panel {
  display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: var(--space-4);
  width: min(1280px, 100%); max-height: 100%; overflow: hidden;
  padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface-1);
}
.viewer__media { display: flex; flex-direction: column; gap: var(--space-3); min-height: 0; overflow-y: auto; }
.viewer__media video, .viewer__media img { width: 100%; max-height: 70vh; object-fit: contain; background: var(--bg); border-radius: var(--radius-md); }
.viewer__sheet { max-height: none; }
.viewer__nomedia { color: var(--text-2); padding: var(--space-6); text-align: center; background: var(--surface-2); border-radius: var(--radius-md); }
.viewer__side { display: flex; flex-direction: column; gap: var(--space-3); min-height: 0; overflow-y: auto; }
.viewer__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
.viewer__head h2 { margin: 0; font-size: var(--text-md); font-weight: 500; }
.viewer__facts { display: grid; grid-template-columns: auto 1fr; gap: 2px var(--space-3); margin: 0; font-size: var(--text-xs); }
.viewer__facts dt { color: var(--text-3); }
.viewer__facts dd { margin: 0; color: var(--text); overflow-wrap: anywhere; }
.viewer__cost { color: var(--accent); }
.viewer__source { color: var(--text-3); }
.viewer__failed { margin: 0; color: var(--bad-ink); font-size: var(--text-sm); }
.viewer__prompt { margin: 0; white-space: pre-wrap; font-size: var(--text-sm); color: var(--text-2); max-height: 30vh; overflow-y: auto; }
.viewer__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.viewer__hint, .viewer__note { margin: 0; font-size: var(--text-xs); color: var(--text-2); }
.viewer__note { color: var(--text); white-space: pre-line; }

/* Narrow windows: no chat rail, the viewer stacks. */
@media (max-width: 760px) {
  .studio { grid-template-columns: minmax(0, 1fr); }
  .chat-slot { display: none; }
  .feed__grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
  .prompt-bar__row { flex-direction: column; align-items: stretch; }
  .generate { justify-content: center; }
  .viewer { padding: var(--space-2); }
  .viewer__panel { grid-template-columns: minmax(0, 1fr); overflow-y: auto; }
}
```

Create `web/src/studio/StudioScreen.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { AssetSummary, JobView, ModelInfo, RunSummary, Vocab } from "../api/types";
import { onStudioEvent } from "../app/useStudio";
import { FilmPicker } from "./FilmPicker";
import { PromptBar } from "./PromptBar";
import { TakeTile } from "./TakeTile";
import { TakeViewer } from "./TakeViewer";
import { getRun, setRun, useRun } from "./promptStore";
import { useJobs, useNow } from "./useJobs";
import "./studio.css";

export function StudioScreen() {
  const run = useRun();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [vocab, setVocab] = useState<Vocab>({ kinds: [], roles: [] });
  const [openId, setOpenId] = useState<string | null>(null);
  const { jobs, error, reload } = useJobs(run);
  const now = useNow();

  const loadRuns = useCallback(
    () =>
      api<RunSummary[]>("/api/runs")
        .then((list) => {
          setRuns(list);
          if (!getRun() && list.length) setRun(list[0].run); // first visit: the newest film
        })
        .catch(() => {}),
    [],
  );

  useEffect(() => {
    loadRuns();
    // The banner in App reports a server that is down; these just stay empty.
    api<ModelInfo[]>("/api/models").then((m) => setModels(m.filter((x) => x.capability !== "audio"))).catch(() => {});
    api<AssetSummary[]>("/api/library").then(setAssets).catch(() => {});
    api<Vocab>("/api/vocab").then(setVocab).catch(() => {});
  }, [loadRuns]);

  useEffect(() => onStudioEvent((e) => e.event === "library" && setAssets(e.data)), []);

  const open: JobView | null = jobs.find((j) => j.id === openId) ?? null;

  return (
    <div className="studio">
      <div className="studio__main">
        <FilmPicker runs={runs} run={run} onChange={setRun} />
        <section className="feed" aria-label="Takes">
          {error && <p className="feed__error">{error}</p>}
          {!error && !jobs.length && <p className="feed__empty">{run ? `No takes in ${run} yet. Write a prompt below.` : "Pick a film, or start a new one, then write a prompt below."}</p>}
          {jobs.length > 0 && (
            <div className="feed__grid">
              {jobs.map((j) => (
                <TakeTile key={j.id} job={j} now={now} onOpen={(job) => setOpenId(job.id)} />
              ))}
            </div>
          )}
        </section>
        <PromptBar models={models} assets={assets} roles={vocab.roles} run={run} onSubmitted={() => {
            loadRuns();
            reload();
          }}
        />
      </div>
      <aside className="chat-slot" aria-label="Chat">
        <span className="chat-slot__title">Chat</span>
        <p className="chat-slot__note">Arrives in a later build.</p>
      </aside>
      {open && <TakeViewer job={open} kinds={vocab.kinds} now={now} onClose={() => setOpenId(null)} />}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run src/studio/TakeViewer.test.tsx src/studio/StudioScreen.test.tsx`
Expected: PASS, 9 of 9.

Then run: `cd web && npx vitest run && npx tsc -p .`
Expected: 12 files, 60 tests pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/library/SaveAssetForm.tsx web/src/studio/FilmPicker.tsx web/src/studio/StudioScreen.test.tsx web/src/studio/StudioScreen.tsx web/src/studio/TakeViewer.test.tsx web/src/studio/TakeViewer.tsx web/src/studio/studio.css
git diff --cached --stat
git commit -m "Add the take viewer, film picker and Studio screen

Open a take to Reuse it, save it to the library, pull its frames or check it again. The
feed follows the working film, newest first, with the prompt bar below and a collapsed
chat placeholder.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 14: Library screen

**Files:**
- Create: `web/src/library/LibraryScreen.tsx`
- Create: `web/src/library/library.css`
- Create: `web/src/library/LibraryScreen.test.tsx` (test)

Kind filters (core's `KINDS` as toggle buttons), a drop zone (plus a file input for the keyboard) that uploads each file and lists accepted ones in a tray with any refusals as alerts, then "Save N as an asset" with `SaveAssetForm`. The asset list shows each `@name` in mono with its cover; the panel for one asset shows its images, the films that used it and the takes (with cost), and "Use in prompt" adds an `@asset` chip with a role and opens the Studio.

- [ ] **Step 1: Write the failing test**

Create `web/src/library/LibraryScreen.test.tsx`:

```tsx
import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LibraryScreen } from "./LibraryScreen";
import { getDraft, resetForTests } from "../studio/promptStore";
import { job, routes } from "../test-fixtures";

const list = [
  { name: "zed", kind: "character", description: "Zed.", imageCount: 2, updatedAt: "", cover: "/media/library/zed/1.png", usedIn: ["zethus-hero"] },
  { name: "warm", kind: "style", description: "Warm light.", imageCount: 1, updatedAt: "", cover: null, usedIn: [] },
];
const zed = {
  name: "zed",
  kind: "character",
  description: "Zed, the mascot.",
  createdAt: "",
  updatedAt: "",
  images: [{ n: 1, file: "1.png", width: 512, height: 512, bytes: 10, mime: "image/png", url: "/media/library/zed/1.png" }],
  usedIn: ["zethus-hero"],
  takes: [job({ id: "j-20261031-cccccc", run: "zethus-hero" })],
};

function stub(extra: Record<string, (init?: RequestInit) => unknown> = {}) {
  const fetchMock = vi.fn(
    routes({
      "/api/library": () => list,
      "/api/vocab": () => ({ kinds: ["character", "product", "location", "style"], roles: ["identity", "style", "first_frame"] }),
      "/api/library/zed": () => zed,
      ...extra,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  resetForTests({}, "zed");
  window.location.hash = "#/library";
});

describe("LibraryScreen", () => {
  test("shows each asset's @name and filters by kind", async () => {
    stub();
    render(<LibraryScreen />);
    const grid = await screen.findByRole("list", { name: "Assets" });
    expect(await within(grid).findByText("@zed")).toHaveClass("mono");
    expect(within(grid).getByText("@warm")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "style" }));
    expect(within(grid).queryByText("@zed")).toBeNull();
    expect(within(grid).getByText("@warm")).toBeInTheDocument();
  });

  test("a refused drop shows core's reason", async () => {
    const refusal = () => new Response(JSON.stringify({ error: { code: 3, field: "file", message: "clip.mp4 is not a image file (checked by its content, not its name)." } }), { status: 400 });
    stub({ "/api/library/incoming": refusal });
    render(<LibraryScreen />);
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
    fireEvent.drop(screen.getByLabelText("Drop images here"), { dataTransfer: { files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("clip.mp4 is not a image file");
    expect(screen.getByRole("button", { name: "Save 0 as an asset" })).toBeDisabled();
  });

  test("an accepted drop saves as an asset with its upload token", async () => {
    const fetchMock = stub({ "/api/library/incoming": () => ({ token: "incoming:" + "a".repeat(32) + ".png", name: "zed.png", kind: "image", mime: "image/png", bytes: 3, width: 1, height: 1 }) });
    render(<LibraryScreen />);
    fireEvent.drop(screen.getByLabelText("Drop images here"), { dataTransfer: { files: [new File(["x"], "zed.png", { type: "image/png" })] } });
    fireEvent.click(await screen.findByRole("button", { name: "Save 1 as an asset" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "zed" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Zed, the mascot." } });
    fireEvent.click(screen.getByRole("button", { name: "Save 1 image" }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[0] === "/api/library" && c[1]?.method === "POST");
      expect(JSON.parse(post![1]!.body as string)).toMatchObject({ name: "zed", kind: "character", images: ["incoming:" + "a".repeat(32) + ".png"] });
    });
  });

  test("an asset's panel lists its films and takes, and Use in prompt adds an @asset chip", async () => {
    stub();
    render(<LibraryScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /@zed/ }));
    const panel = await screen.findByRole("region", { name: "@zed" });
    expect(within(panel).getByText("zethus-hero")).toBeInTheDocument();
    expect(within(panel).getByText(/seedance-2-5 · 4s · 480p/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Use in prompt" }));
    expect(getDraft().refs).toEqual([{ source: "zed", role: "identity" }]);
    expect(window.location.hash).toBe("#/studio");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run src/library/LibraryScreen.test.tsx`
Expected: FAIL, `Failed to resolve import "./LibraryScreen"`.

- [ ] **Step 3: Implement**

Create `web/src/library/LibraryScreen.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { AssetDetail, AssetSummary, IncomingFile, Vocab } from "../api/types";
import { onStudioEvent } from "../app/useStudio";
import { takeCost, takeSpec } from "../studio/format";
import { addRef, setRun } from "../studio/promptStore";
import { SaveAssetForm } from "./SaveAssetForm";
import "./library.css";

interface Drop {
  id: number;
  name: string;
  preview: string | null;
  token: string | null;
  error: string | null;
}

const objectUrl = (file: File) => (typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null);
let nextDrop = 1;

function goToStudio() {
  window.location.hash = "#/studio";
}

/** One asset: its images, where it was used, and a way into the prompt bar. */
function AssetPanel({ name, roles, onClose }: { name: string; roles: string[]; onClose: () => void }) {
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState("");

  useEffect(() => {
    setAsset(null);
    api<AssetDetail>(`/api/library/${encodeURIComponent(name)}`)
      .then(setAsset)
      .catch((e: ApiError) => setError(e.message));
  }, [name]);

  if (error) return <p className="asset-panel__error" role="alert">{error}</p>;
  if (!asset) return <p className="asset-panel__loading">Loading @{name}…</p>;
  const pickedRole = role || (asset.kind === "style" && roles.includes("style") ? "style" : roles.includes("identity") ? "identity" : (roles[0] ?? ""));

  return (
    <section className="asset-panel" aria-label={`@${asset.name}`}>
      <header className="asset-panel__head">
        <h2 className="mono">@{asset.name}</h2>
        <button type="button" className="button button--quiet" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <p className="asset-panel__kind">{asset.kind}</p>
      <p className="asset-panel__description">{asset.description}</p>
      <div className="asset-panel__images">
        {asset.images.map((im) =>
          im.url ? <img key={im.n} src={im.url} alt={`${asset.name}#${im.n}`} title={`${asset.name}#${im.n} · ${im.width ?? "?"}×${im.height ?? "?"}`} /> : null,
        )}
      </div>
      <div className="asset-panel__use">
        <label htmlFor="asset-role">Role</label>
        <select id="asset-role" className="mono" value={pickedRole} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button"
          disabled={!pickedRole}
          onClick={() => {
            addRef({ source: asset.name, role: pickedRole });
            goToStudio();
          }}
        >
          Use in prompt
        </button>
      </div>
      <h3>Used in</h3>
      {asset.usedIn.length ? <p className="mono asset-panel__runs">{asset.usedIn.join(", ")}</p> : <p className="asset-panel__none">Not used in a film yet.</p>}
      <h3>Takes</h3>
      {asset.takes.length ? (
        <ul className="asset-panel__takes">
          {asset.takes.map((t) => (
            <li key={t.id}>
              <span className="mono">
                {takeSpec(t)} · <span className="asset-panel__cost">{takeCost(t)}</span> · {t.state}
              </span>
              <button
                type="button"
                className="button button--quiet"
                onClick={() => {
                  setRun(t.run);
                  goToStudio();
                }}
              >
                Show in {t.run}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="asset-panel__none">No takes have used it yet.</p>
      )}
    </section>
  );
}

export function LibraryScreen() {
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [vocab, setVocab] = useState<Vocab>({ kinds: [], roles: [] });
  const [kind, setKind] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [drops, setDrops] = useState<Drop[]>([]);
  const [saving, setSaving] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api<AssetSummary[]>("/api/library").then(setAssets).catch(() => {}), []);
  useEffect(() => {
    load();
    api<Vocab>("/api/vocab").then(setVocab).catch(() => {});
  }, [load]);
  // The event carries core's list without covers, so read the full list again.
  useEffect(() => onStudioEvent((e) => e.event === "library" && load()), [load]);

  const update = (id: number, patch: Partial<Drop>) => setDrops((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  async function take(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const id = nextDrop++;
      setDrops((list) => [...list, { id, name: file.name, preview: objectUrl(file), token: null, error: null }]);
      try {
        const r = await api<IncomingFile>("/api/library/incoming", { file: { data: file, name: file.name } });
        update(id, { token: r.token });
      } catch (e) {
        update(id, { error: e instanceof ApiError ? e.message : String(e) });
      }
    }
  }

  const clearDrops = () => {
    drops.forEach((d) => d.preview && URL.revokeObjectURL?.(d.preview));
    setDrops([]);
    setSaving(false);
  };

  const ready = drops.filter((d) => d.token).map((d) => d.token as string);
  const shown = kind === "all" ? assets : assets.filter((a) => a.kind === kind);

  return (
    <div className="library">
      <header className="library__head">
        <h1>Library</h1>
        <div className="library__filters" role="group" aria-label="Kind">
          {["all", ...vocab.kinds].map((k) => (
            <button key={k} type="button" className="filter" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k}
            </button>
          ))}
        </div>
      </header>

      <div
        className="drop"
        data-over={over}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
        role="region"
        aria-label="Drop images here"
      >
        <p>
          Drop PNG, JPEG or WebP images here, or{" "}
          <button type="button" className="drop__pick" onClick={() => input.current?.click()}>
            choose files
          </button>
          . Each asset holds 1 to 4 images.
        </p>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) take(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {drops.length > 0 && (
        <section className="tray" aria-label="Dropped files">
          <ul className="tray__list">
            {drops.map((d) => (
              <li key={d.id} className="tray__item" data-state={d.error ? "refused" : d.token ? "ready" : "sending"}>
                {d.preview && !d.error && <img src={d.preview} alt="" />}
                <span className="tray__name mono">{d.name}</span>
                {d.error && <span role="alert" className="tray__error">{d.error}</span>}
                {!d.error && !d.token && <span className="tray__status">checking…</span>}
              </li>
            ))}
          </ul>
          <div className="tray__actions">
            <button type="button" className="button" disabled={!ready.length || ready.length > 4} onClick={() => setSaving(true)}>
              Save {ready.length} as an asset
            </button>
            <button type="button" className="button button--quiet" onClick={clearDrops}>
              Clear
            </button>
            {ready.length > 4 && <span className="tray__note">An asset holds at most 4 images. Clear and drop fewer.</span>}
          </div>
          {saving && (
            <SaveAssetForm
              images={ready}
              kinds={vocab.kinds}
              onSaved={(a) => {
                clearDrops();
                load();
                setOpen(a.name);
              }}
              onCancel={() => setSaving(false)}
            />
          )}
        </section>
      )}

      <div className="library__body">
        <ul className="assets" aria-label="Assets">
          {shown.map((a) => (
            <li key={a.name}>
              <button type="button" className="asset" aria-pressed={open === a.name} onClick={() => setOpen(a.name)}>
                {a.cover ? <img src={a.cover} alt="" loading="lazy" /> : <span className="asset__blank" aria-hidden="true" />}
                <span className="asset__name mono">@{a.name}</span>
                <span className="asset__meta">
                  {a.kind} · {a.imageCount} image{a.imageCount === 1 ? "" : "s"}
                  {a.usedIn?.length ? ` · ${a.usedIn.length} film${a.usedIn.length === 1 ? "" : "s"}` : ""}
                </span>
              </button>
            </li>
          ))}
          {!shown.length && <li className="assets__empty">{assets.length ? `No ${kind} assets yet.` : "No assets yet. Drop images above to save your first."}</li>}
        </ul>
        {open && <AssetPanel name={open} roles={vocab.roles} onClose={() => setOpen(null)} />}
      </div>
    </div>
  );
}
```

Create `web/src/library/library.css`:

```css
/* Library: a grid of saved references, a drop zone, and one asset's panel. Tokens only. */

.library { display: flex; flex-direction: column; gap: var(--space-4); }
.library__head { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
.library__head h1 { margin: 0; font-size: var(--text-xl); font-weight: 600; }
.library__filters { display: flex; gap: var(--space-1); flex-wrap: wrap; }
.filter {
  padding: 4px var(--space-3); border: 1px solid var(--line); border-radius: 999px;
  background: transparent; color: var(--text-2); font-size: var(--text-sm); cursor: pointer;
}
.filter:hover { color: var(--text); }
.filter[aria-pressed="true"] { background: var(--surface-3); color: var(--text); border-color: var(--surface-3); }

.drop {
  padding: var(--space-4); border: 1px dashed var(--surface-3); border-radius: var(--radius-md);
  color: var(--text-2); font-size: var(--text-sm); text-align: center;
  transition: border-color var(--dur-fast) var(--ease-out), background-color var(--dur-fast) var(--ease-out);
}
.drop p { margin: 0; }
.drop[data-over="true"] { border-color: var(--text-2); background: var(--surface-1); }
.drop__pick { background: none; border: 0; padding: 0; color: var(--text); text-decoration: underline; cursor: pointer; font-size: inherit; }

.tray { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-1); }
.tray__list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-3); }
.tray__item { display: flex; flex-direction: column; gap: var(--space-1); width: 160px; font-size: var(--text-xs); }
.tray__item img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--radius-sm); background: var(--surface-2); }
.tray__name { color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tray__error { color: var(--bad-ink); }
.tray__status { color: var(--text-3); }
.tray__actions { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.tray__note { color: var(--warn); font-size: var(--text-xs); }

.library__body { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-4); align-items: start; }
.assets { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: var(--space-3); }
.assets__empty { color: var(--text-2); grid-column: 1 / -1; }
.asset {
  display: flex; flex-direction: column; gap: var(--space-1); width: 100%; padding: 0 0 var(--space-2);
  border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-1); color: var(--text);
  text-align: left; overflow: hidden; cursor: pointer;
}
.asset[aria-pressed="true"] { border-color: var(--text-2); }
.asset img, .asset__blank { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; background: var(--surface-2); }
.asset__name { padding: 0 var(--space-2); font-size: var(--text-sm); }
.asset__meta { padding: 0 var(--space-2); font-size: var(--text-xs); color: var(--text-2); }

.asset-panel {
  width: 340px; display: flex; flex-direction: column; gap: var(--space-2);
  padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-1);
  position: sticky; top: 0;
}
.asset-panel__head { display: flex; justify-content: space-between; align-items: center; }
.asset-panel__head h2 { margin: 0; font-size: var(--text-lg); font-weight: 500; }
.asset-panel h3 { margin: var(--space-2) 0 0; font-size: var(--text-xs); font-weight: 500; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.06em; }
.asset-panel__kind { margin: 0; font-size: var(--text-xs); color: var(--text-2); }
.asset-panel__description { margin: 0; font-size: var(--text-sm); }
.asset-panel__images { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-2); }
.asset-panel__images img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--radius-sm); }
.asset-panel__use { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; font-size: var(--text-sm); }
.asset-panel__use select { background: var(--surface-2); color: var(--text); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 4px var(--space-2); font-size: var(--text-sm); }
.asset-panel__runs, .asset-panel__none { margin: 0; font-size: var(--text-sm); color: var(--text-2); }
.asset-panel__takes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); font-size: var(--text-xs); }
.asset-panel__takes li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-1); }
.asset-panel__cost { color: var(--accent); }
.asset-panel__error { color: var(--bad-ink); }
.asset-panel__loading { color: var(--text-2); }

@media (max-width: 760px) {
  .library__body { grid-template-columns: minmax(0, 1fr); }
  .asset-panel { width: auto; position: static; }
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run src/library/LibraryScreen.test.tsx`
Expected: PASS, 4 of 4.

Then run: `cd web && npx vitest run && npx tsc -p .`
Expected: 13 files, 64 tests pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/library/LibraryScreen.test.tsx web/src/library/LibraryScreen.tsx web/src/library/library.css
git diff --cached --stat
git commit -m "Add the Library screen

Kind filters, drag-and-drop upload with core's refusal reasons, save as an asset, and each
asset's @name, films and takes. Use in prompt adds an @asset chip.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 15: Presets screen and the three screens in the app

**Files:**
- Create: `web/src/presets/PresetsScreen.tsx`
- Create: `web/src/presets/presets.css`
- Modify: `web/src/app/App.tsx`
- Modify: `web/src/app/App.css`
- Create: `web/src/presets/PresetsScreen.test.tsx` (test)
- Modify: `web/src/app/App.test.tsx` (test)

The gallery shows each preset's still (alt "<title>: a frame of its source video") or a text card, and a mono spec line. "Use <title>" loads the preset's prompt, fills the shared store and opens the Studio. The app's Studio, Library and Presets tabs now show their screens; Films, Spend and Settings keep their placeholders until Plan 7. The Studio tab's `main` stops scrolling so the prompt bar stays on screen while the feed scrolls.

- [ ] **Step 1: Write the failing test**

Create `web/src/presets/PresetsScreen.test.tsx`:

```tsx
import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PresetsScreen } from "./PresetsScreen";
import { getDraft, resetForTests } from "../studio/promptStore";
import { routes } from "../test-fixtures";

const kt = { id: "kinetic-typography", title: "Kinetic typography", tagline: "Let the words do the moving.", bestFor: null, durationS: 15, aspectRatio: "16:9", model: "minimax-h3", fidelity: "native", hasPrompt: true, still: "/media/presets/kinetic-typography.png" };
const plain = { ...kt, id: "plain", title: "Plain", still: null };

beforeEach(() => {
  resetForTests({}, "zed");
  window.location.hash = "#/presets";
  vi.stubGlobal(
    "fetch",
    vi.fn(routes({ "/api/presets": () => [kt, plain], "/api/presets/kinetic-typography": () => ({ ...kt, prompt: "SOURCE PROMPT" }) })),
  );
});

describe("PresetsScreen", () => {
  test("a preset with a still shows it; one without gets a text card", async () => {
    render(<PresetsScreen />);
    expect(await screen.findByAltText("Kinetic typography: a frame of its source video")).toHaveAttribute("src", "/media/presets/kinetic-typography.png");
    expect(screen.getAllByText("Plain")).toHaveLength(2); // the text card and the heading
    expect(screen.getAllByText("minimax-h3 · 15s · 16:9")[0]).toHaveClass("mono");
  });

  test("Use this fills the prompt bar from the shared store and opens the Studio", async () => {
    render(<PresetsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Use Kinetic typography" }));
    await waitFor(() => expect(window.location.hash).toBe("#/studio"));
    expect(getDraft()).toMatchObject({ prompt: "SOURCE PROMPT", model: "minimax-h3", durationS: 15, aspectRatio: "16:9", preset: "kinetic-typography" });
  });
});
```

Modify `web/src/app/App.test.tsx` with this change (unified diff: drop the `-` lines, add the `+` lines; `git apply` takes it as is):

```diff
--- a/web/src/app/App.test.tsx
+++ b/web/src/app/App.test.tsx
@@ -16,6 +16,24 @@
     expect(screen.getByRole("link", { name: "Studio" })).toHaveAttribute("aria-current", "page");
   });
 
+  test("each built tab shows its screen; the rest keep their placeholder", async () => {
+    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));
+    window.location.hash = "#/presets";
+    const { unmount } = render(<App />);
+    expect(screen.getByRole("heading", { name: "Presets" })).toBeInTheDocument();
+    unmount();
+    window.location.hash = "#/spend";
+    render(<App />);
+    expect(screen.getByRole("heading", { name: "Spend" })).toBeInTheDocument();
+    expect(screen.getByText("Daily totals and every job will show here.")).toBeInTheDocument();
+  });
+
+  test("the Studio is the default screen, with its prompt bar", () => {
+    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));
+    render(<App />);
+    expect(screen.getByRole("textbox", { name: "Prompt" })).toBeInTheDocument();
+  });
+
   test("shows the server-down banner when the API is unreachable", async () => {
     vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
     render(<App />);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run src/presets/PresetsScreen.test.tsx src/app/App.test.tsx`
Expected: FAIL: `Failed to resolve import "./PresetsScreen"`, and the App test "the Studio is the default screen" cannot find the Prompt textbox (3 of 4 App tests pass).

- [ ] **Step 3: Implement**

Create `web/src/presets/PresetsScreen.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { PresetDetail, PresetInfo } from "../api/types";
import { applyPreset } from "../studio/promptStore";
import "./presets.css";

/** The motion-design preset gallery. "Use this" fills the prompt bar and opens the Studio. */
export function PresetsScreen() {
  const [presets, setPresets] = useState<PresetInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<PresetInfo[]>("/api/presets")
      .then(setPresets)
      .catch((e: ApiError) => setError(e.message));
  }, []);

  async function use(id: string) {
    setBusy(id);
    setError(null);
    try {
      const p = await api<PresetDetail>(`/api/presets/${encodeURIComponent(id)}`);
      applyPreset(p);
      window.location.hash = "#/studio";
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="presets">
      <header className="presets__head">
        <h1>Presets</h1>
        <p>Each preset starts from a published source prompt. Use this puts that prompt and its model, length and ratio in the prompt bar; adapt it to your subject before you generate.</p>
      </header>
      {error && (
        <p className="presets__error" role="alert">
          {error}
        </p>
      )}
      <ul className="presets__grid" aria-label="Presets">
        {(presets ?? []).map((p) => (
          <li key={p.id} className="preset">
            {p.still ? (
              <img className="preset__still" src={p.still} alt={`${p.title}: a frame of its source video`} loading="lazy" />
            ) : (
              <div className="preset__still preset__still--text" aria-hidden="true">
                {p.title}
              </div>
            )}
            <div className="preset__body">
              <h2>{p.title}</h2>
              {p.tagline && <p className="preset__tagline">{p.tagline}</p>}
              <p className="preset__spec mono">
                {[p.model ?? "no route", p.durationS != null ? `${p.durationS}s` : null, p.aspectRatio].filter(Boolean).join(" · ")}
              </p>
              {p.fidelity && <p className="preset__fidelity">{p.fidelity === "native" ? "Runs on the model its prompt was written for" : "Adaptation: written for another model"}</p>}
              {p.bestFor && <p className="preset__best">{p.bestFor}</p>}
              <button type="button" className="button" disabled={!p.hasPrompt || busy === p.id} onClick={() => use(p.id)} aria-label={`Use ${p.title}`}>
                {busy === p.id ? "Opening…" : "Use this"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {presets && !presets.length && <p className="presets__empty">No presets found.</p>}
    </div>
  );
}
```

Create `web/src/presets/presets.css`:

```css
/* Preset gallery: still on top, engine line in mono, one action. Tokens only. */

.presets { display: flex; flex-direction: column; gap: var(--space-4); }
.presets__head h1 { margin: 0 0 var(--space-1); font-size: var(--text-xl); font-weight: 600; }
.presets__head p { margin: 0; color: var(--text-2); max-width: 70ch; font-size: var(--text-sm); }
.presets__error { color: var(--bad-ink); margin: 0; }
.presets__empty { color: var(--text-2); }

.presets__grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--space-4); }
.preset { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-1); overflow: hidden; }
.preset__still { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: var(--surface-2); }
.preset__still--text { display: grid; place-items: center; padding: var(--space-4); color: var(--text-2); font-size: var(--text-lg); text-align: center; }
.preset__body { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-3); flex: 1; }
.preset__body h2 { margin: 0; font-size: var(--text-md); font-weight: 600; }
.preset__tagline { margin: 0; color: var(--text); font-size: var(--text-sm); }
.preset__spec { margin: 0; color: var(--text-2); font-size: var(--text-xs); }
.preset__fidelity, .preset__best { margin: 0; color: var(--text-3); font-size: var(--text-xs); }
.preset__body .button { margin-top: auto; align-self: flex-start; }
.preset__best + .button, .preset__fidelity + .button { margin-top: var(--space-2); }
```

Modify `web/src/app/App.tsx` with this change (unified diff: drop the `-` lines, add the `+` lines; `git apply` takes it as is):

```diff
--- a/web/src/app/App.tsx
+++ b/web/src/app/App.tsx
@@ -1,23 +1,30 @@
 import { Nav } from "./Nav";
 import { SpendMeter } from "./SpendMeter";
 import { Placeholder } from "./Placeholder";
-import { parseRoute } from "./route";
+import { parseRoute, type TabId } from "./route";
 import { useRoute, useStudio } from "./useStudio";
+import { StudioScreen } from "../studio/StudioScreen";
+import { LibraryScreen } from "../library/LibraryScreen";
+import { PresetsScreen } from "../presets/PresetsScreen";
 import "./App.css";
 
-const SCREENS = {
-  studio: ["Studio", "The prompt bar and your takes arrive in the next build step."],
-  library: ["Library", "Saved characters, products, places and styles will show here."],
-  presets: ["Presets", "The preset gallery will show here."],
+const LATER = {
   films: ["Films", "Your run folders, ready to finish, will show here."],
   spend: ["Spend", "Daily totals and every job will show here."],
   settings: ["Settings", "Chat connection, limits and provider keys will show here."],
 } as const;
 
+function Screen({ tab }: { tab: TabId }) {
+  if (tab === "studio") return <StudioScreen />;
+  if (tab === "library") return <LibraryScreen />;
+  if (tab === "presets") return <PresetsScreen />;
+  const [title, next] = LATER[tab];
+  return <Placeholder title={title} next={next} />;
+}
+
 export function App() {
   const { tab } = parseRoute(useRoute());
   const { spend, online } = useStudio();
-  const [title, next] = SCREENS[tab];
   return (
     <div className="app">
       <header className="app__top">
@@ -30,8 +37,8 @@
           Studio server isn't running. Start it with <code className="mono">npm run studio</code>, and this page reconnects.
         </div>
       )}
-      <main className="app__main">
-        <Placeholder title={title} next={next} />
+      <main className="app__main" data-tab={tab}>
+        <Screen tab={tab} />
       </main>
     </div>
   );
```

Modify `web/src/app/App.css` with this change (unified diff: drop the `-` lines, add the `+` lines; `git apply` takes it as is):

```diff
--- a/web/src/app/App.css
+++ b/web/src/app/App.css
@@ -42,7 +42,9 @@
 }
 .banner code { color: var(--text); }
 
-.app__main { flex: 1; min-height: 0; padding: var(--space-6) var(--space-4) var(--space-5); }
+.app__main { flex: 1; min-height: 0; overflow-y: auto; padding: var(--space-6) var(--space-4) var(--space-5); }
+/* The Studio scrolls its feed itself, so the prompt bar stays on screen. */
+.app__main[data-tab="studio"] { overflow: hidden; padding-top: var(--space-4); padding-bottom: var(--space-4); }
 .placeholder h1 { font-size: var(--text-xl); font-weight: 600; line-height: 1.2; margin: 0 0 var(--space-2); }
 .placeholder p { color: var(--text-2); margin: 0; max-width: 65ch; }
 
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd web && npx vitest run src/presets/PresetsScreen.test.tsx src/app/App.test.tsx`
Expected: PASS, 6 of 6.

Then run: `cd web && npx vitest run && npx tsc -p .`
Expected: 14 files, 68 tests pass; no type errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/App.css web/src/app/App.test.tsx web/src/app/App.tsx web/src/presets/PresetsScreen.test.tsx web/src/presets/PresetsScreen.tsx web/src/presets/presets.css
git diff --cached --stat
git commit -m "Add the Presets screen and wire the three screens

The gallery shows each preset's still and fills the prompt bar from it. Studio, Library
and Presets replace their placeholders.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`git diff --cached --stat` must list only the files above.

---

### Task 16: Full check and a look in the browser

No code. Nothing here spends money.

- [ ] **Step 1: Every suite, the type check and the build**

Run: `cd web && npm run test:server && npx vitest run && npx tsc -p . && npm run build`
Expected: 111 server tests pass; 14 files and 68 page tests pass; no type errors; Vite prints `built in …`.

Run: `npm test && npm run test:mcp`
Expected: 286 and 36 pass, 0 fail (core and MCP are untouched).

Run: `grep -rn "e""xec(" web/server web/src web/tests`
Expected: no output.

- [ ] **Step 2: Start it against throwaway folders**

```bash
export KIE_RUNS_DIR=/tmp/studio-check/runs KIE_LIBRARY_DIR=/tmp/studio-check/library KIE_LIMITS_FILE=/tmp/studio-check/limits.json
mkdir -p "$KIE_RUNS_DIR/check-film"
node web/server/main.mjs --no-open
```

Expected: `Studio running at http://127.0.0.1:4317/  (Ctrl-C to stop)` (or the next free port) and no key printed.

- [ ] **Step 3: Click through with the gstack `browse` skill, at 1440×900, 1280×800 and 700×900**

- Studio: "Working in" shows `check-film`; type a prompt and the Generate button shows a price in mono amber. In a second terminal with the same three exports, run `node cli/kie.mjs limits --daily 0.01` (free; it writes only the throwaway limits file), then change the prompt by one character: Generate is disabled with "over today's cap by $…". Do not press Generate.
- Library: drop a PNG from `docs/images/`, save it as `@check-bottle` (kind product); it appears with its `@name` in mono. Drop an `.mp4`: it is refused with core's reason.
- Presets: stills show; "Use Kinetic typography" opens the Studio with the source prompt filled and the note "From preset kinetic-typography: this is the source prompt. Adapt it to your subject before generating."
- At 700px wide the prompt bar stacks under the feed and nothing overlaps.
- Screenshot each; check text is never under 11px and amber appears only on Generate, the meter and costs.

- [ ] **Step 4: Stop the server and clean up**

Ctrl-C, then `rm -rf /tmp/studio-check` and `unset KIE_RUNS_DIR KIE_LIBRARY_DIR KIE_LIMITS_FILE`. Nothing to commit.

---

## Decisions for the reviewer

Places where the spec or core left a choice:

1. **Upload transport.** Raw body, one request per file, name in `X-File-Name` as a label only; streamed to `library/.incoming/<random>.part`, ceiling 200 MB (core's largest `MAX_BYTES`) so core's own per-kind size message is what the user sees. Refused files are deleted at once, unsaved ones after a day. The 1 MB JSON limit is unchanged for every other route. No multipart parser and no new dependency.
2. **The library holds images only.** Core's `openLibrary().save` checks images only, and `KINDS` is character, product, location, style (the spec's "videos and audio" and "logo" are not in core). Video and audio drops are refused with core's reason; a video take is saved as its first or last frame through Frames.
3. **"Takes that used it"** comes from job records whose `assets` field names the asset; core's asset record keeps only run slugs.
4. **Check again** is one status read (`waitJob` with `timeoutMs: 1`, free). If the follower already watches the job it says so instead. An uncertain job with no upstream id returns core's code 5 resolve instruction; resolving stays in the CLI.
5. **Waiting.** A background follower waits on jobs this server submitted (3 rounds of 20 minutes), never on jobs from the CLI or MCP, so nothing downloads twice. There is no failover after submit, as with the MCP `wait_job`; create-time fallback in `submitJob` still shows `→ wavespeed`.
6. **Preset stills** are `docs/images/<id>.png` from `docs/images/sources.json`, served from that fixed list at `/media/presets/<id>.png`. "Use this" fills the source prompt (with a note to adapt it to the subject) and sends `preset`.
7. **Core lacks per-model video resolutions** in `listModels`; `/api/models` reads them from the first usable route's contract enum, or its price keys.
8. **Shapes.** The generate endpoints take the MCP snake_case shapes; `/api/estimate` keeps Plan 5's camelCase.
9. **"Allow $X for this job"** appears only when the catalog's default job budget is the sole blocker, and sets `budget_usd`; the per-job limit and the cap still refuse in core.
10. **Reuse** restores prompt and settings, not refs.
11. **Field at fault** for video problems is found by asking `validateVideoRequest` once per setting.
12. **Feed layout** is a CSS grid, newest first, filtered to the working film, rather than true masonry. The chat is a collapsed rail placeholder.
13. **Events.** The spec names an `asset` event; Plan 5's events send `library`, which the Library and Studio screens listen to.

---

## Self-review

- **Spec coverage (build order 4-6).** Feed and tile states: Tasks 11, 13. Take viewer with Reuse, Save to library, Frames: Tasks 5, 13. Prompt bar with chips, live price and disabled-with-reason: Tasks 9, 12. Working in: Task 13. Generate and wait: Tasks 2-4. Chat placeholder: Task 13. Library list, upload, save from take, `@asset` chips: Tasks 6, 13, 14. Presets gallery with stills and "Use this": Tasks 7, 15. Errors table: code 2 (Tasks 3, 9, 12), code 3 with field (Tasks 3, 5, 6), code 4 with charge wording and fallback (Tasks 4, 9, 11), code 5 with Check again or the resolve instruction (Tasks 4, 13). Library refusal with reason: Tasks 6, 14.
- **Required tests.** Per-job limit and cap via HTTP with 402, code 2 and no `createTask` call: Task 3. Invalid input 400 code 3: Task 3. Fallback shown with its provider: Task 4 (server), Task 11 (tile). Uncertain job kept: Tasks 4, 11. Upload type and size refusal and path confinement: Task 6. Price on Generate, disabled-with-reason, each tile state, Reuse filling the prompt bar: Tasks 11, 12, 13.
- **No money, no network.** Server tests use `generateStubs` and the throwing `fetch` from the helpers; page tests stub `fetch` per test; Task 16 never presses Generate and sets the cap through free `kie limits`.
- **Names line up.** `createFollower` / `follow` / `has` / `idle` (Task 2) are what `generate.mjs` (Tasks 3-4) and the tests use. `resolutionOptions` / `defaultResolution` (Task 7) match `ModelInfo` (Task 8) and `fitToModel` (Task 10). `IncomingFile.token` (Task 8) is what `POST /api/library` takes (Task 6). `FramesResult.firstPath` (Tasks 5, 8) feeds `SaveAssetForm` (Task 13).
- **Each task ends green.** Every task was replayed in order on a clean checkout of this branch: the failing step failed as stated, and the suite counts above are the ones it printed.
