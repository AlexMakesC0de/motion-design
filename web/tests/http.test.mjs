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
