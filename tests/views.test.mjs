import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = realpathSync(mkdtempSync(join(tmpdir(), "kie-views-")));
process.env.KIE_RUNS_DIR = join(tmp, "runs");
process.env.KIE_LIMITS_FILE = join(tmp, "limits.json");
process.env.KIE_API_KEY = "test-key-not-real";
mkdirSync(process.env.KIE_RUNS_DIR, { recursive: true });

const { EXIT } = await import("../cli/lib/errors.mjs");
const { loadCatalog } = await import("../cli/lib/models.mjs");
const { openJobs } = await import("../cli/core/jobs.mjs");
const { readLimits } = await import("../cli/core/spend.mjs");
const views = await import("../cli/core/views.mjs");

const catalog = loadCatalog();
const store = openJobs(join(tmp, "runs", ".jobs"));
const limits = readLimits();
const seedance = { model: "seedance-2-5", capability: "video", durationS: 4, resolution: "480p", provider: "kie" };

describe("catalog views", () => {
  test("listModels filters by capability and shows each route's price", () => {
    const models = views.listModels(catalog, { capability: "video" });
    assert.ok(models.every((m) => m.capability === "video"));
    const s = models.find((m) => m.id === "seedance-2-5");
    assert.match(s.routes.find((r) => r.provider === "kie").price, /480p \$0\.14\/s/);
  });

  test("listPresets marks each preset native or adaptation", () => {
    const presets = views.listPresets(catalog);
    assert.ok(presets.length > 0);
    assert.ok(presets.every((p) => ["native", "adaptation", null].includes(p.fidelity)));
  });
});

describe("estimate reserves nothing and says whether the job may run", () => {
  test("Seedance 2.5, 4s at 480p on kie is $0.56 and allowed", () => {
    const e = views.estimate(catalog, seedance, { store, limits });
    assert.equal(e.estimateUsd, 0.56);
    assert.equal(e.allowed, true);
    assert.deepEqual(store.list(), []);
  });

  test("a first frame with reference images is refused with the reason", () => {
    const refs = [{ source: "https://x.test/a.png", role: "first_frame" }, { source: "https://x.test/b.png", role: "identity" }];
    const e = views.estimate(catalog, { ...seedance, refs }, { store, limits });
    assert.match(e.problems.join("\n"), /cannot combine/);
    assert.equal(e.allowed, false);
  });

  test("over the daily cap is not allowed", () => {
    const e = views.estimate(catalog, seedance, { store, limits: { ...limits, dailyUsd: 0.1 } });
    assert.equal(e.withinDailyCap, false);
    assert.equal(e.allowed, false);
  });

  test("above the per-job ceiling is not allowed, and says so", () => {
    const e = views.estimate(catalog, seedance, { store, limits: { ...limits, perJobUsd: 0.5 } });
    assert.equal(e.perJobUsd, 0.5);
    assert.equal(e.withinPerJob, false);
    assert.equal(e.allowed, false);
  });

  test("with no ceiling, perJobUsd is null and withinPerJob is true", () => {
    const e = views.estimate(catalog, seedance, { store, limits });
    assert.equal(e.perJobUsd, null);
    assert.equal(e.withinPerJob, true);
  });
});

describe("status and runs", () => {
  test("status reads the balance through the injected reader and lists unsettled jobs", async () => {
    const job = store.create({ run: "demo", capability: "video", model: "seedance-2-5", provider: "kie", estimateUsd: 0.56 });
    const s = await views.status(catalog, { store, limits, credits: async () => 123 });
    assert.equal(s.providers.find((p) => p.name === "kie").balance, 123);
    assert.equal(s.today.capUsd, 10);
    assert.deepEqual(s.unsettled.map((j) => j.id), [job.id]);
  });

  test("listRuns and getRun read a run folder; an unknown run is code 3", () => {
    const dir = join(tmp, "runs", "demo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "prompt.txt"), "Shot 1: Zed waves.");
    assert.ok(views.listRuns().some((r) => r.run === "demo"));
    const run = views.getRun("demo", { store });
    assert.equal(run.prompt, "Shot 1: Zed waves.");
    assert.equal(run.jobs.length, 1);
    assert.throws(() => views.getRun("nope", { store }), { code: EXIT.UNKNOWN });
  });

  test("the Create scratch run is not listed as a film", () => {
    mkdirSync(join(tmp, "runs", "create"), { recursive: true });
    assert.ok(!views.listRuns().some((r) => r.run === "create"));
  });
});

describe("doctor", () => {
  test("returns kie doctor's checks as data, reading balances only through the injected reader", async () => {
    let reads = 0;
    const d = await views.doctor(catalog, {
      credits: async () => {
        reads += 1;
        return 42;
      },
    });
    assert.equal(reads, 1, "only kie.ai has a balance endpoint");
    assert.ok(d.checks.some((c) => c.level === "ok" && c.text === "kie.ai: 42 credits"));
    assert.ok(d.checks.some((c) => c.level === "ok" && c.text === "kie.ai: key found" && c.keyOf === "kie"));
    assert.ok(d.checks.every((c) => ["ok", "warn", "fail", "info"].includes(c.level)));
    assert.equal(d.failures, d.checks.filter((c) => c.level === "fail").length);
    assert.ok(!JSON.stringify(d).includes("test-key-not-real"), "no key value in any check");
  });

  test("a failed balance read is a failed check, not a throw", async () => {
    const d = await views.doctor(catalog, {
      credits: async () => {
        throw new Error("kie.ai credit check failed (HTTP 401).");
      },
    });
    assert.ok(d.checks.some((c) => c.level === "fail" && c.text === "kie.ai: credit check — kie.ai credit check failed (HTTP 401)."));
    assert.ok(d.failures >= 1);
  });
});

describe("planJob prices a job without any spending state", () => {
  test("the same price and problems as estimate, from the catalog alone", () => {
    const p = views.planJob(catalog, seedance);
    assert.equal(p.model.id, "seedance-2-5");
    assert.equal(p.route.provider, "kie");
    assert.equal(p.est.usd, views.estimate(catalog, seedance, { store, limits }).estimateUsd);
    assert.deepEqual(p.problems, []);
  });

  test("a first frame picks the image-to-video call and checks its contract", () => {
    const h3 = views.planJob(catalog, { model: "minimax-h3", capability: "video", durationS: 5, aspectRatio: "16:9", refs: [{ role: "first_frame" }] });
    assert.notEqual(h3.call.model, h3.route.model, "the i2v call, not the text-to-video one");
    assert.deepEqual(h3.problems, []);
    const wan = views.planJob(catalog, { model: "wan-3-0", capability: "video", durationS: 5, refs: [{ role: "first_frame" }] });
    assert.match(wan.problems.join(" "), /No captured contract/);
  });
});
