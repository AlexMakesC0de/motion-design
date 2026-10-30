import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EXIT } from "../cli/lib/errors.mjs";
import { sniff, imageSize, checkLocalFile, checkHttpsUrl, confinePath } from "../cli/core/inputs.mjs";
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

describe("URLs", () => {
  test("https passes and is never fetched", () => {
    assert.equal(checkHttpsUrl("https://cdn.example.com/a.png"), "https://cdn.example.com/a.png");
  });

  test("http and other schemes are refused with code 3", () => {
    assert.throws(() => checkHttpsUrl("http://example.com/a.png"), { code: EXIT.UNKNOWN });
    assert.throws(() => checkHttpsUrl("file:///etc/passwd"), { code: EXIT.UNKNOWN });
  });
});
