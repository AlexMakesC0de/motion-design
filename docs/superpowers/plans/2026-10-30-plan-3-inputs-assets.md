# Plan 3: file safety, the asset library and reference expansion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save reusable references as named assets, use them in any job as `zed` or `zed#2` with a numbered mapping (`@Image1 = zed#1`), and make sure no file is sent to a provider unless its contents are an image, video or audio file of a sane size, from a folder it is allowed to come from.

**Architecture:** `cli/core/inputs.mjs` checks local files (real path, allowed roots, hidden segments, magic bytes, size, image dimensions) and URLs (https only, never fetched). `cli/core/assets.mjs` is a folder-per-asset library under `library/` with history on replace and an upload cache keyed by sha256. `cli/core/refs.mjs` expands `{ source, role }` references in order into uploaded URLs plus a `refMapping`. Route-specific limits (Seedance 2.5's image sizes and its 30-image cap) are data in `models.json`, checked by `buildInput`. Result downloads become https-only, size-capped and confined to the run directory.

**Tech stack:** Node ≥20 ESM, `node:test`, no new packages. Image dimensions are read from file headers (PNG, JPEG, WebP), with no image library.

**Spec:** [2026-10-30-mcp-server-design.md](../specs/2026-10-30-mcp-server-design.md), "References", "Inputs and file safety", "Asset library", build steps 4-5. Plans 1 and 2 must have landed.

**Scope decisions, recorded for review:**

- **Where the folder rule applies.** The spec says to apply input validation "to every existing path-taking command". The threat it names is a prompt-injected agent sending a private file to a provider. So:
  - Content, type and size checks apply everywhere a file can leave the machine: `kie upload`, local reference files and asset images.
  - The allowed-folders rule applies to every path the MCP server receives (plan 4 passes `roots`).
  - The CLI keeps accepting any path a human types, because the host's command-approval prompt already guards the shell path. The spec names this as a known limit.
  - Local finishing commands (`probe`, `assemble`, ...) send nothing anywhere, so the CLI leaves them alone. Their MCP versions get the folder rule in plan 4.
- **Raw local paths in `--ref`.** The CLI's `--ref` still refuses a raw local path, with its existing message (upload it first). It now also accepts an asset name. That keeps the skill's "a local path is not a remote attachment" rule for humans. The MCP server accepts local paths inside allowed roots and uploads them itself.
- **`parseRef` returns `{ source, role }`** for both URLs and asset names. Nothing reads a parsed ref's `url` except the new expansion step (checked with `grep`), so one existing test expectation changes.
- **File layout.** Reference expansion gets its own module, `core/refs.mjs`, instead of living in `assets.mjs`, because it also handles URLs and plain files.
- `LIBRARY_DIR` and `isInside` live in `cli/lib/run.mjs`, next to `RUNS_DIR`, so `lib/` modules never import from `core/`.
- **Known limit:** `kie preflight --ref zed:first_frame` checks roles only and does not expand assets, so it will not catch a multi-image asset as a first frame. `kie video` does, before anything is uploaded.

---

## File map

| File | Change |
|---|---|
| `cli/lib/run.mjs` | add `LIBRARY_DIR`, `isInside` |
| `cli/core/inputs.mjs` | new: `sniff`, `imageSize`, `checkLocalFile`, `checkHttpsUrl`, `allowedRoots` |
| `cli/lib/poll.mjs` | `download` is https-only, size-capped, confined to a directory |
| `cli/core/generate.mjs` | passes `within` to `download`; accepts `record` fields for the job record |
| `cli/core/assets.mjs` | new: `openLibrary` (`save`, `get`, `list`, `uploadUrl`, `recordUse`), `KINDS` |
| `cli/core/refs.mjs` | new: `expandRefs` |
| `cli/lib/models.mjs` | `parseRef` accepts asset names, returns `{ source, role }`; `buildInput` checks `refLimits` |
| `cli/lib/upload.mjs` | accepts a `mime` the caller already verified |
| `cli/models.json` | Seedance 2.5 kie route gets `refLimits` |
| `cli/kie.mjs` | `kie asset save|list|show`; `--ref` expands assets; `kie upload` checks contents |
| `.gitignore` | `/library/` |
| `tests/fixtures/images.mjs` | new: tiny valid PNG/JPEG/WebP headers for tests |
| `tests/inputs.test.mjs`, `tests/download.test.mjs`, `tests/assets.test.mjs`, `tests/refs.test.mjs` | new |
| `tests/cli.test.mjs` | one `parseRef` expectation updated |
| `cli/README.md`, `skills/motion-design/references/tool-routing.md`, spec | document |

**Test isolation:** as in plan 2, any test touching `runs/` or `library/` passes a temp directory explicitly (`openLibrary(tmpDir)`) or sets `KIE_RUNS_DIR` / `KIE_LIBRARY_DIR` before a dynamic `await import(...)`.

After each task, run `npm test 2>&1 | grep -E "^ℹ (pass|fail)"` and expect `fail 0`, with the pass count up by the number of tests the task adds.

---

### Task 1: Check what a local file really is

**Files:**
- Modify: `cli/lib/run.mjs`
- Create: `cli/core/inputs.mjs`, `tests/fixtures/images.mjs`
- Test: `tests/inputs.test.mjs` (13 tests)

- [ ] **Step 1: Add the shared path helpers to `cli/lib/run.mjs`**

Make sure the `node:path` import includes `isAbsolute`, `relative` and `sep` (add whichever are missing).

After the `RUNS_DIR` line add:

```js
export const LIBRARY_DIR = process.env.KIE_LIBRARY_DIR || join(REPO_ROOT, "library");

/** True when `path` is strictly inside `root`. Both should already be real paths. */
export function isInside(path, root) {
  const rel = relative(root, path);
  return rel !== "" && !isAbsolute(rel) && rel.split(sep)[0] !== "..";
}
```

- [ ] **Step 2: Create the image fixtures**

`tests/fixtures/images.mjs`:

```js
// Minimal file headers, enough for content sniffing and dimension reading.
// They are not decodable images; nothing in the CLI decodes pixels.

export function png(width, height) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b[24] = 8; // bit depth
  b[25] = 2; // colour type
  return b;
}

export function jpeg(width, height) {
  return Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03,
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, // SOF0
    0xff, 0xd9,
  ]);
}

export function webp(width, height) {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "latin1");
  b.writeUInt32LE(22, 4);
  b.write("WEBPVP8X", 8, "latin1");
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}

export function mp4() {
  const b = Buffer.alloc(32);
  b.writeUInt32BE(32, 0);
  b.write("ftypisom", 4, "latin1");
  return b;
}
```

- [ ] **Step 3: Write the failing tests**

`tests/inputs.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EXIT } from "../cli/lib/errors.mjs";
import { sniff, imageSize, checkLocalFile, checkHttpsUrl } from "../cli/core/inputs.mjs";
import { png, jpeg, webp, mp4 } from "./fixtures/images.mjs";

const root = realpathSync(mkdtempSync(join(tmpdir(), "kie-root-")));
const outside = realpathSync(mkdtempSync(join(tmpdir(), "kie-outside-")));
const put = (dir, name, buf) => {
  const p = join(dir, name);
  writeFileSync(p, buf);
  return p;
};

describe("type comes from the contents, not the name", () => {
  test("PNG, JPEG, WebP and MP4 are recognised", () => {
    assert.equal(sniff(png(10, 10)).type, "png");
    assert.equal(sniff(jpeg(10, 10)).type, "jpeg");
    assert.equal(sniff(webp(10, 10)).type, "webp");
    assert.equal(sniff(mp4()).kind, "video");
  });

  test("dimensions are read from each image format's header", () => {
    assert.deepEqual(imageSize(png(1280, 720), "png"), { width: 1280, height: 720 });
    assert.deepEqual(imageSize(jpeg(640, 480), "jpeg"), { width: 640, height: 480 });
    assert.deepEqual(imageSize(webp(300, 600), "webp"), { width: 300, height: 600 });
  });

  test("a text file named .png is refused", () => {
    const p = put(root, "notes.png", "just some text, not an image");
    assert.throws(() => checkLocalFile(p), (e) => e.code === EXIT.UNKNOWN && /checked by its content/.test(e.message));
  });

  test("a real image passes with its type, size and dimensions", () => {
    const p = put(root, "still.jpg", png(1024, 576));
    const f = checkLocalFile(p, { roots: [root] });
    assert.equal(f.mime, "image/png", "named .jpg, but it is a PNG");
    assert.equal(f.width, 1024);
    assert.equal(f.path, p);
  });

  test("a video where only images are accepted is refused", () => {
    const p = put(root, "clip.mp4", mp4());
    assert.throws(() => checkLocalFile(p, { kinds: ["image"] }), /not a image file/);
  });

  test("an oversize file is refused", () => {
    const p = put(root, "big.png", Buffer.concat([png(10, 10), Buffer.alloc(2048)]));
    assert.throws(() => checkLocalFile(p, { maxBytes: { image: 1024 } }), /over the .*limit for image/);
  });

  test("a missing file is a clear error", () => {
    assert.throws(() => checkLocalFile(join(root, "nope.png")), /No such file/);
  });
});

describe("only allowed folders, when a server is asking", () => {
  test("a file outside every root is refused, naming the roots", () => {
    const p = put(outside, "secret.png", png(10, 10));
    assert.throws(() => checkLocalFile(p, { roots: [root] }), (e) => e.code === EXIT.UNKNOWN && e.message.includes(root));
  });

  test("a symlink inside a root that points outside it is refused", () => {
    const target = put(outside, "private.png", png(10, 10));
    const link = join(root, "innocent.png");
    symlinkSync(target, link);
    assert.throws(() => checkLocalFile(link, { roots: [root] }), /outside the folders/);
  });

  test("a hidden folder inside a root is refused", () => {
    mkdirSync(join(root, ".ssh"), { recursive: true });
    const p = put(join(root, ".ssh"), "id.png", png(10, 10));
    assert.throws(() => checkLocalFile(p, { roots: [root] }), /hidden/);
  });

  test("with no roots (a human at the CLI) any readable path is fine", () => {
    const p = put(outside, "desk.png", png(10, 10));
    assert.equal(checkLocalFile(p).path, p);
  });
});

describe("URLs", () => {
  test("https passes and is never fetched", () => {
    assert.equal(checkHttpsUrl("https://cdn.example.com/a.png"), "https://cdn.example.com/a.png");
  });

  test("http and other schemes are refused with code 3", () => {
    assert.throws(() => checkHttpsUrl("http://example.com/a.png"), { code: EXIT.UNKNOWN });
    assert.throws(() => checkHttpsUrl("file:///etc/passwd"), { code: EXIT.UNKNOWN });
  });
});
```

- [ ] **Step 4: Run and watch it fail**

Run: `node --test tests/inputs.test.mjs`
Expected: FAIL, cannot find module `../cli/core/inputs.mjs`.

- [ ] **Step 5: Implement `cli/core/inputs.mjs`**

```js
import { closeSync, existsSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { LIBRARY_DIR, RUNS_DIR, isInside } from "../lib/run.mjs";
import { unknown } from "../lib/errors.mjs";

export const MAX_BYTES = { image: 30_000_000, video: 200_000_000, audio: 30_000_000 };
const ACCEPTED = "PNG, JPEG, WebP, MP4, MOV, WAV, MP3, AAC, OGG";

/** What a file is, from its first bytes. Null when it is none of the accepted types. */
export function sniff(buf) {
  const ascii = (a, b) => buf.toString("latin1", a, b);
  const t = (kind, type, mime, ext) => ({ kind, type, mime, ext });
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return t("image", "png", "image/png", ".png");
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return t("image", "jpeg", "image/jpeg", ".jpg");
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return t("image", "webp", "image/webp", ".webp");
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return t("audio", "wav", "audio/wav", ".wav");
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand.startsWith("M4A")) return t("audio", "m4a", "audio/mp4", ".m4a");
    if (brand === "qt  ") return t("video", "mov", "video/quicktime", ".mov");
    return t("video", "mp4", "video/mp4", ".mp4");
  }
  if (ascii(0, 4) === "OggS") return t("audio", "ogg", "audio/ogg", ".ogg");
  if (ascii(0, 3) === "ID3") return t("audio", "mp3", "audio/mpeg", ".mp3");
  if (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return t("audio", "aac", "audio/aac", ".aac");
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x06) !== 0) return t("audio", "mp3", "audio/mpeg", ".mp3");
  return null;
}

/** Width and height from an image header. Null when the header does not say. */
export function imageSize(buf, type) {
  if (type === "png" && buf.length >= 24) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (type === "webp" && buf.length >= 30) {
    const chunk = buf.toString("latin1", 12, 16);
    if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  if (type === "jpeg") {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

/** runs/, library/ and any folders the user listed under allowRoots, as real paths. */
export function allowedRoots(limits) {
  return [RUNS_DIR, LIBRARY_DIR, ...(limits.allowRoots ?? [])]
    .filter((p) => existsSync(p))
    .map((p) => realpathSync(p));
}

/**
 * Everything a local file must pass before it may be sent to a provider.
 * `roots` is set when an MCP client is asking: the file's real path (symlinks
 * followed) must then sit inside one of them, with no hidden segment on the
 * way. A human at the CLI passes no roots; the shell's approval prompt is the
 * guard there.
 */
export function checkLocalFile(path, { roots = null, kinds = ["image", "video", "audio"], maxBytes = MAX_BYTES } = {}) {
  let real;
  try {
    real = realpathSync(resolve(path));
  } catch {
    throw unknown(`No such file: ${path}`);
  }
  const stat = statSync(real);
  if (!stat.isFile()) throw unknown(`${path} is not a file.`);

  if (roots) {
    const root = roots.find((r) => isInside(real, r));
    if (!root) {
      throw unknown(
        `${path} is outside the folders files may be sent from. Allowed: ${roots.join(", ")}. ` +
          `To allow another folder, the user adds it under "allowRoots" in ~/.config/kie/limits.json.`,
      );
    }
    const hidden = relative(root, real).split(sep).find((s) => s.startsWith("."));
    if (hidden) throw unknown(`${path} is or sits in a hidden folder ("${hidden}"); such files are never sent.`);
  }

  const head = Buffer.alloc(64);
  const fd = openSync(real, "r");
  try {
    readSync(fd, head, 0, 64, 0);
  } finally {
    closeSync(fd);
  }
  const type = sniff(head);
  if (!type || !kinds.includes(type.kind)) {
    throw unknown(`${path} is not a ${kinds.join(" or ")} file (checked by its content, not its name). Accepted: ${ACCEPTED}.`);
  }
  const limit = maxBytes[type.kind] ?? MAX_BYTES[type.kind];
  if (stat.size > limit) {
    throw unknown(`${path} is ${(stat.size / 1e6).toFixed(1)}MB, over the ${(limit / 1e6).toFixed(1)}MB limit for ${type.kind}.`);
  }

  const info = { path: real, ...type, bytes: stat.size, width: null, height: null };
  if (type.kind === "image") Object.assign(info, imageSize(readFileSync(real), type.type) ?? {});
  return info;
}

/** https only. The URL is handed to the provider, never fetched from this machine. */
export function checkHttpsUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw unknown(`"${url}" is not a URL.`);
  }
  if (parsed.protocol !== "https:") throw unknown(`Only https:// URLs are accepted, got "${url}".`);
  return parsed.href;
}
```

Check the path to the limits file in the "outside the folders" message against `limitsPath()` in `cli/core/spend.mjs` (plan 2) and use the same path.

- [ ] **Step 6: Run the tests, then everything; commit**

Run: `node --test tests/inputs.test.mjs && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: PASS; `fail 0`.

```bash
git add cli/lib/run.mjs cli/core/inputs.mjs tests/fixtures/images.mjs tests/inputs.test.mjs
git commit -m "Check local files by content, size and allowed folder before sending"
```

---

### Task 2: Safe result downloads

**Files:**
- Modify: `cli/lib/poll.mjs` (`download`), `cli/core/generate.mjs` (one call)
- Test: `tests/download.test.mjs` (4 tests)

- [ ] **Step 1: Write the failing tests**

```js
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { download } from "../cli/lib/poll.mjs";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "kie-dl-")));
const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));
const serve = (bytes) => (globalThis.fetch = async () => new Response(Buffer.alloc(bytes, 7)));

describe("result downloads", () => {
  test("an https result is streamed into the run directory", async () => {
    serve(1000);
    const p = await download("https://cdn.test/a.mp4", join(dir, "a.mp4"), { within: dir });
    assert.equal(readFileSync(p).length, 1000);
  });

  test("a non-https result URL is refused before any request", async () => {
    globalThis.fetch = async () => assert.fail("fetched");
    await assert.rejects(download("http://cdn.test/a.mp4", join(dir, "b.mp4"), { within: dir }), /non-https/);
  });

  test("a body over the cap is cut off and the partial file removed", async () => {
    serve(5000);
    await assert.rejects(download("https://cdn.test/c.mp4", join(dir, "c.mp4"), { within: dir, maxBytes: 1000 }), /over the/);
    assert.ok(!existsSync(join(dir, "c.mp4")));
  });

  test("a destination outside the run directory is refused", async () => {
    serve(10);
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "kie-else-")));
    await assert.rejects(download("https://cdn.test/d.mp4", join(elsewhere, "d.mp4"), { within: dir }), /outside the run directory/);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test tests/download.test.mjs`
Expected: the http, cap and outside tests FAIL.

- [ ] **Step 3: Replace `download` in `cli/lib/poll.mjs`**

Replace the import line `import { writeFile } from "node:fs/promises";` (drop it if nothing else in the file uses `writeFile`) with:

```js
import { createWriteStream, realpathSync, rmSync } from "node:fs";
import { once } from "node:events";
import { dirname } from "node:path";
import { isInside } from "./run.mjs";
```

Add `usage` to the existing `./errors.mjs` import. Replace the `download` function with:

```js
/**
 * Fetch a result the provider returned for this task. https only, streamed
 * with a size ceiling, and written only inside `within` (the run directory),
 * so a strange URL in a task record cannot fill the disk or land elsewhere.
 */
export async function download(url, destPath, { within, maxBytes = 500_000_000 } = {}) {
  if (!/^https:\/\//i.test(url)) throw provider(`Refusing to download a non-https result URL: ${redact(url)}`);
  if (within) {
    const destDir = realpathSync(dirname(destPath));
    const root = realpathSync(within);
    if (destDir !== root && !isInside(destDir, root)) {
      throw usage(`${destPath} is outside the run directory ${within}; results are only written there.`);
    }
  }

  const res = await fetch(url);
  if (!res.ok) throw provider(`Download failed (${res.status}) for ${redact(url)}`);
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) throw provider(`Result is ${declared} bytes, over the ${maxBytes}-byte limit: ${redact(url)}`);

  const out = createWriteStream(destPath);
  let total = 0;
  try {
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > maxBytes) throw provider(`Result grew over the ${maxBytes}-byte limit; download stopped: ${redact(url)}`);
      if (!out.write(chunk)) await once(out, "drain");
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  } catch (err) {
    out.destroy();
    rmSync(destPath, { force: true });
    throw err;
  }
  return destPath;
}
```

If `poll.mjs` names its redaction helper differently, use the existing one.

- [ ] **Step 4: Pass the run directory from `waitJob`**

In `cli/core/generate.mjs`, change `await d.download(url, path);` to:

```js
    await d.download(url, path, { within: dir });
```

`dir` is the run directory `waitJob` already computes for `job.json`. If the variable has another name there, use it.

- [ ] **Step 5: Test and commit**

Run: `node --test tests/download.test.mjs && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: PASS; `fail 0`.

```bash
git add cli/lib/poll.mjs cli/core/generate.mjs tests/download.test.mjs
git commit -m "Download results over https only, size-capped, into the run directory"
```

---

### Task 3: The asset library

**Files:**
- Create: `cli/core/assets.mjs`
- Modify: `.gitignore`
- Test: `tests/assets.test.mjs` (9 tests)

- [ ] **Step 1: Ignore the library**

Append to `.gitignore`:

```
# Saved reference assets (characters, products, screens). Private material,
# like runs/.
/library/
```

- [ ] **Step 2: Write the failing tests**

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EXIT } from "../cli/lib/errors.mjs";
import { openLibrary } from "../cli/core/assets.mjs";
import { png, jpeg } from "./fixtures/images.mjs";

const src = realpathSync(mkdtempSync(join(tmpdir(), "kie-src-")));
const img = (name, buf) => {
  const p = join(src, name);
  writeFileSync(p, buf);
  return p;
};
const zed1 = img("zed-front.png", png(1024, 1024));
const zed2 = img("zed-side.jpg", jpeg(800, 1200));
const lib = (opts) => openLibrary(mkdtempSync(join(tmpdir(), "kie-lib-")), opts);
const zed = { name: "zed", kind: "character", description: "Zed, a small round robot with one blue eye.", images: [zed1, zed2] };

describe("saving an asset", () => {
  test("copies the images in, numbered, with their hash and size", () => {
    const l = lib();
    const a = l.save(zed);
    assert.deepEqual(a.images.map((i) => i.file), ["1.png", "2.jpg"]);
    assert.equal(a.images[1].width, 800);
    assert.match(a.images[0].sha256, /^[0-9a-f]{64}$/);
    assert.ok(existsSync(join(l.dir, "zed", "1.png")));
  });

  test("saving over a name is refused unless replace is set", () => {
    const l = lib();
    l.save(zed);
    assert.throws(() => l.save(zed), (e) => e.code === EXIT.UNKNOWN && /replace/.test(e.message));
  });

  test("replacing keeps the previous version in .history", () => {
    const l = lib();
    l.save(zed);
    l.save({ ...zed, images: [zed2], replace: true });
    assert.equal(l.get("zed").images.length, 1);
    const [version] = readdirSync(join(l.dir, "zed", ".history"));
    assert.ok(existsSync(join(l.dir, "zed", ".history", version, "asset.json")));
    assert.ok(existsSync(join(l.dir, "zed", ".history", version, "2.jpg")));
  });

  test("bad names, kinds, empty descriptions and image counts are refused", () => {
    const l = lib();
    assert.throws(() => l.save({ ...zed, name: "Zed!" }), /lowercase/);
    assert.throws(() => l.save({ ...zed, kind: "vibe" }), /kind must be one of/);
    assert.throws(() => l.save({ ...zed, description: " " }), /needs a description/);
    assert.throws(() => l.save({ ...zed, images: [] }), /1 to 4 images/);
  });

  test("a non-image is refused before anything is written", () => {
    const l = lib();
    assert.throws(() => l.save({ ...zed, images: [img("notes.png", "text")] }), /checked by its content/);
    assert.ok(!existsSync(join(l.dir, "zed")));
  });

  test("with roots set, an image from outside them is refused", () => {
    const l = lib();
    assert.throws(() => l.save(zed, { roots: [join(realpathSync(tmpdir()), "nowhere")] }), /outside the folders/);
  });
});

describe("listing and reading", () => {
  test("list gives names, kinds, descriptions and image counts", () => {
    const l = lib();
    l.save(zed);
    assert.deepEqual(l.list().map(({ name, kind, imageCount }) => ({ name, kind, imageCount })), [
      { name: "zed", kind: "character", imageCount: 2 },
    ]);
  });
});

describe("uploads are reused while kie still has them", () => {
  test("the same image within 20 hours is uploaded once", async () => {
    let now = new Date("2026-10-30T10:00:00Z");
    const l = lib({ now: () => now });
    l.save(zed);
    let uploads = 0;
    const upload = async () => ({ url: `https://files.test/${++uploads}.png` });
    assert.equal(await l.uploadUrl("zed", 1, { upload }), "https://files.test/1.png");
    now = new Date("2026-10-31T05:00:00Z"); // 19 hours later
    assert.equal(await l.uploadUrl("zed", 1, { upload }), "https://files.test/1.png");
    now = new Date("2026-10-31T07:00:00Z"); // 21 hours later: kie may have deleted it
    assert.equal(await l.uploadUrl("zed", 1, { upload }), "https://files.test/2.png");
  });

  test("recordUse lists each run once", () => {
    const l = lib();
    l.save(zed);
    l.recordUse("zed", "film-a");
    l.recordUse("zed", "film-a");
    assert.deepEqual(JSON.parse(readFileSync(join(l.dir, "zed", "asset.json"), "utf8")).usedIn, ["film-a"]);
  });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `node --test tests/assets.test.mjs`
Expected: FAIL, cannot find module.

- [ ] **Step 4: Implement `cli/core/assets.mjs`**

```js
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { LIBRARY_DIR } from "../lib/run.mjs";
import { unknown } from "../lib/errors.mjs";
import { checkLocalFile } from "./inputs.mjs";

export const KINDS = ["character", "product", "location", "style"];
export const ASSET_NAME = /^[a-z0-9][a-z0-9-]{0,80}$/;
// kie deletes uploads after 24 hours (docs.kie.ai file-upload quickstart, read
// 2026-10-30). Reusing one for 20 leaves a margin for a long job.
const REUSE_UPLOAD_MS = 20 * 3_600_000;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * library/<name>/asset.json plus the original images, copied in and never
 * modified. A replaced version moves to .history/<timestamp>/.
 */
export function openLibrary(dir = LIBRARY_DIR, { now = () => new Date() } = {}) {
  const assetDir = (name) => {
    if (!ASSET_NAME.test(name ?? "")) throw unknown(`Asset names are lowercase letters, digits and hyphens, got "${name}".`);
    return join(dir, name);
  };
  const recordPath = (name) => join(assetDir(name), "asset.json");
  const read = (name) => JSON.parse(readFileSync(recordPath(name), "utf8"));
  const write = (record) => {
    const path = recordPath(record.name);
    writeFileSync(`${path}.tmp`, JSON.stringify(record, null, 2) + "\n");
    renameSync(`${path}.tmp`, path);
    return record;
  };

  function list() {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((n) => ASSET_NAME.test(n) && existsSync(join(dir, n, "asset.json")))
      .map((n) => {
        const r = read(n);
        return { name: r.name, kind: r.kind, description: r.description, imageCount: r.images.length, updatedAt: r.updatedAt };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The record, with each image's absolute `path` added (not stored). */
  function get(name) {
    if (!existsSync(recordPath(name))) {
      throw unknown(`No asset "${name}". Saved assets: ${list().map((a) => a.name).join(", ") || "none"}.`);
    }
    const r = read(name);
    return { ...r, images: r.images.map((im) => ({ ...im, path: join(assetDir(name), im.file) })) };
  }

  function save({ name, kind, description, images, replace = false }, { roots = null } = {}) {
    const target = assetDir(name);
    if (!KINDS.includes(kind)) throw unknown(`kind must be one of ${KINDS.join(", ")}, got "${kind}".`);
    if (!description?.trim()) throw unknown("An asset needs a description; it is reused word for word in prompts.");
    if (!Array.isArray(images) || images.length < 1 || images.length > 4) throw unknown("An asset holds 1 to 4 images.");

    // Check and read every source before touching the library, so a bad
    // image leaves nothing half-written, and replacing an asset with one of
    // its own images still works after the old files move to .history.
    const sources = images.map((p) => {
      const info = checkLocalFile(p, { roots, kinds: ["image"] });
      return { info, bytes: readFileSync(info.path) };
    });

    const exists = existsSync(join(target, "asset.json"));
    if (exists && !replace) {
      throw unknown(`Asset "${name}" already exists. Pass replace (--replace) to replace it; the old version is kept in .history/.`);
    }

    const at = now().toISOString();
    let createdAt = at;
    let usedIn = [];
    if (exists) {
      const prev = read(name);
      createdAt = prev.createdAt;
      usedIn = prev.usedIn ?? [];
      const history = join(target, ".history", at.replace(/[:.]/g, "-"));
      mkdirSync(history, { recursive: true });
      renameSync(join(target, "asset.json"), join(history, "asset.json"));
      for (const im of prev.images) {
        if (existsSync(join(target, im.file))) renameSync(join(target, im.file), join(history, im.file));
      }
    }

    mkdirSync(target, { recursive: true });
    const stored = sources.map(({ info, bytes }, i) => {
      const file = `${i + 1}${info.ext}`;
      writeFileSync(join(target, file), bytes);
      return {
        n: i + 1,
        file,
        sha256: sha256(bytes),
        bytes: info.bytes,
        width: info.width,
        height: info.height,
        mime: info.mime,
        upload: null,
      };
    });
    return write({ name, kind, description: description.trim(), images: stored, createdAt, updatedAt: at, usedIn });
  }

  /**
   * A provider URL for image n, uploading only when there is no recent upload
   * of these exact bytes. `upload(path, { mime })` returns `{ url }`.
   */
  async function uploadUrl(name, n, { upload }) {
    const record = read(name);
    const image = record.images.find((im) => im.n === n);
    if (!image) throw unknown(`${name} has images 1-${record.images.length}; there is no #${n}.`);
    const prior = image.upload;
    if (prior && prior.sha256 === image.sha256 && now() - Date.parse(prior.at) < REUSE_UPLOAD_MS) return prior.url;

    const { url } = await upload(join(assetDir(name), image.file), { mime: image.mime });
    image.upload = { url, at: now().toISOString(), sha256: image.sha256 };
    write(record);
    return url;
  }

  function recordUse(name, run) {
    const record = read(name);
    record.usedIn ??= [];
    if (!record.usedIn.includes(run)) {
      record.usedIn.push(run);
      write(record);
    }
  }

  return { dir, list, get, save, uploadUrl, recordUse };
}
```

- [ ] **Step 5: Test and commit**

Run: `node --test tests/assets.test.mjs && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: PASS; `fail 0`.

```bash
git add cli/core/assets.mjs tests/assets.test.mjs .gitignore
git commit -m "Add the asset library: named references with history and upload reuse"
```

---

### Task 4: Expand references and check route limits

**Files:**
- Create: `cli/core/refs.mjs`
- Modify: `cli/lib/models.mjs` (`parseRef`, `buildInput`), `cli/lib/upload.mjs`, `cli/models.json`, `tests/cli.test.mjs`
- Test: `tests/refs.test.mjs` (11 tests)

- [ ] **Step 1: Write the failing tests**

`tests/refs.test.mjs`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EXIT } from "../cli/lib/errors.mjs";
import { loadCatalog, buildInput, parseRef } from "../cli/lib/models.mjs";
import { openLibrary } from "../cli/core/assets.mjs";
import { expandRefs } from "../cli/core/refs.mjs";
import { png } from "./fixtures/images.mjs";

const catalog = loadCatalog();
const src = realpathSync(mkdtempSync(join(tmpdir(), "kie-refsrc-")));
const file = (name, buf) => {
  const p = join(src, name);
  writeFileSync(p, buf);
  return p;
};
const library = openLibrary(mkdtempSync(join(tmpdir(), "kie-reflib-")));
library.save({ name: "zed", kind: "character", description: "Zed.", images: [file("a.png", png(1024, 1024)), file("b.png", png(900, 1600))] });
library.save({ name: "crm", kind: "product", description: "The CRM screen.", images: [file("c.png", png(1920, 1080))] });

let uploads = 0;
const upload = async () => ({ url: `https://files.test/${++uploads}.png` });
const expand = (refs, opts = {}) => expandRefs(refs, { catalog, library, upload, ...opts });

describe("expansion order and the mapping", () => {
  test("assets expand in stored order, refs in the order given, numbered across images", async () => {
    const r = await expand([{ source: "zed", role: "identity" }, { source: "crm#1", role: "identity" }]);
    assert.deepEqual(r.refMapping, ["@Image1 = zed#1", "@Image2 = zed#2", "@Image3 = crm#1"]);
    assert.equal(r.refs.length, 3);
    assert.ok(r.refs.every((x) => x.url.startsWith("https://files.test/")));
    assert.deepEqual(r.assets, ["zed", "crm"]);
  });

  test("a URL passes through unfetched, and a dry run uploads nothing", async () => {
    const before = uploads;
    const r = await expand([{ source: "zed#2", role: "first_frame" }, { source: "https://cdn.test/s.png", role: "identity" }], { dryRun: true });
    assert.equal(uploads, before);
    assert.equal(r.refs[0].url, "pending-upload:zed#2");
    assert.equal(r.refs[1].url, "https://cdn.test/s.png");
  });
});

describe("refused before anything is uploaded", () => {
  test("a multi-image asset as a first frame, naming the choices", async () => {
    await assert.rejects(expand([{ source: "zed", role: "first_frame" }]), (e) => e.code === EXIT.UNKNOWN && /zed#1, zed#2/.test(e.message));
  });

  test("#n out of range", async () => {
    await assert.rejects(expand([{ source: "zed#3", role: "identity" }]), /images 1-2; there is no #3/);
  });

  test("two first frames", async () => {
    await assert.rejects(expand([{ source: "zed#1", role: "first_frame" }, { source: "crm", role: "first_frame" }]), /exactly one/);
  });

  test("an unknown role", async () => {
    await assert.rejects(expand([{ source: "zed", role: "vibes" }]), /Unknown reference role/);
  });

  test("http://", async () => {
    await assert.rejects(expand([{ source: "http://cdn.test/a.png", role: "identity" }]), /Only https/);
  });

  test("a local file outside the roots, when roots are set", async () => {
    await assert.rejects(expand([{ source: file("x.png", png(10, 10)), role: "identity" }], { roots: ["/nonexistent-root"] }), /outside the folders/);
  });
});

describe("route limits are checked after expansion", () => {
  const seedance = catalog.models["seedance-2-5"].routes.find((r) => r.provider === "kie");

  test("Seedance 2.5 refuses a first frame combined with reference images", async () => {
    const { refs } = await expand([{ source: "zed#1", role: "first_frame" }, { source: "crm", role: "identity" }], { dryRun: true });
    assert.match(buildInput(seedance, { prompt: "x", refs }).problems.join("\n"), /cannot combine first_frame with identity/);
  });

  test("an image under Seedance 2.5's 300px minimum is refused, naming it", async () => {
    const { refs } = await expand([{ source: file("tiny.png", png(200, 200)), role: "identity" }], { dryRun: true });
    assert.match(buildInput(seedance, { prompt: "x", refs }).problems.join("\n"), /tiny\.png: 200×200 is outside .*300-6000px/);
  });
});

test("--ref accepts an asset name, and still refuses a raw local path", () => {
  assert.deepEqual(parseRef("zed#2:first_frame"), { source: "zed#2", role: "first_frame" });
  assert.throws(() => parseRef("./logo.png:identity"), /local path is not a remote attachment/);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `node --test tests/refs.test.mjs`
Expected: FAIL, cannot find module `../cli/core/refs.mjs`.

- [ ] **Step 3: Implement `cli/core/refs.mjs`**

```js
import { basename } from "node:path";
import { unknown } from "../lib/errors.mjs";
import { checkHttpsUrl, checkLocalFile } from "./inputs.mjs";

const ASSET_REF = /^([a-z0-9][a-z0-9-]{0,80})(?:#(\d+))?$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SINGLE = new Set(["first_frame", "last_frame"]);
const LABEL = { image: "Image", video: "Video", audio: "Audio" };

const kindFromUrl = (url) =>
  /\.(mp4|mov|webm)(\?|$)/i.test(url) ? "video" : /\.(mp3|wav|m4a|aac|ogg)(\?|$)/i.test(url) ? "audio" : "image";

/**
 * Turn `{ source, role }` references into provider URLs, in order:
 *   zed       every image of asset zed, in stored order
 *   zed#2     image 2 of zed
 *   https://  passed through, never fetched here
 *   a path    checked (and confined to `roots` when set), then uploaded
 * Returns the refs for buildInput plus `refMapping` ("@Image1 = zed#1"),
 * numbered per type in the order the provider will see them.
 */
export async function expandRefs(refs, { catalog, library, upload, roots = null, dryRun = false }) {
  const out = [];
  for (const { source, role } of refs) {
    if (!catalog.roles.includes(role)) {
      throw unknown(`Unknown reference role "${role}". Roles: ${catalog.roles.join(", ")}.`);
    }

    if (SCHEME.test(source ?? "")) {
      const url = checkHttpsUrl(source);
      out.push({ url, role, label: url, kind: kindFromUrl(url) });
      continue;
    }

    const m = (source ?? "").match(ASSET_REF);
    if (m) {
      const asset = library.get(m[1]);
      let images = asset.images;
      if (m[2]) {
        const n = Number(m[2]);
        const image = images.find((im) => im.n === n);
        if (!image) throw unknown(`${asset.name} has images 1-${images.length}; there is no #${n}.`);
        images = [image];
      } else if (SINGLE.has(role) && images.length > 1) {
        throw unknown(
          `${role} takes one image, and asset "${asset.name}" has ${images.length}. ` +
            `Pick one: ${images.map((im) => `${asset.name}#${im.n}`).join(", ")}.`,
        );
      }
      for (const im of images) {
        const url = dryRun ? `pending-upload:${asset.name}#${im.n}` : await library.uploadUrl(asset.name, im.n, { upload });
        out.push({
          url,
          role,
          label: `${asset.name}#${im.n}`,
          kind: "image",
          asset: asset.name,
          file: { mime: im.mime, bytes: im.bytes, width: im.width, height: im.height },
        });
      }
      continue;
    }

    const f = checkLocalFile(source, { roots });
    const url = dryRun ? `pending-upload:${basename(f.path)}` : (await upload(f.path, { mime: f.mime })).url;
    out.push({
      url,
      role,
      label: basename(f.path),
      kind: f.kind,
      file: { mime: f.mime, bytes: f.bytes, width: f.width, height: f.height },
    });
  }

  for (const role of SINGLE) {
    const given = out.filter((r) => r.role === role);
    if (given.length > 1) throw unknown(`${role} takes exactly one image; ${given.length} were given.`);
    if (given[0] && given[0].kind !== "image") throw unknown(`${role} must be an image, got ${given[0].kind}.`);
  }

  const counters = {};
  const refMapping = out.map((r) => {
    counters[r.kind] = (counters[r.kind] ?? 0) + 1;
    return `@${LABEL[r.kind]}${counters[r.kind]} = ${r.label}`;
  });
  return { refs: out, refMapping, assets: [...new Set(out.filter((r) => r.asset).map((r) => r.asset))] };
}
```

Note the ordering consequence: a local file (non-dry-run) is uploaded as soon as it is reached, so a later reference that fails a check can leave an earlier one uploaded. kie uploads cost nothing and expire in 24 hours, so this is accepted rather than adding a second pass.

- [ ] **Step 4: `parseRef` accepts asset names (`cli/lib/models.mjs`)**

Replace everything in `parseRef` after `const role = spec.slice(idx + 1);` with:

```js
  // A saved asset: `zed` (all its images) or `zed#2` (one of them).
  if (/^[a-z0-9][a-z0-9-]{0,80}(#\d+)?$/.test(url)) return { source: url, role };

  if (!/^https?:\/\//i.test(url)) {
    throw usage(
      `A local path is not a remote attachment: "${url}".\n` +
        `Run \`kie upload ${url}\` first and pass the URL it prints, or save it as an asset ` +
        `(kie asset save) and pass its name.`,
    );
  }
  return { source: url, role };
```

Update the doc comment above `parseRef` (`--ref <url>:<role>`) to `--ref <url|asset|asset#n>:<role>`.

In `tests/cli.test.mjs`, the test "a URL containing colons still splits on the last one" expects `{ url, role }`. Change its expected object's `url:` key to `source:`.

Run `grep -rn "parseRef" cli/` and confirm no caller reads `.url` from a parsed ref (`cmdPreflight` and `validateVideoRequest` read only `role`).

- [ ] **Step 5: `buildInput` checks route limits**

In `buildInput`, directly before the reference-rules block (the comment beginning `// Combinations the provider documents as impossible`), add:

```js
  // Documented per-route limits, checked after asset expansion so `zed`
  // counts as however many images it holds.
  const refLimits = schema.refLimits ?? {};
  for (const [field, max] of Object.entries(refLimits.maxCount ?? {})) {
    const n = Array.isArray(out[field]) ? out[field].length : 0;
    if (n > max) problems.push(`${route.model} takes at most ${max} in ${field}; got ${n}.`);
  }
  const img = refLimits.image;
  for (const r of img ? values.refs ?? [] : []) {
    const f = r.file;
    if (!f?.mime?.startsWith("image/")) continue;
    const name = r.label ?? r.url;
    if (f.width && f.height) {
      if (Math.min(f.width, f.height) < img.minSide || Math.max(f.width, f.height) > img.maxSide) {
        problems.push(`${name}: ${f.width}×${f.height} is outside ${route.model}'s ${img.minSide}-${img.maxSide}px per side.`);
      }
      const aspect = f.width / f.height;
      if (aspect < img.minAspect || aspect > img.maxAspect) {
        problems.push(`${name}: aspect ${aspect.toFixed(2)} is outside ${route.model}'s ${img.minAspect}-${img.maxAspect}.`);
      }
    }
    if (f.bytes > img.maxBytes) {
      problems.push(`${name}: ${(f.bytes / 1e6).toFixed(1)}MB is over ${route.model}'s ${img.maxBytes / 1e6}MB per image.`);
    }
  }
```

- [ ] **Step 6: Seedance 2.5's limits in `cli/models.json`**

In the `seedance-2-5` kie route's `input` object, after `refRules`, add:

```json
"refLimits": {
  "maxCount": { "reference_image_urls": 30 },
  "image": { "minSide": 300, "maxSide": 6000, "minAspect": 0.4, "maxAspect": 2.5, "maxBytes": 30000000 },
  "source": "docs.kie.ai/market/bytedance/seedance-2-5.md, read 2026-10-30"
}
```

Run `npm run validate 2>&1 | tail -2` afterwards; if the catalog validator rejects the unknown key, add `refLimits` to its list of allowed `input` keys next to `refRules`.

- [ ] **Step 7: `uploadFile` accepts a verified mime (`cli/lib/upload.mjs`)**

Change the signature to `export async function uploadFile(catalog, path, { providerName = "kie", mime: knownMime } = {})` and the mime line to:

```js
  const mime = knownMime ?? MIME[ext];
```

(keep the existing "unsupported type" error for when both are missing).

- [ ] **Step 8: Test and commit**

Run: `node --test tests/refs.test.mjs && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: PASS; `fail 0`.

```bash
git add cli/core/refs.mjs cli/lib/models.mjs cli/lib/upload.mjs cli/models.json tests/refs.test.mjs tests/cli.test.mjs
git commit -m "Expand asset references in order with a numbered mapping, and check route limits"
```

(add the validator file too if Step 6 changed it).

---

### Task 5: CLI: `kie asset`, asset references, checked uploads

**Files:**
- Modify: `cli/kie.mjs`, `cli/core/generate.mjs`

- [ ] **Step 1: The job record carries the mapping (`cli/core/generate.mjs`)**

In `submitJob`, add `record = {}` to the fields destructured from `req`, and add `...record,` as the first entry of the object passed to `reserve(store, { ... })`. A caller can now attach `{ refMapping, assets }` to the job record. Add one line to the `submitJob` doc comment: "`req.record` holds extra fields for the job record, such as the reference mapping."

- [ ] **Step 2: Imports and options (`cli/kie.mjs`)**

```js
import { openLibrary, KINDS } from "./core/assets.mjs";
import { expandRefs } from "./core/refs.mjs";
import { checkLocalFile } from "./core/inputs.mjs";
```

`OPTS` additions:

```js
  kind: { type: "string" },
  description: { type: "string" },
  replace: { type: "boolean", default: false },
```

- [ ] **Step 3: Expand references in `cmdVideo` and `cmdImage`**

Add a helper above `cmdVideo`:

```js
/** Parsed --ref values → provider URLs plus the @Image mapping. Asset uploads are reused for 20h. */
async function refsFor(catalog, args, parsed) {
  if (!parsed.length) return { refs: [], refMapping: [], assets: [] };
  const library = openLibrary();
  const expanded = await expandRefs(parsed, {
    catalog,
    library,
    upload: (path, opts) => uploadFile(catalog, path, opts),
    dryRun: args["dry-run"],
  });
  if (!args["dry-run"]) for (const name of expanded.assets) library.recordUse(name, args.run);
  for (const line of expanded.refMapping) say(`  ref ${line}`);
  return expanded;
}
```

In `cmdVideo`:

1. Rename `const refs = (args.ref ?? []).map(parseRef);` to `const parsedRefs = (args.ref ?? []).map(parseRef);`, and pass `refs: parsedRefs` to `validateVideoRequest`. Role checks stay free and come first.
2. Directly after the `if (problems.length) { ... }` block, add:

   ```js
     const { refs, refMapping, assets } = await refsFor(catalog, args, parsedRefs);
   ```

3. Add `refMapping,` after `refs,` in the `inputs.json` record.
4. Pass `record: { refMapping, assets }` in the object given to `generate`, next to `artifactBase`.

In `cmdImage`, do the same: rename to `parsedRefs`, then `const { refs, refMapping, assets } = await refsFor(catalog, args, parsedRefs);` straight after, add `refMapping` to the `image-inputs.json` record, and pass `record: { refMapping, assets }` to `generate`.

In `generate` (`cli/kie.mjs`), accept `record` in its destructured parameter and pass `record` in the request object it gives to `submitJob`.

The expanded refs carry `label`, `kind` and `file` besides `url` and `role`; `buildInput` uses `url`, `role` and (for `refLimits`) `file` and `label`.

- [ ] **Step 4: `kie asset`**

Add after `cmdLimits`:

```js
function cmdAsset(args, positionals) {
  const [action, name, ...images] = positionals;
  const library = openLibrary();

  if (action === "save") {
    if (!name || !images.length || !args.kind || !args.description) {
      throw usage(`kie asset save <name> <image>... --kind ${KINDS.join("|")} --description "..." [--replace]`);
    }
    const a = library.save({ name, kind: args.kind, description: args.description, images, replace: args.replace });
    say(`saved ${a.name} (${a.kind}), ${a.images.length} image(s) in ${join(library.dir, a.name)}`);
    for (const im of a.images) say(`  #${im.n}  ${im.file}  ${im.width ?? "?"}×${im.height ?? "?"}`);
    return EXIT.OK;
  }

  if (action === "list" || !action) {
    const all = library.list();
    if (args.json) {
      say(JSON.stringify(all, null, 2));
      return EXIT.OK;
    }
    if (!all.length) say(`No assets yet. Save one: kie asset save <name> <image>... --kind K --description "..."`);
    for (const a of all) say(`  ${a.name.padEnd(20)} ${a.kind.padEnd(10)} ${a.imageCount} image(s)  ${a.description.slice(0, 60)}`);
    return EXIT.OK;
  }

  if (action === "show") {
    if (!name) throw usage("kie asset show <name>");
    const a = library.get(name);
    if (args.json) {
      say(JSON.stringify(a, null, 2));
      return EXIT.OK;
    }
    say(`${a.name}  (${a.kind})`);
    say(`  ${a.description}`);
    for (const im of a.images) {
      say(`  #${im.n}  ${im.path}  ${im.width ?? "?"}×${im.height ?? "?"}  ${im.upload ? `uploaded ${im.upload.at}` : "not uploaded"}`);
    }
    if (a.usedIn?.length) say(`  used in: ${a.usedIn.join(", ")}`);
    return EXIT.OK;
  }

  throw usage("kie asset save|list|show");
}
```

(add `join` to the `node:path` import if `kie.mjs` does not already have it.)

In `main`'s switch:

```js
    case "asset":
      return cmdAsset(args, positionals);
```

In `HELP`, after the `kie upload` line:

```
  kie asset      save <name> <image>... --kind K --description "..." [--replace]
                 list | show <name>      saved references; use as --ref zed:identity or --ref zed#2:first_frame
```

- [ ] **Step 5: `kie upload` checks contents first**

In the `case "upload":` block, replace the `uploadFile` line with:

```js
      const file = checkLocalFile(positionals[0]);
      const { url, bytes, mime } = await uploadFile(catalog, file.path, { providerName: args.provider ?? "kie", mime: file.mime });
```

(keep the rest of the block).

- [ ] **Step 6: Check by hand, spending nothing**

Every command here is local or `--dry-run`, against temp folders:

```bash
node --check cli/kie.mjs
export KIE_LIBRARY_DIR=$(mktemp -d) KIE_RUNS_DIR=$(mktemp -d)
node -e 'import("./tests/fixtures/images.mjs").then((m) => { const fs = require("fs"); fs.writeFileSync("/tmp/kie-zed.png", m.png(1024, 1024)); fs.writeFileSync("/tmp/kie-zed2.png", m.png(900, 1600)); fs.writeFileSync("/tmp/kie-prompt.txt", "Shot 1: Zed waves at the camera."); })'
node cli/kie.mjs asset save zed /tmp/kie-zed.png /tmp/kie-zed2.png --kind character --description "Zed, a small round robot."
node cli/kie.mjs asset list
node cli/kie.mjs asset show zed
node cli/kie.mjs video --run plan3-check --model seedance-2-5 --prompt-file /tmp/kie-prompt.txt --duration 4 --resolution 480p --provider kie --ref zed:identity --dry-run; echo "exit $?"
node cli/kie.mjs video --run plan3-check --model seedance-2-5 --prompt-file /tmp/kie-prompt.txt --duration 4 --resolution 480p --provider kie --ref zed:first_frame --dry-run; echo "exit $?"
rm -rf "$KIE_LIBRARY_DIR" "$KIE_RUNS_DIR" /tmp/kie-zed.png /tmp/kie-zed2.png /tmp/kie-prompt.txt
unset KIE_LIBRARY_DIR KIE_RUNS_DIR
```

Expected, in order:
1. no output;
2. `saved zed (character), 2 image(s) in ...`;
3. a `zed  character  2 image(s)` line;
4. two image lines, each `not uploaded`;
5. `ref @Image1 = zed#1`, `ref @Image2 = zed#2`, a dry-run body containing `pending-upload:zed#1`, `exit 0`;
6. `first_frame takes one image ... Pick one: zed#1, zed#2`, `exit 3`.

- [ ] **Step 7: Run everything and commit**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `fail 0`.

```bash
git add cli/kie.mjs cli/core/generate.mjs
git commit -m "Add kie asset, asset references in --ref, and content-checked uploads"
```

---

### Task 6: Documentation and spec log

**Files:**
- Modify: `cli/README.md`, `skills/motion-design/references/tool-routing.md`, `docs/superpowers/specs/2026-10-30-mcp-server-design.md`

- [ ] **Step 1: `cli/README.md`.** Add a section after "Job records and the daily cap":

```markdown
### Saved references (assets)

`kie asset save zed front.png side.png --kind character --description "Zed, a small round robot with one blue eye."`
copies the images into `library/zed/` (gitignored). Use them in any job:
`--ref zed:identity` sends every image of `zed`, `--ref zed#2:first_frame`
sends image 2. The CLI prints the mapping the prompt should use
(`@Image1 = zed#1`) and records it in the run. Uploads are reused for 20
hours, since kie deletes them after 24. Saving over a name needs
`--replace`; the previous version moves to `library/zed/.history/`.

Every file is checked by its contents before it is sent: PNG, JPEG, WebP,
MP4, MOV, WAV, MP3, AAC or OGG, under 30 MB (200 MB for video). Results are
downloaded only from https URLs, only into the run directory.
```

- [ ] **Step 2: `tool-routing.md`.** Add a task-table row:

```markdown
| Reuse a character, product or screen across jobs | `kie asset save <name> <image>... --kind K --description "..."`, then `--ref <name>:identity` or `--ref <name>#n:first_frame` |
```

- [ ] **Step 3: Spec revision log.** Append:

```markdown
- 2026-10-30, while planning steps 4-5: the content checks apply wherever a file can leave the machine (uploads, local references, asset images); the allowed-folders rule applies to every path the MCP server receives. The CLI keeps accepting any path a human types, guarded by the host's command approval, and its `--ref` still refuses raw local paths (assets and URLs only). Reference expansion lives in `core/refs.mjs`.
```

- [ ] **Step 4: Validate, test, commit**

Run: `npm run validate 2>&1 | tail -2 && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: validator success; `fail 0`.

```bash
git add cli/README.md skills/motion-design/references/tool-routing.md docs/superpowers/specs/2026-10-30-mcp-server-design.md
git commit -m "Document assets, reference mapping and file checks"
```

---

## Done when

- `npm test` passes with 37 new tests (13 + 4 + 9 + 11).
- `kie asset save|list|show` work against a temp library, and `--ref zed:identity --dry-run` prints the `@Image` mapping.
- A multi-image asset as `first_frame` is refused with the choices named.
- Nothing was spent and nothing was uploaded: the hand checks are dry runs against temp folders.
