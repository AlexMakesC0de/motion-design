# Shard look and Library sheets: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the studio its new look (Shard, neon green, two fonts, a readable type scale) and turn the Library into a place to make character, location and prop sheets through ChatGPT.

**Architecture:**
- **Phase 1, the look:** a token change in `web/src/theme/tokens.css`, guarded by a test that no font size is under 12px. Then the name and an SVG logo in the rail and the tab.
- **Phase 2, the Library:**
  - `cli/core/assets.mjs`: images get a `role` (sheet or source), and records get a `keep` text and an `update()` for text fields.
  - A new `cli/core/sheets.mjs` writes the ChatGPT prompt.
  - `web/server/api/library.mjs` gains three routes.
  - The Library screen is rebuilt around a new `SheetMaker` panel.

**Tech Stack:**
- Node 22 ESM; `node:test` for core (`npm test`) and server (`npm --prefix web run test:server`).
- React 19, Vite and Vitest with Testing Library for the page (`npm --prefix web run test:page`).

**Spec:** [docs/superpowers/specs/2026-11-01-shard-scenes-design.md](../specs/2026-11-01-shard-scenes-design.md), sections "Look" and "Library". Phases 3–5 get their own plans.

**Repo rules for every task:**
- Stage explicit paths only, and run `git diff --cached --stat` before each commit.
- Never stage `.gstack/`, `web/tsconfig.tsbuildinfo`, `transcript` or `.superpowers/`.
- Never use `git stash`.
- Never write the shell-running call from `node:child_process` that takes one command string; a security hook refuses it.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do not push.

---

## File structure

| File | Responsibility |
|---|---|
| `web/src/theme/tokens.css` | Colour and type tokens (modify) |
| `web/src/theme/type.test.ts` | Guard: no font size under 12px anywhere in `web/src` CSS (create) |
| `web/src/theme/controls.css` | Comment wording only (modify) |
| `web/public/logo.svg` | The Shard mark, used as favicon (create) |
| `web/src/app/Logo.tsx` | The mark as a React component for the rail (create) |
| `web/src/app/Rail.tsx`, `Rail.test.tsx`, `App.test.tsx`, `App.tsx`, `App.css` | Name and logo in the rail (modify) |
| `web/src/api/client.ts`, `web/server/main.mjs`, `web/index.html` | Name in messages and the tab (modify) |
| `cli/core/assets.mjs` | Image roles, `keep`, `update()`, `sheetOf()` (modify) |
| `tests/assets.test.mjs` | Core tests for the above (modify) |
| `cli/core/sheets.mjs` | `sheetPrompt()`: Dan's templates (create) |
| `tests/sheets.test.mjs` | Tests for `sheetPrompt` (create) |
| `web/server/http.mjs` | A `patch` method on the router (modify) |
| `web/server/api/library.mjs` | Images with roles, `keep`, PATCH, sheet upload, sheet prompt (modify) |
| `web/tests/library.test.mjs` | Server tests for the above (modify) |
| `web/src/api/types.ts` | `AssetSummary.hasSheet`, `AssetDetail.keep`, image `role` (modify) |
| `web/src/library/kinds.ts` | Kind labels: product shows as "Prop" (create) |
| `web/src/library/SheetMaker.tsx` | The sheet maker panel: new item and edit (create) |
| `web/src/library/SheetMaker.test.tsx` | Page tests for the panel (create) |
| `web/src/library/LibraryScreen.tsx`, `LibraryScreen.test.tsx`, `library.css` | Grid, tabs and the panel (rewrite) |
| `DESIGN.md` | Updated tokens and rules (modify) |

---

# Phase 1: the look

### Task 1: Tokens, type scale and a 12px floor

**Files:**
- Create: `web/src/theme/type.test.ts`
- Modify: `web/src/theme/tokens.css`, `web/src/theme/controls.css`

- [ ] **Step 1: Write the failing guard test**

`web/src/theme/type.test.ts`:

```ts
// Guard for the type scale: nothing on screen is set below 12px, and the
// accent is Shard's neon green. Reads the CSS files as text.
import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return cssFiles(p);
    return p.endsWith(".css") ? [p] : [];
  });
}

const tokens = readFileSync(join(SRC, "theme", "tokens.css"), "utf8");
const token = (name: string) => tokens.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();

describe("type scale", () => {
  test("every text size token is 12px or more", () => {
    const sizes = [...tokens.matchAll(/--text-[a-z]+:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(4);
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(12);
  });

  test("no CSS file sets a literal font size under 12px", () => {
    const offenders = cssFiles(SRC).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/font(?:-size)?:[^;]*?\b(\d+(?:\.\d+)?)px/g)]
        .filter((m) => Number(m[1]) < 12)
        .map((m) => `${file}: ${m[0]}`),
    );
    expect(offenders).toEqual([]);
  });

  test("the scale has Shard's steps", () => {
    expect([token("text-xs"), token("text-sm"), token("text-md"), token("text-title"), token("text-lg"), token("text-xl")]).toEqual([
      "12px",
      "13px",
      "14px",
      "15px",
      "16px",
      "22px",
    ]);
  });

  test("the accent is neon green and done is no longer a green", () => {
    expect(token("accent")).toBe("#84f80a");
    expect(token("accent-ink")).toBe("#0b1400");
    expect(token("ok")).toBe("var(--text)");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm --prefix web run test:page -- src/theme/type.test.ts`

Expected: FAIL. "the scale has Shard's steps" and "the accent is neon green" fail; `--text-xs` is `11px` and the accent is `#e8a33d`.

- [ ] **Step 3: Change the tokens**

In `web/src/theme/tokens.css`, replace the colour lines from `--accent` to `--selection`, and the five `--text-*` lines, with:

```css
  --accent: #84f80a; /* Shard's neon green: money and the one main button per screen, nothing else */
  --accent-ink: #0b1400;
  --ok: var(--text); /* done is a check mark in bright text, never a green that could read as the accent */
  --warn: #ef8a47;
  --bad: #e2725b;
  --bad-surface: #2b1a14;
  --bad-ink: #f3c8b8;
  --selection: rgb(132 248 10 / 0.28);
```

```css
  /* Type scale. Nothing on screen is smaller than --text-xs. */
  --text-xs: 12px; /* section labels (uppercase) */
  --text-sm: 13px; /* fine print: hints, times, kinds, data */
  --text-md: 14px; /* interface: buttons, menus, inputs */
  --text-title: 15px; /* card headings */
  --text-lg: 16px; /* prompt text and anything read at length */
  --text-xl: 22px; /* page and scene titles */
```

Change the top comment of the file to:

```css
/* Shard. A dark projection room; the footage is the brightest thing on screen, the neon green is for money and the main button. */
```

- [ ] **Step 4: Fix the comments that still say amber**

In `web/src/theme/controls.css`, replace the comment line above `.generate` with:

```css
/* The neon green primary button: one per screen, with its price inside when it spends. */
```

Then run `grep -rn "amber" web/src`. Any comment that calls the accent "amber" now says "green". Code is untouched.

- [ ] **Step 5: Run the page tests**

Run: `npm --prefix web run test:page`

Expected: PASS, including `src/theme/type.test.ts`. If the "no literal font size" test names a file, change that rule to use a token (`var(--text-xs)` or larger) and run again.

- [ ] **Step 6: Commit**

```bash
git add web/src/theme/type.test.ts web/src/theme/tokens.css web/src/theme/controls.css
# plus any CSS file changed in step 4 or 5, by explicit path
git diff --cached --stat
git commit -m "shard: neon green accent, 12px floor and a readable type scale

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: The name Shard and the logo

The PNG Alex made (`Neon Lime Play Logo.png`) is in `~/Downloads`, which agents cannot read. This task draws the mark as SVG from the mockup: a rounded play triangle with a smaller shard split off below it. When Alex copies the PNG into `web/public/logo.png`, a later touch-up can trace it more exactly. Nothing here depends on that.

**Files:**
- Create: `web/public/logo.svg`, `web/src/app/Logo.tsx`
- Modify: `web/src/app/Rail.tsx`, `web/src/app/Rail.test.tsx`, `web/src/app/App.test.tsx`, `web/src/app/App.tsx:76`, `web/src/app/App.css:8`, `web/src/api/client.ts:68`, `web/server/main.mjs:76`, `web/index.html`

- [ ] **Step 1: Make the tests ask for the new name**

In `web/src/app/Rail.test.tsx`:
- Change `{ name: "Studio" }` to `{ name: "Shard" }`.
- Add this test inside `describe("Rail", …)`:

```tsx
  test("the brand is Shard's logo and goes Home", () => {
    render(<Rail current="library" />);
    const brand = screen.getByRole("link", { name: "Shard home" });
    expect(brand).toHaveAttribute("href", "#/");
    expect(brand.querySelector("svg")).not.toBeNull();
  });
```

In `web/src/app/App.test.tsx`, change both `{ name: "Studio" }` to `{ name: "Shard" }`.

- [ ] **Step 2: Run them and watch them fail**

Run: `npm --prefix web run test:page -- src/app`

Expected: FAIL, with no navigation named "Shard" and no link "Shard home".

- [ ] **Step 3: Add the mark**

`web/public/logo.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M24 22 L74 46 L26 70 Z M44 74 L72 61 L62 86 Z" fill="#84f80a" stroke="#84f80a" stroke-width="9" stroke-linejoin="round"/></svg>
```

`web/src/app/Logo.tsx`:

```tsx
// web/src/app/Logo.tsx
// Shard's mark: a play triangle with a shard split off. Drawn from Alex's
// neon-lime logo; the same shape is web/public/logo.svg (the favicon).
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path d="M24 22 L74 46 L26 70 Z M44 74 L72 61 L62 86 Z" fill="var(--accent)" stroke="var(--accent)" strokeWidth="9" strokeLinejoin="round" />
    </svg>
  );
}
```

- [ ] **Step 4: Use it in the rail and rename**

In `web/src/app/Rail.tsx`:
- Add `import { Logo } from "./Logo";`.
- Change `aria-label="Studio"` to `aria-label="Shard"`.
- Replace the brand link with:

```tsx
      <a className="rail__brand" href="#/" aria-label="Shard home">
        <Logo />
      </a>
```

In `web/src/app/App.css`, replace line 8 (`.rail__brand { … }`) with:

```css
.rail__brand { display: flex; justify-content: center; padding: var(--space-2) 0 var(--space-3); text-decoration: none; }
```

In `web/index.html`:
- Change `<title>Studio</title>` to `<title>Shard</title>`.
- Add after the `color-scheme` meta:

```html
    <link rel="icon" type="image/svg+xml" href="/logo.svg" />
```

Change the user-facing name in messages:
- `web/src/app/App.tsx:76`: "Studio server isn't running." becomes "Shard's server isn't running."
- `web/src/api/client.ts:68`: "Studio server isn't running. Start it with: npm run studio" becomes "Shard's server isn't running. Start it with: npm run studio"
- `web/server/main.mjs:76`: `` `Studio running at ${url}  (Ctrl-C to stop)\n` `` becomes `` `Shard running at ${url}  (Ctrl-C to stop)\n` ``

The `npm run studio` script name, the `studio-key` meta and the `X-Studio-Key` header stay. They are internal names, and renaming them is out of scope.

- [ ] **Step 5: Run every web test and the build**

Run: `npm --prefix web test && npm --prefix web run build`

Expected: all pass, and the build writes `web/dist/logo.svg`. If a server test pins "Studio running", change it to "Shard running".

- [ ] **Step 6: Commit**

```bash
git add web/public/logo.svg web/src/app/Logo.tsx web/src/app/Rail.tsx web/src/app/Rail.test.tsx web/src/app/App.test.tsx web/src/app/App.tsx web/src/app/App.css web/src/api/client.ts web/server/main.mjs web/index.html
git diff --cached --stat
git commit -m "shard: the name and the logo in the rail and the tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: DESIGN.md

**Files:**
- Modify: `DESIGN.md`

- [ ] **Step 1: Update the frontmatter tokens**

In the YAML frontmatter:
- `name: Shard`
- `description: A dark projection room for one person making short AI films, with the engine left showing.`
- Under `colors`: `accent: "#84f80a"` and `accent-ink: "#0b1400"`. Remove `ok`.
- Under `typography`:
  - `display` becomes 22px.
  - Add `title-card` (IBM Plex Sans, 15px, 600).
  - `body-sm` becomes 13px.
  - `label` becomes 12px, 600, `letterSpacing: "0.07em"`, uppercase.
  - `data` becomes 13px.
  - Add `prompt` (IBM Plex Sans, 16px, 400, `lineHeight: 1.6`).

- [ ] **Step 2: Update the prose**

- Rename every "Projector Amber" or "amber" to "Neon Green" or "green". Its uses stay the same: the main button with its price, the spend meter and cost figures.
- Add a "Type" paragraph:
  - Two fonts, one job each: Plex Sans for everything read, Plex Mono for exact things (`@library:name`, `@imageN`, seconds, prices). No serif.
  - Nothing under 12px.
  - Three text steps: `text` is what you read and edit, `text-2` supports it, and `text-3` is labels, hints and times.
- Under states: done is a check mark in `text` colour, not a green.
- Link the spec: `See [Shard spec](docs/superpowers/specs/2026-11-01-shard-scenes-design.md#look).`

- [ ] **Step 3: Commit**

```bash
git add DESIGN.md
git diff --cached --stat
git commit -m "design: Shard tokens, two fonts, the 12px floor and green for money

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# Phase 2: Library sheets

### Task 4: Image roles, `keep` and `update()` in core

**Files:**
- Modify: `cli/core/assets.mjs`
- Test: `tests/assets.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/assets.test.mjs`. It already defines `lib`, `zed`, `zed1`, `zed2`, `img` and `png`. Add `writeFileSync` and `readFileSync` to its `node:fs` import if they are not there.

```js
import { IMAGE_ROLES, sheetOf } from "../cli/core/assets.mjs";

describe("sheets and source photos", () => {
  test("images given as paths are source photos; { path, role } sets the role", () => {
    const l = lib();
    const a = l.save({ ...zed, images: [{ path: zed1, role: "sheet" }, zed2] });
    assert.deepEqual(a.images.map((i) => i.role), ["sheet", "source"]);
    assert.equal(sheetOf(l.get("zed")).n, 1);
    assert.deepEqual(IMAGE_ROLES, ["sheet", "source"]);
  });

  test("an asset holds at most one sheet, and roles are checked", () => {
    const l = lib();
    assert.throws(() => l.save({ ...zed, images: [{ path: zed1, role: "sheet" }, { path: zed2, role: "sheet" }] }), /at most one sheet/);
    assert.throws(() => l.save({ ...zed, images: [{ path: zed1, role: "poster" }] }), /role must be sheet or source/);
  });

  test("records saved before roles read their images as source photos", () => {
    const l = lib();
    l.save(zed);
    const path = join(l.dir, "zed", "asset.json");
    const raw = JSON.parse(readFileSync(path, "utf8"));
    for (const im of raw.images) delete im.role;
    delete raw.keep;
    writeFileSync(path, JSON.stringify(raw));
    const a = l.get("zed");
    assert.deepEqual(a.images.map((i) => i.role), ["source", "source"]);
    assert.equal(a.keep, null);
    assert.equal(sheetOf(a), null);
    assert.equal(l.list()[0].hasSheet, false);
  });

  test("keep is saved trimmed, or null when empty", () => {
    const l = lib();
    assert.equal(l.save({ ...zed, keep: "  his one blue eye  " }).keep, "his one blue eye");
    assert.equal(l.save({ ...zed, keep: "", replace: true }).keep, null);
  });

  test("list says which assets have a sheet", () => {
    const l = lib();
    l.save({ ...zed, images: [{ path: zed1, role: "sheet" }] });
    assert.equal(l.list()[0].hasSheet, true);
  });

  test("update changes kind, description and keep without touching images", () => {
    const l = lib();
    l.save(zed);
    const before = l.get("zed").images.map((i) => i.sha256);
    const a = l.update("zed", { kind: "product", description: "A new line.", keep: "the dent" });
    assert.deepEqual([a.kind, a.description, a.keep], ["product", "A new line.", "the dent"]);
    assert.deepEqual(l.get("zed").images.map((i) => i.sha256), before);
    assert.throws(() => l.update("zed", { kind: "vibe" }), /kind must be one of/);
    assert.throws(() => l.update("zed", { description: " " }), /needs a description/);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/assets.test.mjs`

Expected: FAIL. `IMAGE_ROLES` and `sheetOf` are not exported, and `update` is not a function.

- [ ] **Step 3: Implement**

In `cli/core/assets.mjs`, add below `ASSET_NAME`:

```js
export const IMAGE_ROLES = ["sheet", "source"];
/** Images saved before roles existed are source photos. */
const roleOf = (im) => (im.role === "sheet" ? "sheet" : "source");
/** The asset's sheet image (the one scenes use), or null. */
export const sheetOf = (record) => record.images.find((im) => roleOf(im) === "sheet") ?? null;

function checkKind(kind) {
  if (!KINDS.includes(kind)) throw unknown(`kind must be one of ${KINDS.join(", ")}, got "${kind}".`);
}
function checkDescription(description) {
  if (!description?.trim()) throw unknown("An asset needs a description; it is reused word for word in prompts.");
}
const cleanKeep = (keep) => (typeof keep === "string" && keep.trim() ? keep.trim() : null);
```

In `list()`, change the mapped object to:

```js
        return { name: r.name, kind: r.kind, description: r.description, imageCount: r.images.length, hasSheet: r.images.some((im) => roleOf(im) === "sheet"), updatedAt: r.updatedAt };
```

In `get()`, change the return to:

```js
    return { ...r, keep: r.keep ?? null, images: r.images.map((im) => ({ ...im, role: roleOf(im), path: join(assetDir(name), im.file) })) };
```

Change `save` so that:
- its signature takes `keep`;
- it uses the two check helpers;
- it normalises `images` before reading them;
- it stores `role` and `keep`.

Replace from the `function save(` line through the end of the `const sources = images.map(…)` statement with:

```js
  function save({ name, kind, description, keep, images, replace = false }, { roots = null } = {}) {
    const target = assetDir(name);
    checkKind(kind);
    checkDescription(description);
    if (!Array.isArray(images) || images.length < 1 || images.length > 4) throw unknown("An asset holds 1 to 4 images.");
    const wanted = images.map((im) => (typeof im === "string" ? { path: im, role: "source" } : { path: im?.path, role: im?.role ?? "source" }));
    for (const w of wanted) if (!IMAGE_ROLES.includes(w.role)) throw unknown(`An image's role must be sheet or source, got "${w.role}".`);
    if (wanted.filter((w) => w.role === "sheet").length > 1) throw unknown("An asset has at most one sheet.");

    // Check and read every source before touching the library, so a bad
    // image leaves nothing half-written, and replacing an asset with one of
    // its own images still works after the old files move to .history.
    const sources = wanted.map(({ path, role }) => {
      const info = checkLocalFile(path, { roots, kinds: ["image"] });
      return { info, role, bytes: readFileSync(info.path) };
    });
```

In the `stored` map, destructure `role` (`sources.map(({ info, role, bytes }, i) => {`) and add `role,` after `n: i + 1,`. Change the final `write(…)` to:

```js
    return write({ name, kind, description: description.trim(), keep: cleanKeep(keep), images: stored, createdAt, updatedAt: at, usedIn });
```

Add this function after `save`:

```js
  /** Change an asset's kind, description or keep. Images are untouched. */
  function update(name, { kind, description, keep } = {}) {
    if (!existsSync(recordPath(name))) throw unknown(`No asset "${name}".`);
    const record = read(name);
    if (kind !== undefined) {
      checkKind(kind);
      record.kind = kind;
    }
    if (description !== undefined) {
      checkDescription(description);
      record.description = description.trim();
    }
    if (keep !== undefined) record.keep = cleanKeep(keep);
    record.updatedAt = now().toISOString();
    write(record);
    return get(name);
  }
```

Change the return line to `return { dir, list, get, save, update, uploadUrl, recordUse };`.

- [ ] **Step 4: Run the core tests**

Run: `npm test`

Expected: PASS. Old callers (`kie asset save`, MCP `save_asset`, `refs.mjs`) pass string paths, which become source photos. `refs.test.mjs` and the director tests still pass, because `expandRefs` reads `images` the same way.

- [ ] **Step 5: Commit**

```bash
git add cli/core/assets.mjs tests/assets.test.mjs
git diff --cached --stat
git commit -m "library: sheet and source images, a keep line, and update() for text fields

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: `sheetPrompt()`, Dan's templates

**Files:**
- Create: `cli/core/sheets.mjs`, `tests/sheets.test.mjs`

- [ ] **Step 1: Write the failing tests**

`tests/sheets.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sheetPrompt } from "../cli/core/sheets.mjs";

describe("sheetPrompt", () => {
  test("a character is Dan's three-panel sheet on 18% grey, filled from the fields", () => {
    const p = sheetPrompt({ kind: "character", description: "A man with dark curly hair and a full beard", outfit: "neon green jumpsuit, black boots" });
    assert.match(p, /^A three-panel character reference sheet composed as one horizontal image/);
    assert.match(p, /CHARACTER: A man with dark curly hair and a full beard/);
    assert.match(p, /OUTFIT: neon green jumpsuit, black boots/);
    assert.match(p, /LEFT PANEL: full-body front view/);
    assert.match(p, /CENTER PANEL: full-body back view/);
    assert.match(p, /RIGHT PANEL: tight chest-up close-up of the face/);
    assert.match(p, /18% neutral gray/);
    assert.match(p, /No text, no labels, no numbering/);
    assert.doesNotMatch(p, /attached reference/);
  });

  test("with source photos the prompt starts from them and the face must match", () => {
    const p = sheetPrompt({ kind: "character", description: "Alex", photos: 3 });
    assert.match(p, /^Generate the final image based on my attached reference photos\./);
    assert.match(p, /The face comes from the attached reference and must match it exactly in every panel\./);
    assert.match(sheetPrompt({ kind: "character", description: "Alex", photos: 1 }), /^Generate the final image based on my attached reference photo\./);
  });

  test("an outfit left empty says to keep the one described", () => {
    assert.match(sheetPrompt({ kind: "character", description: "Alex" }), /OUTFIT: as described above/);
  });

  test("a location is a view with no people, 3/4 wide by default", () => {
    const p = sheetPrompt({ kind: "location", description: "an empty back alley with colourful graffiti" });
    assert.equal(p, "3/4 wide-angle view of an empty back alley with colourful graffiti. No people. No text.");
    assert.match(sheetPrompt({ kind: "location", description: "a beach", view: "Low eye-level" }), /^Low eye-level view of a beach\./);
  });

  test("a prop (product) is a front and top-down view on mid-grey", () => {
    const p = sheetPrompt({ kind: "product", description: "a neon green skydiving jumpsuit" });
    assert.match(p, /^Two views of the same object: FRONT view on the left of the frame, and top-down view on the right\. Both centered, same scale\. Flat seamless mid-grey background\./);
    assert.match(p, /The object: a neon green skydiving jumpsuit\./);
  });

  test("a style is its description as a mood image", () => {
    assert.equal(sheetPrompt({ kind: "style", description: "Warm dusk light, soft film grain" }), "Warm dusk light, soft film grain. No text.");
  });

  test("a description is required and the kind must be known", () => {
    assert.throws(() => sheetPrompt({ kind: "character", description: " " }), /description/);
    assert.throws(() => sheetPrompt({ kind: "vibe", description: "x" }), /kind must be one of/);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `node --test tests/sheets.test.mjs`

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement**

`cli/core/sheets.mjs`:

```js
// The prompt Alex pastes into ChatGPT to make a Library sheet. Adapted from
// Dan Kieft's templates (start-making-ai-videos.vercel.app, read 2026-11-01):
// a character is a three-panel sheet on 18% grey, a location a view with no
// people, a prop a front and top-down view on mid-grey (white overexposes).
import { unknown } from "../lib/errors.mjs";
import { KINDS } from "./assets.mjs";

const lead = (photos) => (photos > 0 ? `Generate the final image based on my attached reference photo${photos === 1 ? "" : "s"}.\n\n` : "");
const end = (s) => s.trim().replace(/[.\s]+$/, "");

const character = ({ description, outfit, photos }) =>
  [
    "A three-panel character reference sheet composed as one horizontal image, divided into three equal vertical panels side by side with thin clean separations. The same person in the same outfit, rendered identically in all three panels. No text, no labels, no numbering anywhere in the image.",
    photos > 0 ? "The face comes from the attached reference and must match it exactly in every panel." : null,
    `CHARACTER: ${end(description)}.\nOUTFIT: ${outfit?.trim() ? `${end(outfit)}.` : "as described above."}`,
    "LEFT PANEL: full-body front view, standing straight, arms relaxed, facing the camera.\nCENTER PANEL: full-body back view, same pose.\nRIGHT PANEL: tight chest-up close-up of the face, looking into the camera.",
    "Skin tone is identical in every panel. The background is one flat 18% neutral gray field in every panel. Flat shadowless frontal lighting. Photographed on a 50mm prime, soft natural film grain. Photographed, not generated.",
  ]
    .filter(Boolean)
    .join("\n\n");

const location = ({ description, view }) => `${end(view?.trim() || "3/4 wide-angle")} view of ${end(description)}. No people. No text.`;

const product = ({ description, photos }) =>
  [
    "Two views of the same object: FRONT view on the left of the frame, and top-down view on the right. Both centered, same scale. Flat seamless mid-grey background.",
    `The object: ${end(description)}.${photos > 0 ? " It is the object in the attached reference." : ""} Every label, edge and colour exact. No text other than the object's own markings.`,
  ].join(" ");

const style = ({ description }) => `${end(description)}. No text.`;

const BUILD = { character, location, product, style };

/** { kind, description, outfit?, view?, photos? } → the prompt text. */
export function sheetPrompt({ kind, description, outfit = "", view = "", photos = 0 }) {
  if (!KINDS.includes(kind)) throw unknown(`kind must be one of ${KINDS.join(", ")}, got "${kind}".`, { field: "kind" });
  if (!description?.trim()) throw unknown("Say what it is (the description) first.", { field: "description" });
  return lead(photos) + BUILD[kind]({ description, outfit, view, photos });
}
```

Check `cli/lib/errors.mjs` first: confirm that `unknown(message, { field })` sets `err.field`, as `web/server/api/fields.mjs` uses it. If it does not, keep the call as written; the server test in Task 6 will show whether the field reaches the response.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/sheets.test.mjs && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/core/sheets.mjs tests/sheets.test.mjs
git diff --cached --stat
git commit -m "library: sheetPrompt writes Dan's character, location and prop templates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Server routes for roles, keep, edits, sheet upload and the prompt

**Files:**
- Modify: `web/server/http.mjs`, `web/server/api/library.mjs`
- Test: `web/tests/library.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `web/tests/library.test.mjs`, which already has `drop`, `save`, `req`, `port`, `png`, `existsSync`, `join` and `LIBRARY`:

```js
const patch = (name, body) => req(port, `/api/library/${name}`, { method: "PATCH", body });
const sheet = (name, body) => req(port, `/api/library/${name}/sheet`, { method: "POST", body });

describe("sheets", () => {
  test("images may carry a role, and keep is saved; the cover is the sheet", async () => {
    const a = await drop(png(600, 400), "front.png");
    const b = await drop(png(400, 600), "selfie.png");
    const r = await save({ name: "maya", kind: "character", description: "Maya.", keep: "her red scarf", images: [{ src: b.json.token, role: "source" }, { src: a.json.token, role: "sheet" }] });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.images.map((i) => i.role), ["source", "sheet"]);
    assert.equal(r.json.keep, "her red scarf");
    const listed = (await req(port, "/api/library")).json.find((x) => x.name === "maya");
    assert.equal(listed.hasSheet, true);
    assert.equal(listed.cover, "/media/library/maya/2.png");
  });

  test("a bad image entry is refused with code 3 on images", async () => {
    const r = await save({ name: "bad-entry", kind: "style", description: "x", images: [{ role: "sheet" }] });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.field, "images");
  });

  test("PATCH changes kind, description and keep only", async () => {
    const up = await drop(png(300, 300), "cup.png");
    await save({ name: "cup", kind: "product", description: "A cup.", images: [up.json.token] });
    const r = await patch("cup", { description: "A white cup.", keep: "the chip on the rim" });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.description, r.json.keep, r.json.images.length], ["A white cup.", "the chip on the rim", 1]);
  });

  test("a new sheet replaces the old sheet and keeps the source photos", async () => {
    const s1 = await drop(png(320, 320), "s1.png");
    const src = await drop(png(330, 330), "src.png");
    await save({ name: "zara", kind: "character", description: "Zara.", images: [{ src: src.json.token, role: "source" }, { src: s1.json.token, role: "sheet" }] });
    const s2 = await drop(png(900, 300), "s2.png");
    const r = await sheet("zara", { image: s2.json.token });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.images.map((i) => [i.role, i.width]), [["sheet", 900], ["source", 330]]);
    assert.ok(existsSync(join(LIBRARY, "zara", ".history")));
  });

  test("a sheet for an asset with only source photos is added in front of them", async () => {
    const src = await drop(png(340, 340), "only.png");
    await save({ name: "solo", kind: "character", description: "Solo.", images: [src.json.token] });
    const s = await drop(png(910, 310), "sheet.png");
    const r = await sheet("solo", { image: s.json.token });
    assert.deepEqual(r.json.images.map((i) => i.role), ["sheet", "source"]);
  });

  test("the sheet prompt comes from core, with the photo count", async () => {
    const q = new URLSearchParams({ kind: "character", description: "Maya, tall", outfit: "red scarf", photos: "2" });
    const r = await req(port, `/api/library/sheet-prompt?${q}`);
    assert.equal(r.status, 200, r.text);
    assert.match(r.json.prompt, /^Generate the final image based on my attached reference photos\./);
    assert.match(r.json.prompt, /OUTFIT: red scarf\./);
    const bad = await req(port, "/api/library/sheet-prompt?kind=character&description=");
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.field, "description");
  });
});
```

Read `web/tests/helpers.mjs`'s `req` first, to confirm it passes `method` and a JSON `body` through.

- [ ] **Step 2: Run and watch them fail**

Run: `node --test web/tests/library.test.mjs`

Expected: FAIL. Roles are not accepted, PATCH is 404, and so are the sheet and sheet-prompt routes.

- [ ] **Step 3: Add PATCH to the router**

In `web/server/http.mjs`, in the object `createRouter` returns, add after `delete: add("DELETE"),`:

```js
    patch: add("PATCH"),
```

Then read how the handler decides whether to parse a JSON body. Search `http.mjs` for `"POST"` and `"PUT"`. If the methods with a body are listed somewhere, add `"PATCH"` to that list.

- [ ] **Step 4: Implement the routes**

In `web/server/api/library.mjs`:

Change the import `import { KINDS } from "../../../cli/core/assets.mjs";` to:

```js
import { KINDS, sheetOf } from "../../../cli/core/assets.mjs";
import { sheetPrompt } from "../../../cli/core/sheets.mjs";
```

Add above `assetDetail`:

```js
/** "incoming:<file>" → its path in library/.incoming, refused unless it is a real waiting upload. */
function incomingPath(incoming, src, field) {
  const m = src.match(TOKEN);
  if (!m || !existsSync(join(incoming, m[1]))) throw f.invalid(field, `"${src}" is not an upload waiting to be saved. Drop the file again.`);
  return join(incoming, m[1]);
}

/** images: ["incoming:…" | "run/path.png" | { src, role }] → [{ path, role }], plus the uploads to clear after saving. */
function imageList(body, incoming) {
  const v = body?.images;
  if (!Array.isArray(v)) throw f.invalid("images", "images must be a list.");
  const uploads = [];
  const images = v.map((entry) => {
    const { src, role = "source" } = typeof entry === "string" ? { src: entry } : (entry ?? {});
    if (typeof src !== "string" || !src) throw f.invalid("images", "Each image needs a src: an upload token or a path inside runs/.");
    if (src.startsWith("incoming:")) {
      const path = incomingPath(incoming, src, "images");
      uploads.push(path);
      return { path, role };
    }
    // The MCP save_asset rule: relative means inside runs/.
    return { path: isAbsolute(src) ? src : join(RUNS_DIR, src), role };
  });
  return { images, uploads };
}
```

In `assetDetail`, add `keep: a.keep,` after `description: a.description,`, and add `role: im.role,` to each image object after `n: im.n,`.

In the `GET /api/library` route, change the cover to prefer the sheet:

```js
      return { ...s, cover: mediaUrl((sheetOf(a) ?? a.images[0])?.path), usedIn: a.usedIn ?? [] };
```

Register this route before `router.get("/api/library/:name", …)`. The router takes the first match, and `:name` would otherwise catch `sheet-prompt`.

```js
  router.get("/api/library/sheet-prompt", ({ query }) => {
    const photos = Number(query.get("photos") ?? 0);
    return {
      prompt: sheetPrompt({
        kind: query.get("kind") ?? "",
        description: query.get("description") ?? "",
        outfit: query.get("outfit") ?? "",
        view: query.get("view") ?? "",
        photos: Number.isInteger(photos) && photos > 0 ? photos : 0,
      }),
    };
  });
```

Replace the whole `router.post("/api/library", …)` route with:

```js
  router.post("/api/library", ({ body = {} }) => {
    const name = f.text(body, "name", { required: true });
    const kind = f.text(body, "kind", { required: true });
    const description = f.text(body, "description", { required: true });
    const keep = f.text(body, "keep");
    const replace = f.flag(body, "replace");
    const { library, roots } = context();
    const incoming = incomingDir();
    const { images, uploads } = imageList(body, incoming);
    // incoming first: it sits inside library/ under a hidden name, which the library root would refuse.
    library.save({ name, kind, description, keep, images, replace }, { roots: [incoming, ...roots] });
    for (const p of uploads) rmSync(p, { force: true });
    return assetDetail(name, following);
  });

  router.patch("/api/library/:name", ({ params, body = {} }) => {
    const { library } = context();
    const changes = {};
    for (const field of ["kind", "description", "keep"]) {
      const v = body[field];
      if (v === undefined) continue;
      if (typeof v !== "string") throw f.invalid(field, `${field} must be text.`);
      changes[field] = v;
    }
    library.update(params.name, changes);
    return assetDetail(params.name, following);
  });

  router.post("/api/library/:name/sheet", ({ params, body = {} }) => {
    const src = f.text(body, "image", { required: true });
    const { library, roots } = context();
    const incoming = incomingDir();
    const path = incomingPath(incoming, src, "image");
    const current = library.get(params.name);
    const sources = current.images.filter((im) => im.role === "source").map((im) => ({ path: im.path, role: "source" }));
    library.save(
      { name: current.name, kind: current.kind, description: current.description, keep: current.keep, images: [{ path, role: "sheet" }, ...sources], replace: true },
      { roots: [incoming, ...roots] },
    );
    rmSync(path, { force: true });
    return assetDetail(params.name, following);
  });
```

`library.update` and `library.save` throw core's code 3 errors, which the handler already turns into 400s.

- [ ] **Step 5: Run every server test**

Run: `npm --prefix web run test:server`

Expected: PASS. The earlier save tests still pass, because a plain string is still a source image.

- [ ] **Step 6: Commit**

```bash
git add web/server/api/library.mjs web/server/http.mjs web/tests/library.test.mjs
git diff --cached --stat
git commit -m "library api: images with roles, keep, PATCH, sheet upload and the sheet prompt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Page types and kind labels

**Files:**
- Modify: `web/src/api/types.ts:45-67`
- Create: `web/src/library/kinds.ts`

- [ ] **Step 1: Update the types**

In `web/src/api/types.ts`:
- Add `hasSheet?: boolean;` to `AssetSummary`, after `imageCount`.
- In `AssetDetail`, add `keep: string | null;` after `description`.
- In each `images` entry of `AssetDetail`, add `role: "sheet" | "source";` after `n: number;`.

- [ ] **Step 2: Add the labels**

`web/src/library/kinds.ts`:

```ts
// What each stored kind is called on screen. "product" stays the stored id
// (job records and asset.json use it); people call it a prop.
export const KIND_LABEL: Record<string, string> = { character: "Character", location: "Location", product: "Prop", style: "Style" };
export const KIND_PLURAL: Record<string, string> = { character: "Characters", location: "Locations", product: "Props", style: "Styles" };
/** Tab and switch order. */
export const KIND_ORDER = ["character", "location", "product", "style"];
export const kindLabel = (k: string) => KIND_LABEL[k] ?? k;
```

- [ ] **Step 3: Type-check**

Read `web/package.json` for the type-check script (`typecheck`, or `tsc -b` inside `build`), and run it.

Expected: no errors. Test files that build an `AssetDetail` (the old `LibraryScreen.test.tsx` and any fixture) need `keep: null` and `role` on each image. Add them where the checker points. `LibraryScreen.test.tsx` is rewritten in Task 9 anyway.

- [ ] **Step 4: Commit**

```bash
git add web/src/api/types.ts web/src/library/kinds.ts
# plus any file the checker made you touch, by explicit path
git diff --cached --stat
git commit -m "library page: types for sheets and keep, and Prop as the label for product

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: The SheetMaker panel

**Files:**
- Create: `web/src/library/SheetMaker.tsx`, `web/src/library/SheetMaker.test.tsx`
- Modify: `web/src/library/library.css`

The panel works in two modes:
- **New:** `asset` is `null`. You fill the fields, copy the prompt and drop the sheet. Dropping saves the asset, with the sheet and any source photos.
- **Edit:** `asset` is set. The fields are prefilled and the name is fixed. "Save changes" sends a PATCH, and dropping a sheet posts to `/sheet`.

- [ ] **Step 1: Check the fetch stub**

Read `routes()` in `web/src/test-fixtures.ts`. The tests below need:
- `/api/library/sheet-prompt?kind=…` to hit the `/api/library/sheet-prompt` entry, so the query string must be ignored when matching;
- `/api/library/jumpsuit/sheet` to hit its own entry and not `/api/library`.

If `routes()` matches the full URL including the query, change it to match on `String(url).split("?")[0]`. Run `npm --prefix web run test:page` to see that nothing else changed, and include the file in this task's commit.

- [ ] **Step 2: Write the failing tests**

`web/src/library/SheetMaker.test.tsx`:

```tsx
import { describe, test, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SheetMaker } from "./SheetMaker";
import { routes } from "../test-fixtures";
import type { AssetDetail } from "../api/types";

const token = "incoming:" + "b".repeat(32) + ".png";
const saved: AssetDetail = {
  name: "jumpsuit", kind: "product", description: "A neon green jumpsuit.", keep: "the chest logo", createdAt: "", updatedAt: "",
  images: [{ n: 1, role: "sheet", file: "1.png", width: 900, height: 300, bytes: 3, mime: "image/png", url: "/media/library/jumpsuit/1.png" }],
  usedIn: [], takes: [],
};

function stub(extra: Record<string, (init?: RequestInit) => unknown> = {}) {
  const fetchMock = vi.fn(
    routes({
      "/api/library/sheet-prompt": () => ({ prompt: "Two views of the same object: FRONT view on the left…" }),
      "/api/library/incoming": () => ({ token, name: "sheet.png", kind: "image", mime: "image/png", bytes: 3, width: 900, height: 300 }),
      "/api/library": () => saved,
      ...extra,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("SheetMaker", () => {
  test("shows the filled prompt and copies it for ChatGPT", async () => {
    const fetchMock = stub();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<SheetMaker asset={null} onSaved={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Prop" }));
    fill("Name", "jumpsuit");
    fill("What it is", "A neon green jumpsuit");
    expect(await screen.findByText(/Two views of the same object/)).toBeInTheDocument();
    const call = fetchMock.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith("/api/library/sheet-prompt"));
    expect(call).toContain("kind=product");
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt for ChatGPT" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Two views of the same object: FRONT view on the left…"));
    expect(await screen.findByText("Copied. Paste it into ChatGPT.")).toBeInTheDocument();
  });

  test("dropping the sheet saves the asset with the sheet first and the keep line", async () => {
    const fetchMock = stub();
    const onSaved = vi.fn();
    render(<SheetMaker asset={null} onSaved={onSaved} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Prop" }));
    fill("Name", "jumpsuit");
    fill("What it is", "A neon green jumpsuit");
    fill("When a scene uses it, keep", "the chest logo");
    fireEvent.drop(screen.getByLabelText("Drop the sheet here"), { dataTransfer: { files: [new File(["x"], "sheet.png", { type: "image/png" })] } });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    const post = fetchMock.mock.calls.find((c) => c[0] === "/api/library" && c[1]?.method === "POST");
    expect(JSON.parse(post![1]!.body as string)).toEqual({
      name: "jumpsuit", kind: "product", description: "A neon green jumpsuit", keep: "the chest logo",
      images: [{ src: token, role: "sheet" }],
    });
  });

  test("a sheet dropped before the name is filled waits, with the reason", async () => {
    stub();
    render(<SheetMaker asset={null} onSaved={() => {}} onClose={() => {}} />);
    fireEvent.drop(screen.getByLabelText("Drop the sheet here"), { dataTransfer: { files: [new File(["x"], "sheet.png", { type: "image/png" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Give it a name and say what it is, then save.");
    expect(screen.getByRole("button", { name: "Save sheet" })).toBeInTheDocument();
  });

  test("editing: the name is fixed, Save changes sends a PATCH, a new sheet goes to /sheet", async () => {
    const fetchMock = stub({ "/api/library/jumpsuit": () => saved, "/api/library/jumpsuit/sheet": () => saved });
    render(<SheetMaker asset={saved} onSaved={() => {}} onClose={() => {}} />);
    expect(screen.getByLabelText("Name")).toHaveAttribute("readonly");
    fill("When a scene uses it, keep", "the logo and the black panels");
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      const p = fetchMock.mock.calls.find((c) => c[0] === "/api/library/jumpsuit" && c[1]?.method === "PATCH");
      expect(JSON.parse(p![1]!.body as string)).toEqual({ kind: "product", description: "A neon green jumpsuit.", keep: "the logo and the black panels" });
    });
    fireEvent.drop(screen.getByLabelText("Drop the sheet here"), { dataTransfer: { files: [new File(["x"], "s.png", { type: "image/png" })] } });
    await waitFor(() => {
      const s = fetchMock.mock.calls.find((c) => c[0] === "/api/library/jumpsuit/sheet");
      expect(JSON.parse(s![1]!.body as string)).toEqual({ image: token });
    });
  });
});
```

- [ ] **Step 3: Run and watch them fail**

Run: `npm --prefix web run test:page -- src/library/SheetMaker.test.tsx`

Expected: FAIL with "Failed to resolve import ./SheetMaker".

- [ ] **Step 4: Implement**

`web/src/library/SheetMaker.tsx`:

```tsx
// web/src/library/SheetMaker.tsx
// Make a Library sheet the ChatGPT way: fill a few fields, copy the prompt,
// make the image in ChatGPT, bring it back. Never spends kie credits.
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { AssetDetail, IncomingFile } from "../api/types";
import { KIND_ORDER, kindLabel } from "./kinds";

interface Props {
  /** null: a new item. Otherwise the item being edited. */
  asset: AssetDetail | null;
  onSaved: (asset: AssetDetail) => void;
  onClose: () => void;
}

const message = (e: unknown) => (e instanceof ApiError ? e.message : String(e));
const upload = (file: File) => api<IncomingFile>("/api/library/incoming", { file: { data: file, name: file.name } });

export function SheetMaker({ asset, onSaved, onClose }: Props) {
  const id = useId();
  const editing = asset !== null;
  const [kind, setKind] = useState(asset?.kind ?? "character");
  const [name, setName] = useState(asset?.name ?? "");
  const [description, setDescription] = useState(asset?.description ?? "");
  const [outfit, setOutfit] = useState("");
  const [view, setView] = useState("");
  const [keep, setKeep] = useState(asset?.keep ?? "");
  const [sources, setSources] = useState<string[]>([]); // upload tokens, new items only
  const [sheetToken, setSheetToken] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const pickSources = useRef<HTMLInputElement>(null);

  const existingSources = asset?.images.filter((im) => im.role === "source") ?? [];
  const sheet = asset?.images.find((im) => im.role === "sheet") ?? null;
  const photos = editing ? existingSources.length : sources.length;

  // The prompt follows the fields; core writes it. A hand-edited prompt is left alone.
  useEffect(() => {
    if (editingPrompt) return;
    setCopied(false);
    if (!description.trim()) {
      setPrompt("");
      return;
    }
    const q = new URLSearchParams({ kind, description, outfit, view, photos: String(photos) });
    let live = true;
    const t = setTimeout(() => {
      api<{ prompt: string }>(`/api/library/sheet-prompt?${q}`)
        .then((r) => live && setPrompt(r.prompt))
        .catch(() => {});
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [kind, description, outfit, view, photos, editingPrompt]);

  async function copy() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
  }

  async function saveNew(token: string) {
    if (!name.trim() || !description.trim()) {
      setError("Give it a name and say what it is, then save.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const images = [{ src: token, role: "sheet" }, ...sources.map((s) => ({ src: s, role: "source" }))];
      onSaved(await api<AssetDetail>("/api/library", { method: "POST", body: { name: name.trim(), kind, description, keep, images } }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function takeSheet(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const { token } = await upload(file);
      if (asset) {
        setBusy(true);
        onSaved(await api<AssetDetail>(`/api/library/${encodeURIComponent(asset.name)}/sheet`, { method: "POST", body: { image: token } }));
      } else {
        setSheetToken(token);
        await saveNew(token);
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function takeSources(files: FileList | null) {
    if (!files) return;
    setError(null);
    try {
      const tokens: string[] = [];
      for (const file of Array.from(files).slice(0, 3 - sources.length)) tokens.push((await upload(file)).token);
      setSources((s) => [...s, ...tokens]);
    } catch (e) {
      setError(message(e));
    }
  }

  async function saveChanges() {
    if (!asset) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api<AssetDetail>(`/api/library/${encodeURIComponent(asset.name)}`, { method: "PATCH", body: { kind, description, keep } }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  // ⌘V while the panel is open pastes the sheet.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
      if (file) {
        e.preventDefault();
        takeSheet(file);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  return (
    <section className="sheet-maker" aria-label={asset ? `@library:${asset.name}` : "New sheet"}>
      <header className="sheet-maker__head">
        <h2 className="sheet-maker__title">{asset ? <span className="mono">@library:{asset.name}</span> : "New sheet"}</h2>
        <button type="button" className="button button--quiet" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="seg" role="radiogroup" aria-label="Kind">
        {KIND_ORDER.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className="seg__item" onClick={() => setKind(k)}>
            {kindLabel(k)}
          </button>
        ))}
      </div>

      <label className="field__label" htmlFor={`${id}-name`}>Name</label>
      <input id={`${id}-name`} className="field mono" value={name} readOnly={editing} onChange={(e) => setName(e.target.value)} placeholder="maya" autoComplete="off" />
      <p className="field__hint">
        You will write it as <span className="mono">@library:{name || "name"}</span>.
      </p>

      <label className="field__label" htmlFor={`${id}-what`}>What it is</label>
      <textarea
        id={`${id}-what`}
        className="field"
        rows={2}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={kind === "location" ? "an empty back alley with colourful graffiti" : "build, hair, face, overall vibe"}
      />

      {kind === "character" && (
        <>
          <label className="field__label" htmlFor={`${id}-outfit`}>Outfit, head to toe</label>
          <input id={`${id}-outfit`} className="field" value={outfit} onChange={(e) => setOutfit(e.target.value)} />
        </>
      )}
      {kind === "location" && (
        <>
          <label className="field__label" htmlFor={`${id}-view`}>Camera view</label>
          <input id={`${id}-view`} className="field" value={view} onChange={(e) => setView(e.target.value)} placeholder="3/4 wide-angle" />
        </>
      )}

      <p className="field__label">Reference photos (optional; you attach these in ChatGPT)</p>
      <div className="sheet-maker__photos">
        {existingSources.map((im) => (im.url ? <img key={im.n} src={im.url} alt={`Source photo ${im.n}`} /> : null))}
        {!editing &&
          sources.map((t, i) => (
            <span key={t} className="sheet-maker__photo mono">
              photo {i + 1}
            </span>
          ))}
        {!editing && sources.length < 3 && (
          <button type="button" className="sheet-maker__add" onClick={() => pickSources.current?.click()}>
            + Add photo
          </button>
        )}
        <input
          ref={pickSources}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(e) => {
            takeSources(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <label className="field__label" htmlFor={`${id}-keep`}>When a scene uses it, keep</label>
      <input
        id={`${id}-keep`}
        className="field"
        value={keep}
        onChange={(e) => setKeep(e.target.value)}
        placeholder={kind === "character" ? "exact face, hair and glasses" : "colours, shape and markings"}
      />

      {editing && (
        <button type="button" className="button" disabled={busy} onClick={saveChanges}>
          Save changes
        </button>
      )}

      <ol className="sheet-maker__steps">
        <li>
          <h3 className="sheet-maker__step">Copy the prompt</h3>
          {editingPrompt ? (
            <textarea className="field sheet-maker__prompt" aria-label="Prompt" rows={8} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          ) : (
            <p className="sheet-maker__prompt">{prompt || "Say what it is to see the prompt."}</p>
          )}
          <div className="sheet-maker__actions">
            <button type="button" className="generate" disabled={!prompt} onClick={copy}>
              Copy prompt for ChatGPT
            </button>
            <button type="button" className="button button--quiet" disabled={!prompt} onClick={() => setEditingPrompt((v) => !v)}>
              {editingPrompt ? "Back to the written prompt" : "Edit prompt"}
            </button>
          </div>
          {copied && (
            <p className="field__hint" role="status">
              Copied. Paste it into ChatGPT.
            </p>
          )}
        </li>
        <li>
          <h3 className="sheet-maker__step">Paste it into ChatGPT</h3>
          <p className="field__hint">Attach your photos there too. Make a few; images cost you nothing there.</p>
        </li>
        <li>
          <h3 className="sheet-maker__step">{sheet ? "Replace the sheet" : "Bring the best one back"}</h3>
          {sheet?.url && <img className="sheet-maker__sheet" src={sheet.url} alt={`Sheet for ${asset?.name}`} />}
          <div
            className="sheet-maker__drop"
            data-over={over}
            role="region"
            aria-label="Drop the sheet here"
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              takeSheet(e.dataTransfer.files[0]);
            }}
          >
            <strong>Drop the image here</strong>, paste it (⌘V) or{" "}
            <button type="button" className="sheet-maker__pick" onClick={() => pick.current?.click()}>
              choose a file
            </button>
            <input
              ref={pick}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                takeSheet(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          {busy && (
            <p className="field__hint" role="status">
              Saving…
            </p>
          )}
          {!editing && sheetToken && error && (
            <button type="button" className="button" onClick={() => saveNew(sheetToken)}>
              Save sheet
            </button>
          )}
        </li>
      </ol>
      {error && (
        <p className="sheet-maker__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Add its styles**

Append to `web/src/library/library.css`, using tokens only:

```css
/* The sheet maker: a side panel. One green button (Copy prompt). */
.sheet-maker { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-5); background: var(--surface-1); border-left: 1px solid var(--line); overflow-y: auto; }
.sheet-maker__head { display: flex; align-items: center; justify-content: space-between; }
.sheet-maker__title { margin: 0; font-size: var(--text-xl); font-weight: 600; }
.seg { display: flex; padding: 3px; border-radius: var(--radius-md); background: var(--surface-2); margin: var(--space-2) 0; }
.seg__item { flex: 1; padding: 7px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text-2); font-size: var(--text-md); font-weight: 500; cursor: pointer; }
.seg__item[aria-checked="true"] { background: var(--surface-3); color: var(--text); }
.field__label { margin: var(--space-2) 0 0; color: var(--text-3); font-size: var(--text-sm); font-weight: 500; }
.field { width: 100%; padding: 9px 11px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--text); font: 400 var(--text-md)/1.45 var(--font-sans); }
.field.mono { font-family: var(--font-mono); }
.field[readonly] { color: var(--text-2); }
.field__hint { margin: 0; color: var(--text-3); font-size: var(--text-sm); }
.sheet-maker__photos { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }
.sheet-maker__photos img, .sheet-maker__photo { width: 48px; height: 48px; border-radius: var(--radius-sm); object-fit: cover; background: var(--surface-3); display: inline-flex; align-items: center; justify-content: center; font-size: var(--text-xs); color: var(--text-2); }
.sheet-maker__add { height: 48px; padding: 0 var(--space-3); border: 1px dashed var(--line); border-radius: var(--radius-sm); background: transparent; color: var(--text-2); font-size: var(--text-sm); cursor: pointer; }
.sheet-maker__steps { list-style: none; counter-reset: step; margin: var(--space-4) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-4); }
.sheet-maker__steps > li { counter-increment: step; display: grid; grid-template-columns: 28px 1fr; column-gap: var(--space-3); row-gap: var(--space-2); }
.sheet-maker__steps > li > * { grid-column: 2; }
.sheet-maker__steps > li::before { content: counter(step); grid-column: 1; grid-row: 1; width: 26px; height: 26px; border-radius: 50%; background: var(--surface-3); color: var(--text); font-size: var(--text-sm); font-weight: 600; display: flex; align-items: center; justify-content: center; }
.sheet-maker__step { margin: 0; font-size: var(--text-title); font-weight: 600; color: var(--text); }
.sheet-maker__prompt { margin: 0; padding: var(--space-3); border-radius: var(--radius-md); background: var(--surface-2); color: var(--text-2); font-size: var(--text-md); line-height: 1.55; max-height: 180px; overflow: auto; white-space: pre-wrap; }
.sheet-maker__actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.sheet-maker__sheet { width: 100%; border-radius: var(--radius-md); background: var(--surface-2); }
.sheet-maker__drop { padding: var(--space-5); border: 1px dashed var(--text-3); border-radius: var(--radius-md); text-align: center; color: var(--text-2); font-size: var(--text-md); }
.sheet-maker__drop[data-over="true"] { border-color: var(--text); background: var(--surface-2); }
.sheet-maker__drop strong { color: var(--text); font-weight: 500; }
.sheet-maker__pick { background: none; border: 0; padding: 0; color: var(--text); text-decoration: underline; cursor: pointer; font-size: inherit; }
.sheet-maker__error { margin: 0; color: var(--bad-ink); font-size: var(--text-md); }
```

- [ ] **Step 6: Run the tests**

Run: `npm --prefix web run test:page -- src/library/SheetMaker.test.tsx src/theme`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/library/SheetMaker.tsx web/src/library/SheetMaker.test.tsx web/src/library/library.css
# plus web/src/test-fixtures.ts if step 1 changed it
git diff --cached --stat
git commit -m "library: the sheet maker, copy for ChatGPT and drop the image back

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: The Library screen around the sheet maker

**Files:**
- Modify (rewrite): `web/src/library/LibraryScreen.tsx`, `web/src/library/LibraryScreen.test.tsx`
- Modify: `web/src/library/library.css`

The drop tray, its save form and the old `AssetPanel` with "Use in prompt" leave this screen:
- The sheet maker replaces them.
- Create keeps its own "+ @asset" picker until phase 3.
- `SaveAssetForm.tsx` stays, because `TakeViewer` still uses it.

The card says "in N films", from `usedIn`. Phase 4 changes it to scenes.

- [ ] **Step 1: Rewrite the tests**

Replace `web/src/library/LibraryScreen.test.tsx` with:

```tsx
import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { LibraryScreen } from "./LibraryScreen";
import { routes } from "../test-fixtures";

const list = [
  { name: "alexandros", kind: "character", description: "Alex.", imageCount: 3, hasSheet: false, updatedAt: "", cover: "/media/library/alexandros/1.png", usedIn: ["skydive"] },
  { name: "jumpsuit", kind: "product", description: "A jumpsuit.", imageCount: 1, hasSheet: true, updatedAt: "", cover: "/media/library/jumpsuit/1.png", usedIn: [] },
  { name: "alley", kind: "location", description: "An alley.", imageCount: 1, hasSheet: true, updatedAt: "", cover: "/media/library/alley/1.png", usedIn: ["a", "b"] },
];
const alexandros = {
  name: "alexandros", kind: "character", description: "Alex.", keep: null, createdAt: "", updatedAt: "",
  images: [{ n: 1, role: "source", file: "1.png", width: 1, height: 1, bytes: 1, mime: "image/png", url: "/media/library/alexandros/1.png" }],
  usedIn: ["skydive"], takes: [],
};

beforeEach(() => {
  window.location.hash = "#/library";
  vi.stubGlobal(
    "fetch",
    vi.fn(
      routes({
        "/api/library": () => list,
        "/api/library/alexandros": () => alexandros,
        "/api/library/sheet-prompt": () => ({ prompt: "A three-panel character reference sheet…" }),
      }),
    ),
  );
});

describe("LibraryScreen", () => {
  test("cards show @library:name, the kind as people say it, and whether there is a sheet", async () => {
    render(<LibraryScreen />);
    const grid = await screen.findByRole("list", { name: "Library" });
    expect(await within(grid).findByText("@library:jumpsuit")).toHaveClass("mono");
    expect(within(grid).getByText(/^Prop ·/)).toBeInTheDocument();
    expect(within(grid).getByText("no sheet yet")).toBeInTheDocument();
    expect(within(grid).getByText(/in 2 films/)).toBeInTheDocument();
  });

  test("tabs filter by kind and show counts", async () => {
    render(<LibraryScreen />);
    const grid = await screen.findByRole("list", { name: "Library" });
    await within(grid).findByText("@library:alley");
    fireEvent.click(screen.getByRole("button", { name: /Props\s*1/ }));
    expect(within(grid).queryByText("@library:alley")).toBeNull();
    expect(within(grid).getByText("@library:jumpsuit")).toBeInTheDocument();
  });

  test("+ New sheet opens the sheet maker; a card opens it for that item", async () => {
    render(<LibraryScreen />);
    fireEvent.click(await screen.findByRole("button", { name: /New sheet/ }));
    expect(screen.getByRole("region", { name: "New sheet" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /@library:alexandros/ }));
    expect(await screen.findByRole("region", { name: "@library:alexandros" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm --prefix web run test:page -- src/library/LibraryScreen.test.tsx`

Expected: FAIL. There is no list named "Library" and no "New sheet" button.

- [ ] **Step 3: Rewrite the screen**

Replace `web/src/library/LibraryScreen.tsx` with:

```tsx
// web/src/library/LibraryScreen.tsx
// Everything you can @library:, and the sheet maker to add more.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { AssetDetail, AssetSummary } from "../api/types";
import { onStudioEvent } from "../app/useStudio";
import { KIND_ORDER, KIND_PLURAL, kindLabel } from "./kinds";
import { SheetMaker } from "./SheetMaker";
import "./library.css";

type Open = { mode: "new" } | { mode: "edit"; asset: AssetDetail } | null;

const films = (n: number) => (n ? `in ${n} film${n === 1 ? "" : "s"}` : "not used yet");

export function LibraryScreen() {
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [kind, setKind] = useState<string>("all");
  const [open, setOpen] = useState<Open>(null);

  const load = useCallback(() => api<AssetSummary[]>("/api/library").then(setAssets).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);
  // The event carries core's list without covers, so read the full list again.
  useEffect(() => onStudioEvent((e) => e.event === "library" && load()), [load]);

  const edit = (name: string) =>
    api<AssetDetail>(`/api/library/${encodeURIComponent(name)}`)
      .then((asset) => setOpen({ mode: "edit", asset }))
      .catch(() => {});

  const count = (k: string) => assets.filter((a) => a.kind === k).length;
  const shown = kind === "all" ? assets : assets.filter((a) => a.kind === kind);

  return (
    <div className="library" data-open={open !== null}>
      <div className="library__main">
        <header className="library__head">
          <h1>Library</h1>
          <div className="library__filters" role="group" aria-label="Kind">
            <button type="button" className="filter" aria-pressed={kind === "all"} onClick={() => setKind("all")}>
              All <span className="filter__n mono">{assets.length}</span>
            </button>
            {KIND_ORDER.map((k) => (
              <button key={k} type="button" className="filter" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {KIND_PLURAL[k]} <span className="filter__n mono">{count(k)}</span>
              </button>
            ))}
          </div>
        </header>

        <ul className="cards" aria-label="Library">
          <li>
            <button type="button" className="card-new" onClick={() => setOpen({ mode: "new" })}>
              <span className="card-new__plus" aria-hidden="true">
                +
              </span>
              New sheet
              <span className="card-new__hint">character · location · prop</span>
            </button>
          </li>
          {shown.map((a) => (
            <li key={a.name}>
              <button type="button" className="card-item" aria-pressed={open?.mode === "edit" && open.asset.name === a.name} onClick={() => edit(a.name)}>
                {a.hasSheet && a.cover ? <img src={a.cover} alt="" loading="lazy" /> : <span className="card-item__blank">no sheet yet</span>}
                <span className="card-item__name mono">@library:{a.name}</span>
                <span className="card-item__meta">
                  {kindLabel(a.kind)} · {films(a.usedIn?.length ?? 0)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!assets.length && <p className="library__empty">Nothing here yet. Start with a sheet of yourself: + New sheet, Character.</p>}
      </div>

      {open && (
        <SheetMaker
          key={open.mode === "edit" ? open.asset.name : "new"}
          asset={open.mode === "edit" ? open.asset : null}
          onSaved={(asset) => {
            load();
            setOpen({ mode: "edit", asset });
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Restyle the grid**

In `web/src/library/library.css`:
- Delete the rules for `.drop`, `.drop__pick`, `.tray*`, `.assets*`, `.asset`, `.asset__*` and `.asset-panel*`. Keep `.library__head`, `.library__filters`, `.filter` and the sheet-maker rules from Task 8.
- Replace the first `.library { … }` rule with the block below. Tokens only.

```css
.library { display: grid; grid-template-columns: 1fr; min-height: 100%; }
.library[data-open="true"] { grid-template-columns: 1fr 520px; }
.library__main { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-5); }
.filter__n { color: var(--text-3); font-size: var(--text-sm); margin-left: 2px; }
.library__empty { color: var(--text-2); font-size: var(--text-md); }

.cards { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--space-4); }
.card-new, .card-item { width: 100%; height: 100%; border-radius: var(--radius-md); cursor: pointer; text-align: left; font: inherit; }
.card-new { min-height: 220px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-1); border: 1px dashed var(--line); background: transparent; color: var(--text-2); font-size: var(--text-title); font-weight: 500; }
.card-new:hover { color: var(--text); border-color: var(--text-3); }
.card-new__plus { font-size: 28px; font-weight: 400; color: var(--text); }
.card-new__hint { color: var(--text-3); font-size: var(--text-sm); font-weight: 400; }
.card-item { display: flex; flex-direction: column; padding: 0; overflow: hidden; border: 1px solid transparent; background: var(--surface-1); color: var(--text); }
.card-item[aria-pressed="true"] { border-color: var(--text-3); }
.card-item img, .card-item__blank { width: 100%; aspect-ratio: 3 / 2; object-fit: cover; background: var(--surface-2); }
.card-item__blank { display: flex; align-items: center; justify-content: center; color: var(--text-3); font-size: var(--text-sm); }
.card-item__name { padding: var(--space-3) var(--space-3) 0; font-size: var(--text-md); font-weight: 500; }
.card-item__meta { padding: 2px var(--space-3) var(--space-3); color: var(--text-3); font-size: var(--text-sm); }
```

The selected card uses `text-3` for its border, not the green, because green is only for money and the main button.

- [ ] **Step 5: Run every page test, type-check and build**

Run: `npm --prefix web test && npm --prefix web run build`

Expected: PASS. If another test relied on "Use in prompt" from the Library (`grep -rn "Use in prompt" web/src`), remove that assertion. That flow is gone on purpose, and Create's own picker stays.

- [ ] **Step 6: Commit**

```bash
git add web/src/library/LibraryScreen.tsx web/src/library/LibraryScreen.test.tsx web/src/library/library.css
git diff --cached --stat
git commit -m "library: cards to @library:, kind tabs with counts, and the sheet maker beside them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Check it in the browser

No paid calls. This uses the real `library/`, where alexandros has 3 source photos and no sheet.

- [ ] **Step 1: Build and start Shard on a spare port**

```bash
npm --prefix web run build
```

Start the server the way `npm run studio` does, but on a port other than Alex's 4317. Read `web/server/main.mjs` for the port flag or variable. Run it in the background, and never print the session key.

- [ ] **Step 2: Screenshot**

Use the gstack browse skill at 1440×900 and 1280×800. Take the screenshots:
- Library with no panel open.
- "+ New sheet" with Character picked and the fields filled for "maya".
- The alexandros card opened. It should show "no sheet yet", 3 source photos and a prompt starting "Generate the final image based on my attached reference photos.".

Compare against `.superpowers/brainstorm/76381-1793497460/content/library-v2.html`. Check by eye:
- nothing under 12px;
- one green button on the screen;
- the prompt is readable.

After using browse, run `git checkout .gitignore`, because browse appends `.gstack/`.

- [ ] **Step 3: Stop the server and report**

Stop the background server. Report the screenshots' paths. There is nothing to commit, unless a visual fix was needed. Any fix gets its own commit with explicit paths.
