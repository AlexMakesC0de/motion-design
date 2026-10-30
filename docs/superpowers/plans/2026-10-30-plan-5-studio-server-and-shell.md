# Studio Plan 5: Core Ceiling, Local Server and Page Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run studio` opens a local, key-protected page with the six-tab shell, a live spend meter and read-only data from `cli/core`, plus a per-job spending ceiling in core.

**Architecture:** A zero-dependency `node:http` server in `web/server/` calls `cli/core` directly, as `cli/kie.mjs` and `mcp/server.mjs` do. A React + TypeScript page in `web/src/` is built by Vite into `web/dist/` and served by that server. Live changes reach the page over one Server-Sent Events stream read with `fetch`, so every `/api` request carries the session key header.

**Tech Stack:** Node ≥20 (ESM, `node:test`), React 19, Vite 8, Vitest 5 with Testing Library and jsdom, TypeScript 6, IBM Plex Sans and Mono via @fontsource.

Spec: [`docs/superpowers/specs/2026-10-30-studio-web-app-design.md`](../specs/2026-10-30-studio-web-app-design.md). First of four studio plans: 5 server and shell, 6 Studio/Library/Presets, 7 Films/Spend/Settings, 8 Chat.

**Repo rules for every task:**
- Never `git stash`. Run `git diff --cached --stat` before each commit and commit only the task's files.
- End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never run a paid command. No `kie video/image/audio/upload` without `--dry-run`. Tests stub every provider call and replace `globalThis.fetch` with a function that throws.
- A hook blocks any file containing the four letters e-x-e-c followed by an opening parenthesis. Use `spawn`/`spawnSync` for processes and `String.prototype.match` instead of `RegExp.prototype` e-x-e-c.
- Never print or log the session key or any API key.

---

## File map

| File | Responsibility |
|---|---|
| `cli/core/spend.mjs` (modify) | `perJobUsd` in `limits.json`: validate, set, enforce in `reserve` |
| `cli/core/views.mjs` (modify) | `estimate` reports `perJobUsd` and `withinPerJob` |
| `cli/kie.mjs` (modify) | `kie limits --per-job USD\|off` |
| `mcp/server.mjs` (modify) | `estimate` output schema gains the two fields |
| `web/package.json` | page dependencies and scripts |
| `web/server/http.mjs` | router, Host and key checks, JSON body, error mapping, static files |
| `web/server/media.mjs` | `/media/runs/...` and `/media/library/...` with Range support |
| `web/server/state.mjs` | per-request context; job tile and spend views |
| `web/server/events.mjs` | snapshot diffing and the SSE stream |
| `web/server/api/look.mjs` | read-only endpoints |
| `web/server/app.mjs` | wires router, events, media and static into one `http.Server` |
| `web/server/main.mjs` | `npm run studio`: build if stale, pick a port, open the browser |
| `web/tests/*.test.mjs` | server tests (`node:test`) |
| `web/index.html`, `web/vite.config.ts`, `web/tsconfig.json` | page build |
| `web/src/api/*.ts` | key-carrying fetch client, SSE reader, shared types |
| `web/src/theme/*.css` | tokens and base styles |
| `web/src/app/*.tsx` | shell, nav, spend meter, connection banner, screen placeholders |

---

### Task 1: Per-job ceiling in core

**Files:**
- Modify: `cli/core/spend.mjs`
- Modify: `cli/core/views.mjs` (the `estimate` function)
- Modify: `cli/kie.mjs` (args table near line 137, help line 61, `cmdLimits` near line 348)
- Modify: `mcp/server.mjs` (the `estimate` tool's `outputSchema`, near line 273)
- Test: `tests/spend.test.mjs`, `tests/views.test.mjs`

- [ ] **Step 1: Write the failing tests**

In `tests/spend.test.mjs`, add `setPerJobLimit` to the existing `await import("../cli/core/spend.mjs")` destructuring, then append:

```js
describe("per-job ceiling", () => {
  const limitsFile = () => join(mkdtempSync(join(tmpdir(), "kie-lim-")), "limits.json");

  test("absent by default, so existing limits files keep their meaning", () => {
    assert.equal(readLimits(join(RUNS, "absent.json")).perJobUsd, undefined);
  });

  test("setPerJobLimit writes a ceiling and keeps the other settings; off removes it", () => {
    const path = limitsFile();
    writeFileSync(path, JSON.stringify({ dailyUsd: 7, allowRoots: [] }));
    assert.equal(setPerJobLimit("2", path).perJobUsd, 2);
    assert.deepEqual(readLimits(path), { dailyUsd: 7, allowRoots: [], perJobUsd: 2 });
    setPerJobLimit("off", path);
    assert.deepEqual(readLimits(path), { dailyUsd: 7, allowRoots: [] });
  });

  test("a zero, negative, blank or non-numeric ceiling is refused", () => {
    for (const bad of ["0", "-1", "", "  ", "lots"]) {
      assert.throws(() => setPerJobLimit(bad, limitsFile()), { code: EXIT.USAGE }, bad);
    }
  });

  test("a limits file with a bad perJobUsd is an error", () => {
    const path = limitsFile();
    writeFileSync(path, JSON.stringify({ perJobUsd: "two" }));
    assert.throws(() => readLimits(path), /perJobUsd/);
  });

  test("reserve refuses a job above the ceiling whatever budget the caller chose, and writes nothing", async () => {
    const store = fresh();
    await assert.rejects(
      reserve(store, { run: "demo", estimateUsd: 2.5 }, { limits: { dailyUsd: 10, allowRoots: [], perJobUsd: 2 } }),
      (e) => e.code === EXIT.BUDGET && /per-job limit/.test(e.message) && /kie limits --per-job/.test(e.message),
    );
    assert.deepEqual(store.list(), []);
  });

  test("reserve allows a job at or under the ceiling", async () => {
    const store = fresh();
    const job = await reserve(store, { run: "demo", estimateUsd: 2 }, { limits: { dailyUsd: 10, allowRoots: [], perJobUsd: 2 } });
    assert.equal(job.state, "reserved");
  });
});
```

Append inside the `describe("estimate reserves nothing ...")` block of `tests/views.test.mjs`:

```js
  test("above the per-job ceiling is not allowed, and says so", () => {
    const e = views.estimate(catalog, seedance, { store, limits: { ...limits, perJobUsd: 0.5 } });
    assert.equal(e.perJobUsd, 0.5);
    assert.equal(e.withinPerJob, false);
    assert.equal(e.allowed, false);
  });

  test("with no ceiling, perJobUsd is null and withinPerJob is true", () => {
    const e = views.estimate(catalog, seedance, { store, limits });
    assert.equal(e.perJobUsd, null);
    assert.equal(e.withinPerJob, true);
  });
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `node --test tests/spend.test.mjs tests/views.test.mjs`
Expected: FAIL, `setPerJobLimit is not a function` and `perJobUsd` undefined.

- [ ] **Step 3: Implement in `cli/core/spend.mjs`**

Replace the `limitsPath` doc comment:

```js
/** ~/.config/kie/limits.json. Writers: `kie limits` and the studio's Settings screen. No MCP tool or chat path writes it. */
```

In `readLimits`, after the `allowRoots` check and before `return limits;`:

```js
  if (limits.perJobUsd != null && (typeof limits.perJobUsd !== "number" || !(limits.perJobUsd > 0))) {
    throw usage(`${path}: perJobUsd must be a dollar amount above 0, or absent for no per-job limit.`);
  }
```

After `setDailyLimit`:

```js
/** "off" (or null) removes the per-job ceiling; anything else must be a dollar amount above 0. */
export function setPerJobLimit(usd, path = limitsPath()) {
  const { perJobUsd: _old, ...rest } = readLimits(path);
  let next = rest;
  if (!(usd == null || String(usd).trim() === "off")) {
    const n = Number(usd);
    if (String(usd).trim() === "" || !Number.isFinite(n) || n <= 0) {
      throw usage(`--per-job wants a dollar amount above 0, or "off", got "${usd}".`);
    }
    next = { ...rest, perJobUsd: n };
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
  return next;
}
```

At the start of `reserve`, before `return withSpendLock(...)`:

```js
  if (limits.perJobUsd != null && fields.estimateUsd > limits.perJobUsd) {
    throw budget(
      `Refused, nothing spent. Estimated $${fields.estimateUsd.toFixed(2)} is above the ` +
        `$${limits.perJobUsd.toFixed(2)} per-job limit. Ask the user; only they can raise it, with: kie limits --per-job N`,
      { estimatedUsd: fields.estimateUsd, perJobUsd: limits.perJobUsd },
    );
  }
```

- [ ] **Step 4: Implement in `cli/core/views.mjs` `estimate`**

Replace the tail of `estimate`, from `const withinBudget` to the end of the returned object, with:

```js
  const withinBudget = usd != null && (cap == null || usd <= cap);
  const withinDailyCap = usd != null && usd <= pos.availableUsd;
  const perJobUsd = limits.perJobUsd ?? null;
  const withinPerJob = usd != null && (perJobUsd == null || usd <= perJobUsd);
  return {
    model: model.id,
    provider: route?.provider ?? null,
    providerModel: call?.model ?? null,
    routeUsable: Boolean(route?.usable),
    estimateUsd: usd,
    basis: est?.basis ?? null,
    budgetUsd: cap,
    withinBudget,
    perJobUsd,
    withinPerJob,
    availableTodayUsd: pos.availableUsd,
    withinDailyCap,
    problems,
    allowed: !problems.length && withinBudget && withinPerJob && withinDailyCap && Boolean(route?.usable),
  };
```

Update the doc comment above `estimate` to read "whether the per-job budget, the per-job ceiling and today's cap allow it".

- [ ] **Step 5: MCP output schema**

In `mcp/server.mjs`, in the `estimate` tool's `outputSchema`, after `withinBudget: z.boolean(),` add:

```js
          perJobUsd: z.number().nullable(),
          withinPerJob: z.boolean(),
```

- [ ] **Step 6: CLI flag**

In `cli/kie.mjs`:
- In the args table next to `daily: { type: "string" },` add `"per-job": { type: "string" },`.
- Change the help line to: `  kie limits     [--daily USD] [--per-job USD|off] [--json]   the daily cap, per-job limit, today's spend and unsettled jobs`
- Import `setPerJobLimit` alongside `setDailyLimit`.
- In `cmdLimits`, after the `--daily` block:

```js
  if (args["per-job"] != null) {
    const next = setPerJobLimit(args["per-job"]);
    say(next.perJobUsd == null ? `per-job limit removed  (${limitsPath()})` : `per-job limit set to $${next.perJobUsd.toFixed(2)}  (${limitsPath()})`);
  }
```

- Change `if (args.json) return say(JSON.stringify(pos, null, 2));` to `if (args.json) return say(JSON.stringify({ ...pos, perJobUsd: readLimits().perJobUsd ?? null }, null, 2));`
- After the existing `say(\`daily cap:  ...\`)` line:

```js
  const perJob = readLimits().perJobUsd;
  say(`per-job:    ${perJob == null ? "no limit" : `$${perJob.toFixed(2)}`}`);
```

- [ ] **Step 7: Run all tests**

Run: `npm test && npm run test:mcp`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add cli/core/spend.mjs cli/core/views.mjs cli/kie.mjs mcp/server.mjs tests/spend.test.mjs tests/views.test.mjs
git diff --cached --stat
git commit -m "Add a per-job spending ceiling to limits.json

reserve refuses any job above perJobUsd whatever budget the caller chose,
so a chat that never asks still cannot start an expensive job.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `web/` package and server test helpers

**Files:**
- Create: `web/package.json`, `web/.gitignore`, `web/tests/helpers.mjs`
- Modify: root `package.json` (scripts)

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "motion-design-studio",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Local studio web app over the kie harness. The server has no dependencies; the page is built with Vite.",
  "scripts": {
    "build": "vite build",
    "dev": "vite",
    "test": "npm run test:server && npm run test:page",
    "test:server": "node --test 'tests/*.test.mjs'",
    "test:page": "vitest run"
  },
  "engines": {
    "node": ">=20"
  },
  "license": "SEE LICENSE IN ../LICENSE.md"
}
```

`web/.gitignore`:

```
node_modules/
dist/
```

- [ ] **Step 2: Install page dependencies with exact versions**

```bash
npm --prefix web install --save-exact react@19.3.1 react-dom@19.3.1 @fontsource/ibm-plex-sans@5.3.0 @fontsource/ibm-plex-mono@5.3.0
npm --prefix web install --save-exact -D vite@8.3.5 @vitejs/plugin-react@6.1.2 typescript@6.0.2 vitest@5.0.5 jsdom@30.1.3 @testing-library/react@16.3.3 @testing-library/jest-dom @types/react@19 @types/react-dom@19
```

If a pinned version fails to resolve or conflicts with a peer, run `npm view <pkg> version` and use the current one, and record the versions actually installed in the commit message. Never use `--force` or `--legacy-peer-deps`.

- [ ] **Step 3: Root scripts**

In the root `package.json` `scripts`, add:

```json
    "studio": "node web/server/main.mjs",
    "test:web": "npm --prefix web test",
```

- [ ] **Step 4: Server test helpers**

Create `web/tests/helpers.mjs`:

```js
// Every server test imports this first. It points runs/, library/ and the
// limits file at a temp folder BEFORE cli modules load (they read these at
// import), and makes any real network call throw.
import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const tmp = realpathSync(mkdtempSync(join(tmpdir(), "kie-web-")));
export const RUNS = join(tmp, "runs");
export const LIBRARY = join(tmp, "library");
process.env.KIE_RUNS_DIR = RUNS;
process.env.KIE_LIBRARY_DIR = LIBRARY;
process.env.KIE_LIMITS_FILE = join(tmp, "limits.json");
process.env.KIE_API_KEY = "test-key-not-real";
mkdirSync(RUNS, { recursive: true });
mkdirSync(LIBRARY, { recursive: true });
globalThis.fetch = () => {
  throw new Error("network call attempted in a web server test");
};

export const KEY = "test-session-key-0123456789abcdef";

/** Stubs for every call that would reach a provider. */
export const deps = { credits: async () => 100 };

/**
 * One HTTP request through node:http (fetch is disabled, and fetch cannot
 * set Host). Resolves { status, headers, text, json, buf }.
 */
export function req(port, path, { method = "GET", headers = {}, body, key = KEY, host = `127.0.0.1:${port}` } = {}) {
  return new Promise((resolve, reject) => {
    const h = { host, ...(key ? { "x-studio-key": key } : {}), ...headers };
    let payload;
    if (body !== undefined) {
      payload = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
      h["content-type"] ??= "application/json";
      h["content-length"] = payload.length;
    }
    const r = request({ host: "127.0.0.1", port, path, method, headers: h }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString("utf8");
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json, buf });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/package-lock.json web/.gitignore web/tests/helpers.mjs package.json
git diff --cached --stat
git commit -m "Add the web package and its server test helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: HTTP core — router, Host and key checks, errors, static files

**Files:**
- Create: `web/server/http.mjs`
- Test: `web/tests/http.test.mjs`

- [ ] **Step 1: Write the failing tests**

`web/tests/http.test.mjs`:

```js
import { tmp, KEY, req } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { createRouter, createHandler, statusFor } = await import("../server/http.mjs");
const { budget, unknown, uncertain } = await import("../../cli/lib/errors.mjs");

const dist = join(tmp, "dist");
mkdirSync(join(dist, "assets"), { recursive: true });
writeFileSync(join(dist, "index.html"), "<html><head><!--studio-key--></head><body>app</body></html>");
writeFileSync(join(dist, "assets", "app.js"), "console.log(1)");

const router = createRouter();
router.get("/api/ping", () => ({ ok: true }));
router.get("/api/runs/:slug", ({ params }) => ({ slug: params.slug }));
router.post("/api/echo", ({ body }) => body);
router.get("/api/over", () => {
  throw budget("Refused, nothing spent. Over the cap.");
});
router.get("/api/missing", () => {
  throw unknown("No run x.");
});
router.get("/api/maybe", () => {
  throw uncertain("Timed out.", "task-1", { localJobId: "j-20261030-abcdef" });
});
router.get("/api/boom", () => {
  throw new Error("kaboom with sk-abcdefghijklmnopqrstuvwxyz0123");
});

let port, server;
before(async () => {
  server = createServer(createHandler({ key: KEY, router, distDir: dist }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});
after(() => new Promise((r) => server.close(r)));

describe("guards", () => {
  test("an API call with the key and a local Host works", async () => {
    const r = await req(port, "/api/ping");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true });
  });

  test("localhost:<port> is accepted as a Host too", async () => {
    assert.equal((await req(port, "/api/ping", { host: `localhost:${port}` })).status, 200);
  });

  test("no key is 403", async () => {
    const r = await req(port, "/api/ping", { key: null });
    assert.equal(r.status, 403);
    assert.match(r.json.error.message, /studio key/);
  });

  test("a wrong key is 403", async () => {
    assert.equal((await req(port, "/api/ping", { key: "nope" })).status, 403);
  });

  test("a foreign Host is 403 even with the key (DNS rebinding)", async () => {
    assert.equal((await req(port, "/api/ping", { host: "evil.test" })).status, 403);
    assert.equal((await req(port, "/", { host: `evil.test:${port}` })).status, 403);
  });

  test("no CORS header is ever sent", async () => {
    const r = await req(port, "/api/ping", { headers: { origin: "https://evil.test" } });
    assert.equal(r.headers["access-control-allow-origin"], undefined);
  });
});

describe("routing and bodies", () => {
  test("path params are decoded", async () => {
    assert.deepEqual((await req(port, "/api/runs/zed-hero")).json, { slug: "zed-hero" });
  });

  test("a JSON body is parsed", async () => {
    assert.deepEqual((await req(port, "/api/echo", { method: "POST", body: { a: 1 } })).json, { a: 1 });
  });

  test("a body that is not JSON is 400", async () => {
    const r = await req(port, "/api/echo", { method: "POST", body: Buffer.from("{nope"), headers: { "content-type": "application/json" } });
    assert.equal(r.status, 400);
  });

  test("a body over 1 MB is 413", async () => {
    const r = await req(port, "/api/echo", { method: "POST", body: Buffer.alloc(1_100_000, 32) });
    assert.equal(r.status, 413);
  });

  test("an unknown API path is 404 JSON", async () => {
    const r = await req(port, "/api/nothing");
    assert.equal(r.status, 404);
    assert.ok(r.json.error);
  });
});

describe("errors keep core's codes", () => {
  test("statusFor maps exit codes to HTTP statuses", () => {
    assert.deepEqual([1, 2, 3, 4, 5].map(statusFor), [400, 402, 400, 502, 409]);
  });

  test("a budget refusal is 402 with code 2 and the message", async () => {
    const r = await req(port, "/api/over");
    assert.equal(r.status, 402);
    assert.equal(r.json.error.code, 2);
    assert.match(r.json.error.message, /nothing spent/);
  });

  test("an unknown thing is 400 with code 3", async () => {
    const r = await req(port, "/api/missing");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 3);
  });

  test("an uncertain job keeps its ids", async () => {
    const r = await req(port, "/api/maybe");
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, 5);
    assert.equal(r.json.error.localJobId, "j-20261030-abcdef");
    assert.equal(r.json.error.taskId, "task-1");
  });

  test("an unexpected error is 500 and redacts anything key-shaped", async () => {
    const r = await req(port, "/api/boom");
    assert.equal(r.status, 500);
    assert.doesNotMatch(r.text, /abcdefghijklmnopqrstuvwxyz0123/);
  });
});

describe("static files", () => {
  test("/ serves index.html with the key meta tag, uncached", async () => {
    const r = await req(port, "/", { key: null });
    assert.equal(r.status, 200);
    assert.match(r.text, new RegExp(`<meta name="studio-key" content="${KEY}">`));
    assert.equal(r.headers["cache-control"], "no-store");
  });

  test("index.html sets the HttpOnly SameSite=Strict media cookie", async () => {
    const r = await req(port, "/", { key: null });
    assert.match(String(r.headers["set-cookie"]), /studio=.+; Path=\/media; HttpOnly; SameSite=Strict/);
  });

  test("an unknown page path falls back to index.html", async () => {
    assert.match((await req(port, "/films/zed", { key: null })).text, /app/);
  });

  test("assets are served with their type", async () => {
    const r = await req(port, "/assets/app.js", { key: null });
    assert.equal(r.status, 200);
    assert.match(r.headers["content-type"], /javascript/);
  });

  test("a traversal path never serves a file outside dist", async () => {
    const r = await req(port, "/assets/..%2f..%2fhelpers.mjs", { key: null });
    assert.doesNotMatch(r.text, /network call attempted/);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd web && node --test tests/http.test.mjs`
Expected: FAIL, cannot find `../server/http.mjs`.

- [ ] **Step 3: Implement `web/server/http.mjs`**

```js
// The studio's HTTP layer. Thin by design: check who is asking, route, parse
// JSON, call a handler, map core's typed errors to statuses. Handlers live in
// api/*.mjs and call cli/core; nothing here knows about jobs or money.
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { CliError } from "../../cli/lib/errors.mjs";
import { redact } from "../../cli/lib/redact.mjs";

const MAX_BODY = 1_000_000;
const STATUS = { 1: 400, 2: 402, 3: 400, 4: 502, 5: 409 };
export const statusFor = (code) => STATUS[code] ?? 500;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createRouter() {
  const routes = [];
  const add = (method) => (pattern, handler) => {
    const names = [];
    const source = pattern.replace(/:([a-zA-Z]+)/g, (_, n) => {
      names.push(n);
      return "([^/]+)";
    });
    routes.push({ method, re: new RegExp(`^${source}$`), names, handler });
  };
  return {
    get: add("GET"),
    post: add("POST"),
    put: add("PUT"),
    delete: add("DELETE"),
    match(method, path) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = path.match(r.re);
        if (m) return { handler: r.handler, params: Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
      }
      return null;
    },
  };
}

export function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

const fail = (res, status, message, extra = {}) => sendJson(res, status, { error: { code: 0, message, ...extra } });

export function sendError(res, err) {
  if (err instanceof CliError) {
    const { code, message, name: _n, stack: _s, ...extra } = err;
    return sendJson(res, statusFor(code), { error: { ...extra, code, message: redact(message) } });
  }
  if (err instanceof HttpError) return fail(res, err.status, err.message);
  process.stderr.write(`studio: ${redact(err?.stack ?? String(err))}\n`);
  return fail(res, 500, `Unexpected error: ${redact(err?.message ?? String(err))}`);
}

const sameKey = (given, key) => {
  if (typeof given !== "string" || given.length !== key.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(key));
};

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, "Request body is over 1 MB.");
    chunks.push(c);
  }
  if (!size) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.");
  }
}

function serveStatic(req, res, distDir, pathname, key) {
  const root = resolve(distDir);
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return fail(res, 400, "Bad path.");
  }
  const file = resolve(root, `.${rel}`);
  const inside = file === root || file.startsWith(root + sep);
  if (!inside) return fail(res, 404, "Not found.");
  const isAsset = rel !== "/" && existsSync(file) && statSync(file).isFile();
  if (isAsset && !file.endsWith("index.html")) {
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    return createReadStream(file).pipe(res);
  }
  // Every page path gets the app; the page routes itself.
  const index = join(root, "index.html");
  if (!existsSync(index)) return fail(res, 503, "The page is not built yet. Run: npm --prefix web run build");
  const html = readFileSync(index, "utf8").replace("<!--studio-key-->", `<meta name="studio-key" content="${key}">`);
  res.writeHead(200, {
    "content-type": TYPES[".html"],
    "cache-control": "no-store",
    "set-cookie": `studio=${key}; Path=/media; HttpOnly; SameSite=Strict`,
  });
  res.end(html);
}

/** The cookie <video> and <img> send, since they cannot send a header. */
export function cookieKey(req) {
  const m = (req.headers.cookie ?? "").match(/(?:^|;\s*)studio=([^;]+)/);
  return m ? m[1] : null;
}

/**
 * The request handler. `media(req, res, pathname)` serves /media/*; `router`
 * serves /api/*; everything else is the built page from `distDir`.
 */
export function createHandler({ key, router, distDir, media = null }) {
  return async (req, res) => {
    const port = req.socket.localPort;
    const host = req.headers.host ?? "";
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return fail(res, 403, "Wrong host.");
    const url = new URL(req.url, `http://${host}`);

    if (url.pathname.startsWith("/api/")) {
      if (!sameKey(req.headers["x-studio-key"], key)) return fail(res, 403, "Missing or wrong studio key. Reload the page.");
      const hit = router.match(req.method, url.pathname);
      if (!hit) return fail(res, 404, `No ${req.method} ${url.pathname}.`);
      try {
        const body = req.method === "GET" ? undefined : await readJson(req);
        const out = await hit.handler({ params: hit.params, query: url.searchParams, body, req, res });
        if (out === undefined) return; // the handler wrote the response itself (a stream)
        return sendJson(res, 200, out);
      } catch (err) {
        if (res.headersSent) return res.end();
        return sendError(res, err);
      }
    }

    if (url.pathname.startsWith("/media/")) {
      if (!sameKey(cookieKey(req) ?? req.headers["x-studio-key"], key)) return fail(res, 403, "Missing or wrong studio key. Reload the page.");
      if (!media) return fail(res, 404, "Not found.");
      try {
        return await media(req, res, url.pathname);
      } catch (err) {
        return sendError(res, err);
      }
    }

    if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "Method not allowed.");
    return serveStatic(req, res, distDir, url.pathname, key);
  };
}
```

- [ ] **Step 4: Run and see it pass**

Run: `cd web && node --test tests/http.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/server/http.mjs web/tests/http.test.mjs
git diff --cached --stat
git commit -m "Add the studio HTTP layer: host and key checks, routing, typed errors, static page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Media files with Range support

**Files:**
- Create: `web/server/media.mjs`
- Test: `web/tests/media.test.mjs`

Media URLs are `/media/runs/<path inside runs>` and `/media/library/<path inside library>`. The real path must stay inside that root (symlinks followed), with no hidden segment, using the existing `confinePath` from `cli/core/inputs.mjs`. Read `confinePath` first to confirm it is `confinePath(path, roots)` and throws a `CliError` with code 3 outside the roots, through a hidden segment, or for a missing file. If its signature differs, adapt the call here, not the core function.

- [ ] **Step 1: Write the failing tests**

`web/tests/media.test.mjs`:

```js
import { tmp, RUNS, LIBRARY, KEY, req } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { createRouter, createHandler } = await import("../server/http.mjs");
const { serveMedia, mediaUrl } = await import("../server/media.mjs");

mkdirSync(join(RUNS, "zed"), { recursive: true });
writeFileSync(join(RUNS, "zed", "out.mp4"), Buffer.from("0123456789"));
mkdirSync(join(RUNS, ".jobs"), { recursive: true });
writeFileSync(join(RUNS, ".jobs", "secret.json"), "{}");
mkdirSync(join(LIBRARY, "bottle"), { recursive: true });
writeFileSync(join(LIBRARY, "bottle", "1.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
writeFileSync(join(tmp, "outside.txt"), "nope");
symlinkSync(join(tmp, "outside.txt"), join(RUNS, "zed", "link.mp4"));

let port, server;
before(async () => {
  server = createServer(createHandler({ key: KEY, router: createRouter(), distDir: join(tmp, "nodist"), media: serveMedia }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;
});
after(() => new Promise((r) => server.close(r)));

const cookie = { cookie: `studio=${KEY}` };

describe("media", () => {
  test("mediaUrl maps a file in runs/ or library/ to its URL, anything else to null", () => {
    assert.equal(mediaUrl(join(RUNS, "zed", "out.mp4")), "/media/runs/zed/out.mp4");
    assert.equal(mediaUrl(join(LIBRARY, "bottle", "1.png")), "/media/library/bottle/1.png");
    assert.equal(mediaUrl(join(tmp, "outside.txt")), null);
  });

  test("a run file is served whole with its type, using the cookie", async () => {
    const r = await req(port, "/media/runs/zed/out.mp4", { key: null, headers: cookie });
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "video/mp4");
    assert.equal(r.headers["accept-ranges"], "bytes");
    assert.equal(r.text, "0123456789");
  });

  test("a Range request gets 206 and the slice", async () => {
    const r = await req(port, "/media/runs/zed/out.mp4", { key: null, headers: { ...cookie, range: "bytes=2-5" } });
    assert.equal(r.status, 206);
    assert.equal(r.headers["content-range"], "bytes 2-5/10");
    assert.equal(r.text, "2345");
  });

  test("an open-ended Range runs to the end", async () => {
    const r = await req(port, "/media/runs/zed/out.mp4", { key: null, headers: { ...cookie, range: "bytes=7-" } });
    assert.equal(r.text, "789");
  });

  test("an unsatisfiable Range is 416", async () => {
    const r = await req(port, "/media/runs/zed/out.mp4", { key: null, headers: { ...cookie, range: "bytes=50-60" } });
    assert.equal(r.status, 416);
  });

  test("library files are served", async () => {
    const r = await req(port, "/media/library/bottle/1.png", { key: null, headers: cookie });
    assert.equal(r.status, 200);
    assert.equal(r.headers["content-type"], "image/png");
  });

  test("without the cookie or key it is 403", async () => {
    assert.equal((await req(port, "/media/runs/zed/out.mp4", { key: null })).status, 403);
  });

  test("hidden folders, traversal and symlinks out of the root are refused", async () => {
    for (const p of ["/media/runs/.jobs/secret.json", "/media/runs/..%2Foutside.txt", "/media/runs/zed/link.mp4", "/media/other/x"]) {
      const r = await req(port, p, { key: null, headers: cookie });
      assert.notEqual(r.status, 200, p);
    }
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd web && node --test tests/media.test.mjs`
Expected: FAIL, cannot find `../server/media.mjs`.

- [ ] **Step 3: Implement `web/server/media.mjs`**

```js
// Serves run outputs and library images to <video> and <img>. Only two roots,
// real paths only, no hidden segments: the same confinement the MCP tools use.
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { LIBRARY_DIR, RUNS_DIR, isInside } from "../../cli/lib/run.mjs";
import { confinePath } from "../../cli/core/inputs.mjs";
import { HttpError } from "./http.mjs";

const TYPES = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".srt": "text/plain; charset=utf-8",
};

const real = (p) => (existsSync(p) ? realpathSync(p) : p);
const roots = () => ({ runs: real(RUNS_DIR), library: real(LIBRARY_DIR) });

/** The URL for a file inside runs/ or library/, or null for anything else. */
export function mediaUrl(path) {
  if (!path) return null;
  const p = real(path);
  for (const [name, root] of Object.entries(roots())) {
    if (isInside(p, root)) return `/media/${name}/${relative(root, p).split(sep).map(encodeURIComponent).join("/")}`;
  }
  return null;
}

export async function serveMedia(req, res, pathname) {
  const m = pathname.match(/^\/media\/(runs|library)\/(.+)$/);
  if (!m) throw new HttpError(404, "Not found.");
  let rel;
  try {
    rel = decodeURIComponent(m[2]);
  } catch {
    throw new HttpError(400, "Bad path.");
  }
  const root = roots()[m[1]];
  const file = confinePath(join(root, rel), [root]); // code 3 outside the root, through a hidden segment, or missing
  const st = statSync(file);
  if (!st.isFile()) throw new HttpError(404, "Not found.");

  const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = (req.headers.range ?? "").match(/^bytes=(\d*)-(\d*)$/);
  if (!range) {
    res.writeHead(200, { "content-type": type, "content-length": st.size, "accept-ranges": "bytes", "cache-control": "no-cache" });
    return createReadStream(file).pipe(res);
  }
  const start = range[1] === "" ? st.size - Number(range[2]) : Number(range[1]);
  const end = Math.min(range[1] !== "" && range[2] !== "" ? Number(range[2]) : st.size - 1, st.size - 1);
  if (!(start >= 0) || start > end) {
    res.writeHead(416, { "content-range": `bytes */${st.size}` });
    return res.end();
  }
  res.writeHead(206, {
    "content-type": type,
    "content-length": end - start + 1,
    "content-range": `bytes ${start}-${end}/${st.size}`,
    "accept-ranges": "bytes",
    "cache-control": "no-cache",
  });
  return createReadStream(file, { start, end }).pipe(res);
}
```

- [ ] **Step 4: Run and see it pass**

Run: `cd web && node --test tests/media.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/server/media.mjs web/tests/media.test.mjs
git diff --cached --stat
git commit -m "Serve run and library media to the studio page with Range support

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Request context and job views

**Files:**
- Create: `web/server/state.mjs`
- Test: `web/tests/state.test.mjs`

- [ ] **Step 1: Write the failing tests**

`web/tests/state.test.mjs`:

```js
import { RUNS } from "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

const { context, jobView, spendView } = await import("../server/state.mjs");
const { openJobs } = await import("../../cli/core/jobs.mjs");

describe("context", () => {
  test("reads limits, opens the job store and library per call", () => {
    const c = context();
    assert.equal(c.limits.dailyUsd, 10);
    assert.deepEqual(c.store.list(), []);
    assert.deepEqual(c.library.list(), []);
    assert.ok(c.roots.length >= 2);
  });
});

describe("jobView", () => {
  test("adds what a take tile shows, and media URLs for artifacts", () => {
    const store = openJobs(join(RUNS, ".jobs"));
    const job = store.create({
      run: "zed",
      capability: "video",
      model: "seedance-2",
      provider: "kie",
      providerModel: "bytedance/seedance-2",
      estimateUsd: 1.03,
      input: { prompt: "Slow push-in", duration: 5, resolution: "720p", aspect_ratio: "16:9" },
      failedOver: false,
    });
    const v = jobView({ ...job, artifacts: [join(RUNS, "zed", "out.mp4")] });
    assert.equal(v.id, job.id);
    assert.equal(v.prompt, "Slow push-in");
    assert.equal(v.durationS, 5);
    assert.equal(v.resolution, "720p");
    assert.equal(v.aspectRatio, "16:9");
    assert.deepEqual(v.media, ["/media/runs/zed/out.mp4"]);
    assert.equal(v.countedUsd, 1.03);
    assert.ok(!("input" in v), "the raw provider input is not sent to the page");
  });
});

describe("spendView", () => {
  test("today's position, the ceiling and 14 days of totals", () => {
    const store = openJobs(join(RUNS, ".jobs"));
    const v = spendView(store, { dailyUsd: 10, allowRoots: [], perJobUsd: 2 });
    assert.equal(v.capUsd, 10);
    assert.equal(v.perJobUsd, 2);
    assert.equal(v.days.length, 14);
    assert.equal(v.days.at(-1).usd, v.spentUsd);
    assert.ok(v.days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day)));
  });
});
```

Note: `mediaUrl` maps any path inside runs/, existing or not, because `real()` falls back to the given path. The `out.mp4` here does not exist, and that is fine for this test.

- [ ] **Step 2: Run and see it fail**

Run: `cd web && node --test tests/state.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `web/server/state.mjs`**

```js
// Per-request context and the shapes the page reads. Context is rebuilt per
// call, like the MCP server's, so a limits change or a new run is seen at once.
import { openJobs, countedUsd, localDay, systemTimeZone } from "../../cli/core/jobs.mjs";
import { readLimits, dailyPosition } from "../../cli/core/spend.mjs";
import { openLibrary } from "../../cli/core/assets.mjs";
import { allowedRoots } from "../../cli/core/inputs.mjs";
import { jobSummary } from "../../cli/core/views.mjs";
import { mediaUrl } from "./media.mjs";

export function context() {
  const limits = readLimits();
  return { limits, store: openJobs(), library: openLibrary(), roots: allowedRoots(limits) };
}

const round = (n) => Math.round(n * 10_000) / 10_000;

/** A job as a take tile needs it. The raw provider input stays on disk. */
export function jobView(j) {
  const input = j.input ?? {};
  return {
    ...jobSummary(j),
    capability: j.capability ?? null,
    providerModel: j.providerModel ?? null,
    prompt: typeof input.prompt === "string" ? input.prompt : null,
    durationS: input.duration ?? input.duration_s ?? null,
    resolution: input.resolution != null ? String(input.resolution) : null,
    aspectRatio: input.aspect_ratio ?? null,
    failedOver: Boolean(j.failedOver),
    costSource: j.costSource ?? "none",
    countedUsd: countedUsd(j),
    error: j.error ?? null,
    media: (j.artifacts ?? []).map(mediaUrl).filter(Boolean),
    updatedAt: j.history?.at(-1)?.at ?? j.createdAt,
  };
}

/** Today against the cap, the per-job ceiling, and the last 14 local days. */
export function spendView(store, limits, now = new Date()) {
  const pos = dailyPosition(store, limits, now);
  const tz = systemTimeZone();
  const jobs = store.list();
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const day = localDay(new Date(now.getTime() - i * 86_400_000), tz);
    days.push({ day, usd: round(jobs.filter((j) => j.day === day).reduce((s, j) => s + countedUsd(j), 0)) });
  }
  // Today's bar uses the same rule as the cap (each job judged in its own zone).
  days[days.length - 1].usd = pos.spentUsd;
  return {
    capUsd: pos.capUsd,
    spentUsd: pos.spentUsd,
    availableUsd: pos.availableUsd,
    perJobUsd: limits.perJobUsd ?? null,
    unsettled: pos.unsettled.length,
    days,
  };
}
```

- [ ] **Step 4: Run and see it pass**

Run: `cd web && node --test tests/state.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/server/state.mjs web/tests/state.test.mjs
git diff --cached --stat
git commit -m "Add studio request context, job tile view and 14-day spend view

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Live events

**Files:**
- Create: `web/server/events.mjs`
- Test: `web/tests/events.test.mjs`

The stream sends `job` (one changed job, as `jobView`), `spend` (the `spendView`) and `library` (the asset list) events. A snapshot is taken after each `fs.watch` change (debounced 150 ms) and at least every 2 seconds. `diff(prev, next)` is pure, so its rules are tested without timers.

- [ ] **Step 1: Write the failing tests**

`web/tests/events.test.mjs`:

```js
import { RUNS } from "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

const { diff, createEvents, formatEvent } = await import("../server/events.mjs");
const { openJobs } = await import("../../cli/core/jobs.mjs");

const snap = (jobs, spend = { spentUsd: 0 }, library = []) => ({ jobs: new Map(jobs.map((j) => [j.id, j])), spend, library });

describe("diff", () => {
  test("the first snapshot sends nothing (the page loads the full state itself)", () => {
    assert.deepEqual(diff(null, snap([{ id: "a", state: "reserved" }])), []);
  });

  test("a new or changed job is one job event; an unchanged one is none", () => {
    const prev = snap([{ id: "a", state: "submitted" }, { id: "b", state: "succeeded" }]);
    const next = snap([{ id: "a", state: "succeeded" }, { id: "b", state: "succeeded" }, { id: "c", state: "reserved" }]);
    assert.deepEqual(
      diff(prev, next).map((e) => [e.event, e.data.id]),
      [["job", "a"], ["job", "c"]],
    );
  });

  test("a spend change and a library change are one event each", () => {
    const events = diff(snap([], { spentUsd: 0 }, []), snap([], { spentUsd: 1.03 }, [{ name: "bottle" }]));
    assert.deepEqual(events.map((e) => e.event), ["spend", "library"]);
  });
});

describe("formatEvent", () => {
  test("is SSE wire format", () => {
    assert.equal(formatEvent({ event: "spend", data: { a: 1 } }), 'event: spend\ndata: {"a":1}\n\n');
  });
});

describe("createEvents", () => {
  test("a subscriber gets a hello, then job and spend events when a job is written", async () => {
    const events = createEvents({ pollMs: 50 });
    const written = [];
    let onClose = () => {};
    const res = { writeHead: () => {}, write: (s) => written.push(s), on: (ev, fn) => ev === "close" && (onClose = fn) };
    events.subscribe(res);
    await new Promise((r) => setTimeout(r, 120));
    openJobs(join(RUNS, ".jobs")).create({ run: "zed", capability: "video", model: "seedance-2", provider: "kie", estimateUsd: 1 });
    await new Promise((r) => setTimeout(r, 300));
    onClose();
    events.close();
    const text = written.join("");
    assert.match(text, /event: hello/);
    assert.match(text, /event: job\ndata: \{"id":"j-/);
    assert.match(text, /event: spend/);
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd web && node --test tests/events.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `web/server/events.mjs`**

```js
// One Server-Sent Events stream for the page. Jobs started anywhere (this
// page, the chat, the CLI, Codex through MCP) land in runs/.jobs, so watching
// that folder is how every take reaches the feed.
import { existsSync, mkdirSync, watch } from "node:fs";
import { JOBS_DIR } from "../../cli/core/jobs.mjs";
import { LIBRARY_DIR } from "../../cli/lib/run.mjs";
import { context, jobView, spendView } from "./state.mjs";

export const formatEvent = ({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export function takeSnapshot() {
  const { store, limits, library } = context();
  store.sweep();
  return {
    jobs: new Map(store.list().map((j) => [j.id, jobView(j)])),
    spend: spendView(store, limits),
    library: library.list(),
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Events that turn `prev` into `next`. Pure. */
export function diff(prev, next) {
  if (!prev) return [];
  const out = [];
  for (const [id, job] of next.jobs) {
    if (!same(prev.jobs.get(id), job)) out.push({ event: "job", data: job });
  }
  if (!same(prev.spend, next.spend)) out.push({ event: "spend", data: next.spend });
  if (!same(prev.library, next.library)) out.push({ event: "library", data: next.library });
  return out;
}

export function createEvents({ pollMs = 2_000, snapshot = takeSnapshot } = {}) {
  const clients = new Set();
  let last = null;
  let timer = null;

  const check = () => {
    let next;
    try {
      next = snapshot();
    } catch (err) {
      process.stderr.write(`studio: event snapshot failed: ${err.message}\n`);
      return;
    }
    const events = diff(last, next);
    last = next;
    for (const e of events) for (const c of clients) c.write(formatEvent(e));
  };
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(check, 150);
  };

  const watchers = [];
  for (const dir of [JOBS_DIR, LIBRARY_DIR]) {
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      watchers.push(watch(dir, { recursive: dir === LIBRARY_DIR }, soon));
    } catch {
      // fs.watch is best effort; the poll below still catches every change.
    }
  }
  const poll = setInterval(check, pollMs);
  check();

  return {
    /** Attach an HTTP response as a subscriber. */
    subscribe(res) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(formatEvent({ event: "hello", data: { at: new Date().toISOString() } }));
      const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
      const client = { write: (s) => res.write(s) };
      clients.add(client);
      res.on("close", () => {
        clearInterval(ping);
        clients.delete(client);
      });
    },
    close() {
      clearInterval(poll);
      clearTimeout(timer);
      for (const w of watchers) w.close();
      clients.clear();
    },
  };
}
```

- [ ] **Step 4: Run and see it pass**

Run: `cd web && node --test tests/events.test.mjs`
Expected: PASS, and the process exits (the test calls the stored close handler, which clears the ping interval).

- [ ] **Step 5: Commit**

```bash
git add web/server/events.mjs web/tests/events.test.mjs
git diff --cached --stat
git commit -m "Stream job, spend and library changes to the studio page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Read-only API and the app

**Files:**
- Create: `web/server/api/look.mjs`, `web/server/app.mjs`
- Test: `web/tests/look.test.mjs`

Endpoints:

| Method and path | Returns |
|---|---|
| `GET /api/status` | `status()` from views (providers, catalog age, today, unsettled) |
| `GET /api/models?capability=video` | `listModels()` |
| `GET /api/presets` | `listPresets()` |
| `GET /api/runs` | `listRuns()` |
| `GET /api/runs/:slug` | `getRun()` with `artifacts` replaced by media URLs and jobs as `jobView`, newest first |
| `GET /api/jobs?run=&limit=` | newest first, as `jobView`, default limit 200, max 1000 |
| `GET /api/spend` | `spendView()` |
| `GET /api/library` | `library.list()` |
| `GET /api/library/:name` | `library.get()` with each image's `path` replaced by a media `url` |
| `POST /api/estimate` | `estimate()`; body `{ model, durationS, resolution, aspectRatio, refs, params, budgetUsd, provider }` |
| `GET /api/events` | the SSE stream |

- [ ] **Step 1: Write the failing tests**

`web/tests/look.test.mjs`:

```js
import { RUNS, KEY, deps, req, tmp } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { createApp } = await import("../server/app.mjs");
const { openJobs } = await import("../../cli/core/jobs.mjs");

mkdirSync(join(RUNS, "zed"), { recursive: true });
writeFileSync(join(RUNS, "zed", "prompt.txt"), "Slow push-in");
writeFileSync(join(RUNS, "zed", "out.mp4"), "x");
const store = openJobs(join(RUNS, ".jobs"));
const job = store.create({
  run: "zed",
  capability: "video",
  model: "seedance-2",
  provider: "kie",
  estimateUsd: 1.03,
  input: { prompt: "Slow push-in", duration: 5, resolution: "720p" },
});

let app, port;
before(async () => {
  app = createApp({ key: KEY, deps, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());

describe("read-only API", () => {
  test("status uses the injected balance reader", async () => {
    const r = await req(port, "/api/status");
    assert.equal(r.status, 200);
    assert.equal(r.json.providers.find((p) => p.name === "kie").balance, 100);
    assert.equal(r.json.today.capUsd, 10);
  });

  test("models filter by capability", async () => {
    const r = await req(port, "/api/models?capability=video");
    assert.ok(r.json.length > 0);
    assert.ok(r.json.every((m) => m.capability === "video"));
  });

  test("presets list", async () => {
    assert.ok(Array.isArray((await req(port, "/api/presets")).json));
  });

  test("runs and one run, with media URLs and job views", async () => {
    assert.ok((await req(port, "/api/runs")).json.some((r) => r.run === "zed"));
    const r = await req(port, "/api/runs/zed");
    assert.deepEqual(r.json.media, ["/media/runs/zed/out.mp4"]);
    assert.equal(r.json.jobs[0].durationS, 5);
    assert.ok(!("artifacts" in r.json), "absolute paths are not sent to the page");
  });

  test("an unknown run is 400 with code 3", async () => {
    const r = await req(port, "/api/runs/nope");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 3);
  });

  test("jobs newest first, filtered by run", async () => {
    const r = await req(port, "/api/jobs?run=zed");
    assert.equal(r.json[0].id, job.id);
    assert.equal((await req(port, "/api/jobs?run=other")).json.length, 0);
  });

  test("spend has 14 days", async () => {
    assert.equal((await req(port, "/api/spend")).json.days.length, 14);
  });

  test("library list and an unknown asset", async () => {
    assert.deepEqual((await req(port, "/api/library")).json, []);
    assert.equal((await req(port, "/api/library/nope")).json.error.code, 3);
  });

  test("estimate prices a job and reserves nothing", async () => {
    const before = store.list().length;
    const r = await req(port, "/api/estimate", {
      method: "POST",
      body: { model: "seedance-2-5", durationS: 4, resolution: "480p", provider: "kie" },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.estimateUsd, 0.56);
    assert.equal(store.list().length, before);
  });

  test("no response contains the provider key", async () => {
    for (const p of ["/api/status", "/api/models", "/api/jobs", "/api/spend"]) {
      assert.doesNotMatch((await req(port, p)).text, /test-key-not-real/, p);
    }
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd web && node --test tests/look.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `web/server/api/look.mjs`**

```js
// Read-only endpoints. Each one calls a cli/core view and turns paths into
// media URLs; none reserves, submits or writes.
import { loadCatalog } from "../../../cli/lib/models.mjs";
import { status, listModels, listPresets, estimate, listRuns, getRun } from "../../../cli/core/views.mjs";
import { context, jobView, spendView } from "../state.mjs";
import { mediaUrl } from "../media.mjs";

export function registerLook(router, { catalog = loadCatalog(), deps = {} } = {}) {
  router.get("/api/status", () => {
    const { store, limits } = context();
    return status(catalog, { store, limits, ...(deps.credits ? { credits: deps.credits } : {}) });
  });

  router.get("/api/models", ({ query }) => listModels(catalog, { capability: query.get("capability") || undefined }));

  router.get("/api/presets", () => listPresets(catalog));

  router.get("/api/runs", () => listRuns());

  router.get("/api/runs/:slug", ({ params }) => {
    const { store } = context();
    const { artifacts, jobs: _summaries, ...run } = getRun(params.slug, { store });
    return {
      ...run,
      media: artifacts.map(mediaUrl).filter(Boolean),
      jobs: store.list().filter((j) => j.run === params.slug).reverse().map(jobView),
    };
  });

  router.get("/api/jobs", ({ query }) => {
    const { store } = context();
    const run = query.get("run");
    const limit = Math.min(Number(query.get("limit")) || 200, 1000);
    return store
      .list()
      .filter((j) => !run || j.run === run)
      .reverse()
      .slice(0, limit)
      .map(jobView);
  });

  router.get("/api/spend", () => {
    const { store, limits } = context();
    store.sweep();
    return spendView(store, limits);
  });

  router.get("/api/library", () => context().library.list());

  router.get("/api/library/:name", ({ params }) => {
    const a = context().library.get(params.name);
    return { ...a, images: a.images.map(({ path, upload: _u, ...im }) => ({ ...im, url: mediaUrl(path) })) };
  });

  router.post("/api/estimate", ({ body = {} }) => {
    const { store, limits } = context();
    return estimate(
      catalog,
      {
        model: body.model,
        durationS: body.durationS,
        resolution: body.resolution,
        aspectRatio: body.aspectRatio,
        refs: body.refs ?? [],
        params: body.params ?? {},
        budgetUsd: body.budgetUsd,
        provider: body.provider,
      },
      { store, limits },
    );
  });
}
```

- [ ] **Step 4: Implement `web/server/app.mjs`**

```js
// Wires the studio together: router + API modules + media + events + page.
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter, createHandler } from "./http.mjs";
import { serveMedia } from "./media.mjs";
import { createEvents } from "./events.mjs";
import { registerLook } from "./api/look.mjs";

export const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * An http.Server for the studio. `deps` replaces anything that reaches a
 * provider (tests pass stubs). `closeAll()` also stops the event watchers.
 * Later plans register more endpoints on `server.router` before listen().
 */
export function createApp({ key, deps = {}, catalog, distDir = join(WEB_DIR, "dist"), pollMs } = {}) {
  const router = createRouter();
  const events = createEvents({ pollMs });
  router.get("/api/events", ({ res }) => {
    events.subscribe(res);
    return undefined;
  });
  registerLook(router, { catalog, deps });

  const server = createServer(createHandler({ key, router, distDir, media: serveMedia }));
  server.closeAll = () =>
    new Promise((r) => {
      events.close();
      server.closeAllConnections?.();
      server.close(r);
    });
  server.router = router;
  server.events = events;
  return server;
}
```

`registerLook(router, { catalog, deps })` receives `catalog: undefined` when none is given; its default parameter loads the real catalog in that case.

- [ ] **Step 5: Run and see it pass**

Run: `cd web && node --test tests/look.test.mjs && npm run test:server`
Expected: every server test passes.

- [ ] **Step 6: Commit**

```bash
git add web/server/api/look.mjs web/server/app.mjs web/tests/look.test.mjs
git diff --cached --stat
git commit -m "Add the studio's read-only API over cli/core views

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `npm run studio`

**Files:**
- Create: `web/server/main.mjs`
- Test: `web/tests/main.test.mjs`

- [ ] **Step 1: Write the failing tests**

`web/tests/main.test.mjs` tests the two helpers; the start-up itself is checked by hand in Task 11.

```js
import { tmp } from "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

const { needsBuild, listenOnFreePort } = await import("../server/main.mjs");

describe("needsBuild", () => {
  const web = join(tmp, "webroot");
  mkdirSync(join(web, "src"), { recursive: true });
  writeFileSync(join(web, "src", "a.tsx"), "x");
  writeFileSync(join(web, "index.html"), "x");

  test("true when dist/index.html is missing", () => {
    assert.equal(needsBuild(web), true);
  });

  test("false when the build is newer than every source, true when a source is newer", () => {
    mkdirSync(join(web, "dist"), { recursive: true });
    writeFileSync(join(web, "dist", "index.html"), "x");
    const old = new Date(Date.now() - 60_000);
    utimesSync(join(web, "src", "a.tsx"), old, old);
    utimesSync(join(web, "index.html"), old, old);
    assert.equal(needsBuild(web), false);
    writeFileSync(join(web, "src", "a.tsx"), "y");
    assert.equal(needsBuild(web), true);
  });
});

describe("listenOnFreePort", () => {
  test("skips a port in use", async () => {
    const blocker = createServer();
    await new Promise((r) => blocker.listen(0, "127.0.0.1", r));
    const taken = blocker.address().port;
    const server = createServer();
    const port = await listenOnFreePort(server, taken);
    assert.notEqual(port, taken);
    await new Promise((r) => server.close(r));
    await new Promise((r) => blocker.close(r));
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `cd web && node --test tests/main.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `web/server/main.mjs`**

```js
#!/usr/bin/env node
// npm run studio: build the page if its sources changed, start the server on
// 127.0.0.1 (4317 or the next free port), open the browser. The session key
// is made here, kept in memory and never printed.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createApp, WEB_DIR } from "./app.mjs";

const newest = (dir) => {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
};

export function needsBuild(webDir = WEB_DIR) {
  const built = join(webDir, "dist", "index.html");
  if (!existsSync(built)) return true;
  const sources = [join(webDir, "index.html"), join(webDir, "vite.config.ts")].filter(existsSync).map((p) => statSync(p).mtimeMs);
  return Math.max(newest(join(webDir, "src")), ...sources) > statSync(built).mtimeMs;
}

export function listenOnFreePort(server, first = 4317, tries = 20) {
  return new Promise((resolve, reject) => {
    let port = first;
    const attempt = () => {
      server.once("error", (err) => {
        if (err.code === "EADDRINUSE" && port < first + tries) {
          port += 1;
          attempt();
        } else reject(err);
      });
      server.listen(port, "127.0.0.1", () => resolve(server.address().port));
    };
    attempt();
  });
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(cmd, [url], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (!existsSync(join(WEB_DIR, "node_modules"))) {
    process.stderr.write("The studio's page dependencies are missing. Run: npm --prefix web install\n");
    process.exit(1);
  }
  if (needsBuild()) {
    process.stderr.write("Building the studio page…\n");
    const b = spawnSync("npm", ["--prefix", WEB_DIR, "run", "build"], { stdio: "inherit" });
    if (b.status !== 0) process.exit(b.status ?? 1);
  }
  const key = randomBytes(24).toString("base64url");
  const app = createApp({ key });
  const port = await listenOnFreePort(app, Number(process.env.STUDIO_PORT) || 4317);
  const url = `http://127.0.0.1:${port}/`;
  process.stdout.write(`Studio running at ${url}  (Ctrl-C to stop)\n`);
  if (!args.has("--no-open")) openBrowser(url);
  const stop = () => app.closeAll().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
```

- [ ] **Step 4: Run and see it pass**

Run: `cd web && node --test tests/main.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/server/main.mjs web/tests/main.test.mjs
git diff --cached --stat
git commit -m "Add npm run studio: build when stale, free port, open the browser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Page build, theme and API client

**Files:**
- Create: `web/index.html`, `web/vite.config.ts`, `web/tsconfig.json`, `web/src/test-setup.ts`, `web/src/vite-env.d.ts`
- Create: `web/src/theme/tokens.css`, `web/src/theme/base.css`
- Create: `web/src/api/client.ts`, `web/src/api/events.ts`, `web/src/api/types.ts`
- Test: `web/src/api/client.test.ts`, `web/src/api/events.test.ts`

Before writing CSS, load the impeccable skill (`Skill` tool, `impeccable`) and follow its guidance for type, colour and spacing. The values below are the approved direction; refine them only where impeccable flags a real problem, and keep functional text at 11px or more.

- [ ] **Step 1: Build files**

`web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <!--studio-key-->
    <title>Studio</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/vite.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test-setup.ts"],
  },
});
```

`web/src/test-setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

`web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`web/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 2: Theme**

`web/src/theme/tokens.css`:

```css
/* Projection room, engine showing. The footage is the brightest thing on screen. */
:root {
  --bg: #0e0d0c;
  --surface-1: #161412;
  --surface-2: #1b1917;
  --surface-3: #2a2724;
  --line: #2c2926;
  --text: #ece7df;
  --text-2: #b9b0a3;
  --text-3: #8a8277;
  --accent: #e8a33d;
  --accent-ink: #1a1206;
  --ok: #8fc79a;
  --warn: #e0b057;
  --bad: #e2725b;

  --font-sans: "IBM Plex Sans", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;

  --text-xs: 11px; /* floor for any functional text */
  --text-sm: 12px;
  --text-md: 14px;
  --text-lg: 16px;
  --text-xl: 20px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
}
```

`web/src/theme/base.css`:

```css
@import "@fontsource/ibm-plex-sans/400.css";
@import "@fontsource/ibm-plex-sans/500.css";
@import "@fontsource/ibm-plex-sans/600.css";
@import "@fontsource/ibm-plex-mono/400.css";
@import "@fontsource/ibm-plex-mono/500.css";
@import "./tokens.css";

*, *::before, *::after { box-sizing: border-box; }
html, body, #root { height: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 400 var(--text-md)/1.45 var(--font-sans);
  -webkit-font-smoothing: antialiased;
}
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

- [ ] **Step 3: Write the failing client tests**

`web/src/api/client.test.ts`:

```ts
import { describe, test, expect, vi, beforeEach } from "vitest";
import { api, ApiError, setKeyForTests } from "./client";

beforeEach(() => setKeyForTests("k-123"));

describe("api", () => {
  test("sends the studio key and parses JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await api("/api/ping")).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][1].headers["x-studio-key"]).toBe("k-123");
  });

  test("posts a JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await api("/api/estimate", { method: "POST", body: { model: "x" } });
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"model":"x"}');
    expect(init.headers["content-type"]).toBe("application/json");
  });

  test("an error response becomes an ApiError with core's code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 2, message: "Over the cap." } }), { status: 402 })));
    await expect(api("/api/x")).rejects.toMatchObject({ code: 2, status: 402, message: "Over the cap." });
  });

  test("a network failure is an ApiError with offline set", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = await api("/api/x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.offline).toBe(true);
  });
});
```

`web/src/api/events.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { parseSse } from "./events";

describe("parseSse", () => {
  test("splits complete events and keeps the remainder", () => {
    const { events, rest } = parseSse('event: job\ndata: {"id":"a"}\n\n: ping\n\nevent: spend\ndata: {"sp');
    expect(events).toEqual([{ event: "job", data: { id: "a" } }]);
    expect(rest).toBe('event: spend\ndata: {"sp');
  });
});
```

- [ ] **Step 4: Run and see them fail**

Run: `cd web && npx vitest run src/api`
Expected: FAIL, modules not found.

- [ ] **Step 5: Implement the client**

`web/src/api/types.ts`:

```ts
export type JobState =
  | "reserved" | "sending" | "submitted" | "uncertain" | "succeeded"
  | "failed-charged" | "failed-unconfirmed" | "failed-confirmed-free" | "refused";

export interface JobView {
  id: string;
  state: JobState;
  run: string;
  model: string;
  provider: string;
  providerModel: string | null;
  upstreamTaskId: string | null;
  estimateUsd: number | null;
  actualUsd: number | null;
  countedUsd: number;
  costSource: string;
  capability: "video" | "image" | "audio" | null;
  prompt: string | null;
  durationS: number | null;
  resolution: string | null;
  aspectRatio: string | null;
  failedOver: boolean;
  error: string | null;
  media: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SpendView {
  capUsd: number;
  spentUsd: number;
  availableUsd: number;
  perJobUsd: number | null;
  unsettled: number;
  days: { day: string; usd: number }[];
}

export interface AssetSummary {
  name: string;
  kind: string;
  description: string;
  imageCount: number;
  updatedAt: string;
}

export type StudioEvent =
  | { event: "hello"; data: { at: string } }
  | { event: "job"; data: JobView }
  | { event: "spend"; data: SpendView }
  | { event: "library"; data: AssetSummary[] };
```

`web/src/api/client.ts`:

```ts
let key = typeof document !== "undefined"
  ? document.querySelector<HTMLMetaElement>('meta[name="studio-key"]')?.content ?? ""
  : "";

export const studioKey = () => key;
export const setKeyForTests = (k: string) => { key = k; };

export class ApiError extends Error {
  code: number;
  status: number;
  offline: boolean;
  detail: Record<string, unknown>;
  constructor(message: string, { code = 0, status = 0, offline = false, detail = {} }: { code?: number; status?: number; offline?: boolean; detail?: Record<string, unknown> } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.offline = offline;
    this.detail = detail;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { "x-studio-key": key };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch {
    throw new ApiError("Studio server isn't running. Start it with: npm run studio", { offline: true });
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const { code = 0, message = `HTTP ${res.status}`, ...detail } = json?.error ?? {};
    throw new ApiError(message, { code, status: res.status, detail });
  }
  return json as T;
}
```

`web/src/api/events.ts`:

```ts
import { studioKey } from "./client";
import type { StudioEvent } from "./types";

/** Complete SSE events in `buf`, plus the incomplete tail. Comments (": ping") are dropped. */
export function parseSse(buf: string): { events: StudioEvent[]; rest: string } {
  const parts = buf.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: StudioEvent[] = [];
  for (const block of parts) {
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (data) events.push({ event, data: JSON.parse(data) } as StudioEvent);
  }
  return { events, rest };
}

/**
 * Read /api/events with fetch (EventSource cannot send the key header).
 * Reconnects with backoff; `onConnection(false)` while the server is away.
 */
export function subscribe(onEvent: (e: StudioEvent) => void, onConnection: (up: boolean) => void): () => void {
  let stopped = false;
  let ctrl = new AbortController();
  let delay = 500;

  const run = async () => {
    while (!stopped) {
      try {
        const res = await fetch("/api/events", { headers: { "x-studio-key": studioKey() }, signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        onConnection(true);
        delay = 500;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const parsed = parseSse(buf + value);
          buf = parsed.rest;
          parsed.events.forEach(onEvent);
        }
      } catch {
        if (stopped) return;
      }
      onConnection(false);
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 8_000);
      ctrl = new AbortController();
    }
  };
  run();
  return () => {
    stopped = true;
    ctrl.abort();
  };
}
```

- [ ] **Step 6: Run and see them pass**

Run: `cd web && npx vitest run src/api`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/index.html web/vite.config.ts web/tsconfig.json web/src/test-setup.ts web/src/vite-env.d.ts web/src/theme web/src/api
git diff --cached --stat
git commit -m "Add the studio page build, theme tokens and key-carrying API client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: App shell — nav, spend meter, connection banner

**Files:**
- Create: `web/src/main.tsx`, `web/src/app/App.tsx`, `web/src/app/App.css`, `web/src/app/Nav.tsx`, `web/src/app/SpendMeter.tsx`, `web/src/app/useStudio.ts`, `web/src/app/route.ts`, `web/src/app/Placeholder.tsx`
- Test: `web/src/app/route.test.ts`, `web/src/app/SpendMeter.test.tsx`, `web/src/app/App.test.tsx`

Before writing the components, load the impeccable skill and use it for the layout and states. Mobbin references are listed in the spec's "Visual direction" section.

- [ ] **Step 1: Write the failing tests**

`web/src/app/route.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { parseRoute, TABS } from "./route";

describe("parseRoute", () => {
  test("empty or unknown goes to studio", () => {
    expect(parseRoute("")).toEqual({ tab: "studio", rest: [] });
    expect(parseRoute("#/nope")).toEqual({ tab: "studio", rest: [] });
  });
  test("a tab and its rest", () => {
    expect(parseRoute("#/films/zed-hero")).toEqual({ tab: "films", rest: ["zed-hero"] });
  });
  test("six tabs in nav order", () => {
    expect(TABS.map((t) => t.id)).toEqual(["studio", "library", "presets", "films", "spend", "settings"]);
  });
});
```

`web/src/app/SpendMeter.test.tsx`:

```tsx
import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SpendMeter } from "./SpendMeter";

const spend = { capUsd: 10, spentUsd: 2.1, availableUsd: 7.9, perJobUsd: null, unsettled: 0, days: [] };

describe("SpendMeter", () => {
  test("shows spent and cap in the mono face, with an accessible meter", () => {
    render(<SpendMeter spend={spend} />);
    expect(screen.getByText("$2.10 / $10.00")).toHaveClass("mono");
    const meter = screen.getByRole("meter", { name: "Spent today" });
    expect(meter).toHaveAttribute("aria-valuenow", "2.1");
    expect(meter).toHaveAttribute("aria-valuemax", "10");
  });

  test("warns at 80% and over", () => {
    render(<SpendMeter spend={{ ...spend, spentUsd: 8.5, availableUsd: 1.5 }} />);
    expect(screen.getByRole("meter", { name: "Spent today" })).toHaveAttribute("data-level", "high");
  });

  test("shows a dash while loading", () => {
    render(<SpendMeter spend={null} />);
    expect(screen.getByText("— / —")).toBeInTheDocument();
  });
});
```

`web/src/app/App.test.tsx`:

```tsx
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

beforeEach(() => {
  window.location.hash = "";
});

describe("App", () => {
  test("shows the six tabs and marks the current one", () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise(() => {})));
    render(<App />);
    for (const name of ["Studio", "Library", "Presets", "Films", "Spend", "Settings"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Studio" })).toHaveAttribute("aria-current", "page");
  });

  test("shows the server-down banner when the API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("npm run studio");
  });
});
```

The brand link is labelled "Studio" too; give it `aria-label="Studio home"` so the tab link is the only link named exactly "Studio".

- [ ] **Step 2: Run and see them fail**

Run: `cd web && npx vitest run src/app`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`web/src/app/route.ts`:

```ts
export const TABS = [
  { id: "studio", label: "Studio" },
  { id: "library", label: "Library" },
  { id: "presets", label: "Presets" },
  { id: "films", label: "Films" },
  { id: "spend", label: "Spend" },
  { id: "settings", label: "Settings" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

export function parseRoute(hash: string): { tab: TabId; rest: string[] } {
  const [first = "", ...rest] = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const tab = TABS.find((t) => t.id === first)?.id;
  return tab ? { tab, rest } : { tab: "studio", rest: [] };
}
```

`web/src/app/useStudio.ts`:

```ts
import { useEffect, useState, useSyncExternalStore } from "react";
import { api, ApiError } from "../api/client";
import { subscribe } from "../api/events";
import type { SpendView, StudioEvent } from "../api/types";

type Listener = (e: StudioEvent) => void;
const listeners = new Set<Listener>();

/** Screens listen for job and library events here. */
export function onStudioEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useRoute(): string {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("hashchange", cb);
      return () => window.removeEventListener("hashchange", cb);
    },
    () => window.location.hash,
  );
}

export function useStudio() {
  const [spend, setSpend] = useState<SpendView | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<SpendView>("/api/spend")
        .then((s) => alive && setSpend(s))
        .catch((e: ApiError) => alive && e.offline && setOnline(false));
    load();
    const stop = subscribe(
      (e) => {
        if (e.event === "spend") setSpend(e.data);
        listeners.forEach((fn) => fn(e));
      },
      (up) => {
        if (!alive) return;
        setOnline(up);
        if (up) load();
      },
    );
    return () => {
      alive = false;
      stop();
    };
  }, []);

  return { spend, online };
}
```

`web/src/app/SpendMeter.tsx`:

```tsx
import type { SpendView } from "../api/types";

const usd = (n: number) => `$${n.toFixed(2)}`;

export function SpendMeter({ spend }: { spend: SpendView | null }) {
  if (!spend) {
    return (
      <div className="spend-meter">
        <span className="mono">— / —</span>
      </div>
    );
  }
  const share = spend.capUsd > 0 ? Math.min(1, spend.spentUsd / spend.capUsd) : 1;
  const level = share >= 1 ? "over" : share >= 0.8 ? "high" : "ok";
  return (
    <div className="spend-meter" title={`${usd(spend.availableUsd)} left today`}>
      <span className="spend-meter__label">Today</span>
      <span className="mono">{`${usd(spend.spentUsd)} / ${usd(spend.capUsd)}`}</span>
      <div
        className="spend-meter__bar"
        role="meter"
        aria-label="Spent today"
        aria-valuemin={0}
        aria-valuemax={spend.capUsd}
        aria-valuenow={spend.spentUsd}
        data-level={level}
      >
        <span style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}
```

`web/src/app/Nav.tsx`:

```tsx
import { TABS, type TabId } from "./route";

export function Nav({ current }: { current: TabId }) {
  return (
    <nav className="nav" aria-label="Sections">
      {TABS.map((t) => (
        <a key={t.id} href={`#/${t.id}`} aria-current={t.id === current ? "page" : undefined}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}
```

`web/src/app/Placeholder.tsx` (each screen replaces its placeholder in plans 6-8):

```tsx
export function Placeholder({ title, next }: { title: string; next: string }) {
  return (
    <section className="placeholder" aria-labelledby="ph-title">
      <h1 id="ph-title">{title}</h1>
      <p>{next}</p>
    </section>
  );
}
```

`web/src/app/App.tsx`:

```tsx
import { Nav } from "./Nav";
import { SpendMeter } from "./SpendMeter";
import { Placeholder } from "./Placeholder";
import { parseRoute } from "./route";
import { useRoute, useStudio } from "./useStudio";
import "./App.css";

const SCREENS = {
  studio: ["Studio", "The prompt bar and your takes arrive in the next build step."],
  library: ["Library", "Saved characters, products, places and styles will show here."],
  presets: ["Presets", "The preset gallery will show here."],
  films: ["Films", "Your run folders, ready to finish, will show here."],
  spend: ["Spend", "Daily totals and every job will show here."],
  settings: ["Settings", "Chat connection, limits and provider keys will show here."],
} as const;

export function App() {
  const { tab } = parseRoute(useRoute());
  const { spend, online } = useStudio();
  const [title, next] = SCREENS[tab];
  return (
    <div className="app">
      <header className="app__top">
        <a className="app__brand" href="#/studio" aria-label="Studio home">Studio</a>
        <Nav current={tab} />
        <SpendMeter spend={spend} />
      </header>
      {!online && (
        <div className="banner" role="alert">
          Studio server isn't running. Start it with <code className="mono">npm run studio</code>, and this page reconnects.
        </div>
      )}
      <main className="app__main">
        <Placeholder title={title} next={next} />
      </main>
    </div>
  );
}
```

`web/src/app/App.css`:

```css
.app { display: flex; flex-direction: column; height: 100%; }
.app__top {
  display: flex; align-items: center; gap: var(--space-5);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--line);
}
.app__brand { color: var(--text); font-weight: 600; text-decoration: none; letter-spacing: 0.01em; }
.nav { display: flex; gap: var(--space-1); }
.nav a {
  color: var(--text-2); text-decoration: none; font-size: var(--text-sm);
  padding: var(--space-1) var(--space-3); border-radius: var(--radius-sm);
}
.nav a:hover { color: var(--text); background: var(--surface-2); }
.nav a[aria-current="page"] { color: var(--text); background: var(--surface-3); }
.spend-meter { margin-left: auto; display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); color: var(--text-2); }
.spend-meter .mono { color: var(--text); }
.spend-meter__bar { width: 80px; height: 4px; border-radius: 2px; background: var(--surface-3); overflow: hidden; }
.spend-meter__bar span { display: block; height: 100%; background: var(--accent); }
.spend-meter__bar[data-level="high"] span { background: var(--warn); }
.spend-meter__bar[data-level="over"] span { background: var(--bad); }
.banner {
  margin: var(--space-3) var(--space-4) 0; padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md); background: #2b1a14; color: #f3c8b8; font-size: var(--text-sm);
}
.app__main { flex: 1; min-height: 0; padding: var(--space-5) var(--space-4); }
.placeholder h1 { font-size: var(--text-xl); font-weight: 600; margin: 0 0 var(--space-2); }
.placeholder p { color: var(--text-2); margin: 0; max-width: 60ch; }
```

`web/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme/base.css";
import { App } from "./app/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 4: Run tests, type check and build**

Run: `cd web && npx vitest run && npx tsc -p tsconfig.json && npm run build && grep -c "studio-key" dist/index.html`
Expected: tests PASS, no type errors, the grep prints `1` (the placeholder comment survived the build).

- [ ] **Step 5: Commit**

```bash
git add web/src/main.tsx web/src/app
git diff --cached --stat
git commit -m "Add the studio shell: six tabs, live spend meter, server-down banner

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Run it for real, document it

**Files:**
- Modify: `README.md` (a "Studio (web app)" section after the MCP section; the per-job limit next to `kie limits`)
- Create: `web/README.md`

- [ ] **Step 1: Full test run**

Run: `npm test && npm run test:mcp && npm run test:web`
Expected: all pass.

- [ ] **Step 2: Start it and check by hand**

Start in the background: `node web/server/main.mjs --no-open`
Expected output: `Studio running at http://127.0.0.1:4317/  (Ctrl-C to stop)`, and no key printed.

Then:
- `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4317/api/status` prints `403` (no key).
- `curl -s http://127.0.0.1:4317/ | grep -c 'name="studio-key"'` prints `1` (the key is in the page; do not print it).
- Open the page with the gstack `browse` skill, screenshot the Studio tab at 1440×900, and confirm: the six tabs, the spend meter showing today's real total, the warm dark ground, IBM Plex fonts loaded (not the fallback).
- Stop the server and wait: the "Studio server isn't running" banner appears. Start it again: the banner goes away within about 8 seconds.

- [ ] **Step 3: Docs**

`web/README.md`:

```markdown
# Studio web app

A local page for everything the `kie` CLI and the MCP tools do. It runs on your Mac only.

## Start

1. `npm --prefix web install` (once)
2. `npm run studio`

This builds the page if needed, starts a server on http://127.0.0.1:4317 (or the next free port) and opens your browser. Ctrl-C stops it. `--no-open` skips the browser; `STUDIO_PORT=5000 npm run studio` picks another first port.

## Why it is safe to leave running

- It listens on 127.0.0.1 only and refuses requests addressed to any other host name.
- Every `/api` call must carry a random key that only the page it served knows, so another website cannot make your browser start jobs.
- Jobs started here go through the same per-job limit, daily cap and job records as `kie` and the MCP server.

## Layout

- `server/`: `node:http` server, no dependencies. `api/*.mjs` call `cli/core`.
- `src/`: React page, built with Vite into `dist/`.
- `tests/`: server tests (`node --test`). Page tests sit next to their components (`vitest`).

Run them all with `npm run test:web` from the repo root.
```

In the root `README.md`, after the MCP section:

```markdown
## Studio (web app)

`npm --prefix web install` once, then `npm run studio`. A local page with the prompt bar, your takes, the library, presets, films, spend and settings. See [web/README.md](web/README.md).
```

Next to the existing `kie limits` description in `README.md` (and `cli/README.md` if it lists `kie limits`), add: `kie limits --per-job 2` refuses any single job estimated above $2; `--per-job off` removes the limit.

- [ ] **Step 4: Commit**

```bash
git add README.md web/README.md cli/README.md
git diff --cached --stat
git commit -m "Document the studio web app and the per-job limit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
