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
