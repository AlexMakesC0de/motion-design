import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EXIT } from "../cli/lib/errors.mjs";
import { loadCatalog, buildInput, parseRef } from "../cli/lib/models.mjs";
import { openLibrary } from "../cli/core/assets.mjs";
import { expandRefs } from "../cli/core/refs.mjs";
import { png } from "./fixtures/images.mjs";

const catalog = loadCatalog();
const src = realpathSync(mkdtempSync(join(tmpdir(), "kie-refsrc-")));
const file = (name, buf) => {
  const p = join(src, name);
  writeFileSync(p, buf);
  return p;
};
const library = openLibrary(mkdtempSync(join(tmpdir(), "kie-reflib-")));
library.save({ name: "zed", kind: "character", description: "Zed.", images: [file("a.png", png(1024, 1024)), file("b.png", png(900, 1600))] });
library.save({ name: "crm", kind: "product", description: "The CRM screen.", images: [file("c.png", png(1920, 1080))] });

let uploads = 0;
const upload = async () => ({ url: `https://files.test/${++uploads}.png` });
const expand = (refs, opts = {}) => expandRefs(refs, { catalog, library, upload, ...opts });

describe("expansion order and the mapping", () => {
  test("assets expand in stored order, refs in the order given, numbered across images", async () => {
    const r = await expand([{ source: "zed", role: "identity" }, { source: "crm#1", role: "identity" }]);
    assert.deepEqual(r.refMapping, ["@Image1 = zed#1", "@Image2 = zed#2", "@Image3 = crm#1"]);
    assert.equal(r.refs.length, 3);
    assert.ok(r.refs.every((x) => x.url.startsWith("https://files.test/")));
    assert.deepEqual(r.assets, ["zed", "crm"]);
  });

  test("a URL passes through unfetched, and a dry run uploads nothing", async () => {
    const before = uploads;
    const r = await expand([{ source: "zed#2", role: "first_frame" }, { source: "https://cdn.test/s.png", role: "identity" }], { dryRun: true });
    assert.equal(uploads, before);
    assert.equal(r.refs[0].url, "pending-upload:zed#2");
    assert.equal(r.refs[1].url, "https://cdn.test/s.png");
  });
});

describe("refused before anything is uploaded", () => {
  test("a multi-image asset as a first frame, naming the choices", async () => {
    await assert.rejects(expand([{ source: "zed", role: "first_frame" }]), (e) => e.code === EXIT.UNKNOWN && /zed#1, zed#2/.test(e.message));
  });

  test("#n out of range", async () => {
    await assert.rejects(expand([{ source: "zed#3", role: "identity" }]), /images 1-2; there is no #3/);
  });

  test("two first frames", async () => {
    await assert.rejects(expand([{ source: "zed#1", role: "first_frame" }, { source: "crm", role: "first_frame" }]), /exactly one/);
  });

  test("an unknown role", async () => {
    await assert.rejects(expand([{ source: "zed", role: "vibes" }]), /Unknown reference role/);
  });

  test("http://", async () => {
    await assert.rejects(expand([{ source: "http://cdn.test/a.png", role: "identity" }]), /Only https/);
  });

  test("a local file outside the roots, when roots are set", async () => {
    await assert.rejects(expand([{ source: file("x.png", png(10, 10)), role: "identity" }], { roots: ["/nonexistent-root"] }), /outside the folders/);
  });
});

describe("route limits are checked after expansion", () => {
  const seedance = catalog.models["seedance-2-5"].routes.find((r) => r.provider === "kie");

  test("Seedance 2.5 refuses a first frame combined with reference images", async () => {
    const { refs } = await expand([{ source: "zed#1", role: "first_frame" }, { source: "crm", role: "identity" }], { dryRun: true });
    assert.match(buildInput(seedance, { prompt: "x", refs }).problems.join("\n"), /cannot combine first_frame with identity/);
  });

  test("an image under Seedance 2.5's 300px minimum is refused, naming it", async () => {
    const { refs } = await expand([{ source: file("tiny.png", png(200, 200)), role: "identity" }], { dryRun: true });
    assert.match(buildInput(seedance, { prompt: "x", refs }).problems.join("\n"), /tiny\.png: 200×200 is outside .*300-6000px/);
  });
});

test("--ref accepts an asset name, and still refuses a raw local path", () => {
  assert.deepEqual(parseRef("zed#2:first_frame"), { source: "zed#2", role: "first_frame" });
  assert.throws(() => parseRef("./logo.png:identity"), /local path is not a remote attachment/);
});
