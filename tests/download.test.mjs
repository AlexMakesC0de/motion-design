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
