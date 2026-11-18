import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
import { nextArtifact, extFromUrl, claimArtifact } from "../cli/lib/run.mjs";

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

  test("a built-in object key is not a model", () => {
    for (const id of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      assert.throws(() => resolveModel(catalog, id), { code: EXIT.UNKNOWN }, id);
    }
  });

  test("a preset override that is a built-in object key is refused", () => {
    assert.throws(() => routeFor(presets[0], catalog, { override: "constructor" }), { code: EXIT.UNKNOWN });
  });

  test("a capability mismatch is caught before submission", () => {
    assert.throws(() => resolveModel(catalog, "gpt-image-2", "video"), { code: EXIT.UNKNOWN });
  });

  test("every model declares a capability and at least one usable-looking route", () => {
    for (const m of catalog.list) {
      assert.ok(["video", "image", "audio", "jutsu"].includes(m.capability), `${m.id} capability`);
      assert.ok(m.routes?.length, `${m.id} has at least one route`);
      for (const r of m.routes) {
        assert.ok(catalog.providers[r.provider], `${m.id}: provider "${r.provider}" is configured`);
        const fam = catalog.providers[r.provider].families[r.family];
        assert.ok(fam, `${m.id}: ${r.provider} family "${r.family}" is defined`);
        assert.equal(typeof r.priceUsd, "number", `${m.id}/${r.provider} price`);
        assert.ok(r.priceUsd > 0, `${m.id}/${r.provider} price is positive`);
        assert.equal(typeof r.model, "string", `${m.id}/${r.provider} model string`);
      }
    }
  });

  test("a fallback route is always the SAME model at another reseller", () => {
    // Failing over to a different model would silently change the film. The
    // guard is that every route of a model names a recognisably matching
    // provider model string.
    for (const m of catalog.list) {
      if (m.routes.length < 2) continue;
      const stems = m.routes.map((r) =>
        r.model.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/texttovideo|texttoimage|t2v|v\d+$/g, ""),
      );
      const family = m.id.replace(/-/g, "").replace(/\d.*$/, "");
      for (const stem of stems) {
        assert.ok(
          stem.includes(family.slice(0, 5)),
          `${m.id}: route "${stem}" does not look like the same model family as "${family}"`,
        );
      }
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
  const h3 = resolveModel(catalog, "minimax-h3-max", "video");

  test("an unsupported duration names the models that can do it", () => {
    const wan = resolveModel(catalog, "wan-2-6", "video");
    const [problem] = validateVideoRequest(catalog, wan, { durationS: 7 });
    assert.match(problem, /not 7s/);
    assert.match(problem, /seedance-2-fast/);
  });

  test("a supported duration passes clean", () => {
    assert.deepEqual(validateVideoRequest(catalog, h3, { durationS: 10, aspectRatio: "16:9" }), []);
  });

  test("an unsupported aspect ratio is caught", () => {
    const kling = resolveModel(catalog, "kling-3-0", "video");
    const [problem] = validateVideoRequest(catalog, kling, { aspectRatio: "21:9" });
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
      source: "https://cdn.test:8443/a/b.png",
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

  test("a claimed artifact takes the first free name and never replaces a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "kie-run-"));
    writeFileSync(join(dir, "out.mp4"), "take one");
    writeFileSync(join(dir, "x.part"), "take two");
    const c = claimArtifact(join(dir, "x.part"), dir, "out", ".mp4");
    assert.match(c.path, /out-2\.mp4$/);
    assert.equal(c.take, 2);
    assert.equal(readFileSync(join(dir, "out.mp4"), "utf8"), "take one");
    assert.equal(readFileSync(c.path, "utf8"), "take two");
    assert.ok(!existsSync(join(dir, "x.part")));
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

  test("a long folder name inside a path is left readable", () => {
    const path = "/var/folders/3spxk9q2v8wz1m4n7b6c0d5fgn/T/kie-mcp-x/runs/summer-launch-teaser-final-v2/a.png";
    assert.equal(redact(`No such file: ${path}`), `No such file: ${path}`);
    assert.doesNotMatch(redact("key sk-abcdefghijklmnopqrstuvwxyz012345 /x"), /abcdefghijklmnop/);
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

  test("a job that wrote two entries is counted once, at its last entry", () => {
    const s = summarise([
      { localJobId: "j-1", model: "seedance-2", provider: "kie", estimatedUsd: 1.2, status: "uncertain" },
      { localJobId: "j-1", model: "seedance-2", provider: "kie", estimatedUsd: 1.2, status: "success" },
      { model: "seedance-2", provider: "kie", estimatedUsd: 0.5, status: "success" },
      { model: "seedance-2", provider: "kie", estimatedUsd: 0.5, status: "success" },
    ]);
    assert.equal(s.jobs, 3, "the two entries without an id are kept as they are");
    assert.equal(s.failures, 0, "the earlier uncertain entry was superseded");
    assert.equal(s.estimatedUsd, 2.2);
    assert.equal(s.byProvider[0].estimated, 2.2);
  });

  test("a create the provider rejected cost nothing and adds no estimate", () => {
    const s = summarise([
      { localJobId: "j-1", model: "seedance-2", provider: "kie", estimatedUsd: 1.2, costSource: "create-rejected", actualUsd: 0, status: "provider-error", failedOver: true },
      { localJobId: "j-2", model: "seedance-2", provider: "wavespeed", estimatedUsd: 1.2, status: "success" },
    ]);
    assert.equal(s.estimatedUsd, 1.2);
    assert.equal(s.failures, 1);
    assert.equal(s.byProvider.find((p) => p.provider === "kie").estimated, 0);
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

describe("kie video --pick", () => {
  const KIE = fileURLToPath(new URL("../cli/kie.mjs", import.meta.url));
  const tmp = mkdtempSync(join(tmpdir(), "kie-pick-"));
  mkdirSync(join(tmp, "runs"));
  writeFileSync(join(tmp, "prompt.txt"), "A fox runs through snow.\n");
  const env = { ...process.env, KIE_RUNS_DIR: join(tmp, "runs"), KIE_LIBRARY_DIR: join(tmp, "library"), KIE_LIMITS_FILE: join(tmp, "limits.json"), HOME: tmp, KIE_API_KEY: "test-key-not-real", WAVESPEED_API_KEY: "" };
  const video = (...extra) =>
    spawnSync(process.execPath, [KIE, "video", "--run", "picked", "--prompt-file", join(tmp, "prompt.txt"), "--model", "seedance-2-5", "--duration", "4", "--resolution", "480p", ...extra], { env, encoding: "utf8" });

  test("a dry run shows the block that would be added, and records what was typed and sent", () => {
    const r = video("--pick", "move=push-in", "--pick", "speed=slow", "--pick", "light=golden-hour", "--dry-run");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /picks added after the prompt:\n\s+Camera: The camera slowly pushes in\.\n\s+Warm, low golden-hour sunlight\./);
    assert.equal(readFileSync(join(tmp, "runs", "picked", "prompt.txt"), "utf8"), "A fox runs through snow.\n\nCamera: The camera slowly pushes in.\nWarm, low golden-hour sunlight.");
    const inputs = JSON.parse(readFileSync(join(tmp, "runs", "picked", "inputs.json"), "utf8"));
    assert.deepEqual(inputs.picks, { move: "push-in", speed: "slow", light: "golden-hour" });
    assert.equal(inputs.typedPrompt, "A fox runs through snow.\n");
  });

  test("a dry run without picks is as before", () => {
    const r = video("--dry-run");
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /picks added/);
  });

  test("a bad pick is refused before anything is submitted", () => {
    const noEquals = video("--pick", "push-in", "--dry-run");
    assert.equal(noEquals.status, EXIT.USAGE);
    assert.match(noEquals.stderr, /--pick takes key=id, got "push-in"\. The keys are: move, speed, size, angle, lens, light\./);
    const unknownId = video("--pick", "light=moonbeam", "--dry-run");
    assert.equal(unknownId.status, EXIT.UNKNOWN);
    assert.match(unknownId.stderr, /not on the director's lights menu/);
    const noMove = video("--pick", "speed=slow", "--dry-run");
    assert.equal(noMove.status, EXIT.UNKNOWN);
    assert.match(noMove.stderr, /a speed needs a move other than static/);
  });
});
