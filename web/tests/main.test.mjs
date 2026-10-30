import { tmp } from "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

const { needsBuild, listenOnFreePort, shutdown } = await import("../server/main.mjs");
const { createApp } = await import("../server/app.mjs");

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

describe("shutdown", () => {
  test("stops the running tasks (so their tools are killed), then closes the server, and says when it is done", async () => {
    const app = createApp({ key: "k", distDir: join(tmp, "nodist"), pollMs: 60_000 });
    await new Promise((r) => app.listen(0, "127.0.0.1", r));
    let aborted = false;
    const t = app.tasks.start("zed", "assemble", "Assemble", ({ signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => ((aborted = true), reject(new Error("stopped"))))));
    await new Promise((r) => setImmediate(r));
    await shutdown(app);
    assert.equal(aborted, true);
    assert.equal(app.tasks.get(t.id).state, "failed");
    assert.match(app.tasks.get(t.id).error, /studio was shut down/);
    assert.equal(app.listening, false);
  });

  test("does not wait forever for a task that ignores the stop", async () => {
    const app = createApp({ key: "k", distDir: join(tmp, "nodist"), pollMs: 60_000 });
    await new Promise((r) => app.listen(0, "127.0.0.1", r));
    let release;
    app.tasks.start("zed", "assemble", "Assemble", () => new Promise((r) => (release = r)));
    await new Promise((r) => setImmediate(r));
    const began = Date.now();
    await shutdown(app, { waitMs: 100 });
    assert.ok(Date.now() - began < 2000);
    assert.equal(app.listening, false);
    release({ outputs: [] });
    await app.tasks.idle();
  });
});
