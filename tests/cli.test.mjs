import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EXIT } from "../cli/lib/errors.mjs";
import {
  loadCatalog,
  resolveModel,
  validateVideoRequest,
  parseRef,
  isStale,
  catalogAgeDays,
} from "../cli/lib/models.mjs";
import { loadPresets, findPreset, routeFor } from "../cli/lib/presets.mjs";
import { extractUrls } from "../cli/lib/poll.mjs";
import { redact } from "../cli/lib/client.mjs";
import { summarise, filter } from "../cli/lib/ledger.mjs";
import { nextArtifact, extFromUrl } from "../cli/lib/run.mjs";

const catalog = loadCatalog();
const presets = loadPresets();

describe("model resolution refuses rather than forwards", () => {
  test("an unknown model fails locally, listing what exists", () => {
    try {
      resolveModel(catalog, "seedance-3");
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal(e.code, EXIT.UNKNOWN);
      assert.match(e.message, /Unknown model "seedance-3"/);
      assert.ok(e.available.includes("seedance-2"), "names real alternatives");
    }
  });

  test("a capability mismatch is caught before submission", () => {
    assert.throws(() => resolveModel(catalog, "gpt-image-2", "video"), { code: EXIT.UNKNOWN });
  });

  test("every model declares a capability, family and price", () => {
    for (const m of catalog.list) {
      assert.ok(["video", "image", "audio"].includes(m.capability), `${m.id} capability`);
      assert.ok(catalog.api.families[m.family], `${m.id} family "${m.family}" is defined`);
      assert.equal(typeof m.priceUsd, "number", `${m.id} price`);
      assert.ok(m.priceUsd > 0, `${m.id} price is positive`);
    }
  });

  test("every video model's refs are drawn from the declared role vocabulary", () => {
    for (const m of catalog.list.filter((x) => x.refs)) {
      for (const r of m.refs) {
        assert.ok(catalog.roles.includes(r), `${m.id} declares unknown role "${r}"`);
      }
    }
  });
});

describe("request validation happens before anything is spent", () => {
  const h3 = resolveModel(catalog, "minimax-h3", "video");

  test("an unsupported duration names the models that can do it", () => {
    const [problem] = validateVideoRequest(catalog, h3, { durationS: 15 });
    assert.match(problem, /generates 6\/10s, not 15s/);
    assert.match(problem, /seedance-2/);
  });

  test("a supported duration passes clean", () => {
    assert.deepEqual(validateVideoRequest(catalog, h3, { durationS: 10, aspectRatio: "16:9" }), []);
  });

  test("an unsupported aspect ratio is caught", () => {
    const [problem] = validateVideoRequest(catalog, h3, { aspectRatio: "21:9" });
    assert.match(problem, /supports 16:9, 9:16, 1:1/);
  });

  test("a reference role the model has no input for is caught", () => {
    const [problem] = validateVideoRequest(catalog, h3, {
      refs: [{ url: "https://x.test/a.png", role: "motion" }],
    });
    assert.match(problem, /has no "motion" input/);
  });

  test("an unknown role is caught before the model is even consulted", () => {
    const [problem] = validateVideoRequest(catalog, h3, {
      refs: [{ url: "https://x.test/a.png", role: "vibes" }],
    });
    assert.match(problem, /Unknown reference role "vibes"/);
  });
});

describe("--ref enforces the local-path rule in code, not prose", () => {
  test("a bare local path is refused with the fix", () => {
    try {
      parseRef("./logo.png:identity");
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal(e.code, EXIT.USAGE);
      assert.match(e.message, /local path is not a remote attachment/);
      assert.match(e.message, /kie upload \.\/logo\.png/);
    }
  });

  test("an absolute path is refused too", () => {
    assert.throws(() => parseRef("/Users/alex/logo.png:style"), { code: EXIT.USAGE });
  });

  test("a URL containing colons still splits on the last one", () => {
    assert.deepEqual(parseRef("https://cdn.test:8443/a/b.png:first_frame"), {
      url: "https://cdn.test:8443/a/b.png",
      role: "first_frame",
    });
  });

  test("a missing role is a usage error", () => {
    assert.throws(() => parseRef("https://x.test/a.png"), { code: EXIT.USAGE });
  });
});

describe("preset routing tells the truth about fidelity", () => {
  test("all ten presets resolve to a model in the catalog", () => {
    assert.equal(presets.length, 10);
    for (const p of presets) {
      const r = routeFor(p, catalog);
      assert.ok(catalog.models[r.modelId], `${p.id} → ${r.modelId} exists`);
    }
  });

  test("the three minimax-sourced presets route natively", () => {
    const native = presets
      .filter((p) => routeFor(p, catalog).fidelity === "native")
      .map((p) => p.id)
      .sort();
    assert.deepEqual(native, ["editorial-collage", "footage-overlays", "kinetic-typography"]);
  });

  test("a native route uses the model named in the source prompt's own label", () => {
    for (const id of ["kinetic-typography", "editorial-collage"]) {
      const p = findPreset(presets, id);
      assert.equal(p.source.prompt_model_label, "minimax_h3");
      assert.equal(routeFor(p, catalog).modelId, "minimax-h3");
    }
  });

  test("every Marketing Studio preset is labelled an adaptation and says why", () => {
    for (const p of presets) {
      if (!String(p.source.prompt_model_label).startsWith("marketing_studio")) continue;
      const r = routeFor(p, catalog);
      assert.equal(r.fidelity, "adaptation", `${p.id}`);
      assert.match(r.note, /adaptation, not a reproduction/, `${p.id} note`);
    }
  });

  test("an explicit --model override downgrades a native route to an adaptation", () => {
    const p = findPreset(presets, "kinetic-typography");
    const r = routeFor(p, catalog, { override: "seedance-2" });
    assert.equal(r.modelId, "seedance-2");
    assert.equal(r.fidelity, "adaptation", "overriding the source model is never native");
  });

  test("presets resolve by alias as well as id", () => {
    assert.equal(findPreset(presets, "kinetic type").id, "kinetic-typography");
    assert.equal(findPreset(presets, "Kinetic typography").id, "kinetic-typography");
  });

  test("an unknown preset lists the real ones", () => {
    assert.throws(() => findPreset(presets, "nope"), { code: EXIT.UNKNOWN });
  });

  test("the kie block never disturbed the archived source provenance", () => {
    for (const p of presets) {
      assert.equal(typeof p.source.prompt_sha256, "string", `${p.id} keeps its hash`);
      assert.equal(p.source.prompt_sha256.length, 64);
      assert.ok(p.source.prompt_path, `${p.id} keeps its source path`);
    }
  });
});

describe("artifact writing never destroys a previous take", () => {
  test("successive artifacts are numbered, not overwritten", () => {
    const dir = mkdtempSync(join(tmpdir(), "kie-run-"));
    const a = nextArtifact(dir, "out", ".mp4");
    assert.equal(a.take, 1);
    writeFileSync(a.path, "take one");

    const b = nextArtifact(dir, "out", ".mp4");
    assert.equal(b.take, 2);
    assert.notEqual(a.path, b.path);
    assert.match(b.path, /out-2\.mp4$/);
    writeFileSync(b.path, "take two");

    assert.match(nextArtifact(dir, "out", ".mp4").path, /out-3\.mp4$/);
  });

  test("extensions come from the URL, falling back when absent", () => {
    assert.equal(extFromUrl("https://x.test/a/b.mp4?token=1", ".bin"), ".mp4");
    assert.equal(extFromUrl("https://x.test/stream", ".bin"), ".bin");
  });
});

describe("result parsing is liberal across kie.ai's response shapes", () => {
  const cases = {
    "nested resultUrls array": { resultJson: { resultUrls: ["https://a.test/1.mp4"] } },
    "resultJson as a JSON string": { resultJson: '{"resultUrls":["https://a.test/1.mp4"]}' },
    "response.videoUrl": { response: { videoUrl: "https://a.test/1.mp4" } },
    "flat url": { url: "https://a.test/1.mp4" },
    "result.image_url": { result: { image_url: "https://a.test/1.mp4" } },
  };
  for (const [name, payload] of Object.entries(cases)) {
    test(name, () => assert.deepEqual(extractUrls(payload), ["https://a.test/1.mp4"]));
  }

  test("duplicates collapse", () => {
    const urls = extractUrls({ resultJson: { resultUrls: ["https://a.test/1.mp4"], url: "https://a.test/1.mp4" } });
    assert.equal(urls.length, 1);
  });

  test("a shape it cannot read yields nothing rather than garbage", () => {
    assert.deepEqual(extractUrls({ mystery: { deeply: { nested: 42 } } }), []);
  });

  test("non-http strings are not mistaken for artifacts", () => {
    assert.deepEqual(extractUrls({ url: "pending" }), []);
  });
});

describe("secrets never reach a log or a run record", () => {
  test("a key-shaped token is redacted", () => {
    const out = redact("Authorization failed for sk-abcdefghijklmnopqrstuvwxyz012345");
    assert.ok(!out.includes("abcdefghijklmnopqrstuvwxyz"), out);
    assert.match(out, /…/);
  });

  test("ordinary prose is untouched", () => {
    assert.equal(redact("task failed: bad prompt"), "task failed: bad prompt");
  });
});

describe("the ledger separates estimates from measurements", () => {
  const rows = [
    { at: "2026-09-10T10:00:00Z", run: "a", model: "seedance-2", estimatedUsd: 1.2, status: "success", creditsBefore: 100, creditsAfter: 88 },
    { at: "2026-09-10T11:00:00Z", run: "a", model: "seedance-2", estimatedUsd: 1.2, status: "failed", creditsBefore: 88, creditsAfter: 80 },
    { at: "2026-09-01T10:00:00Z", run: "b", model: "minimax-h3", estimatedUsd: 0.45, status: "success" },
  ];

  test("failed jobs are still counted -- they still cost money", () => {
    const s = summarise(rows);
    assert.equal(s.jobs, 3);
    assert.equal(s.failures, 1);
    assert.equal(s.estimatedUsd, 2.85, "the failed job's estimate is included");
  });

  test("measured credits come only from jobs that sampled a balance", () => {
    const s = summarise(rows);
    assert.equal(s.creditsUsed, 20);
    assert.equal(s.creditSamples, 2, "the unsampled job does not silently count as zero");
  });

  test("with no samples, credits used is null rather than a misleading zero", () => {
    const s = summarise([rows[2]]);
    assert.equal(s.creditsUsed, null);
  });

  test("spend filters by run and date", () => {
    assert.equal(filter(rows, { run: "a" }).length, 2);
    assert.equal(filter(rows, { since: "2026-09-05" }).length, 2);
  });

  test("byModel is ranked by spend", () => {
    assert.equal(summarise(rows).byModel[0].model, "seedance-2");
  });
});

describe("catalog staleness is surfaced, not assumed away", () => {
  test("the shipped catalog carries a capture date", () => {
    assert.match(catalog.captured, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof catalogAgeDays(catalog), "number");
  });

  test("an old catalog reports stale", () => {
    assert.ok(isStale({ captured: "2020-01-01", staleAfterDays: 30 }));
  });

  test("an undated catalog is not claimed fresh or stale", () => {
    assert.equal(catalogAgeDays({}), null);
    assert.equal(isStale({}), false);
  });
});
