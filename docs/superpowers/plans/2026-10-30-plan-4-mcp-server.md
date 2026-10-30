# Plan 4: the MCP server and its installer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code and Codex can look, save assets, generate (inside the per-job budget and the daily cap), wait, and finish films through an MCP server, installed and removed by `node install.mjs` without touching anyone else's configuration.

**Architecture:** `cli/core/views.mjs` holds the read-only views (status, models, presets, estimate, runs) as plain data, tested in the zero-dependency root suite. `mcp/` is its own package (like `render/`) with `@modelcontextprotocol/sdk` and `zod`. `mcp/server.mjs` registers 18 tools that validate input, call `cli/core` or `cli/lib`, and return `structuredContent` matching each tool's `outputSchema`. Errors become `isError` results via `mcp/results.mjs`. `mcp/register.mjs` (zero-dependency) edits only our own Claude Code entry and our own marked block in Codex's `config.toml`.

**Tech stack:** Node ≥20 ESM. `@modelcontextprotocol/sdk` 1.32.2 and `zod` 4.6.7 (the npm `latest` tags, read 2026-10-30), pinned exactly. ffmpeg for previews (already required by the finishing commands).

**Spec:** [2026-10-30-mcp-server-design.md](../specs/2026-10-30-mcp-server-design.md), "Tools", "Errors", "Installer", "Testing", build step 7. Plans 1-3 must have landed, including the plan 2 review fixes (`waitJob` can return `outcome: "no-artifact"`).

**Decisions made while planning, recorded for review:**

- **Error details go in `_meta.error`, not `structuredContent`.** Probed against SDK 1.32.2: a client validates `structuredContent` against the tool's `outputSchema` *even when `isError` is true*. An error object there fails validation and the client throws instead of showing the error. So an error result is `isError: true`, a text block starting `Error <code>:` with the next action, and `_meta: { error: { code, retryable, nextAction, localJobId, upstreamTaskId } }`.
- **Relative paths are inside `runs/`.** A server's working directory is whatever the host chose, so a relative path from a client is resolved against `runs/` (`my-film/out.png`). For tools that take `run`, a bare file name is looked for in that run first, as the CLI does. Every path is then confined to the allowed roots.
- **Presets supply defaults only.** `generate_video` takes `preset` for its model, duration and aspect ratio, but the prompt text is always required. The CLI's "archived source prompt sent raw" path, which reproduces someone else's ad, does not exist over MCP.
- **No failover after an upstream failure over MCP.** Within one `generate_*` call, a clean create-time rejection still falls over to the next reseller (that is inside `submitJob`). A job that fails later is reported by `wait_job` with whether it was charged. The agent decides whether to generate again, and the text says so.
- **Previews** are made with ffmpeg: a JPEG at most 768 px wide for an image, the 8-frame contact sheet (at most 1024 px wide) for a video. Without ffmpeg the preview is skipped, not an error.
- `brand` in `render` is a brand-kit name only (`^[a-z0-9-]+$`), never a path, so a client cannot point the renderer at an arbitrary JSON file.

---

## File map

| File | Change |
|---|---|
| `cli/core/inputs.mjs` | add `confinePath`; `checkLocalFile` uses it |
| `cli/core/refs.mjs` | `baseDir` option for relative local paths |
| `cli/core/views.mjs` | new: `status`, `listModels`, `listPresets`, `estimate`, `listRuns`, `getRun`, `jobSummary` |
| `mcp/package.json`, `mcp/package-lock.json` | new package |
| `mcp/results.mjs` | new: `ok`, `fail` |
| `mcp/preview.mjs` | new: `imagePreview`, `artifactPreview` |
| `mcp/server.mjs` | new: `createServer`, stdio entry point |
| `mcp/register.mjs` | new: Claude Code and Codex registration |
| `install.mjs` | registers the server; `--no-mcp` skips it |
| `package.json` | `test:mcp` script |
| `mcp/tests/helpers.mjs`, `mcp/tests/{results,look,generate,finish}.test.mjs` | new |
| `tests/inputs.test.mjs`, `tests/refs.test.mjs` | 2 + 1 tests |
| `tests/views.test.mjs`, `tests/mcp-register.test.mjs` | new |
| `mcp/README.md`, `cli/README.md`, `skills/motion-design/references/tool-routing.md`, `README.md`, spec | document |

**Two test suites.** The root suite (`npm test`) stays zero-dependency: it covers `views.mjs`, `register.mjs` and the core changes. The MCP suite (`npm run test:mcp`, i.e. `npm --prefix mcp test`) needs `mcp/node_modules`. Run both after each task from Task 3 on.

**Never print to stdout in `mcp/`.** stdout carries the protocol. `cli/lib` and `cli/core` do not print (checked: no `console.log` or `process.stdout` there); keep it that way and do not pass an `onLine` that writes to stdout.

**Spend nothing.** The MCP tests stub every provider call (`preflight`, `createTask`, `waitForTask`, `download`, `creditsAfter`, uploads and the balance read) and point `KIE_RUNS_DIR`, `KIE_LIBRARY_DIR` and `KIE_LIMITS_FILE` at a temp folder. `KIE_API_KEY` is set to a dummy so routes count as usable; nothing reaches the network.

---

### Task 1: Confine any client path, and resolve relative refs

**Files:**
- Modify: `cli/core/inputs.mjs`, `cli/core/refs.mjs`
- Test: `tests/inputs.test.mjs` (+2), `tests/refs.test.mjs` (+1)

- [ ] **Step 1: Write the failing tests**

Add `confinePath` to the import in `tests/inputs.test.mjs` and append:

```js
describe("confinePath, for files that are not media", () => {
  test("a subtitle file inside a root comes back as its real path", () => {
    const p = put(root, "captions.srt", "1\n00:00:00,000 --> 00:00:01,000\nHi\n");
    assert.equal(confinePath(p, [root]), p);
  });

  test("a hidden segment is refused even for a non-media file", () => {
    mkdirSync(join(root, ".env.d"), { recursive: true });
    const p = put(join(root, ".env.d"), "x.srt", "1");
    assert.throws(() => confinePath(p, [root]), (e) => e.code === EXIT.UNKNOWN && /hidden/.test(e.message));
  });
});
```

Append to `tests/refs.test.mjs`:

```js
test("a relative local path is resolved against baseDir", async () => {
  file("rel.png", png(800, 800));
  const r = await expand([{ source: "rel.png", role: "identity" }], { baseDir: src, dryRun: true, roots: [src] });
  assert.equal(r.refs[0].label, "rel.png");
  assert.equal(r.refs[0].file.width, 800);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/inputs.test.mjs tests/refs.test.mjs`
Expected: FAIL, `confinePath` is not exported; the relative path is not found (it resolves against the working directory).

- [ ] **Step 3: Implement**

In `cli/core/inputs.mjs`, add above `checkLocalFile`:

```js
/**
 * The real path of `path` (symlinks followed), refused unless it sits inside
 * one of `roots` with no hidden segment on the way. For every file an MCP
 * client names, media or not: a subtitle file or a shot list leaves the
 * machine as surely as an image once it is burned into a video and uploaded.
 */
export function confinePath(path, roots) {
  let real;
  try {
    real = realpathSync(resolve(path));
  } catch {
    throw unknown(`No such file: ${path}`);
  }
  const root = roots.find((r) => isInside(real, r));
  if (!root) {
    throw unknown(
      `${path} is outside the folders files may be read from. Allowed: ${roots.join(", ")}. ` +
        `To allow another folder, the user adds it under "allowRoots" in ${limitsPath()}.`,
    );
  }
  const hidden = relative(root, real).split(sep).find((s) => s.startsWith("."));
  if (hidden) throw unknown(`${path} is or sits in a hidden folder ("${hidden}"); such files are never read.`);
  return real;
}
```

Import `limitsPath` from `./spend.mjs` (it honours `KIE_LIMITS_FILE`). If plan 3 hard-coded `~/.config/kie/limits.json` in `checkLocalFile`'s message, that message goes away with the next change.

Replace the start of `checkLocalFile`, from `let real;` through the end of the `if (roots) { ... }` block, with:

```js
  let real;
  if (roots) {
    real = confinePath(path, roots);
  } else {
    try {
      real = realpathSync(resolve(path));
    } catch {
      throw unknown(`No such file: ${path}`);
    }
  }
  const stat = statSync(real);
  if (!stat.isFile()) throw unknown(`${path} is not a file.`);
```

(remove the now-duplicated `statSync`/`isFile` lines that followed the old block). The existing "outside the folders" and "hidden" tests from plan 3 must still pass: the wording `outside the folders` and `hidden` is kept.

In `cli/core/refs.mjs`, add `baseDir = null` to `expandRefs`' options, import `isAbsolute` and `join` from `node:path`, and change the local-file line to:

```js
    const f = checkLocalFile(baseDir && !isAbsolute(source) ? join(baseDir, source) : source, { roots });
```

Add to the doc comment: "`baseDir` resolves relative local paths (the MCP server passes runs/)."

- [ ] **Step 4: Test and commit**

Run: `node --test tests/inputs.test.mjs tests/refs.test.mjs && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: PASS; `fail 0`, 3 more tests than before.

```bash
git add cli/core/inputs.mjs cli/core/refs.mjs tests/inputs.test.mjs tests/refs.test.mjs
git commit -m "Confine any client-named path to the allowed roots; resolve relative refs against a base"
```

---

### Task 2: Read-only views as plain data

**Files:**
- Create: `cli/core/views.mjs`
- Test: `tests/views.test.mjs` (7 tests)

- [ ] **Step 1: Write the failing tests**

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "kie-views-")));
process.env.KIE_RUNS_DIR = join(tmp, "runs");
process.env.KIE_LIMITS_FILE = join(tmp, "limits.json");
process.env.KIE_API_KEY = "test-key-not-real";
mkdirSync(process.env.KIE_RUNS_DIR, { recursive: true });

const { EXIT } = await import("../cli/lib/errors.mjs");
const { loadCatalog } = await import("../cli/lib/models.mjs");
const { openJobs } = await import("../cli/core/jobs.mjs");
const { readLimits } = await import("../cli/core/spend.mjs");
const views = await import("../cli/core/views.mjs");

const catalog = loadCatalog();
const store = openJobs(join(tmp, "runs", ".jobs"));
const limits = readLimits();
const seedance = { model: "seedance-2-5", capability: "video", durationS: 4, resolution: "480p", provider: "kie" };

describe("catalog views", () => {
  test("listModels filters by capability and shows each route's price", () => {
    const models = views.listModels(catalog, { capability: "video" });
    assert.ok(models.every((m) => m.capability === "video"));
    const s = models.find((m) => m.id === "seedance-2-5");
    assert.match(s.routes.find((r) => r.provider === "kie").price, /480p \$0\.14\/s/);
  });

  test("listPresets marks each preset native or adaptation", () => {
    const presets = views.listPresets(catalog);
    assert.ok(presets.length > 0);
    assert.ok(presets.every((p) => ["native", "adaptation", null].includes(p.fidelity)));
  });
});

describe("estimate reserves nothing and says whether the job may run", () => {
  test("Seedance 2.5, 4s at 480p on kie is $0.56 and allowed", () => {
    const e = views.estimate(catalog, seedance, { store, limits });
    assert.equal(e.estimateUsd, 0.56);
    assert.equal(e.allowed, true);
    assert.deepEqual(store.list(), []);
  });

  test("a first frame with reference images is refused with the reason", () => {
    const refs = [{ source: "https://x.test/a.png", role: "first_frame" }, { source: "https://x.test/b.png", role: "identity" }];
    const e = views.estimate(catalog, { ...seedance, refs }, { store, limits });
    assert.match(e.problems.join("\n"), /cannot combine/);
    assert.equal(e.allowed, false);
  });

  test("over the daily cap is not allowed", () => {
    const e = views.estimate(catalog, seedance, { store, limits: { ...limits, dailyUsd: 0.1 } });
    assert.equal(e.withinDailyCap, false);
    assert.equal(e.allowed, false);
  });
});

describe("status and runs", () => {
  test("status reads the balance through the injected reader and lists unsettled jobs", async () => {
    const job = store.create({ run: "demo", capability: "video", model: "seedance-2-5", provider: "kie", estimateUsd: 0.56 });
    const s = await views.status(catalog, { store, limits, credits: async () => 123 });
    assert.equal(s.providers.find((p) => p.name === "kie").balance, 123);
    assert.equal(s.today.capUsd, 10);
    assert.deepEqual(s.unsettled.map((j) => j.id), [job.id]);
  });

  test("listRuns and getRun read a run folder; an unknown run is code 3", () => {
    const dir = join(tmp, "runs", "demo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "prompt.txt"), "Shot 1: Zed waves.");
    assert.ok(views.listRuns().some((r) => r.run === "demo"));
    const run = views.getRun("demo", { store });
    assert.equal(run.prompt, "Shot 1: Zed waves.");
    assert.equal(run.jobs.length, 1);
    assert.throws(() => views.getRun("nope", { store }), { code: EXIT.UNKNOWN });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test tests/views.test.mjs`
Expected: FAIL, cannot find module `../cli/core/views.mjs`.

- [ ] **Step 3: Implement `cli/core/views.mjs`**

```js
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  buildInput,
  catalogAgeDays,
  effectiveRoute,
  isStale,
  resolveModel,
  routesFor,
  validateVideoRequest,
} from "../lib/models.mjs";
import { getProvider, providerCredits, providerKey } from "../lib/providers.mjs";
import { estimateUsd, priceLabel } from "../lib/budget.mjs";
import { loadPresets, routeFor } from "../lib/presets.mjs";
import { REPO_ROOT, RUNS_DIR, runDir } from "../lib/run.mjs";
import { unknown } from "../lib/errors.mjs";
import { dailyPosition } from "./spend.mjs";

// Read-only views shared by the MCP server (and, later, the web app). Plain
// data in, plain data out; nothing here prints, reserves or submits.

const MEDIA = /\.(mp4|mov|webm|png|jpe?g|webp|mp3|wav|m4a)$/i;
const MAX_PROMPT_CHARS = 20_000;

export const jobSummary = (j) => ({
  id: j.id,
  state: j.state,
  run: j.run,
  model: j.model,
  provider: j.provider,
  upstreamTaskId: j.upstreamTaskId ?? null,
  estimateUsd: j.estimateUsd ?? null,
  actualUsd: j.actualUsd ?? null,
  createdAt: j.createdAt,
});

/** Keys, balances, catalog age, today's position and unsettled jobs. `credits` reads a balance (injectable). */
export async function status(catalog, { store, limits, credits = providerCredits }) {
  store.sweep();
  const providers = [];
  for (const name of Object.keys(catalog.providers)) {
    const prov = getProvider(catalog, name);
    const key = providerKey(prov, { required: false });
    let balance = null;
    if (key && prov.credits) {
      try {
        balance = await credits(prov, key);
      } catch {
        balance = null;
      }
    }
    providers.push({
      name,
      label: prov.label,
      keyConfigured: Boolean(key),
      balance: typeof balance === "number" ? balance : null,
      unit: prov.creditUnit ?? null,
    });
  }
  const pos = dailyPosition(store, limits);
  return {
    providers,
    catalog: { captured: catalog.captured ?? null, ageDays: catalogAgeDays(catalog) ?? null, stale: Boolean(isStale(catalog)) },
    today: { capUsd: pos.capUsd, spentUsd: pos.spentUsd, availableUsd: pos.availableUsd },
    unsettled: pos.unsettled.map(jobSummary),
  };
}

export function listModels(catalog, { capability } = {}) {
  return catalog.list
    .filter((m) => !capability || m.capability === capability)
    .map((m) => ({
      id: m.id,
      capability: m.capability,
      durationsS: m.durationsS ?? [],
      aspectRatios: m.aspectRatios ?? [],
      resolutions: (m.resolutions ?? []).map(String),
      refRoles: m.refs ?? [],
      nativeAudio: Boolean(m.nativeAudio),
      notes: m.notes ?? null,
      routes: routesFor(catalog, m).map((r) => ({
        provider: r.provider,
        price: priceLabel(r),
        verified: Boolean(r.verified),
        usable: Boolean(r.usable),
        skipReason: r.skipReason ?? null,
      })),
    }));
}

export function listPresets(catalog) {
  return loadPresets().map((p) => {
    let route = null;
    try {
      route = routeFor(p, catalog);
    } catch {
      route = null;
    }
    return {
      id: p.id,
      title: p.title,
      tagline: p.tagline ?? null,
      bestFor: p.best_for ?? null,
      durationS: p.defaults?.duration_s ?? null,
      aspectRatio: p.defaults?.aspect_ratio ?? null,
      model: route?.modelId ?? null,
      fidelity: route?.fidelity ?? null,
      sourcePromptPath: route?.promptPath ? join(REPO_ROOT, "skills", "motion-design", route.promptPath) : null,
      guide: p.template ?? null,
    };
  });
}

/**
 * What a planned job would cost and whether the per-job budget and today's
 * cap allow it. Reserves nothing and calls no provider. `refs` are checked by
 * role only; assets are not expanded here.
 */
export function estimate(catalog, req, { store, limits }) {
  const { model: modelId, capability, durationS, resolution, aspectRatio, refs = [], params = {}, budgetUsd, provider } = req;
  const model = resolveModel(catalog, modelId, capability);
  const problems = model.capability === "video" ? validateVideoRequest(catalog, model, { durationS, aspectRatio, refs }) : [];

  const routes = routesFor(catalog, model, { only: provider });
  const route = routes.find((r) => r.usable) ?? routes.find((r) => !provider || r.provider === provider) ?? null;
  let call = null;
  let est = null;
  if (route) {
    const useI2v = model.capability === "video" ? refs.some((r) => r.role === "first_frame") : refs.length > 0;
    call = effectiveRoute(route, useI2v);
    const built = buildInput(call, {
      prompt: "(estimate)",
      duration: durationS,
      resolution,
      aspect_ratio: aspectRatio,
      refs: refs.map((r) => ({ role: r.role, url: "pending" })),
      params,
    });
    problems.push(...built.problems);
    est = estimateUsd(call, { durationS: built.input.duration, resolution: built.input.resolution });
  } else {
    problems.push(`No route for ${model.id}${provider ? ` via ${provider}` : ""}.`);
  }

  const cap = budgetUsd ?? catalog.defaultBudgetUsd?.[model.capability] ?? null;
  const pos = dailyPosition(store, limits);
  const usd = est?.usd ?? null;
  const withinBudget = usd != null && (cap == null || usd <= cap);
  const withinDailyCap = usd != null && usd <= pos.availableUsd;
  return {
    model: model.id,
    provider: route?.provider ?? null,
    providerModel: call?.model ?? null,
    routeUsable: Boolean(route?.usable),
    estimateUsd: usd,
    basis: est?.basis ?? null,
    budgetUsd: cap,
    withinBudget,
    availableTodayUsd: pos.availableUsd,
    withinDailyCap,
    problems,
    allowed: !problems.length && withinBudget && withinDailyCap && Boolean(route?.usable),
  };
}

export function listRuns() {
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => {
      const dir = join(RUNS_DIR, d.name);
      const files = readdirSync(dir);
      return {
        run: d.name,
        modified: statSync(dir).mtime.toISOString(),
        files: files.length,
        takes: files.filter((f) => MEDIA.test(f)).length,
      };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

const readText = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
const readJson = (p) => {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  } catch {
    return null;
  }
};

/** Everything a run folder records: prompt, settings, takes, job records, cost, review notes. */
export function getRun(slug, { store }) {
  const dir = runDir(slug, { create: false });
  if (!existsSync(dir)) {
    throw unknown(`No run "${slug}". Recent runs: ${listRuns().slice(0, 20).map((r) => r.run).join(", ") || "none"}.`);
  }
  const prompt = readText(join(dir, "prompt.txt")) ?? readText(join(dir, "image-prompt.txt"));
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((f) => f.isFile())
    .map((f) => ({ name: f.name, bytes: statSync(join(dir, f.name)).size }));
  return {
    run: slug,
    prompt: prompt && prompt.length > MAX_PROMPT_CHARS ? `${prompt.slice(0, MAX_PROMPT_CHARS)}\n[truncated]` : prompt,
    inputs: readJson(join(dir, "inputs.json")) ?? readJson(join(dir, "image-inputs.json")),
    files,
    artifacts: files.filter((f) => MEDIA.test(f.name)).map((f) => join(dir, f.name)),
    jobs: store.list().filter((j) => j.run === slug).map(jobSummary),
    cost: readJson(join(dir, "cost.json")),
    review: readText(join(dir, "review.md")),
  };
}
```

If `routeFor`'s result names the prompt path differently from `promptPath`, use the name `cmdVideo` in `cli/kie.mjs` uses.

- [ ] **Step 4: Test and commit**

Run: `node --test tests/views.test.mjs && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: PASS; `fail 0`.

```bash
git add cli/core/views.mjs tests/views.test.mjs
git commit -m "Add read-only views: status, models, presets, estimate, runs"
```

---

### Task 3: The `mcp/` package, results and previews

**Files:**
- Create: `mcp/package.json`, `mcp/results.mjs`, `mcp/preview.mjs`, `mcp/tests/results.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: The package**

`mcp/package.json`:

```json
{
  "name": "motion-design-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "MCP server over the kie harness for Claude Code and Codex. A separate package so the CLI stays zero-dependency.",
  "bin": {
    "motion-design-mcp": "./server.mjs"
  },
  "scripts": {
    "start": "node server.mjs",
    "test": "node --test 'tests/*.test.mjs'"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.32.2",
    "zod": "4.6.7"
  },
  "engines": {
    "node": ">=20"
  }
}
```

Run `npm install --prefix mcp`. It writes `mcp/package-lock.json` (commit it) and `mcp/node_modules` (check `git check-ignore mcp/node_modules` prints the path; the root `.gitignore` has `node_modules/`).

In the root `package.json` `scripts`, add `"test:mcp": "npm --prefix mcp test"`.

- [ ] **Step 2: Write the failing tests**

`mcp/tests/results.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { EXIT, budget, uncertain, unknown } from "../../cli/lib/errors.mjs";
import { ok, fail } from "../results.mjs";

test("ok carries text and structured content", () => {
  const r = ok("done", { a: 1 });
  assert.deepEqual(r.structuredContent, { a: 1 });
  assert.equal(r.content[0].text, "done");
  assert.equal(r.isError, undefined);
});

test("code 2 says nothing was spent and to ask the user", () => {
  const r = fail(budget("Refused, nothing spent: estimate $0.56, $0.10 available today."));
  assert.equal(r.isError, true);
  assert.equal(r._meta.error.code, EXIT.BUDGET);
  assert.equal(r._meta.error.retryable, false);
  assert.match(r._meta.error.nextAction, /Ask the user/);
  assert.match(r.content[0].text, /^Error 2:/);
});

test("code 5 with an upstream id says to call wait_job, never to resubmit", () => {
  const r = fail(uncertain("read timed out", "task-77", { localJobId: "j-20261030-abcdef" }));
  assert.equal(r._meta.error.code, EXIT.UNCERTAIN);
  assert.match(r._meta.error.nextAction, /wait_job with job_id "j-20261030-abcdef"/);
  assert.match(r._meta.error.nextAction, /Do not resubmit/);
});

test("code 5 without an upstream id sends the user to kie's task log and kie job resolve", () => {
  const r = fail(uncertain("socket hang up", null, { localJobId: "j-20261030-abcdef" }));
  assert.match(r._meta.error.nextAction, /task log/);
  assert.match(r._meta.error.nextAction, /kie job resolve j-20261030-abcdef --task/);
  assert.match(r._meta.error.nextAction, /Do not resubmit/);
  assert.equal(r._meta.error.upstreamTaskId, null);
});

test("codes 3 and 4, and an unexpected error", () => {
  assert.equal(fail(unknown("bad role")).    _meta.error.retryable, false);
  assert.equal(fail(Object.assign(new Error("busy"), { code: EXIT.PROVIDER }))._meta.error.retryable, true);
  const r = fail(new TypeError("x is undefined"));
  assert.equal(r._meta.error.code, EXIT.USAGE);
  assert.match(r._meta.error.nextAction, /status/);
});
```

(format the `fail(unknown(...))` line normally; the spacing above is a typo to fix when copying.)

- [ ] **Step 3: Run and watch it fail**

Run: `npm run test:mcp`
Expected: FAIL, cannot find `../results.mjs`.

- [ ] **Step 4: Implement `mcp/results.mjs`**

```js
import { EXIT } from "../cli/lib/errors.mjs";
import { redact } from "../cli/lib/redact.mjs";

/** A successful tool result: readable text, structured data matching the tool's outputSchema, optional images. */
export function ok(text, data, extra = []) {
  return { content: [{ type: "text", text }, ...extra], structuredContent: data };
}

const NEXT = {
  [EXIT.USAGE]: [false, "Fix the arguments the message names and call again."],
  [EXIT.BUDGET]: [
    false,
    "Nothing was spent. Ask the user whether to raise the per-job budget (budget_usd) or the daily cap " +
      "(they run kie limits --daily N), or choose a cheaper model, resolution or duration.",
  ],
  [EXIT.UNKNOWN]: [false, "Fix the request using the allowed values or folders in the message."],
  [EXIT.PROVIDER]: [
    true,
    "The provider or the spend lock failed. A create the provider rejected was not charged. Retry once; if it fails again, tell the user.",
  ],
};

function uncertainNext(localJobId, upstreamTaskId) {
  const job = localJobId ?? "the job";
  if (upstreamTaskId) {
    return `${job} was submitted as ${upstreamTaskId} and its outcome is not known yet. Call wait_job with job_id "${localJobId}". Do not resubmit.`;
  }
  return (
    `${job} may exist at kie, and there is no upstream task id to poll. Do not resubmit. ` +
    `Ask the user to check kie's task log (kie.ai dashboard) and record the outcome with ` +
    `kie job resolve ${localJobId ?? "<local job id>"} --task <task id> (it exists) or ` +
    `kie job resolve ${localJobId ?? "<local job id>"} --not-created (it does not).`
  );
}

/**
 * A thrown error as an isError result. The structured part goes in _meta, not
 * structuredContent: SDK 1.32 clients validate structuredContent against the
 * tool's outputSchema even on an error, and an error object would fail it.
 */
export function fail(err) {
  const known = typeof err?.code === "number" && err.code >= EXIT.USAGE && err.code <= EXIT.UNCERTAIN;
  const code = known ? err.code : EXIT.USAGE;
  const localJobId = err?.localJobId ?? null;
  const upstreamTaskId = err?.taskId ?? null;
  const [retryable, nextAction] =
    code === EXIT.UNCERTAIN
      ? [false, uncertainNext(localJobId, upstreamTaskId)]
      : known
        ? NEXT[code]
        : [false, "An unexpected error. Show the message to the user; before generating again, call status to see whether a job is pending."];
  const message = redact(String(err?.message ?? err));
  return {
    isError: true,
    content: [{ type: "text", text: `Error ${code}: ${message}\nNext: ${nextAction}` }],
    _meta: { error: { code, retryable, nextAction, localJobId, upstreamTaskId } },
  };
}
```

Check `redact` is the default-less named export in `cli/lib/redact.mjs` (it is `export function redact`).

- [ ] **Step 5: Implement `mcp/preview.mjs`** (exercised by the tool tests in Tasks 4-6)

```js
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpeg } from "../cli/lib/ffmpeg.mjs";
import { extractFrames } from "../cli/lib/frames.mjs";

const IMAGE = /\.(png|jpe?g|webp)$/i;
const VIDEO = /\.(mp4|mov|webm)$/i;

/** A small JPEG of an image file as MCP image content, or null when ffmpeg cannot make one. */
export async function imagePreview(path, { width = 768 } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "kie-preview-"));
  try {
    const out = join(tmp, "preview.jpg");
    await ffmpeg(["-i", path, "-vf", `scale='min(${width},iw)':-2`, "-frames:v", "1", "-q:v", "4", out]);
    return { type: "image", data: readFileSync(out).toString("base64"), mimeType: "image/jpeg" };
  } catch {
    return null;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The preview for a finished take: the image itself, or the 8-frame contact sheet of a video. */
export async function artifactPreview(path) {
  if (IMAGE.test(path)) return imagePreview(path);
  if (!VIDEO.test(path)) return null;
  try {
    const frames = await extractFrames(path);
    return imagePreview(frames.sheet, { width: 1024 });
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Test and commit**

Run: `npm run test:mcp && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: 5 MCP tests pass; root `fail 0`.

```bash
git add mcp/package.json mcp/package-lock.json mcp/results.mjs mcp/preview.mjs mcp/tests/results.test.mjs package.json
git diff --cached --stat   # no node_modules
git commit -m "Add the mcp package: error results with next actions, and previews"
```

---

### Task 4: Server skeleton, look tools and asset tools

**Files:**
- Create: `mcp/server.mjs`, `mcp/tests/helpers.mjs`, `mcp/tests/look.test.mjs` (10 tests)

- [ ] **Step 1: The test helper**

`mcp/tests/helpers.mjs`:

```js
// Every MCP test file imports this first. It points runs/, library/ and the
// limits file at a temp folder and sets a dummy key BEFORE the server (and the
// cli modules, which read these at import) load. Provider calls are stubs.
import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const tmp = realpathSync(mkdtempSync(join(tmpdir(), "kie-mcp-")));
export const RUNS = join(tmp, "runs");
process.env.KIE_RUNS_DIR = RUNS;
process.env.KIE_LIBRARY_DIR = join(tmp, "library");
process.env.KIE_LIMITS_FILE = join(tmp, "limits.json");
process.env.KIE_API_KEY = "test-key-not-real";
mkdirSync(RUNS, { recursive: true });

const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { createServer } = await import("../server.mjs");

export const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const ff = (args) => spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

/** A real, decodable PNG. */
export function realPng(path, size = "1024x1024") {
  ff(["-f", "lavfi", "-i", `color=c=red:s=${size}`, "-frames:v", "1", path]);
  return path;
}

/** A real 2-second MP4 with no audio. */
export function realMp4(path) {
  ff(["-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=2", "-pix_fmt", "yuv420p", path]);
  return path;
}

/** Stubs for every call that would reach a provider, with a call log. */
export function stubs() {
  const calls = { create: [], wait: 0, upload: 0 };
  const generate = {
    preflight: async (catalog, route, o) => ({ estimatedUsd: 0.56, basis: "stub", cap: o.budgetUsd ?? 3, creditsBefore: 100 }),
    createTask: async (prov, family, model, input) => {
      calls.create.push({ provider: prov.name, model, input });
      return { taskId: `task-${calls.create.length}` };
    },
    waitForTask: async () => {
      calls.wait += 1;
      return { state: "success", urls: ["https://cdn.test/result.png"], data: { state: "success", creditsConsumed: 6 }, elapsedS: 2 };
    },
    download: async (url, path) => (hasFfmpeg ? realPng(path, "64x64") : path),
    creditsAfter: async () => 94,
  };
  const deps = {
    generate,
    upload: async () => {
      calls.upload += 1;
      return { url: `https://files.test/${calls.upload}.png` };
    },
    credits: async () => 100,
  };
  return { calls, deps };
}

export async function connect(deps) {
  const server = createServer({ deps });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  return client;
}

export const call = (client, name, args = {}) => client.callTool({ name, arguments: args });
export const errorOf = (r) => r._meta?.error;
```

The client validates every successful result's `structuredContent` against the tool's `outputSchema` inside `callTool`, so each test that calls a tool also checks its schema.

- [ ] **Step 2: Write the failing tests**

`mcp/tests/look.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RUNS, hasFfmpeg, realPng, stubs, connect, call, errorOf } from "./helpers.mjs";
import { png } from "../../tests/fixtures/images.mjs";

const { deps } = stubs();
const client = await connect(deps);

const TOOLS = [
  "status", "list_models", "list_presets", "estimate", "list_runs", "get_run",
  "save_asset", "list_assets", "get_asset",
  "generate_image", "generate_video", "wait_job",
  "frames", "probe", "assemble", "variants", "caption", "render",
];

describe("the tool list", () => {
  test("all 18 tools; spending tools say so first and are marked open-world, not destructive", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOLS].sort());
    for (const name of ["generate_image", "generate_video"]) {
      const t = tools.find((x) => x.name === name);
      assert.match(t.description, /^Spends kie credits\./);
      assert.equal(t.annotations.openWorldHint, true);
      assert.equal(t.annotations.destructiveHint, false);
    }
    for (const name of ["list_models", "list_presets", "estimate", "list_runs", "get_run", "list_assets", "get_asset"]) {
      assert.equal(tools.find((x) => x.name === name).annotations.readOnlyHint, true, name);
    }
    assert.ok(tools.every((t) => t.outputSchema), "every tool declares an output schema");
  });
});

describe("look", () => {
  test("status: cap, balance through the stub, no unsettled jobs", async () => {
    const r = await call(client, "status");
    assert.equal(r.structuredContent.today.capUsd, 10);
    assert.equal(r.structuredContent.providers.find((p) => p.name === "kie").balance, 100);
    assert.deepEqual(r.structuredContent.unsettled, []);
  });

  test("list_models and list_presets", async () => {
    const m = await call(client, "list_models", { capability: "video" });
    assert.ok(m.structuredContent.models.some((x) => x.id === "seedance-2-5"));
    const p = await call(client, "list_presets");
    assert.ok(p.structuredContent.presets.length > 0);
  });

  test("estimate: allowed, and a refused combination with its reason", async () => {
    const base = { model: "seedance-2-5", duration_s: 4, resolution: "480p", provider: "kie" };
    const okR = await call(client, "estimate", base);
    assert.equal(okR.structuredContent.estimateUsd, 0.56);
    assert.equal(okR.structuredContent.allowed, true);
    const refs = [{ source: "https://x.test/a.png", role: "first_frame" }, { source: "https://x.test/b.png", role: "identity" }];
    const bad = await call(client, "estimate", { ...base, refs });
    assert.equal(bad.structuredContent.allowed, false);
    assert.match(bad.structuredContent.problems.join("\n"), /cannot combine/);
  });

  test("arguments of the wrong type are refused by the schema", async () => {
    const r = await call(client, "estimate", { model: "seedance-2-5", duration_s: "4" });
    assert.equal(r.isError, true);
  });

  test("list_runs and get_run; an unknown run is code 3", async () => {
    mkdirSync(join(RUNS, "look-demo"), { recursive: true });
    writeFileSync(join(RUNS, "look-demo", "prompt.txt"), "Shot 1: Zed waves.");
    const runs = await call(client, "list_runs");
    assert.ok(runs.structuredContent.runs.some((r) => r.run === "look-demo"));
    const run = await call(client, "get_run", { run: "look-demo" });
    assert.equal(run.structuredContent.prompt, "Shot 1: Zed waves.");
    const none = await call(client, "get_run", { run: "nope" });
    assert.equal(none.isError, true);
    assert.equal(errorOf(none).code, 3);
  });
});

describe("assets", () => {
  test("save_asset from a run folder, by relative path; list_assets shows it", async () => {
    mkdirSync(join(RUNS, "look-demo"), { recursive: true });
    writeFileSync(join(RUNS, "look-demo", "zed.png"), png(1024, 1024));
    const r = await call(client, "save_asset", {
      name: "zed", kind: "character", description: "Zed, a small round robot.", images: ["look-demo/zed.png"],
    });
    assert.equal(r.structuredContent.images.length, 1);
    const list = await call(client, "list_assets");
    assert.deepEqual(list.structuredContent.assets.map((a) => a.name), ["zed"]);
  });

  test("an image outside the allowed folders is refused with code 3, naming them", async () => {
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "kie-elsewhere-")));
    writeFileSync(join(elsewhere, "secret.png"), png(1024, 1024));
    const r = await call(client, "save_asset", {
      name: "secret", kind: "product", description: "x", images: [join(elsewhere, "secret.png")],
    });
    assert.equal(errorOf(r).code, 3);
    assert.match(r.content[0].text, new RegExp(RUNS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  test("get_asset returns one preview image per stored image", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    realPng(join(RUNS, "look-demo", "real.png"));
    await call(client, "save_asset", {
      name: "real", kind: "style", description: "Red.", images: ["look-demo/real.png"],
    });
    const r = await call(client, "get_asset", { name: "real" });
    assert.equal(r.content.filter((c) => c.type === "image").length, 1);
    assert.equal(r.structuredContent.images[0].n, 1);
  });

  test("get_asset for a missing name is code 3", async () => {
    const r = await call(client, "get_asset", { name: "nobody" });
    assert.equal(errorOf(r).code, 3);
  });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `npm run test:mcp`
Expected: FAIL, cannot find `../server.mjs`.

- [ ] **Step 4: Implement `mcp/server.mjs` with the look and asset tools**

The whole file is built over Tasks 4-6. Task 4 writes everything below except the bodies marked "Task 5" and "Task 6"; leave those two `register…` calls out until then. The tool list test passes only once all 18 tools exist, so in this task mark that one test `{ todo: "generate and finish tools land in Tasks 5-6" }` and remove the marker in Task 6.

```js
#!/usr/bin/env node
// MCP server over the kie harness, for Claude Code and Codex over stdio.
// Thin by design: validate input, call cli/core or cli/lib, shape the result.
// stdout carries the protocol, so nothing in here may print to it.

import { realpathSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadCatalog, resolveModel, validateVideoRequest } from "../cli/lib/models.mjs";
import { loadPresets, findPreset, routeFor } from "../cli/lib/presets.mjs";
import { RUNS_DIR, runDir, outPath, writeRecord } from "../cli/lib/run.mjs";
import { uploadFile } from "../cli/lib/upload.mjs";
import { probe, measureLoudness, dimsFor, RATIOS } from "../cli/lib/ffmpeg.mjs";
import { extractFrames } from "../cli/lib/frames.mjs";
import { assemble } from "../cli/lib/assemble.mjs";
import { makeVariants, MODES } from "../cli/lib/variants.mjs";
import { burnCaptions } from "../cli/lib/caption.mjs";
import { render, TEMPLATES } from "../cli/lib/render.mjs";
import { unknown, usage } from "../cli/lib/errors.mjs";
import { openJobs } from "../cli/core/jobs.mjs";
import { readLimits } from "../cli/core/spend.mjs";
import { submitJob, waitJob } from "../cli/core/generate.mjs";
import { openLibrary, KINDS } from "../cli/core/assets.mjs";
import { expandRefs } from "../cli/core/refs.mjs";
import { allowedRoots, confinePath } from "../cli/core/inputs.mjs";
import { status, listModels, listPresets, estimate, listRuns, getRun } from "../cli/core/views.mjs";
import { ok, fail } from "./results.mjs";
import { artifactPreview, imagePreview } from "./preview.mjs";

const VERSION = "0.1.0";

const INSTRUCTIONS =
  "Motion-design studio over kie.ai. Look first (status, list_models, list_presets, estimate), " +
  "then generate_image or generate_video, then wait_job until it finishes. Generating spends real money " +
  "against a per-job budget and a daily cap. Error 2 means nothing was spent: ask the user. " +
  "Error 5 means a job may exist: never resubmit it. Relative paths are inside runs/; only runs/, " +
  "library/ and folders the user allowed can be read.";

const LOOK = { readOnlyHint: true, openWorldHint: false };
const LOCAL_WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const SPEND = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

const Job = z.object({
  id: z.string(),
  state: z.string(),
  run: z.string(),
  model: z.string(),
  provider: z.string(),
  upstreamTaskId: z.string().nullable(),
  estimateUsd: z.number().nullable(),
  actualUsd: z.number().nullable(),
  createdAt: z.string(),
});

const Asset = {
  name: z.string(),
  kind: z.string(),
  description: z.string(),
  images: z.array(
    z.object({
      n: z.number().int(),
      file: z.string(),
      path: z.string(),
      width: z.number().nullable(),
      height: z.number().nullable(),
      bytes: z.number(),
      uploadedAt: z.string().nullable(),
    }),
  ),
  usedIn: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
};

const assetView = (a) => ({
  name: a.name,
  kind: a.kind,
  description: a.description,
  images: a.images.map((im) => ({
    n: im.n,
    file: im.file,
    path: im.path,
    width: im.width ?? null,
    height: im.height ?? null,
    bytes: im.bytes,
    uploadedAt: im.upload?.at ?? null,
  })),
  usedIn: a.usedIn ?? [],
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
});

/**
 * Build the server. `deps` replaces anything that would reach a provider:
 * `generate` (preflight, createTask, waitForTask, download, creditsAfter),
 * `upload` and `credits` (the balance read). Tests pass stubs; production
 * passes nothing.
 */
export function createServer({ deps = {}, catalog = loadCatalog() } = {}) {
  const server = new McpServer({ name: "motion-design", version: VERSION }, { instructions: INSTRUCTIONS });

  const tool = (name, config, fn) =>
    server.registerTool(name, config, async (args) => {
      try {
        return await fn(args ?? {});
      } catch (err) {
        return fail(err);
      }
    });

  /** Per call, so a limits change or a new run folder is seen without a restart. */
  const ctx = () => {
    const limits = readLimits();
    return { limits, store: openJobs(), roots: allowedRoots(limits), library: openLibrary() };
  };

  /** A path a client named: relative means inside runs/; the real path must sit in an allowed root. */
  const clientPath = (p, roots) => confinePath(isAbsolute(p) ? p : join(RUNS_DIR, p), roots);

  /** A file of a run: a bare name is looked for in the run folder; anything else is a client path. */
  const runFile = (dir, name, roots) =>
    name.includes("/") || isAbsolute(name) ? clientPath(name, roots) : confinePath(join(dir, name), roots);

  /** Outputs land in the run folder under a plain name, never a path. */
  const outName = (name) => {
    if (name == null) return undefined;
    if (/[\\/]/.test(name) || name.startsWith(".")) {
      throw unknown(`out must be a plain file name inside the run folder, got "${name}".`);
    }
    return name;
  };

  const Ref = z.object({
    source: z
      .string()
      .describe('An asset name ("zed"), one of its images ("zed#2"), an https:// URL, or a file inside runs/ (relative) or library/.'),
    role: z.enum(catalog.roles),
  });

  registerLook();
  registerAssets();
  registerGenerate(); // Task 5
  registerFinish(); // Task 6
  return server;

  function registerLook() {
    tool(
      "status",
      {
        title: "Status",
        description: "Keys, kie balance, catalog age, today's spend against the daily cap, and jobs not yet settled. Free.",
        inputSchema: {},
        outputSchema: {
          providers: z.array(
            z.object({
              name: z.string(),
              label: z.string(),
              keyConfigured: z.boolean(),
              balance: z.number().nullable(),
              unit: z.string().nullable(),
            }),
          ),
          catalog: z.object({ captured: z.string().nullable(), ageDays: z.number().nullable(), stale: z.boolean() }),
          today: z.object({ capUsd: z.number(), spentUsd: z.number(), availableUsd: z.number() }),
          unsettled: z.array(Job),
        },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async () => {
        const { store, limits } = ctx();
        const s = await status(catalog, { store, limits, credits: deps.credits });
        const lines = [
          `today: $${s.today.spentUsd.toFixed(2)} spent or held of $${s.today.capUsd.toFixed(2)}; $${s.today.availableUsd.toFixed(2)} available`,
          ...s.providers.map(
            (p) => `${p.label}: ${p.keyConfigured ? "key configured" : "no key"}${p.balance != null ? `, ${p.balance} ${p.unit ?? ""}` : ""}`,
          ),
          `catalog captured ${s.catalog.captured}${s.catalog.stale ? " (stale: prices may be out of date)" : ""}`,
          s.unsettled.length ? `not settled: ${s.unsettled.map((j) => `${j.id} ${j.state}`).join(", ")}` : "no unsettled jobs",
        ];
        return ok(lines.join("\n"), s);
      },
    );

    tool(
      "list_models",
      {
        title: "List models",
        description: "Models with durations, aspect ratios, reference roles, price per route and whether each route is verified. Free.",
        inputSchema: { capability: z.enum(["video", "image", "audio"]).optional() },
        outputSchema: {
          models: z.array(
            z.object({
              id: z.string(),
              capability: z.string(),
              durationsS: z.array(z.number()),
              aspectRatios: z.array(z.string()),
              resolutions: z.array(z.string()),
              refRoles: z.array(z.string()),
              nativeAudio: z.boolean(),
              notes: z.string().nullable(),
              routes: z.array(
                z.object({
                  provider: z.string(),
                  price: z.string(),
                  verified: z.boolean(),
                  usable: z.boolean(),
                  skipReason: z.string().nullable(),
                }),
              ),
            }),
          ),
        },
        annotations: LOOK,
      },
      async ({ capability }) => {
        const models = listModels(catalog, { capability });
        return ok(models.map((m) => `${m.id} (${m.capability}): ${m.routes.map((r) => `${r.provider} ${r.price}`).join("; ")}`).join("\n"), { models });
      },
    );

    tool(
      "list_presets",
      {
        title: "List presets",
        description: "Gallery presets: default duration and aspect ratio, the model each runs on, native or adaptation, and the source prompt and guide to adapt from. Free.",
        inputSchema: {},
        outputSchema: {
          presets: z.array(
            z.object({
              id: z.string(),
              title: z.string(),
              tagline: z.string().nullable(),
              bestFor: z.string().nullable(),
              durationS: z.number().nullable(),
              aspectRatio: z.string().nullable(),
              model: z.string().nullable(),
              fidelity: z.string().nullable(),
              sourcePromptPath: z.string().nullable(),
              guide: z.string().nullable(),
            }),
          ),
        },
        annotations: LOOK,
      },
      async () => {
        const presets = listPresets(catalog);
        return ok(presets.map((p) => `${p.id}: ${p.title} [${p.fidelity ?? "unrouted"}]`).join("\n"), { presets });
      },
    );

    tool(
      "estimate",
      {
        title: "Estimate",
        description: "Cost of a planned job and whether the per-job budget and today's cap allow it. Reserves nothing, calls no provider. Free.",
        inputSchema: {
          model: z.string(),
          duration_s: z.number().int().positive().optional(),
          resolution: z.string().optional(),
          aspect_ratio: z.string().optional(),
          refs: z.array(Ref).optional(),
          params: z.record(z.string(), z.unknown()).optional(),
          budget_usd: z.number().positive().optional(),
          provider: z.string().optional(),
        },
        outputSchema: {
          model: z.string(),
          provider: z.string().nullable(),
          providerModel: z.string().nullable(),
          routeUsable: z.boolean(),
          estimateUsd: z.number().nullable(),
          basis: z.string().nullable(),
          budgetUsd: z.number().nullable(),
          withinBudget: z.boolean(),
          availableTodayUsd: z.number(),
          withinDailyCap: z.boolean(),
          problems: z.array(z.string()),
          allowed: z.boolean(),
        },
        annotations: LOOK,
      },
      async (a) => {
        const { store, limits } = ctx();
        const e = estimate(
          catalog,
          {
            model: a.model,
            durationS: a.duration_s,
            resolution: a.resolution,
            aspectRatio: a.aspect_ratio,
            refs: a.refs ?? [],
            params: a.params ?? {},
            budgetUsd: a.budget_usd,
            provider: a.provider,
          },
          { store, limits },
        );
        const head = e.estimateUsd == null ? "no estimate" : `$${e.estimateUsd.toFixed(2)} (${e.basis})`;
        const verdict = e.allowed ? "allowed" : `not allowed${e.problems.length ? `: ${e.problems.join("; ")}` : ""}`;
        return ok(`${e.model} via ${e.provider ?? "?"}: ${head}; $${e.availableTodayUsd.toFixed(2)} available today; ${verdict}`, e);
      },
    );

    tool(
      "list_runs",
      {
        title: "List runs",
        description: "Run folders, newest first, with file and take counts. Free.",
        inputSchema: {},
        outputSchema: {
          runs: z.array(z.object({ run: z.string(), modified: z.string(), files: z.number(), takes: z.number() })),
        },
        annotations: LOOK,
      },
      async () => {
        const runs = listRuns();
        return ok(runs.map((r) => `${r.run}  ${r.takes} take(s)  ${r.modified}`).join("\n") || "no runs yet", { runs });
      },
    );

    tool(
      "get_run",
      {
        title: "Get run",
        description: "One run: prompt, settings, takes, job records, cost and review notes. Free.",
        inputSchema: { run: z.string() },
        outputSchema: {
          run: z.string(),
          prompt: z.string().nullable(),
          inputs: z.record(z.string(), z.unknown()).nullable(),
          files: z.array(z.object({ name: z.string(), bytes: z.number() })),
          artifacts: z.array(z.string()),
          jobs: z.array(Job),
          cost: z.record(z.string(), z.unknown()).nullable(),
          review: z.string().nullable(),
        },
        annotations: LOOK,
      },
      async ({ run }) => {
        const { store } = ctx();
        const r = getRun(run, { store });
        return ok(`${r.run}: ${r.artifacts.length} take(s), ${r.jobs.length} job(s)`, r);
      },
    );
  }

  function registerAssets() {
    tool(
      "save_asset",
      {
        title: "Save asset",
        description:
          "Save 1-4 images as a named reference (character, product, location or style) to reuse in any job as refs [{ source: name, role }]. " +
          "Images are files inside runs/ (relative paths, e.g. my-film/out.png) or library/. The description is reused word for word in prompts. Free.",
        inputSchema: {
          name: z.string(),
          kind: z.enum(KINDS),
          description: z.string().min(1),
          images: z.array(z.string()).min(1).max(4),
          replace: z.boolean().optional(),
        },
        outputSchema: Asset,
        annotations: LOCAL_WRITE,
      },
      async ({ name, kind, description, images, replace }) => {
        const { library, roots } = ctx();
        const paths = images.map((p) => (isAbsolute(p) ? p : join(RUNS_DIR, p)));
        library.save({ name, kind, description, images: paths, replace: replace ?? false }, { roots });
        const a = assetView(library.get(name));
        return ok(`saved ${a.name} (${a.kind}) with ${a.images.length} image(s); use it as refs [{ source: "${a.name}", role }]`, a);
      },
    );

    tool(
      "list_assets",
      {
        title: "List assets",
        description: "Saved references: names, kinds, descriptions, image counts. Free.",
        inputSchema: {},
        outputSchema: {
          assets: z.array(
            z.object({
              name: z.string(),
              kind: z.string(),
              description: z.string(),
              imageCount: z.number(),
              updatedAt: z.string(),
            }),
          ),
        },
        annotations: LOOK,
      },
      async () => {
        const { library } = ctx();
        const assets = library.list();
        return ok(assets.map((a) => `${a.name} (${a.kind}, ${a.imageCount} image(s)): ${a.description}`).join("\n") || "no assets yet", { assets });
      },
    );

    tool(
      "get_asset",
      {
        title: "Get asset",
        description: "One asset with its images shown, numbered #1..#n as used in refs (zed#2). Free.",
        inputSchema: { name: z.string() },
        outputSchema: Asset,
        annotations: LOOK,
      },
      async ({ name }) => {
        const { library } = ctx();
        const a = assetView(library.get(name));
        const previews = [];
        for (const im of a.images) {
          const p = await imagePreview(im.path);
          if (p) previews.push(p);
        }
        const lines = [`${a.name} (${a.kind}): ${a.description}`, ...a.images.map((im) => `#${im.n} ${im.file} ${im.width ?? "?"}×${im.height ?? "?"}`)];
        return ok(lines.join("\n"), a, previews);
      },
    );
  }

  // registerGenerate and registerFinish: Tasks 5 and 6.
}

const entry = process.argv[1] ? realpathSync(process.argv[1]) : null;
if (entry && entry === realpathSync(fileURLToPath(import.meta.url))) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
```

Until Tasks 5 and 6, define `registerGenerate` and `registerFinish` as empty functions inside `createServer` so the file runs, and leave the imports they will use (eslint is not run; unused imports are fine for one task).

- [ ] **Step 5: Test and commit**

Run: `npm run test:mcp`
Expected: results and look tests pass (one `todo`).

Check the stdio entry by hand, spending nothing (lists tools, then exits):

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | KIE_RUNS_DIR=$(mktemp -d) node mcp/server.mjs | head -c 400; echo
```

Expected: two JSON-RPC responses on stdout, the second listing tools; nothing else on stdout.

```bash
git add mcp/server.mjs mcp/tests/helpers.mjs mcp/tests/look.test.mjs
git commit -m "Add the MCP server with look and asset tools"
```

---

### Task 5: Generate and wait

**Files:**
- Modify: `mcp/server.mjs` (`registerGenerate`)
- Test: `mcp/tests/generate.test.mjs` (8 tests)

- [ ] **Step 1: Write the failing tests**

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { RUNS, hasFfmpeg, stubs, connect, call, errorOf } from "./helpers.mjs";
import { png } from "../../tests/fixtures/images.mjs";

const { calls, deps } = stubs();
const client = await connect(deps);
const realCreate = deps.generate.createTask;
const jobsDir = join(RUNS, ".jobs");
const jobCount = () => (existsSync(jobsDir) ? readdirSync(jobsDir).filter((f) => f.startsWith("j-")).length : 0);
const video = { run: "gen-demo", prompt: "Shot 1: Zed waves at the camera.", model: "seedance-2-5", duration_s: 4, resolution: "480p", provider: "kie" };

mkdirSync(join(RUNS, "gen-demo"), { recursive: true });
writeFileSync(join(RUNS, "gen-demo", "zed.png"), png(1024, 1024));
await call(client, "save_asset", { name: "zed", kind: "character", description: "Zed.", images: ["gen-demo/zed.png"] });

let firstJob;

describe("generate", () => {
  test("generate_video reserves, submits once and returns a local id with the ref mapping", async () => {
    const r = await call(client, "generate_video", { ...video, refs: [{ source: "zed", role: "identity" }] });
    const s = r.structuredContent;
    assert.match(s.localJobId, /^j-\d{8}-[0-9a-f]{6}$/);
    assert.equal(s.state, "submitted");
    assert.equal(s.upstreamTaskId, "task-1");
    assert.deepEqual(s.refMapping, ["@Image1 = zed#1"]);
    assert.equal(calls.create.length, 1);
    assert.equal(calls.upload, 1);
    const inputs = JSON.parse(readFileSync(join(RUNS, "gen-demo", "inputs.json"), "utf8"));
    assert.deepEqual(inputs.refMapping, ["@Image1 = zed#1"]);
    firstJob = s.localJobId;
  });

  test("wait_job downloads into the run, reads the cost from the task record and shows a preview", async () => {
    const r = await call(client, "wait_job", { job_id: firstJob, max_wait_s: 5 });
    const s = r.structuredContent;
    assert.equal(s.outcome, "succeeded");
    assert.ok(s.artifacts[0].startsWith(join(RUNS, "gen-demo")));
    assert.equal(s.actualUsd, 0.03);
    assert.equal(s.costSource, "task-record");
    if (hasFfmpeg) assert.equal(r.content.filter((c) => c.type === "image").length, 1);
  });

  test("waiting on a settled job asks the provider nothing", async () => {
    const before = calls.wait;
    const r = await call(client, "wait_job", { job_id: firstJob });
    assert.equal(r.structuredContent.outcome, "succeeded");
    assert.equal(calls.wait, before);
  });

  test("generate_image uses the default image model and writes its prompt", async () => {
    const r = await call(client, "generate_image", { run: "gen-image", prompt: "A red robot, studio light.", provider: "kie" });
    assert.equal(r.structuredContent.state, "submitted");
    assert.ok(existsSync(join(RUNS, "gen-image", "image-prompt.txt")));
  });

  test("no model and no preset is a usage error", async () => {
    const { model, ...noModel } = video;
    const r = await call(client, "generate_video", noModel);
    assert.equal(errorOf(r).code, 1);
  });
});

describe("refusals and uncertainty", () => {
  test("over the daily cap: code 2, nothing sent, no job record", async () => {
    writeFileSync(process.env.KIE_LIMITS_FILE, JSON.stringify({ dailyUsd: 0.1 }));
    const sent = calls.create.length;
    const jobs = jobCount();
    const r = await call(client, "generate_video", video);
    rmSync(process.env.KIE_LIMITS_FILE);
    assert.equal(errorOf(r).code, 2);
    assert.match(errorOf(r).nextAction, /Ask the user/);
    assert.equal(calls.create.length, sent);
    assert.equal(jobCount(), jobs);
  });

  test("a create that dies without an id: code 5, resolve instructions, never resubmitted", async () => {
    const sent = calls.create.length;
    deps.generate.createTask = async (...a) => {
      await realCreate(...a);
      throw new Error("socket hang up");
    };
    const { provider, ...anyProvider } = video; // fallbacks available: still must not resubmit
    const r = await call(client, "generate_video", anyProvider);
    deps.generate.createTask = realCreate;
    assert.equal(errorOf(r).code, 5);
    assert.equal(errorOf(r).upstreamTaskId, null);
    assert.match(r.content[0].text, /kie job resolve j-/);
    assert.match(r.content[0].text, /Do not resubmit/);
    assert.equal(calls.create.length, sent + 1);
  });

  test("a create that times out after the provider gave an id: code 5, wait_job", async () => {
    deps.generate.createTask = async () => {
      throw Object.assign(new Error("read timed out"), { taskId: "task-77" });
    };
    const r = await call(client, "generate_video", video);
    deps.generate.createTask = realCreate;
    assert.equal(errorOf(r).code, 5);
    assert.equal(errorOf(r).upstreamTaskId, "task-77");
    assert.match(errorOf(r).nextAction, /wait_job with job_id "j-/);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm run test:mcp`
Expected: the generate tests FAIL (tool not found).

- [ ] **Step 3: Implement `registerGenerate` in `mcp/server.mjs`**

```js
  function registerGenerate() {
    const Submit = {
      localJobId: z.string(),
      upstreamTaskId: z.string().nullable(),
      state: z.string(),
      provider: z.string(),
      providerModel: z.string(),
      estimateUsd: z.number(),
      basis: z.string(),
      refMapping: z.array(z.string()),
      next: z.string(),
    };
    const common = {
      run: z.string().describe("Run folder slug: lowercase letters, digits, hyphens."),
      prompt: z.string().min(1).describe("The full prompt. Never edited by the server."),
      refs: z.array(Ref).optional(),
      resolution: z.string().optional(),
      aspect_ratio: z.string().optional(),
      params: z.record(z.string(), z.unknown()).optional().describe("Route fields such as generate_audio, checked against the route's captured contract."),
      budget_usd: z.number().positive().optional().describe("Per-job budget; defaults to the catalog's."),
      provider: z.string().optional().describe("Only this provider (e.g. kie)."),
    };

    /** Expand refs, record the inputs, then reserve and submit through the core. */
    async function submit(capability, model, a, values, { promptFile, inputsFile, artifactBase, useI2v, extra = {} }) {
      const dir = runDir(a.run);
      const { store, limits, roots, library } = ctx();
      const expanded = await expandRefs(a.refs ?? [], {
        catalog,
        library,
        roots,
        baseDir: RUNS_DIR,
        upload: deps.upload ?? ((path, opts) => uploadFile(catalog, path, opts)),
      });
      await writeRecord(dir, promptFile, a.prompt);
      await writeRecord(dir, inputsFile, {
        model: model.id,
        ...extra,
        refs: expanded.refs,
        refMapping: expanded.refMapping,
        params: a.params ?? {},
        via: "mcp",
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
          values: { ...values, refs: expanded.refs, params: a.params ?? {}, _useI2v: useI2v(expanded.refs) },
          record: { refMapping: expanded.refMapping, assets: expanded.assets, via: "mcp" },
        },
        { store, limits, deps: deps.generate },
      );
      for (const name of expanded.assets) library.recordUse(name, a.run);

      const out = {
        localJobId: sub.job.id,
        upstreamTaskId: sub.job.upstreamTaskId ?? null,
        state: sub.job.state,
        provider: sub.job.provider,
        providerModel: sub.job.providerModel,
        estimateUsd: sub.estimateUsd,
        basis: sub.basis,
        refMapping: expanded.refMapping,
        next: `Call wait_job with job_id "${sub.job.id}".`,
      };
      const text = [
        `submitted ${out.localJobId} (${out.provider} · ${out.providerModel}), estimate $${out.estimateUsd.toFixed(2)}`,
        ...(out.refMapping.length ? [`refs: ${out.refMapping.join("; ")}`] : []),
        out.next,
      ];
      return ok(text.join("\n"), out);
    }

    tool(
      "generate_image",
      {
        title: "Generate image",
        description:
          "Spends kie credits. Generates a still. Reserves the estimate against the daily cap, submits, and returns a local job id at once; then call wait_job. " +
          "refs: [{ source, role }] with an asset name, name#n, an https URL or a file in runs/. Write the prompt against the returned refMapping (@Image1 = zed#1).",
        inputSchema: {
          ...common,
          model: z.string().optional().describe("Defaults to gpt-image-2. See list_models."),
          quality: z.string().optional(),
          background: z.string().optional(),
        },
        outputSchema: Submit,
        annotations: SPEND,
      },
      async (a) => {
        const model = resolveModel(catalog, a.model ?? "gpt-image-2", "image");
        if (a.resolution && model.resolutions && !model.resolutions.includes(a.resolution)) {
          throw unknown(`${model.id} supports resolutions ${model.resolutions.join(", ")}.`);
        }
        if (a.quality && model.qualities && !model.qualities.includes(a.quality)) {
          throw unknown(`${model.id} supports qualities ${model.qualities.join(", ")}.`);
        }
        return submit(
          "image",
          model,
          a,
          { prompt: a.prompt, resolution: a.resolution, quality: a.quality, aspect_ratio: a.aspect_ratio, background: a.background },
          { promptFile: "image-prompt.txt", inputsFile: "image-inputs.json", artifactBase: "ref", useI2v: (refs) => refs.length > 0 },
        );
      },
    );

    tool(
      "generate_video",
      {
        title: "Generate video",
        description:
          "Spends kie credits. Generates a video. Reserves the estimate against the daily cap, submits, and returns a local job id at once; then call wait_job. " +
          "A preset supplies model, duration and aspect ratio defaults only: the prompt is always yours (adapt the preset's source prompt; never send it unmodified). " +
          "A first_frame ref makes it image-to-video. Write the prompt against the returned refMapping.",
        inputSchema: {
          ...common,
          model: z.string().optional(),
          preset: z.string().optional(),
          duration_s: z.number().int().positive().optional(),
        },
        outputSchema: Submit,
        annotations: SPEND,
      },
      async (a) => {
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
        if (!modelId) throw usage("Need model, or a preset that supplies one. See list_models and list_presets.");

        const model = resolveModel(catalog, modelId, "video");
        const problems = validateVideoRequest(catalog, model, { durationS, aspectRatio, refs: a.refs ?? [] });
        if (problems.length) {
          throw unknown(`Refused before submitting — nothing was spent:\n${problems.map((p) => `  · ${p}`).join("\n")}`);
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
      },
    );

    tool(
      "wait_job",
      {
        title: "Wait for a job",
        description:
          "Wait for a generate_image or generate_video job, up to max_wait_s (default 60, at most 120). Still running is a normal result (outcome pending): call again. " +
          "On success the files are in the run folder, the actual cost is recorded, and a preview is shown. Free.",
        inputSchema: {
          job_id: z.string(),
          max_wait_s: z.number().int().min(1).max(120).optional(),
        },
        outputSchema: {
          localJobId: z.string(),
          outcome: z.enum(["succeeded", "failed", "pending", "no-artifact"]),
          state: z.string(),
          artifacts: z.array(z.string()),
          estimateUsd: z.number().nullable(),
          actualUsd: z.number().nullable(),
          costSource: z.string().nullable(),
          message: z.string(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      async ({ job_id, max_wait_s }) => {
        const { store } = ctx();
        const w = await waitJob(catalog, store, job_id, { timeoutMs: (max_wait_s ?? 60) * 1000, deps: deps.generate });
        const job = w.job;
        const charged = job.state !== "failed-confirmed-free";
        const message = {
          succeeded: `Done: ${(w.artifacts ?? []).join(", ") || "no files"}.`,
          pending: `${w.message ?? "Still running."} Call wait_job again with job_id "${job.id}".`,
          failed:
            `Job ended ${job.state}: ${job.error ?? "no message"}. ` +
            (charged
              ? "It may have been charged; tell the user before generating again."
              : "Nothing was charged; generating again is safe."),
          "no-artifact": w.message ?? "The task succeeded but returned no file. Do not resubmit; tell the user.",
        }[w.outcome];
        const out = {
          localJobId: job.id,
          outcome: w.outcome,
          state: job.state,
          artifacts: w.artifacts ?? [],
          estimateUsd: job.estimateUsd ?? null,
          actualUsd: job.actualUsd ?? null,
          costSource: job.costSource ?? null,
          message,
        };
        const preview = w.outcome === "succeeded" && out.artifacts.length ? await artifactPreview(out.artifacts[0]) : null;
        const cost = out.actualUsd != null ? ` Cost $${out.actualUsd.toFixed(2)} (${out.costSource}).` : "";
        return ok(`${message}${cost}`, out, preview ? [preview] : []);
      },
    );
  }
```

If the plan 2 review fixes named the no-artifact outcome differently, use that name in the enum and the message map.

- [ ] **Step 4: Test and commit**

Run: `npm run test:mcp && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: all MCP tests pass except the one `todo`; root `fail 0`.

```bash
git add mcp/server.mjs mcp/tests/generate.test.mjs
git commit -m "Add generate_image, generate_video and wait_job to the MCP server"
```

---

### Task 6: Finishing tools

**Files:**
- Modify: `mcp/server.mjs` (`registerFinish`), `mcp/tests/look.test.mjs` (remove the `todo`)
- Test: `mcp/tests/finish.test.mjs` (5 tests)

- [ ] **Step 1: Write the failing tests**

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RUNS, hasFfmpeg, realMp4, stubs, connect, call, errorOf } from "./helpers.mjs";

const skip = !hasFfmpeg && "ffmpeg not installed";
const { deps } = stubs();
const client = await connect(deps);
const dir = join(RUNS, "finish-demo");
mkdirSync(dir, { recursive: true });
if (hasFfmpeg) realMp4(join(dir, "a.mp4"));

describe("finishing, local and free", { skip }, () => {
  test("frames writes a contact sheet into the run and returns it as an image", async () => {
    const r = await call(client, "frames", { run: "finish-demo", video: "a.mp4" });
    assert.ok(r.structuredContent.sheet.startsWith(join(dir, "a-frames")));
    assert.equal(r.structuredContent.times.length, 8);
    assert.equal(r.content.filter((c) => c.type === "image").length, 1);
  });

  test("probe reads duration and size", async () => {
    const r = await call(client, "probe", { run: "finish-demo", file: "a.mp4" });
    assert.equal(r.structuredContent.width, 320);
    assert.ok(Math.abs(r.structuredContent.durationS - 2) < 0.2);
  });

  test("variants makes a square cut in the run", async () => {
    const r = await call(client, "variants", { run: "finish-demo", video: "a.mp4", ratios: ["1:1"] });
    const v = r.structuredContent.variants[0];
    assert.equal(v.width, v.height);
    assert.ok(v.out.startsWith(dir));
  });

  test("a shot outside the allowed folders is refused with code 3", async () => {
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "kie-else-")));
    const outside = realMp4(join(elsewhere, "b.mp4"));
    const r = await call(client, "assemble", { run: "finish-demo", shots: [outside] });
    assert.equal(errorOf(r).code, 3);
    assert.match(r.content[0].text, /outside the folders/);
  });

  test("an output name with a path is refused with code 3", async () => {
    const r = await call(client, "assemble", { run: "finish-demo", shots: ["a.mp4"], out: "../escape.mp4" });
    assert.equal(errorOf(r).code, 3);
    assert.match(r.content[0].text, /plain file name/);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm run test:mcp`
Expected: the finish tests FAIL (tools not found).

- [ ] **Step 3: Implement `registerFinish` in `mcp/server.mjs`**

```js
  function registerFinish() {
    const Run = z.string().describe("Run folder slug.");
    const InRun = (what) => z.string().describe(`${what}: a file name in the run folder, or a path inside runs/ or library/.`);
    const Ratio = z.enum(Object.keys(RATIOS));

    tool(
      "frames",
      {
        title: "Frames",
        description: "An 8-frame contact sheet plus first and last frame PNGs of a video, written into the run folder; the sheet is shown. Free, local.",
        inputSchema: { run: Run, video: InRun("The video") },
        outputSchema: {
          sheet: z.string(),
          first: z.string(),
          last: z.string(),
          times: z.array(z.number()),
          durationS: z.number(),
        },
        annotations: LOCAL_WRITE,
      },
      async ({ run, video }) => {
        const dir = runDir(run, { create: false });
        const path = runFile(dir, video, ctx().roots);
        const r = await extractFrames(path, { outDir: join(dir, `${basename(path, extname(path))}-frames`) });
        const sheet = await imagePreview(r.sheet, { width: 1024 });
        const out = { sheet: r.sheet, first: r.first, last: r.last, times: r.times, durationS: r.durationS };
        return ok(`${r.sheet}\nfirst ${r.first}\nlast ${r.last}`, out, sheet ? [sheet] : []);
      },
    );

    tool(
      "probe",
      {
        title: "Probe",
        description: "Duration, size, frame rate, codecs and loudness of a media file. Free, local.",
        inputSchema: { run: Run, file: InRun("The file") },
        outputSchema: {
          path: z.string(),
          durationS: z.number().nullable(),
          width: z.number().nullable(),
          height: z.number().nullable(),
          fps: z.number().nullable(),
          videoCodec: z.string().nullable(),
          hasAudio: z.boolean(),
          audioCodec: z.string().nullable(),
          sizeBytes: z.number().nullable(),
          lufs: z.number().nullable(),
          truePeakDb: z.number().nullable(),
        },
        annotations: LOOK,
      },
      async ({ run, file }) => {
        const path = runFile(runDir(run, { create: false }), file, ctx().roots);
        const info = await probe(path);
        const loud = info.hasAudio ? await measureLoudness(path) : null;
        const out = {
          path: info.path,
          durationS: info.durationS,
          width: info.width,
          height: info.height,
          fps: info.fps,
          videoCodec: info.videoCodec,
          hasAudio: info.hasAudio,
          audioCodec: info.audioCodec,
          sizeBytes: info.sizeBytes,
          lufs: loud?.inputI ?? null,
          truePeakDb: loud?.inputTp ?? null,
        };
        return ok(`${out.path}: ${out.durationS}s ${out.width}×${out.height} @ ${out.fps}fps${out.hasAudio ? `, audio ${out.audioCodec}` : ", no audio"}`, out);
      },
    );

    tool(
      "assemble",
      {
        title: "Assemble",
        description: "Join shots, with optional music, voice-over and crossfades, into one film in the run folder, loudness-normalised. Free, local.",
        inputSchema: {
          run: Run,
          shots: z.array(InRun("A shot")).min(1),
          music: InRun("Music").optional(),
          vo: InRun("Voice-over").optional(),
          transition: z.object({ kind: z.string().default("fade"), seconds: z.number().positive() }).optional(),
          aspect_ratio: Ratio.optional(),
          shot_audio: z.enum(["auto", "keep", "drop"]).optional(),
          out: z.string().optional().describe("A plain file name; defaults to film.mp4, numbered if taken."),
        },
        outputSchema: { out: z.string(), totalS: z.number(), width: z.number(), height: z.number() },
        annotations: LOCAL_WRITE,
      },
      async (a) => {
        const dir = runDir(a.run, { create: false });
        const { roots } = ctx();
        const name = outName(a.out);
        const shots = a.shots.map((s) => runFile(dir, s, roots));
        const ratio = a.aspect_ratio ?? "16:9";
        const [width, height] = dimsFor(ratio);
        const result = await assemble({
          shots,
          music: a.music ? runFile(dir, a.music, roots) : null,
          vo: a.vo ? runFile(dir, a.vo, roots) : null,
          out: outPath(dir, name, "film", ".mp4"),
          transitionS: a.transition?.seconds ?? 0,
          transition: a.transition?.kind ?? "fade",
          ratio,
          width,
          height,
          shotAudio: a.shot_audio ?? "auto",
        });
        await writeRecord(dir, "assembly.json", result);
        return ok(`${result.out} (${result.totalS}s, ${width}×${height})`, { out: result.out, totalS: result.totalS, width, height });
      },
    );

    tool(
      "variants",
      {
        title: "Variants",
        description: "Reframe a video to other aspect ratios (blur, crop or pad), written into the run folder. Free, local.",
        inputSchema: { run: Run, video: InRun("The video"), ratios: z.array(Ratio).min(1), mode: z.enum(MODES).optional() },
        outputSchema: {
          variants: z.array(z.object({ out: z.string(), width: z.number(), height: z.number(), mode: z.string() })),
        },
        annotations: LOCAL_WRITE,
      },
      async (a) => {
        const dir = runDir(a.run, { create: false });
        const video = runFile(dir, a.video, ctx().roots);
        const result = await makeVariants({ video, ratios: a.ratios, outDir: dir, mode: a.mode ?? "blur" });
        await writeRecord(dir, "variants.json", result);
        const variants = result.variants.map((v) => ({ out: v.out, width: v.width, height: v.height, mode: v.mode }));
        return ok(variants.map((v) => `${v.out} (${v.width}×${v.height}, ${v.mode})`).join("\n"), { variants });
      },
    );

    tool(
      "caption",
      {
        title: "Caption",
        description: "Burn an SRT's captions into a video, written into the run folder. Free, local (needs the render package).",
        inputSchema: {
          run: Run,
          video: InRun("The video"),
          srt: InRun("The SRT file"),
          style: z.enum(["social", "subtle"]).optional(),
          out: z.string().optional(),
        },
        outputSchema: { out: z.string(), cues: z.number(), style: z.string(), warnings: z.array(z.string()) },
        annotations: LOCAL_WRITE,
      },
      async (a) => {
        const dir = runDir(a.run, { create: false });
        const { roots } = ctx();
        const result = await burnCaptions({
          video: runFile(dir, a.video, roots),
          srt: runFile(dir, a.srt, roots),
          out: outPath(dir, outName(a.out), "captioned", ".mp4"),
          style: a.style ?? "social",
        });
        await writeRecord(dir, "captions.json", result);
        const out = { out: result.out, cues: result.cues, style: result.style, warnings: result.warnings ?? [] };
        return ok(`${out.out} (${out.cues} cues, ${out.style})`, out);
      },
    );

    tool(
      "render",
      {
        title: "Render",
        description: "Render a code template (exact text, logos, numbers) to video in the run folder. Use instead of a video model when copy must land exactly. Free, local.",
        inputSchema: {
          run: Run,
          template: z.enum(Object.keys(TEMPLATES)),
          props: z.record(z.string(), z.unknown()).optional(),
          aspect_ratio: Ratio.optional(),
          duration_s: z.number().positive().optional(),
          brand: z.string().regex(/^[a-z0-9-]+$/).optional().describe("A brand kit name from brand/."),
          alpha: z.boolean().optional(),
          out: z.string().optional(),
        },
        outputSchema: { out: z.string(), width: z.number(), height: z.number() },
        annotations: LOCAL_WRITE,
      },
      async (a) => {
        const dir = runDir(a.run);
        let propsPath;
        if (a.props) {
          propsPath = join(dir, `props-${a.template}.json`);
          writeFileSync(propsPath, JSON.stringify(a.props, null, 2) + "\n");
        }
        const result = await render({
          template: a.template,
          propsPath,
          out: outPath(dir, outName(a.out), a.template, a.alpha ? ".mov" : ".mp4"),
          ratio: a.aspect_ratio ?? "16:9",
          durationS: a.duration_s,
          brand: a.brand,
          alpha: a.alpha ?? false,
        });
        await writeRecord(dir, `render-${a.template}.json`, result);
        return ok(`${result.out} (${result.width}×${result.height})`, { out: result.out, width: result.width, height: result.height });
      },
    );
  }
```

Remove the `todo` marker from the tool-list test in `mcp/tests/look.test.mjs`.

Check against the libraries: `makeVariants`' variant objects and `burnCaptions`' result use the field names above (`out`, `width`, `height`, `mode`; `out`, `cues`, `style`, `warnings`) — the CLI prints the same fields. If one differs, map it in the handler and keep the schema.

- [ ] **Step 4: Test and commit**

Run: `npm run test:mcp && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: all MCP tests pass (5 results + 10 look + 8 generate + 5 finish = 28); root `fail 0`.

```bash
git add mcp/server.mjs mcp/tests/finish.test.mjs mcp/tests/look.test.mjs
git commit -m "Add the finishing tools to the MCP server"
```

---

### Task 7: Register with Claude Code and Codex

**Files:**
- Create: `mcp/register.mjs`
- Modify: `install.mjs`
- Test: `tests/mcp-register.test.mjs` (8 tests, root suite: `register.mjs` has no dependencies)

- [ ] **Step 1: Write the failing tests**

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NAME, planCodex, applyCodex, claudeEntry, planClaude, applyClaude } from "../mcp/register.mjs";

const want = { command: "/usr/local/bin/node", args: ["/repo/mcp/server.mjs"] };
const UNRELATED = `model = "gpt-5.5"

[mcp_servers.context7]
url = "https://mcp.context7.com/mcp"

[mcp_servers.markitdown]
command = "uvx"
args = ["markitdown-mcp"]
`;

describe("Codex config.toml", () => {
  test("install twice gives an identical file", () => {
    const once = planCodex(UNRELATED, want);
    assert.equal(once.action, "add");
    const twice = planCodex(once.text, want);
    assert.equal(twice.action, "none");
    assert.equal(twice.text, once.text);
    assert.match(once.text, /\[mcp_servers\.motion-design\]\ncommand = "\/usr\/local\/bin\/node"\nargs = \["\/repo\/mcp\/server\.mjs"\]/);
  });

  test("uninstall restores the original byte for byte", () => {
    const installed = planCodex(UNRELATED, want).text;
    const removed = planCodex(installed, want, { uninstall: true });
    assert.equal(removed.action, "remove");
    assert.equal(removed.text, UNRELATED);
  });

  test("a motion-design table someone else wrote is reported and left alone", () => {
    const theirs = `${UNRELATED}\n[mcp_servers.motion-design]\ncommand = "other"\n`;
    const plan = planCodex(theirs, want);
    assert.equal(plan.action, "conflict");
    assert.equal(plan.text, theirs);
  });

  test("a changed node path updates only our block", () => {
    const installed = planCodex(UNRELATED, want).text;
    const plan = planCodex(installed, { ...want, command: "/opt/node/bin/node" });
    assert.equal(plan.action, "update");
    assert.ok(plan.text.startsWith(UNRELATED));
    assert.match(plan.text, /\/opt\/node\/bin\/node/);
  });

  test("applyCodex backs the file up before writing, and a dry run writes nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "kie-codex-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, UNRELATED);
    assert.equal(applyCodex(path, want, { dryRun: true }).action, "add");
    assert.equal(readFileSync(path, "utf8"), UNRELATED);
    const r = applyCodex(path, want);
    assert.equal(r.action, "add");
    assert.equal(readFileSync(r.backup, "utf8"), UNRELATED);
    assert.equal(readdirSync(dir).length, 2);
  });
});

describe("Claude Code", () => {
  const out = (cmd, args) => `${NAME}:\n  Scope: User config\n  Type: stdio\n  Command: ${cmd}\n  Args: ${args}\n`;
  const runner = (stdout, status = 0) => {
    const log = [];
    const run = (args) => {
      log.push(args);
      return args[1] === "get" ? { status, stdout } : { status: 0, stdout: "" };
    };
    return { run, log };
  };

  test("claudeEntry reads command and args, and absence", () => {
    assert.deepEqual(claudeEntry(runner(out("/usr/local/bin/node", "/repo/mcp/server.mjs")).run), {
      state: "present",
      command: "/usr/local/bin/node",
      args: "/repo/mcp/server.mjs",
    });
    assert.equal(claudeEntry(runner("", 1).run).state, "absent");
    assert.equal(claudeEntry(() => ({ missing: true })).state, "no-cli");
  });

  test("planClaude: add, leave, update, conflict, skip", () => {
    const ours = { state: "present", command: want.command, args: want.args.join(" ") };
    assert.equal(planClaude({ state: "absent" }, want).action, "add");
    assert.equal(planClaude(ours, want).action, "none");
    assert.equal(planClaude({ ...ours, command: "/old/node" }, want).action, "update");
    assert.equal(planClaude({ state: "present", command: "npx", args: "someone-else" }, want).action, "conflict");
    assert.equal(planClaude({ state: "no-cli" }, want).action, "skip");
    assert.equal(planClaude({ state: "present", command: "npx", args: "someone-else" }, want, { uninstall: true }).action, "none");
  });

  test("applyClaude adds at user scope with our exact command, and removes only ours", () => {
    const fresh = runner("", 1);
    applyClaude(want, { run: fresh.run });
    assert.deepEqual(fresh.log.at(-1), ["mcp", "add", "--scope", "user", NAME, "--", want.command, ...want.args]);
    const ours = runner(out(want.command, want.args.join(" ")));
    applyClaude(want, { uninstall: true, run: ours.run });
    assert.deepEqual(ours.log.at(-1), ["mcp", "remove", NAME, "-s", "user"]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test tests/mcp-register.test.mjs`
Expected: FAIL, cannot find `../mcp/register.mjs`.

- [ ] **Step 3: Implement `mcp/register.mjs`**

```js
// Register the MCP server with Claude Code and Codex, touching only our own
// entry: the Claude Code server whose args are our server.mjs, and the Codex
// block between our markers. Zero dependencies, so install.mjs can import it
// before mcp/node_modules exists.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

export const NAME = "motion-design";
export const BEGIN = `# >>> ${NAME} >>>`;
export const END = `# <<< ${NAME} <<<`;
// The optional leading newline is the blank line we add before the block, so
// removing it restores the file exactly.
const BLOCK = new RegExp(`\\n?${BEGIN}\\n[\\s\\S]*?${END}\\n`);
const FOREIGN = new RegExp(`^\\s*\\[mcp_servers\\.(?:${NAME}|"${NAME}")\\]\\s*$`, "m");

/** The command hosts run: this node (absolute, so a GUI-launched host without our PATH still finds it). */
export function serverCommand(root, node = process.execPath) {
  return { command: node, args: [join(root, "mcp", "server.mjs")] };
}

export function codexBlock(want) {
  return [BEGIN, `[mcp_servers.${NAME}]`, `command = ${JSON.stringify(want.command)}`, `args = ${JSON.stringify(want.args)}`, END, ""].join("\n");
}

/** What to do to config.toml's text. Nothing outside our markers ever changes. */
export function planCodex(text, want, { uninstall = false } = {}) {
  const has = BLOCK.test(text);
  if (uninstall) return has ? { action: "remove", text: text.replace(BLOCK, "") } : { action: "none", text };
  if (FOREIGN.test(text.replace(BLOCK, ""))) return { action: "conflict", text };
  if (has) {
    const next = text.replace(BLOCK, (m) => (m.startsWith("\n") ? "\n" : "") + codexBlock(want));
    return next === text ? { action: "none", text } : { action: "update", text: next };
  }
  const base = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  return { action: "add", text: `${base}${base ? "\n" : ""}${codexBlock(want)}` };
}

export function applyCodex(path, want, { uninstall = false, dryRun = false, now = new Date() } = {}) {
  const exists = existsSync(path);
  if (!exists && uninstall) return { action: "none" };
  const plan = planCodex(exists ? readFileSync(path, "utf8") : "", want, { uninstall });
  if (dryRun || !["add", "update", "remove"].includes(plan.action)) return { action: plan.action };
  let backup = null;
  if (exists) {
    backup = `${path}.bak-${now.toISOString().replace(/[:.]/g, "-")}`;
    copyFileSync(path, backup);
  }
  writeFileSync(path, plan.text);
  return { action: plan.action, backup };
}

export function runClaude(args) {
  const r = spawnSync("claude", args, { encoding: "utf8" });
  if (r.error?.code === "ENOENT") return { missing: true };
  return { status: r.status, stdout: r.stdout ?? "" };
}

/**
 * Our entry as Claude Code reports it. The output is parsed, never printed:
 * `claude mcp get` shows headers and env values, which can be secrets.
 */
export function claudeEntry(run = runClaude) {
  const r = run(["mcp", "get", NAME]);
  if (r.missing) return { state: "no-cli" };
  if (r.status !== 0) return { state: "absent" };
  const field = (label) => r.stdout.match(new RegExp(`^\\s*${label}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? null;
  return { state: "present", command: field("Command"), args: field("Args") };
}

export function planClaude(entry, want, { uninstall = false } = {}) {
  if (entry.state === "no-cli") return { action: "skip", reason: "the claude CLI is not on PATH" };
  const ours = entry.state === "present" && entry.args === want.args.join(" ");
  if (uninstall) return ours ? { action: "remove" } : { action: "none" };
  if (entry.state === "absent") return { action: "add" };
  if (!ours) return { action: "conflict" };
  return entry.command === want.command ? { action: "none" } : { action: "update" };
}

export function applyClaude(want, { uninstall = false, dryRun = false, run = runClaude } = {}) {
  const plan = planClaude(claudeEntry(run), want, { uninstall });
  if (dryRun) return plan;
  const remove = () => run(["mcp", "remove", NAME, "-s", "user"]);
  const add = () => run(["mcp", "add", "--scope", "user", NAME, "--", want.command, ...want.args]);
  let status = 0;
  if (plan.action === "remove") status = remove().status;
  if (plan.action === "update") status = remove().status || add().status;
  if (plan.action === "add") status = add().status;
  return status ? { ...plan, action: "failed" } : plan;
}
```

- [ ] **Step 4: Wire it into `install.mjs`**

Add to the imports at the top:

```js
import { spawnSync } from "node:child_process";
import { serverCommand, applyClaude, applyCodex } from "./mcp/register.mjs";
```

Insert this block directly before the final `log(\`\n${changed} change(s)...` call:

```js
// MCP server: Claude Code at user scope, Codex in a marked block of
// ~/.codex/config.toml. Only our own entries are ever added, changed or removed.
if (!argv.has("--no-mcp")) {
  log("\nmcp server");
  const want = serverCommand(ROOT);
  if (!UNINSTALL && !existsSync(join(ROOT, "mcp", "node_modules", "@modelcontextprotocol", "sdk"))) {
    if (DRY) {
      log("  would run npm install in mcp/");
    } else {
      const r = spawnSync("npm", ["install", "--prefix", join(ROOT, "mcp")], { stdio: "inherit" });
      log(r.status === 0 ? "  installed mcp/ dependencies" : "  FAIL     npm install in mcp/; run it by hand: npm --prefix mcp install");
    }
  }

  const say = {
    add: "added",
    update: "updated (node path changed)",
    remove: "removed",
    none: "ok, nothing to change",
    conflict: "SKIP: a motion-design entry exists that is not ours; left alone",
    skip: "skip",
    failed: "FAIL: the claude CLI returned an error",
  };
  const c = applyClaude(want, { uninstall: UNINSTALL, dryRun: DRY });
  if (["add", "update", "remove"].includes(c.action)) changed += 1;
  log(`  Claude Code: ${say[c.action]}${c.reason ? ` (${c.reason})` : ""}`);

  const codexDir = join(homedir(), ".codex");
  if (existsSync(codexDir)) {
    const x = applyCodex(join(codexDir, "config.toml"), want, { uninstall: UNINSTALL, dryRun: DRY });
    if (["add", "update", "remove"].includes(x.action)) changed += 1;
    log(`  Codex:       ${say[x.action]}${x.backup ? ` (backup ${x.backup})` : ""}`);
  } else {
    log("  Codex:       skip (~/.codex not found)");
  }
}
```

Update the header comment's usage lines to mention `--no-mcp`.

- [ ] **Step 5: Test, check the installer by dry run, commit**

Run: `node --test tests/mcp-register.test.mjs && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: 8 pass; `fail 0`.

Run: `node install.mjs --dry-run` and read the `mcp server` section. It only reads (`claude mcp get`, the Codex file) and writes nothing. Do **not** run the installer without `--dry-run`: registering the server in Alex's real Claude Code and Codex configs is his decision, made at hand-off.

```bash
git add mcp/register.mjs install.mjs tests/mcp-register.test.mjs
git commit -m "Register the MCP server with Claude Code and Codex, touching only our entries"
```

---

### Task 8: Documentation and spec log

**Files:**
- Create: `mcp/README.md`
- Modify: `README.md`, `cli/README.md`, `skills/motion-design/references/tool-routing.md`, `docs/superpowers/specs/2026-10-30-mcp-server-design.md`

- [ ] **Step 1: `mcp/README.md`**

```markdown
# motion-design MCP server

Lets Claude Code and Codex use the kie harness as tools: look at models and
costs, save reference assets, generate stills and videos inside the spend
limits, wait for them, and finish films. It runs locally over stdio and calls
the same code as the `kie` CLI.

## Set up

1. Install the CLI and its key first (see the main README); `kie doctor` should pass.
2. `node install.mjs` from the repo root. It installs this folder's
   dependencies and registers the server:
   - Claude Code: `claude mcp add --scope user motion-design -- <node> <repo>/mcp/server.mjs`
   - Codex: a block between `# >>> motion-design >>>` and `# <<< motion-design <<<`
     in `~/.codex/config.toml` (backed up first).
   `node install.mjs --dry-run` shows what it would change. `--uninstall`
   removes only these two entries. `--no-mcp` skips this step.
3. Restart the host and ask it to call `status`.

## Tools

| Group | Tools | Cost |
|---|---|---|
| Look | `status`, `list_models`, `list_presets`, `estimate`, `list_runs`, `get_run` | free |
| Assets | `save_asset`, `list_assets`, `get_asset` | free |
| Generate | `generate_image`, `generate_video`, `wait_job` | spends kie credits |
| Finish | `frames`, `probe`, `assemble`, `variants`, `caption`, `render` | free, local |

## Limits that protect your money

- Every job has a per-job budget, and all jobs share a daily cap
  (`~/.config/kie/limits.json`, $10 by default). Change it with
  `kie limits --daily N`; no tool can.
- A job that may exist upstream (error 5) is never resubmitted. Check kie's
  task log and record the outcome with `kie job resolve`.
- Files are read only from `runs/`, `library/` and folders you list under
  `allowRoots` in the limits file. Relative paths mean inside `runs/`.

## Errors

Errors are tool results with `isError: true`. The text starts `Error <code>:`
and ends with the next action; `_meta.error` holds `{ code, retryable,
nextAction, localJobId, upstreamTaskId }`. Codes match the CLI: 1 usage,
2 budget or cap (nothing spent), 3 invalid request or path, 4 provider error,
5 outcome unknown.

## Tests

`npm --prefix mcp test` (or `npm run test:mcp` from the root). Every provider
call is stubbed; nothing is spent.
```

- [ ] **Step 2: Other docs**

- `README.md`: in the setup section, one line after the CLI install: "`node install.mjs` also registers the MCP server with Claude Code and Codex; see [mcp/README.md](mcp/README.md)."
- `cli/README.md`: a short "MCP server" section linking `mcp/README.md` and saying the server shares job records, the daily cap and the asset library with the CLI.
- `tool-routing.md`: a row: `| Drive the harness from chat (Claude Code, Codex) | the motion-design MCP server: status → estimate → generate_* → wait_job; see mcp/README.md |`.

- [ ] **Step 3: Spec revision log.** Append:

```markdown
- 2026-10-30, while planning step 7:
  - Error details are in `_meta.error`, not `structuredContent`: SDK 1.32 clients validate `structuredContent` against the `outputSchema` even on `isError` results.
  - The read-only views live in `cli/core/views.mjs`, shared with the coming web app.
  - Relative client paths resolve inside `runs/`; every path is confined to the allowed roots, media or not (`confinePath`).
  - `generate_video` takes a preset for defaults only; the prompt is always required, so the raw source-prompt path does not exist over MCP.
  - A job that fails after submission is not failed over by the server; `wait_job` says whether it was charged and the agent decides.
  - Previews are ffmpeg JPEGs (768 px for images, the contact sheet at 1024 px for video).
```

- [ ] **Step 4: Validate, test, commit**

Run: `npm run validate 2>&1 | tail -2 && npm test 2>&1 | grep -E "^ℹ (pass|fail)" && npm run test:mcp 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: validator success; both suites `fail 0`.

```bash
git add mcp/README.md README.md cli/README.md skills/motion-design/references/tool-routing.md docs/superpowers/specs/2026-10-30-mcp-server-design.md
git commit -m "Document the MCP server, its setup and its limits"
```

---

## Done when

- Root suite: 18 new tests (3 + 7 + 8), `fail 0`. MCP suite: 28 tests, `fail 0`.
- `printf ... | node mcp/server.mjs` lists 18 tools over stdio and prints nothing else to stdout.
- `node install.mjs --dry-run` reports what it would do for Claude Code and Codex and changes nothing.
- Nothing was spent: every provider call in the tests is a stub.
- Not done here, by design: registering the server in Alex's real configs, and the live acceptance run (about $0.20). Both wait for Alex.
