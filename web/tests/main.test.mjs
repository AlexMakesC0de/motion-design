import { tmp } from "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

const { needsBuild, listenOnFreePort } = await import("../server/main.mjs");

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
