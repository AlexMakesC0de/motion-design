import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadFile } from "../cli/lib/upload.mjs";
import { png } from "./fixtures/images.mjs";

const catalog = { providers: { kie: { label: "kie.ai", keyEnv: "KIE_TEST_UPLOAD_KEY", keyFile: ".nope", baseUrl: "https://api.example", upload: { host: "https://up.example", base64: "/up" } } } };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.KIE_TEST_UPLOAD_KEY;
});

describe("uploadFile", () => {
  test("two different pictures with the same file name get different upload names", async () => {
    process.env.KIE_TEST_UPLOAD_KEY = "test";
    const sent = [];
    globalThis.fetch = async (_url, init) => {
      const { fileName } = JSON.parse(init.body);
      sent.push(fileName);
      return new Response(JSON.stringify({ data: { downloadUrl: `https://files.example/motion-design/${fileName}` } }), { status: 200 });
    };
    const dir = mkdtempSync(join(tmpdir(), "kie-up-"));
    for (const [sub, w] of [["a", 600], ["b", 700]]) {
      mkdirSync(join(dir, sub));
      writeFileSync(join(dir, sub, "1.png"), png(w, 400));
    }
    const a = await uploadFile(catalog, join(dir, "a", "1.png"));
    const b = await uploadFile(catalog, join(dir, "b", "1.png"));
    assert.notEqual(sent[0], sent[1]);
    assert.notEqual(a.url, b.url);
    assert.match(sent[0], /^1-[0-9a-f]{16}\.png$/);
    // The same bytes keep the same name: a re-upload replaces the file with itself.
    await uploadFile(catalog, join(dir, "a", "1.png"));
    assert.equal(sent[2], sent[0]);
  });
});
