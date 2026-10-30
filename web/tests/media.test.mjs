import { tmp, RUNS, LIBRARY, KEY, req } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
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
writeFileSync(join(RUNS, "zed", "big.mp4"), Buffer.alloc(5 * 1024 * 1024, 7));
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

  test("a suffix Range is the last N bytes", async () => {
    const r = await req(port, "/media/runs/zed/out.mp4", { key: null, headers: { ...cookie, range: "bytes=-3" } });
    assert.equal(r.status, 206);
    assert.equal(r.headers["content-range"], "bytes 7-9/10");
    assert.equal(r.text, "789");
  });

  test("a suffix longer than the file is the whole file as 206", async () => {
    const r = await req(port, "/media/runs/zed/out.mp4", { key: null, headers: { ...cookie, range: "bytes=-500" } });
    assert.equal(r.status, 206);
    assert.equal(r.headers["content-range"], "bytes 0-9/10");
    assert.equal(r.text, "0123456789");
  });

  test("a zero-length suffix is 416", async () => {
    const r = await req(port, "/media/runs/zed/out.mp4", { key: null, headers: { ...cookie, range: "bytes=-0" } });
    assert.equal(r.status, 416);
    assert.equal(r.headers["content-range"], "bytes */10");
  });

  test("a backwards Range is invalid and ignored: the whole file as 200", async () => {
    const r = await req(port, "/media/runs/zed/out.mp4", { key: null, headers: { ...cookie, range: "bytes=5-2" } });
    assert.equal(r.status, 200);
    assert.equal(r.text, "0123456789");
  });

  test("a client that hangs up mid-download does not hurt the server", async () => {
    for (const range of [undefined, "bytes=0-"]) {
      await new Promise((resolve, reject) => {
        const headers = { host: `127.0.0.1:${port}`, ...cookie, ...(range ? { range } : {}) };
        const r = request({ host: "127.0.0.1", port, path: "/media/runs/zed/big.mp4", headers }, (res) => {
          res.once("data", () => {
            r.destroy();
            res.destroy();
          });
          res.on("error", () => {});
          res.on("close", resolve);
        });
        r.on("error", () => {});
        r.end();
        setTimeout(() => reject(new Error("download never started")), 5000).unref();
      });
      const ok = await req(port, "/media/runs/zed/out.mp4", { key: null, headers: cookie });
      assert.equal(ok.status, 200);
      assert.equal(ok.text, "0123456789");
    }
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
