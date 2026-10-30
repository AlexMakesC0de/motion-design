import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RUNS, hasFfmpeg, realMp4, stubs, connect, call, errorOf } from "./helpers.mjs";

const skip = !hasFfmpeg && "ffmpeg not installed";
const { deps } = stubs();
const client = await connect(deps);
const dir = join(RUNS, "finish-demo");
mkdirSync(dir, { recursive: true });
if (hasFfmpeg) realMp4(join(dir, "a.mp4"));

describe("finishing, local and free", { skip }, () => {
  test("frames writes a contact sheet into the run and returns it as an image", async () => {
    const r = await call(client, "frames", { run: "finish-demo", video: "a.mp4" });
    assert.ok(r.structuredContent.sheet.startsWith(join(dir, "a-frames")));
    assert.equal(r.structuredContent.times.length, 8);
    assert.equal(r.content.filter((c) => c.type === "image").length, 1);
  });

  test("probe reads duration and size", async () => {
    const r = await call(client, "probe", { run: "finish-demo", file: "a.mp4" });
    assert.equal(r.structuredContent.width, 320);
    assert.ok(Math.abs(r.structuredContent.durationS - 2) < 0.2);
  });

  test("variants makes a square cut in the run", async () => {
    const r = await call(client, "variants", { run: "finish-demo", video: "a.mp4", ratios: ["1:1"] });
    const v = r.structuredContent.variants[0];
    assert.equal(v.width, v.height);
    assert.ok(v.out.startsWith(dir));
  });

  test("a shot outside the allowed folders is refused with code 3", async () => {
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "kie-else-")));
    const outside = realMp4(join(elsewhere, "b.mp4"));
    const r = await call(client, "assemble", { run: "finish-demo", shots: [outside] });
    assert.equal(errorOf(r).code, 3);
    assert.match(r.content[0].text, /outside the folders/);
  });

  test("an output name with a path is refused with code 3", async () => {
    const r = await call(client, "assemble", { run: "finish-demo", shots: ["a.mp4"], out: "../escape.mp4" });
    assert.equal(errorOf(r).code, 3);
    assert.match(r.content[0].text, /plain file name/);
  });
});

describe("what a client may smuggle into a local render or filter", () => {
  test("a transition kind that is not a plain xfade name is refused by the schema", async () => {
    const r = await call(client, "assemble", {
      run: "finish-demo",
      shots: ["a.mp4", "a.mp4"],
      transition: { kind: "fade:duration=1,movie=/etc/hosts", seconds: 0.5 },
    });
    assert.equal(r.isError, true);
  });

  test("render props naming a file outside the allowed folders, or a file: URL, are refused with code 3", async () => {
    const outside = join(realpathSync(mkdtempSync(join(tmpdir(), "kie-props-"))), "logo.png");
    writeFileSync(outside, "x");
    const a = await call(client, "render", { run: "finish-demo", template: "logo-reveal", props: { logo: outside } });
    assert.equal(errorOf(a).code, 3);
    assert.match(a.content[0].text, /outside the folders/);
    const b = await call(client, "render", { run: "finish-demo", template: "logo-reveal", props: { shots: [{ src: "file:///etc/x.png" }] } });
    assert.equal(errorOf(b).code, 3);
    assert.match(b.content[0].text, /file: URL/);
  });
});
