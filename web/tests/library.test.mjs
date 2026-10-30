import { KEY, RUNS, LIBRARY, tmp, req } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { png, mp4 } from "../../tests/fixtures/images.mjs";

const { createApp } = await import("../server/app.mjs");
const { createRouter, createHandler } = await import("../server/http.mjs");
const { registerLibrary, MAX_UPLOAD } = await import("../server/api/library.mjs");
const { MAX_BYTES } = await import("../../cli/core/inputs.mjs");
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
    assert.match(r.json.error.message, /^clip\.mp4 is not an image file \(checked by its content/);
    assert.match(r.json.error.message, /Accepted: PNG, JPEG, WebP\.$/);
    assert.doesNotMatch(r.json.error.message, /\.incoming/);
    assert.equal(leftovers().length, before);
  });

  test("the upload ceiling is core's image limit, since the library takes images only", () => {
    assert.equal(MAX_UPLOAD, MAX_BYTES.image);
  });

  test("an image over the 30 MB image limit is 413, and nothing is kept", async () => {
    const before = leftovers().length;
    const big = Buffer.alloc(30_500_000);
    png(100, 100).copy(big);
    const r = await drop(big, "huge.png");
    assert.equal(r.status, 413);
    assert.match(r.json.error.message, /^huge\.png is over 30 MB/);
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
