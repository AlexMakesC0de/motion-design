# Plan 1: honest prices, the params passthrough and `kie frames`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CLI price per-second models correctly, call MiniMax H3 and Seedance 2.5 on kie with their real contracts (including the audio switch), pass extra provider fields safely, and produce contact sheets plus first and last frames from any clip.

**Architecture:** All provider knowledge stays in `cli/models.json`, per the repo's rule ([cli/README.md](../../../cli/README.md)). Code changes are small, pure, tested functions in `cli/lib/` (`estimateUsd`, `priceLabel`, `effectiveRoute`, `parseParams`, extended `buildInput`, `frameTimes`, `extractFrames`), wired into `cli/kie.mjs`. No architecture change; the `core/` extraction is plan 2.

**Tech stack:** Node ≥20 ESM, `node:test`, ffmpeg (already the finishing dependency). No new packages.

**Spec:** [2026-10-30-mcp-server-design.md](../specs/2026-10-30-mcp-server-design.md), build step 1, plus `frames` (build step 6, pulled forward because it is independent and the quality work needs it).

**Plan series:** 1 catalog, params, frames (this) → 2 core extraction, jobs, spend guard → 3 input safety, asset library → 4 MCP server, installer. Each is written once its predecessor has landed, against the code as it then stands.

---

## File map

| File | Change |
|---|---|
| `cli/lib/budget.mjs` | add `estimateUsd`, `priceLabel`; `preflight` prices from duration and resolution |
| `cli/lib/models.mjs` | add `effectiveRoute`, `parseParams`; `buildInput` learns `params` and `refRules` |
| `cli/lib/frames.mjs` | new: `frameTimes`, `extractFrames` |
| `cli/kie.mjs` | `--param` flag; `generate` uses `effectiveRoute` and passes duration/resolution to `preflight`; `kie preflight` and `kie models` show real prices; new `kie frames` |
| `cli/models.json` | `minimax-h3` and `seedance-2-5` entries rewritten from the docs read 2026-10-30 |
| `tests/pricing.test.mjs` | new |
| `tests/contracts.test.mjs` | new: `effectiveRoute`, `refRules`, `params` |
| `tests/catalog-2026-10-30.test.mjs` | new: the two rewritten catalog entries behave as documented |
| `tests/frames.test.mjs` | new |
| `cli/README.md`, `skills/motion-design/references/tool-routing.md` | document `--param`, per-second pricing, `frames` |

Run the whole suite with `npm test` from the repo root. The baseline is 110 passing tests.

---

### Task 0: Branch and settle the existing uncommitted work

`cli/kie.mjs` and `cli/models.json` carry uncommitted changes from earlier work (image references and `--background` on `kie image`, GPT Image 2.5 and Seedance contract updates). They must not get mixed into this plan's commits.

- [ ] **Step 1: Confirm the tree and the test baseline**

Run: `cd ~/Developer/motion-design && git status --short && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: ` M cli/kie.mjs`, ` M cli/models.json`, untracked `docs/...`; `tests 110`, `pass 110`, `fail 0`.

- [ ] **Step 2: Ask Alex** whether the existing changes are committed as their own commit ("Add image references and the GPT Image 2.5 route") before work starts. Do not commit without a yes. If he says no, stop: this plan's commits would include them.

- [ ] **Step 3: Branch**

```bash
git switch -c plan-1-catalog-params-frames
```

---

### Task 1: Price per-second routes by duration and resolution

Today `preflight` charges a flat `priceUsd` per job. That makes a 4s 480p Seedance 2.5 draft cost $4.73 on paper (the 15s 720p price) and blocks it under a $3 budget, while a 30s 1080p job would read as $4.73 against a real ~$23.70.

**Files:**
- Modify: `cli/lib/budget.mjs`
- Test: `tests/pricing.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/pricing.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EXIT } from "../cli/lib/errors.mjs";
import { estimateUsd, priceLabel, preflight } from "../cli/lib/budget.mjs";

const perSecond = {
  model: "m",
  priceUsd: 4.73,
  pricing: { per: "second", usdPerSecond: { "480p": 0.14, "720p": 0.315 } },
  input: { defaults: { duration: 5, resolution: "720p" } },
  prov: { label: "Test", credits: null },
};

describe("a per-second route is priced the way it bills", () => {
  test("duration × the rate for the requested resolution", () => {
    const e = estimateUsd(perSecond, { durationS: 4, resolution: "480p" });
    assert.equal(e.usd, 0.56);
    assert.match(e.basis, /4s × \$0\.14\/s at 480p/);
  });

  test("the contract's defaults fill a missing duration and resolution", () => {
    assert.equal(estimateUsd(perSecond, {}).usd, 1.575);
  });

  test("a string duration (wan's contract type) still prices", () => {
    assert.equal(estimateUsd(perSecond, { durationS: "4", resolution: "480p" }).usd, 0.56);
  });

  test("an unpriced resolution falls back to the flat figure and says so", () => {
    const e = estimateUsd(perSecond, { durationS: 4, resolution: "1080p" });
    assert.equal(e.usd, 4.73);
    assert.equal(e.basis, "per-job-fallback");
  });

  test("automatic duration (-1) falls back rather than pricing a negative job", () => {
    assert.equal(estimateUsd(perSecond, { durationS: -1 }).basis, "per-job-fallback");
  });

  test("a flat route ignores duration entirely", () => {
    const e = estimateUsd({ priceUsd: 0.06 }, { durationS: 30 });
    assert.deepEqual(e, { usd: 0.06, basis: "per-job" });
  });
});

describe("the budget check uses the per-second estimate", () => {
  test("a short draft fits a budget the flat price would have refused", async () => {
    const r = await preflight({}, perSecond, { budgetUsd: 1, durationS: 4, resolution: "480p" });
    assert.equal(r.estimatedUsd, 0.56);
  });

  test("a long final is refused even though the flat price would pass", async () => {
    await assert.rejects(
      preflight({}, perSecond, { budgetUsd: 5, durationS: 30, resolution: "720p" }),
      (e) => e.code === EXIT.BUDGET && /\$9\.45/.test(e.message),
    );
  });
});

describe("prices are labelled in the unit they bill in", () => {
  test("per-second routes list each resolution's rate", () => {
    assert.equal(priceLabel(perSecond), "480p $0.14/s 720p $0.315/s");
  });

  test("flat routes show the job price", () => {
    assert.equal(priceLabel({ priceUsd: 0.06 }), "$0.06");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test tests/pricing.test.mjs`
Expected: FAIL, `estimateUsd` is not exported from `budget.mjs`.

- [ ] **Step 3: Implement**

In `cli/lib/budget.mjs`, add above `preflight`:

```js
/**
 * Price a job the way the provider bills it. Seedance 2.5 and H3 on kie charge
 * per second at a per-resolution rate, so a flat per-job figure overstates a 4s
 * draft by 4x and understates a 30s film by 5x -- and the budget cap is only as
 * honest as this number. Routes without per-second pricing keep `priceUsd`.
 */
export function estimateUsd(route, { durationS, resolution } = {}) {
  const pricing = route.pricing;
  if (pricing?.per !== "second") return { usd: route.priceUsd ?? 0, basis: "per-job" };

  const res = resolution ?? route.input?.defaults?.resolution;
  const rate = pricing.usdPerSecond?.[res];
  const seconds = Number(durationS ?? route.input?.defaults?.duration);
  if (rate == null || !Number.isFinite(seconds) || seconds <= 0) {
    return { usd: route.priceUsd ?? 0, basis: "per-job-fallback" };
  }
  return {
    usd: Math.round(rate * seconds * 10_000) / 10_000,
    basis: `${seconds}s × $${rate}/s at ${res}`,
  };
}

/** How `kie models` and `kie preflight` show a route's price. */
export function priceLabel(route) {
  const rates = route.pricing?.per === "second" ? Object.entries(route.pricing.usdPerSecond ?? {}) : [];
  if (!rates.length) return `$${route.priceUsd}`;
  return rates.map(([res, usd]) => `${res} $${usd}/s`).join(" ");
}
```

Then change the first two lines of `preflight`'s body and its signature:

```js
export async function preflight(
  catalog,
  route,
  { budgetUsd, quantity = 1, key, modelId, capability, durationS, resolution } = {},
) {
  const { usd, basis } = estimateUsd(route, { durationS, resolution });
  const estimatedUsd = usd * quantity;
  const cap = budgetUsd ?? catalog.defaultBudgetUsd?.[capability] ?? null;
```

and its final `return`:

```js
  return { estimatedUsd, basis, cap, creditsBefore: balance };
```

- [ ] **Step 4: Run the new tests, then everything**

Run: `node --test tests/pricing.test.mjs && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"`
Expected: pricing tests PASS; `pass 120`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add cli/lib/budget.mjs tests/pricing.test.mjs
git commit -m "Price per-second routes by duration and resolution"
```

---

### Task 2: Let an image-to-video model bring its own contract

kie's H3 image-to-video endpoint takes no `aspect_ratio` and has different required fields from text-to-video. Today the CLI swaps only the model id and reuses the text-to-video contract.

**Files:**
- Modify: `cli/lib/models.mjs`
- Create: `tests/contracts.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/contracts.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { effectiveRoute } from "../cli/lib/models.mjs";

describe("an image-to-video call uses the image-to-video contract", () => {
  const route = {
    model: "acme/t2v",
    i2vModel: "acme/i2v",
    input: { enums: { aspect_ratio: ["16:9"] }, required: ["prompt", "aspect_ratio"] },
    i2vInput: { required: ["prompt"] },
  };

  test("the i2v model brings its own captured input", () => {
    const call = effectiveRoute(route, true);
    assert.equal(call.model, "acme/i2v");
    assert.deepEqual(call.input, route.i2vInput);
  });

  test("with no captured i2v contract, the t2v contract carries over", () => {
    const { i2vInput, ...noI2vInput } = route;
    assert.deepEqual(effectiveRoute(noI2vInput, true).input, route.input);
  });

  test("no first frame, no switch", () => {
    assert.equal(effectiveRoute(route, false), route);
  });

  test("a route with no separate i2v model is called as it is", () => {
    const single = { model: "acme/one", input: {} };
    assert.equal(effectiveRoute(single, true), single);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test tests/contracts.test.mjs`
Expected: FAIL, `effectiveRoute` is not exported.

- [ ] **Step 3: Implement in `cli/lib/models.mjs`**

Add above `buildInput`:

```js
/**
 * The route as it will actually be called. Providers that split image-to-video
 * into its own model id often give it its own contract too -- kie's H3 i2v has
 * no aspect_ratio at all -- so the i2v model brings `i2vInput` when one was
 * captured, and falls back to the t2v contract when not.
 */
export function effectiveRoute(route, useI2v) {
  if (!useI2v || !route.i2vModel) return route;
  return { ...route, model: route.i2vModel, input: route.i2vInput ?? route.input };
}
```

- [ ] **Step 4: Use it in `generate` (`cli/kie.mjs`)**

Add `effectiveRoute` to the `./lib/models.mjs` import list on line 13. Then in `generate`, replace:

```js
    const effectiveRoute =
      values._useI2v && route.i2vModel ? { ...route, model: route.i2vModel } : route;
    const { _useI2v, ...inputValues } = values;
    const built = buildInput(effectiveRoute, inputValues);
```

with:

```js
    const callRoute = effectiveRoute(route, values._useI2v);
    const { _useI2v, ...inputValues } = values;
    const built = buildInput(callRoute, inputValues);
```

and further down in the same function:

```js
      const created = await createTask(route.prov, route.family, effectiveRoute.model, built.input, { key });
```

with:

```js
      const created = await createTask(route.prov, route.family, callRoute.model, built.input, { key });
```

Also replace the `preflight(...)` call in `generate` so that it prices what is actually sent:

```js
    const { estimatedUsd, cap, creditsBefore } = await preflight(catalog, callRoute, {
      budgetUsd: num(args.budget),
      key,
      modelId: model.id,
      capability,
      durationS: built.input.duration,
      resolution: built.input.resolution,
    });
```

- [ ] **Step 5: Verify no stale name remains, then run everything**

Run: `grep -n "effectiveRoute\.\|effectiveRoute =" cli/kie.mjs; node --test tests/contracts.test.mjs && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: grep prints nothing; `pass 124`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add cli/lib/models.mjs cli/kie.mjs tests/contracts.test.mjs
git commit -m "Call image-to-video models with their own captured contract"
```

---

### Task 3: Refuse reference combinations a model documents as impossible

Seedance 2.5 on kie runs frame-to-video or reference-to-video, never both, and `last_frame_url` cannot be sent without `first_frame_url`. Today the CLI would post that combination and pay a round trip for the rejection, or worse, have one input silently ignored.

**Files:**
- Modify: `cli/lib/models.mjs` (`buildInput`)
- Modify: `tests/contracts.test.mjs`

- [ ] **Step 1: Append the failing tests to `tests/contracts.test.mjs`**

Add `buildInput` to that file's import from `../cli/lib/models.mjs`, then append:

```js
describe("reference rules a model documents are enforced locally", () => {
  const route = {
    model: "acme/v",
    input: {
      refFields: {
        first_frame: "first_frame_url",
        last_frame: "last_frame_url",
        identity: "reference_image_urls",
      },
      refRules: {
        exclusiveGroups: [["first_frame", "last_frame"], ["identity"]],
        requires: { last_frame: "first_frame" },
        note: "Frame mode and reference mode are separate.",
      },
    },
  };
  const ref = (role, n = 1) => ({ url: `https://a.test/${role}${n}.png`, role });

  test("a first frame plus reference images is refused, naming both", () => {
    const { problems } = buildInput(route, { prompt: "x", refs: [ref("first_frame"), ref("identity")] });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /cannot combine first_frame with identity/);
    assert.match(problems[0], /Frame mode and reference mode are separate/);
  });

  test("first and last frame together are one mode, so they pass", () => {
    const { problems } = buildInput(route, { prompt: "x", refs: [ref("first_frame"), ref("last_frame")] });
    assert.deepEqual(problems, []);
  });

  test("a last frame on its own is refused", () => {
    const { problems } = buildInput(route, { prompt: "x", refs: [ref("last_frame")] });
    assert.match(problems[0], /"last_frame" needs a "first_frame"/);
  });

  test("several identity images are still one mode", () => {
    const { problems, input } = buildInput(route, { prompt: "x", refs: [ref("identity", 1), ref("identity", 2)] });
    assert.deepEqual(problems, []);
    assert.equal(input.reference_image_urls.length, 2);
  });

  test("a route without rules is unaffected", () => {
    const plain = { model: "acme/p", input: { refFields: route.input.refFields } };
    assert.deepEqual(buildInput(plain, { prompt: "x", refs: [ref("first_frame"), ref("identity")] }).problems, []);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/contracts.test.mjs`
Expected: the first and third new tests FAIL (no problems reported); the others pass.

- [ ] **Step 3: Implement**

In `buildInput` in `cli/lib/models.mjs`, directly before the final `return { input: out, unverified: false, problems };`, add:

```js
  // Combinations the provider documents as impossible are refused here, free,
  // rather than posted for a paid round trip or a silently ignored input.
  const roles = new Set((values.refs ?? []).map((r) => r.role));
  const rules = schema.refRules ?? {};
  const groupsUsed = (rules.exclusiveGroups ?? [])
    .map((group) => group.filter((role) => roles.has(role)))
    .filter((used) => used.length);
  if (groupsUsed.length > 1) {
    problems.push(
      `${route.model} cannot combine ${groupsUsed.map((g) => g.join("+")).join(" with ")} in one job.` +
        (rules.note ? ` ${rules.note}` : ""),
    );
  }
  for (const [role, needs] of Object.entries(rules.requires ?? {})) {
    if (roles.has(role) && !roles.has(needs)) {
      problems.push(`${route.model}: "${role}" needs a "${needs}" reference too.`);
    }
  }
```

- [ ] **Step 4: Run everything**

Run: `node --test tests/contracts.test.mjs && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `pass 129`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add cli/lib/models.mjs tests/contracts.test.mjs
git commit -m "Refuse reference combinations a route documents as impossible"
```

---

### Task 4: `--param key=value`, checked against the route's contract

Provider fields such as Seedance 2.5's `generate_audio` have no flag of their own. A passthrough lets a newly captured field be used without a CLI release. Only fields declared under the route's `input.params` pass, so it can never override `prompt`, references or anything else the CLI owns.

**Files:**
- Modify: `cli/lib/models.mjs` (`parseParams`, `buildInput`)
- Modify: `cli/kie.mjs` (flag, help, `cmdVideo`, `cmdImage`)
- Modify: `tests/contracts.test.mjs`

- [ ] **Step 1: Append the failing tests**

Add `parseParams` to the import in `tests/contracts.test.mjs`, plus `import { EXIT } from "../cli/lib/errors.mjs";`, then append:

```js
describe("--param values are read as the types providers expect", () => {
  test("booleans and numbers parse; anything else stays a string", () => {
    assert.deepEqual(parseParams(["generate_audio=false", "seed=42", "output_format=mov"]), {
      generate_audio: false,
      seed: 42,
      output_format: "mov",
    });
  });

  test("a value may itself contain '='", () => {
    assert.deepEqual(parseParams(["note=a=b"]), { note: "a=b" });
  });

  test("a spec without '=' is a usage error", () => {
    assert.throws(() => parseParams(["generate_audio"]), { code: EXIT.USAGE });
  });

  test("no params is an empty object", () => {
    assert.deepEqual(parseParams(undefined), {});
  });
});

describe("params pass only where the route's contract declares them", () => {
  const route = {
    model: "acme/v",
    input: {
      params: {
        generate_audio: { type: "boolean" },
        output_format: { type: "string", enum: ["mp4", "mov"] },
      },
    },
  };

  test("a declared field passes through with its value", () => {
    const { input, problems } = buildInput(route, { prompt: "x", params: { generate_audio: false } });
    assert.deepEqual(problems, []);
    assert.strictEqual(input.generate_audio, false);
  });

  test("an undeclared field is refused, listing what is allowed", () => {
    const { problems } = buildInput(route, { prompt: "x", params: { first_frame_url: "https://evil.test" } });
    assert.match(problems[0], /no passthrough field "first_frame_url". Allowed: generate_audio, output_format/);
  });

  test("a wrong type is refused", () => {
    const { problems } = buildInput(route, { prompt: "x", params: { generate_audio: "no" } });
    assert.match(problems[0], /generate_audio must be a boolean/);
  });

  test("a value outside the enum is refused", () => {
    const { problems } = buildInput(route, { prompt: "x", params: { output_format: "avi" } });
    assert.match(problems[0], /output_format="avi" is not allowed. Allowed: mp4, mov/);
  });

  test("a route with no captured contract refuses params rather than guessing", () => {
    const { problems, input } = buildInput({ model: "acme/guess" }, { prompt: "x", params: { generate_audio: false } });
    assert.match(problems[0], /cannot be checked/);
    assert.ok(!("params" in input) && !("generate_audio" in input));
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/contracts.test.mjs`
Expected: FAIL, `parseParams` is not exported.

- [ ] **Step 3: Implement `parseParams` in `cli/lib/models.mjs`**

Add after `parseRef`:

```js
/**
 * `--param key=value` → { key: value }. A value that parses as JSON is used as
 * that type, so `generate_audio=false` reaches the provider as the boolean it
 * expects rather than the string "false". Anything else stays a string.
 */
export function parseParams(list = []) {
  const out = {};
  for (const spec of list ?? []) {
    const idx = spec.indexOf("=");
    if (idx <= 0) throw usage(`--param must be "key=value", got "${spec}".`);
    const raw = spec.slice(idx + 1);
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
    out[spec.slice(0, idx).trim()] = value;
  }
  return out;
}
```

- [ ] **Step 4: Teach `buildInput` about `params`**

In the no-contract branch at the top of `buildInput`, replace:

```js
    const { refs, ...rest } = values;
    return {
      input: Object.fromEntries(Object.entries(rest).filter(([, v]) => v != null)),
      unverified: true,
      problems: refs?.length
        ? [
            `No captured contract for this route, so reference roles ` +
              `(${refs.map((r) => r.role).join(", ")}) cannot be mapped to its input fields. ` +
              `Use a route whose schema is verified, or capture this one's doc page.`,
          ]
        : [],
    };
```

with:

```js
    const { refs, params, ...rest } = values;
    const problems = [];
    if (refs?.length) {
      problems.push(
        `No captured contract for this route, so reference roles ` +
          `(${refs.map((r) => r.role).join(", ")}) cannot be mapped to its input fields. ` +
          `Use a route whose schema is verified, or capture this one's doc page.`,
      );
    }
    if (params && Object.keys(params).length) {
      problems.push(
        `No captured contract for this route, so --param ${Object.keys(params).join(", ")} ` +
          `cannot be checked. Capture its doc page into models.json first.`,
      );
    }
    return {
      input: Object.fromEntries(Object.entries(rest).filter(([, v]) => v != null)),
      unverified: true,
      problems,
    };
```

In the value-copying loop below it, skip `params` the way `refs` is skipped:

```js
  for (const [key, v] of Object.entries(values)) {
    if (v == null) continue;
    if (key === "refs" || key === "params") continue;
    out[key] = coerce(key, v);
  }
```

Then, directly after that loop, add:

```js
  // Passthrough fields: only what the route's contract declares, with its type.
  // Undeclared keys are refused, so a param can never override the prompt, a
  // reference field or anything else the CLI builds itself.
  const declared = schema.params ?? {};
  for (const [key, v] of Object.entries(values.params ?? {})) {
    const spec = declared[key];
    if (!spec) {
      problems.push(
        `${route.model} has no passthrough field "${key}". Allowed: ${Object.keys(declared).join(", ") || "none"}.`,
      );
      continue;
    }
    const typeOk =
      spec.type === "boolean" ? typeof v === "boolean"
        : spec.type === "integer" ? Number.isInteger(v)
          : spec.type === "string" ? typeof v === "string"
            : true;
    if (!typeOk) {
      problems.push(`${route.model}: ${key} must be a ${spec.type}, got ${JSON.stringify(v)}.`);
      continue;
    }
    if (spec.enum && !spec.enum.includes(v)) {
      problems.push(`${route.model}: ${key}="${v}" is not allowed. Allowed: ${spec.enum.join(", ")}.`);
      continue;
    }
    out[key] = v;
  }
```

- [ ] **Step 5: Run the contract tests**

Run: `node --test tests/contracts.test.mjs`
Expected: PASS.

- [ ] **Step 6: Wire the flag into `cli/kie.mjs`**

Add `parseParams` to the `./lib/models.mjs` import. In `OPTS`, after the `ref` line, add:

```js
  param: { type: "string", multiple: true, default: [] },
```

In `HELP`, change the `kie video` and `kie image` usage lines to:

```
  kie video      --run SLUG (--prompt-file F | --preset P) [--model M]
                 [--duration N] [--ar R] [--resolution R] [--ref URL:ROLE]...
                 [--param KEY=VALUE]... [--budget U]
                 [--provider kie|wavespeed] [--no-wait] [--dry-run]
  kie image      --run SLUG --prompt "..." [--model M] [--resolution R]
                 [--quality Q] [--ar R] [--ref URL:ROLE]... [--background B]
                 [--param KEY=VALUE]... [--budget U] [--dry-run]
```

In `cmdVideo`, after `const refs = (args.ref ?? []).map(parseRef);` add:

```js
  const params = parseParams(args.param);
```

add `params,` to the object written to `inputs.json` (after `refs,`), and add `params,` to the `values` passed to `generate` (after `refs,`).

In `cmdImage`, after its `const refs = ...` line add the same `const params = parseParams(args.param);`, replace:

```js
  if (refs.length) await writeRecord(dir, "image-inputs.json", { model: model.id, refs, background: args.background ?? null });
```

with:

```js
  if (refs.length || Object.keys(params).length) {
    await writeRecord(dir, "image-inputs.json", { model: model.id, refs, params, background: args.background ?? null });
  }
```

and add `params,` to its `values` after `refs,`.

- [ ] **Step 7: Check the flag end to end without spending**

Run: `node cli/kie.mjs video --run plan1-check --model seedance-2-fast --prompt-file README.md --duration 4 --param bogus=1 --dry-run; echo "exit $?"`
Expected: `refused before submitting`, the line `has no passthrough field "bogus". Allowed: none.`, and `exit 3`. Then `rm -r runs/plan1-check`.

- [ ] **Step 8: Run everything**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `pass 138`, `fail 0`.

- [ ] **Step 9: Commit**

```bash
git add cli/lib/models.mjs cli/kie.mjs tests/contracts.test.mjs
git commit -m "Add --param, passing only fields a route's contract declares"
```

---

### Task 5: Rewrite the H3 and Seedance 2.5 entries from the live docs

Sources, read 2026-10-30:

- `https://docs.kie.ai/market/minimax-h3/text-to-video.md`, `.../image-to-video.md`
- `https://docs.kie.ai/market/bytedance/seedance-2-5.md`, `.../seedance-2-5-draft.md`
- kie.ai/hailuo-h3 and kie.ai/seedance-2-5 for prices
- wavespeed.ai/models/bytedance/seedance-2.5/text-to-video for WaveSpeed's rate

Summary in [the catalog research note](../../research/2026-10-30-catalog-and-prices.md).

**Files:**
- Modify: `cli/models.json` (entries `minimax-h3`, `seedance-2-5`)
- Create: `tests/catalog-2026-10-30.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/catalog-2026-10-30.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { loadCatalog, buildInput, effectiveRoute } from "../cli/lib/models.mjs";
import { estimateUsd } from "../cli/lib/budget.mjs";

const catalog = loadCatalog();
const frame = (role) => ({ url: `https://a.test/${role}.png`, role });

describe("MiniMax H3 is called on kie with its documented contract", () => {
  const h3 = catalog.models["minimax-h3"];
  const kie = h3.routes[0];

  test("kie is primary, with the real model ids", () => {
    assert.equal(kie.provider, "kie");
    assert.equal(kie.model, "minimax-h3/text-to-video");
    assert.equal(kie.i2vModel, "minimax-h3/image-to-video");
  });

  test("image-to-video sends no aspect_ratio and defaults to 768P, not the doc's 2K", () => {
    const { input, problems } = buildInput(effectiveRoute(kie, true), {
      prompt: "x",
      duration: 4,
      aspect_ratio: "16:9",
      refs: [frame("first_frame")],
    });
    assert.deepEqual(problems, []);
    assert.ok(!("aspect_ratio" in input));
    assert.equal(input.resolution, "768P");
    assert.equal(input.first_frame_url, "https://a.test/first_frame.png");
  });

  test("text-to-video requires an aspect ratio and refuses 3s", () => {
    assert.deepEqual(buildInput(kie, { prompt: "x", duration: 6, aspect_ratio: "9:16" }).problems, []);
    assert.match(buildInput(kie, { prompt: "x", duration: 3 }).problems[0], /outside its 4-15s range/);
  });

  test("4s at 768P is priced at 8 credits a second", () => {
    assert.equal(estimateUsd(kie, { durationS: 4, resolution: "768P" }).usd, 0.16);
  });

  test("audio is declared native, because it cannot be switched off", () => {
    assert.equal(h3.nativeAudio, true);
    assert.ok(!kie.input.params?.generate_audio);
  });
});

describe("Seedance 2.5 on kie matches its documented contract", () => {
  const s = catalog.models["seedance-2-5"];
  const kie = s.routes[0];
  const ws = s.routes.find((r) => r.provider === "wavespeed");

  test("kie is primary and cheaper than WaveSpeed at every listed resolution", () => {
    assert.equal(kie.provider, "kie");
    for (const res of ["480p", "720p", "1080p"]) {
      assert.ok(kie.pricing.usdPerSecond[res] < ws.pricing.usdPerSecond[res], res);
    }
  });

  test("audio can be switched off, and a 30s job is in range", () => {
    const { input, problems } = buildInput(kie, {
      prompt: "x",
      duration: 30,
      params: { generate_audio: false, return_last_frame: true },
    });
    assert.deepEqual(problems, []);
    assert.strictEqual(input.generate_audio, false);
    assert.strictEqual(input.return_last_frame, true);
  });

  test("a first frame with reference images is refused before submitting", () => {
    const { problems } = buildInput(kie, { prompt: "x", duration: 5, refs: [frame("first_frame"), frame("identity")] });
    assert.match(problems[0], /cannot combine first_frame with identity/);
  });

  test("a 4s 480p draft costs 28 credits a second, not the 15s price", () => {
    assert.equal(estimateUsd(kie, { durationS: 4, resolution: "480p" }).usd, 0.56);
  });

  test("the draft finalize model is recorded for later use", () => {
    assert.equal(kie.draftFinalize.model, "bytedance/seedance-2-5-draft");
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/catalog-2026-10-30.test.mjs`
Expected: FAIL. kie is not primary for either model, the H3 model ids are the old guesses, and there is no `pricing`.

- [ ] **Step 3: Replace the `minimax-h3` entry in `cli/models.json`**

Replace the whole `"minimax-h3": { ... }` value with the JSON below. Keep the existing WaveSpeed route object exactly as it is, except for the added `priceNote`. Its current content is shown in full here so the result is unambiguous.

```json
"minimax-h3": {
  "capability": "video",
  "durationsS": [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  "aspectRatios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"],
  "nativeAudio": true,
  "refs": ["first_frame", "last_frame"],
  "notes": "Source model for kinetic-typography and editorial-collage; running those two here is a native route, not an adaptation. Cheapest capable motion in the table on kie (8 credits/s at 768P). Text renders legibly but letterforms wobble, so brand-exact copy is still `kie render`. Audio is always generated; strip it in finishing when the film is silent.",
  "routes": [
    {
      "provider": "kie",
      "family": "jobs",
      "model": "minimax-h3/text-to-video",
      "i2vModel": "minimax-h3/image-to-video",
      "priceUsd": 0.24,
      "pricing": {
        "per": "second",
        "usdPerSecond": { "768P": 0.04, "2K": 0.065 },
        "source": "kie.ai/hailuo-h3, read 2026-10-30: 8 and 13 credits/s. Input video is billed at the same rate; images after the fifth cost 4 credits each (not modelled here)."
      },
      "verified": false,
      "schemaVerified": true,
      "schemaSource": "docs.kie.ai/market/minimax-h3/text-to-video.md and image-to-video.md, read 2026-10-30",
      "input": {
        "required": ["prompt", "aspect_ratio", "duration", "resolution"],
        "defaults": { "aspect_ratio": "16:9", "duration": 6, "resolution": "768P" },
        "types": { "duration": "integer" },
        "enums": {
          "aspect_ratio": ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
          "resolution": ["768P", "2K"]
        },
        "durationRange": [4, 15],
        "refFields": {},
        "note": "The docs default to 2K (13 credits/s); this table defaults to 768P (8 credits/s). Audio cannot be turned off."
      },
      "i2vInput": {
        "required": ["prompt", "duration", "resolution"],
        "defaults": { "duration": 6, "resolution": "768P" },
        "types": { "duration": "integer" },
        "enums": { "resolution": ["768P", "2K"] },
        "durationRange": [4, 15],
        "refFields": { "first_frame": "first_frame_url", "last_frame": "last_frame_url" },
        "refRules": { "requires": { "last_frame": "first_frame" } },
        "note": "No aspect_ratio: the output follows the first frame. The provider also accepts a last frame alone; this table requires a first frame, because that is what switches the CLI to this model."
      }
    },
    {
      "provider": "wavespeed",
      "family": "v3",
      "model": "wavespeed-ai/minimax-h3/text-to-video",
      "i2vModel": "wavespeed-ai/minimax-h3/image-to-video",
      "priceUsd": 0.1,
      "priceNote": "Never measured: WaveSpeed exposes no balance. Search results (2026-10-30, not a direct read) put it at about $0.10 per SECOND, so a 5s job may cost ~$0.50. Treat 0.1 as a floor.",
      "verified": true,
      "schemaVerified": true,
      "input": {
        "required": ["prompt"],
        "defaults": { "aspect_ratio": "16:9", "resolution": "480p", "duration": 5 },
        "types": { "duration": "integer" },
        "enums": {
          "aspect_ratio": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"],
          "resolution": ["480p", "540p", "768p", "1080p"]
        },
        "durationRange": [3, 15],
        "refFields": { "first_frame": "image" }
      },
      "measuredNote": "VERIFIED twice: 3s/480p/16:9 in 24s wall (15.6s inference), and the full 5.7KB kinetic-typography source prompt at 10s in 84s. Both returned 832x480 @24fps WITH native audio, hot at -10 to -12 LUFS -- run kie assemble to normalise. Far faster than the kie route (24s vs 111s for a comparable job)."
    }
  ]
},
```

Before saving, diff the WaveSpeed object against the file's current one (`git diff cli/models.json`). The only intended change there is the new `priceNote`. If any other field differs from the current file, keep the current file's value.

- [ ] **Step 4: Replace the `seedance-2-5` entry**

```json
"seedance-2-5": {
  "capability": "video",
  "durationsS": [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
  "aspectRatios": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
  "nativeAudio": true,
  "refs": ["identity", "style", "first_frame", "last_frame"],
  "notes": "Newest Seedance; what Higgsfield's Cinema Studio 4.0 runs on. Billed per second on both routes and cheaper on kie. A first frame cannot be combined with reference images. Audio is on unless --param generate_audio=false. Draft mode (--param draft=true at 480p) previews cheaply; draftFinalize turns a draft into 1080p.",
  "routes": [
    {
      "provider": "kie",
      "family": "jobs",
      "model": "bytedance/seedance-2-5",
      "priceUsd": 4.73,
      "pricing": {
        "per": "second",
        "usdPerSecond": { "480p": 0.14, "720p": 0.315, "1080p": 0.79 },
        "source": "kie.ai/seedance-2-5, read 2026-10-24 and 2026-10-30: 28/63/158 credits/s without video input; reference images add nothing. With a reference video it is 17/38/95 credits/s billed on input plus output seconds (not modelled here)."
      },
      "priceNote": "priceUsd is only the fallback when duration or resolution is unknown: 15s at 720p (945 credits).",
      "verified": true,
      "measuredCredits": 945,
      "measuredNote": "15s/720p/16:9 with 6 reference_image_urls in ~248s (job b3c42935, 2026-10-24); returned 1280x720 @24fps with native audio even though the prompt asked for silence.",
      "schemaVerified": true,
      "schemaSource": "docs.kie.ai/market/bytedance/seedance-2-5.md, read 2026-10-30",
      "draftFinalize": {
        "model": "bytedance/seedance-2-5-draft",
        "requires": { "draft_task_id": "task id of a job submitted with draft=true; valid 7 days", "resolution": "1080p (the only value)" },
        "optional": ["output_format", "return_last_frame"],
        "note": "Price not captured and no command uses it yet. Source: docs.kie.ai/market/bytedance/seedance-2-5-draft.md, read 2026-10-30."
      },
      "input": {
        "required": ["prompt", "aspect_ratio", "duration", "resolution"],
        "defaults": { "aspect_ratio": "16:9", "duration": 5, "resolution": "720p" },
        "types": { "duration": "integer" },
        "enums": {
          "aspect_ratio": ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "adaptive"],
          "resolution": ["480p", "720p", "1080p"]
        },
        "durationRange": [4, 30],
        "refFields": {
          "first_frame": "first_frame_url",
          "last_frame": "last_frame_url",
          "identity": "reference_image_urls",
          "style": "reference_image_urls"
        },
        "refRules": {
          "exclusiveGroups": [["first_frame", "last_frame"], ["identity", "style"]],
          "requires": { "last_frame": "first_frame" },
          "note": "Frame-to-video and reference-to-video are separate modes; for strict frame matching use frames, not reference images."
        },
        "params": {
          "generate_audio": { "type": "boolean" },
          "return_last_frame": { "type": "boolean" },
          "draft": { "type": "boolean" },
          "output_format": { "type": "string", "enum": ["mp4", "mov"] }
        },
        "note": "Draft mode requires resolution 480p. Reference images: jpeg/png/webp, 300-6000 px per side, aspect 0.4-2.5, under 30 MB, at most 30."
      }
    },
    {
      "provider": "wavespeed",
      "family": "v3",
      "model": "bytedance/seedance-2.5/text-to-video",
      "i2vModel": "bytedance/seedance-2.5/image-to-video",
      "priceUsd": 1.8,
      "pricing": {
        "per": "second",
        "usdPerSecond": { "480p": 0.18, "720p": 0.36, "1080p": 0.9 },
        "source": "wavespeed.ai/models/bytedance/seedance-2.5/text-to-video, read 2026-10-30 (list price; the playground showed 10% off)."
      },
      "priceNote": "The earlier 0.81 was 480p for 5s at 10% off, not a per-job price. priceUsd is 5s at 720p.",
      "verified": false,
      "schemaVerified": false
    }
  ]
},
```

- [ ] **Step 5: Validate the JSON, then run the new tests**

Run: `node -e "JSON.parse(require('fs').readFileSync('cli/models.json','utf8'))" && node --test tests/catalog-2026-10-30.test.mjs`
Expected: no parse error; all PASS.

- [ ] **Step 6: Run everything**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `pass 148`, `fail 0`.

If an existing test fails because it assumed WaveSpeed was H3's primary route, read the test's intent. If it pins the route order, update the expectation to the new order. If it tests failover behaviour, keep the behaviour and only change which route it names.

- [ ] **Step 7: Check the user-facing listing**

Run: `node cli/kie.mjs models --capability video 2>/dev/null | sed -n '/minimax-h3$/,/^  [a-z]/p;/seedance-2-5$/,/^  [a-z]/p'`
Expected: both models list `→ kie.ai` first. Prices stay flat until Task 6 changes the display.

- [ ] **Step 8: Commit**

```bash
git add cli/models.json tests/catalog-2026-10-30.test.mjs
git commit -m "Capture the kie contracts and prices for H3 and Seedance 2.5"
```

---

### Task 6: Show real prices in `kie models` and `kie preflight`

**Files:**
- Modify: `cli/kie.mjs` (`cmdModels`, `cmdPreflight`)

- [ ] **Step 1: Import the helpers**

Change the budget import in `cli/kie.mjs` to:

```js
import { preflight, creditsAfter, estimateUsd, priceLabel } from "./lib/budget.mjs";
```

- [ ] **Step 2: `kie models` shows the billing unit**

In `cmdModels`, replace:

```js
        say(`    ${r.provider === m.routes[0].provider ? "→" : " "} ${r.prov.label.padEnd(10)} $${String(r.priceUsd).padEnd(7)} ${flags}`);
```

with:

```js
        say(`    ${r.provider === m.routes[0].provider ? "→" : " "} ${r.prov.label.padEnd(10)} ${priceLabel(r).padEnd(34)} ${flags}`);
```

- [ ] **Step 3: `kie preflight` prices the requested duration and resolution**

In `cmdPreflight`, replace the routes loop and the `affordable` line:

```js
  for (const r of routes) {
    const verdict = !r.usable
      ? `skipped — ${r.skipReason}`
      : (r.priceUsd ?? 0) > cap
        ? `WOULD REFUSE — over budget`
        : `ok`;
    say(`  ${r.prov.label.padEnd(10)} $${String(r.priceUsd).padEnd(7)} ${verdict}`);
  }
```

with:

```js
  const priced = routes.map((r) => ({
    ...r,
    estimate: estimateUsd(r, { durationS: num(args.duration), resolution: args.resolution }),
  }));
  for (const r of priced) {
    const verdict = !r.usable
      ? `skipped — ${r.skipReason}`
      : r.estimate.usd > cap
        ? `WOULD REFUSE — over budget`
        : `ok`;
    say(`  ${r.prov.label.padEnd(10)} $${r.estimate.usd.toFixed(2).padEnd(7)} ${verdict}  (${r.estimate.basis})`);
  }
```

and:

```js
  const affordable = routes.filter((r) => r.usable && (r.priceUsd ?? 0) <= cap);
```

with:

```js
  const affordable = priced.filter((r) => r.usable && r.estimate.usd <= cap);
```

Also change the `kie preflight` help line to:

```
  kie preflight  --model M [--duration N] [--resolution R] [--ar R] [--budget U]
```

- [ ] **Step 4: Check by hand (read-only, spends nothing)**

Run: `node cli/kie.mjs preflight --model seedance-2-5 --duration 4 --resolution 480p --budget 1`
Expected: `kie.ai  $0.56  ok  (4s × $0.14/s at 480p)` and an `OK to submit` line.

Run: `node cli/kie.mjs preflight --model seedance-2-5 --duration 30 --resolution 1080p --budget 5; echo "exit $?"`
Expected: `WOULD REFUSE — over budget` with `$23.70`, and `exit 2`.

- [ ] **Step 5: Run everything and commit**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `pass 148`, `fail 0`.

```bash
git add cli/kie.mjs
git commit -m "Show per-second prices in kie models and price preflight by duration"
```

---

### Task 7: `kie frames`, a contact sheet plus first and last frame

Review and shot chaining both need to look at a clip without playing it. The sheet is 8 frames sampled at the middle of 8 equal slices, 4×2, each 480px wide. `first.png` and `last.png` are full resolution; `last.png` is what the next shot's `first_frame` would be.

**Files:**
- Create: `cli/lib/frames.mjs`
- Create: `tests/frames.test.mjs`
- Modify: `cli/kie.mjs` (command, help)

- [ ] **Step 1: Write the failing tests**

Create `tests/frames.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EXIT } from "../cli/lib/errors.mjs";
import { frameTimes, extractFrames } from "../cli/lib/frames.mjs";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe("frames are sampled where they say they are", () => {
  test("the middle of each equal slice, never the very start or end", () => {
    assert.deepEqual(frameTimes(8, 8), [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]);
  });

  test("odd durations round to the millisecond", () => {
    assert.deepEqual(frameTimes(5, 3), [0.833, 2.5, 4.167]);
  });

  test("a zero-length file is refused", () => {
    assert.throws(() => frameTimes(0), { code: EXIT.USAGE });
  });
});

describe("extractFrames on a real clip", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  test("writes a 4×2 sheet of 480px tiles plus full-size first and last frames", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kie-frames-"));
    const clip = join(dir, "clip.mp4");
    const made = spawnSync("ffmpeg", [
      "-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=24",
      "-pix_fmt", "yuv420p", clip,
    ]);
    assert.equal(made.status, 0, String(made.stderr));

    const r = await extractFrames(clip);
    assert.equal(r.dir, join(dir, "clip-frames"));
    for (const p of [r.sheet, r.first, r.last]) assert.ok(existsSync(p), p);
    assert.equal(r.times.length, 8);

    const dims = (p) =>
      String(spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", p]).stdout).trim();
    assert.equal(dims(r.sheet), "1920,720", "4 tiles × 480 wide, 2 rows × 360 high");
    assert.equal(dims(r.first), "320,240", "first frame keeps the source size");
    assert.equal(dims(r.last), "320,240");
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/frames.test.mjs`
Expected: FAIL, cannot find module `../cli/lib/frames.mjs`.

- [ ] **Step 3: Implement `cli/lib/frames.mjs`**

```js
import { mkdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { ffmpeg, probe, requireFfmpeg } from "./ffmpeg.mjs";
import { usage } from "./errors.mjs";

const COUNT = 8;
const COLS = 4;
const TILE_WIDTH = 480;

/**
 * Sample times at the middle of n equal slices. Never t=0 or the final frame:
 * those are first.png and last.png, and a fade-in or fade-out would make the
 * sheet open or close on black.
 */
export function frameTimes(durationS, n = COUNT) {
  if (!(durationS > 0)) throw usage(`Cannot sample frames from a ${durationS}s file.`);
  return Array.from({ length: n }, (_, i) => Math.round((((i + 0.5) * durationS) / n) * 1000) / 1000);
}

/**
 * A contact sheet (8 frames, 4×2, 480px tiles) plus full-size first and last
 * frames. The sheet is for looking at a clip without playing it; last.png is
 * what the next shot's first_frame would be when shots must join.
 */
export async function extractFrames(videoPath, { outDir } = {}) {
  requireFfmpeg();
  const info = await probe(videoPath);
  const times = frameTimes(info.durationS);
  const dir = outDir ?? join(dirname(videoPath), `${basename(videoPath, extname(videoPath))}-frames`);
  mkdirSync(dir, { recursive: true });

  const tiles = [];
  for (const [i, t] of times.entries()) {
    const tile = join(dir, `t${String(i + 1).padStart(2, "0")}.png`);
    await ffmpeg(["-ss", String(t), "-i", videoPath, "-frames:v", "1", "-vf", `scale=${TILE_WIDTH}:-2`, tile]);
    tiles.push(tile);
  }

  const sheet = join(dir, "sheet.jpg");
  await ffmpeg([
    "-framerate", "1", "-i", join(dir, "t%02d.png"),
    "-vf", `tile=${COLS}x${COUNT / COLS}`, "-frames:v", "1", "-q:v", "3", sheet,
  ]);

  const first = join(dir, "first.png");
  await ffmpeg(["-i", videoPath, "-frames:v", "1", first]);

  // -update keeps overwriting one image, so what remains is the true last frame.
  const last = join(dir, "last.png");
  await ffmpeg(["-sseof", "-0.5", "-i", videoPath, "-update", "1", last]);

  return { dir, sheet, first, last, tiles, times, durationS: info.durationS };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/frames.test.mjs`
Expected: PASS (3 pure tests plus 1 integration test, or the integration test reported as skipped without ffmpeg).

- [ ] **Step 5: Add the command**

In `cli/kie.mjs`, import it next to the other finishing imports:

```js
import { extractFrames } from "./lib/frames.mjs";
```

Change the path import to:

```js
import { basename, dirname, join, resolve } from "node:path";
```

Add after `cmdProbe`:

```js
async function cmdFrames(args, positionals) {
  if (!positionals[0]) throw usage("kie frames <video> [--run SLUG] [--out-dir DIR]");
  const video = args.run ? inPath(runDir(args.run), positionals[0]) : resolve(positionals[0]);
  const r = await extractFrames(video, { outDir: args["out-dir"] ? resolve(args["out-dir"]) : undefined });
  say(r.sheet);
  say(`  first  ${r.first}`);
  say(`  last   ${r.last}`);
  say(`  ${r.tiles.length} frames at ${r.times.map((t) => t.toFixed(2)).join(", ")}s of ${r.durationS.toFixed(2)}s`);
  return EXIT.OK;
}
```

In `main`'s switch, after `case "probe":`:

```js
    case "frames":
      return cmdFrames(args, positionals);
```

In `HELP`, under the finishing section after the `kie probe` line:

```
  kie frames     <video> [--run SLUG] [--out-dir DIR]   contact sheet + first/last frame
```

- [ ] **Step 6: Try it on a real past take (free)**

Run: `node cli/kie.mjs frames out.mp4 --run zethus-hero-loop`
Expected: prints `.../runs/zethus-hero-loop/out-frames/sheet.jpg` plus the first and last paths, and `8 frames at 0.93, 2.78, ...s of 14.8...s`. Open `sheet.jpg` and check it shows the five app screens in order.

- [ ] **Step 7: Run everything and commit**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `pass 152`, `fail 0`.

```bash
git add cli/lib/frames.mjs cli/kie.mjs tests/frames.test.mjs
git commit -m "Add kie frames: contact sheet plus first and last frame"
```

---

### Task 8: Document what changed

**Files:**
- Modify: `cli/README.md`
- Modify: `skills/motion-design/references/tool-routing.md`

- [ ] **Step 1: `cli/README.md`.** After the "Per-route contracts" bullet list, add:

```markdown
### Prices follow the provider's billing unit

A route with `pricing: { per: "second", usdPerSecond: { <resolution>: <usd> } }`
is estimated as duration × the rate for the requested resolution, which is how
Seedance 2.5 and H3 bill on kie. `priceUsd` stays as the fallback when the
duration or resolution is unknown. `kie preflight --duration N --resolution R`
shows the estimate and how it was worked out.

### Passing a provider field the CLI has no flag for

`--param key=value` (repeatable) sends a field such as Seedance 2.5's
`generate_audio=false`. Only fields declared under the route's `input.params`
pass, with their type and allowed values checked locally. Anything else is
refused with exit 3, so a param can never replace the prompt or a reference
field. A route with no captured contract refuses every param.

### Reference rules

`input.refRules` holds what the provider documents as impossible:
`exclusiveGroups` (roles from different groups cannot share a job, e.g. Seedance
2.5's first frame with reference images) and `requires` (e.g. a last frame needs
a first frame). Violations are refused before anything is uploaded or spent.
An image-to-video model with its own contract carries it as `i2vInput`.
```

- [ ] **Step 2: `tool-routing.md`.** In the task table, add after the "Read a file's real duration, size and loudness" row:

```markdown
| See a clip without playing it; get its last frame for the next shot | `kie frames <video> --run SLUG` |
```

and after the "Check cost and settings without spending" row, change that row to:

```markdown
| Check cost and settings without spending | `kie preflight --model M --duration N --resolution R --ar R` |
```

Then add one sentence to the end of the "Never state a capability from memory" section:

```markdown
Provider fields without a flag of their own (Seedance 2.5's `generate_audio`, for a silent film) go through `--param key=value`; `kie models --json` shows which fields each route declares.
```

- [ ] **Step 3: Validate the skill package still passes upstream's checks**

Run: `npm run validate 2>&1 | tail -3 && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: the validator reports success; `pass 152`, `fail 0`.

- [ ] **Step 4: Commit**

```bash
git add cli/README.md skills/motion-design/references/tool-routing.md
git commit -m "Document per-second pricing, --param, reference rules and kie frames"
```

---

## Done when

- `npm test` passes, with 42 new tests on top of the 110.
- `kie preflight --model seedance-2-5 --duration 4 --resolution 480p` estimates $0.56.
- `kie video ... --model minimax-h3 --ref <url>:first_frame --dry-run` shows `minimax-h3/image-to-video` with no `aspect_ratio` and `resolution: "768P"`.
- `kie frames` produces a sheet from a real past take.
- Nothing was spent. The first paid job on the new H3 route is plan 4's live acceptance run, which flips `verified` once it succeeds.
