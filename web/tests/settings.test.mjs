import { KEY, deps, req, tmp } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { createApp } = await import("../server/app.mjs");
const { loadCatalog } = await import("../../cli/lib/models.mjs");
const { getProvider, providerKey } = await import("../../cli/lib/providers.mjs");

const LIMITS = join(tmp, "limits.json");
const catalog = loadCatalog();
// Every key this machine has, from the environment or ~/.config: none may appear in a response.
const keys = Object.keys(catalog.providers)
  .map((name) => providerKey(getProvider(catalog, name), { required: false }))
  .filter(Boolean);

let app, port;
let reads = 0;
before(async () => {
  const counting = { ...deps, credits: async () => (reads += 1, 100) };
  app = createApp({ key: KEY, deps: counting, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());

const put = (body) => req(port, "/api/settings/limits", { method: "PUT", body });
const noKeys = (text) => keys.every((k) => !text.includes(k));

describe("GET /api/settings", () => {
  test("shows the saved limits and whether each provider has a key, never the key", async () => {
    const r = await req(port, "/api/settings");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.limits, { dailyUsd: 10, perJobUsd: null, file: LIMITS });
    const kie = r.json.providers.find((p) => p.name === "kie");
    assert.deepEqual(kie, { name: "kie", label: "kie.ai", keyConfigured: true, keyEnv: "KIE_API_KEY", keyFile: "~/.config/kie/key", signup: "https://kie.ai/api-key", balanceReadable: true });
    assert.equal(r.json.providers.find((p) => p.name === "wavespeed").balanceReadable, false);
    assert.ok(noKeys(r.text));
    assert.equal(reads, 0, "reading settings never calls a provider");
  });
});

describe("PUT /api/settings/limits", () => {
  test("writes the daily cap and per-job limit through core, as kie limits does", async () => {
    const r = await put({ dailyUsd: 4.5, perJobUsd: 1.25, was: { dailyUsd: 10, perJobUsd: null } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.limits, { dailyUsd: 4.5, perJobUsd: 1.25, file: LIMITS });
    assert.deepEqual(JSON.parse(readFileSync(LIMITS, "utf8")), { dailyUsd: 4.5, allowRoots: [], perJobUsd: 1.25 });
    const spend = await req(port, "/api/spend");
    assert.equal(spend.json.capUsd, 4.5);
    assert.equal(spend.json.perJobUsd, 1.25);
  });

  test("a null per-job limit removes it; a cap of 0 is allowed", async () => {
    const r = await put({ dailyUsd: 0, perJobUsd: null, was: { dailyUsd: 4.5, perJobUsd: 1.25 } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(JSON.parse(readFileSync(LIMITS, "utf8")), { dailyUsd: 0, allowRoots: [] });
  });

  test("a value core would refuse is 400 on its field, and the file is unchanged", async () => {
    const before = readFileSync(LIMITS, "utf8");
    for (const [body, field] of [
      [{ dailyUsd: -1, perJobUsd: null }, "dailyUsd"],
      [{ dailyUsd: "5", perJobUsd: null }, "dailyUsd"],
      [{ dailyUsd: 5, perJobUsd: 0 }, "perJobUsd"],
      [{ dailyUsd: 5, perJobUsd: "off" }, "perJobUsd"],
      [{ dailyUsd: 5, perJobUsd: null }, "was"],
    ]) {
      const r = await put(field === "was" ? body : { ...body, was: { dailyUsd: 0, perJobUsd: null } });
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.json.error.field, field);
    }
    assert.equal(readFileSync(LIMITS, "utf8"), before);
  });

  test("a page holding limits that changed since it loaded is refused with 409, and the file is unchanged", async () => {
    writeFileSync(LIMITS, JSON.stringify({ dailyUsd: 2, allowRoots: [] })); // kie limits --daily 2, in another terminal
    const r = await put({ dailyUsd: 50, perJobUsd: null, was: { dailyUsd: 0, perJobUsd: null } });
    assert.equal(r.status, 409);
    assert.match(r.json.error.message, /changed since this page loaded/);
    assert.equal(r.json.error.current.dailyUsd, 2);
    assert.equal(JSON.parse(readFileSync(LIMITS, "utf8")).dailyUsd, 2);
  });

  test("needs the session key, like every write", async () => {
    const r = await req(port, "/api/settings/limits", { method: "PUT", body: { dailyUsd: 99, perJobUsd: null, was: { dailyUsd: 2, perJobUsd: null } }, key: null });
    assert.equal(r.status, 403);
    assert.equal(JSON.parse(readFileSync(LIMITS, "utf8")).dailyUsd, 2);
  });
});

describe("POST /api/settings/doctor", () => {
  test("runs core's doctor on request: one balance read, checks back, no key in them", async () => {
    const r = await req(port, "/api/settings/doctor", { method: "POST" });
    assert.equal(r.status, 200, r.text);
    assert.equal(reads, 1);
    assert.ok(r.json.checks.some((c) => c.level === "ok" && c.text === "kie.ai: 100 credits"));
    assert.ok(r.json.checks.every((c) => !("keyOf" in c)));
    assert.equal(typeof r.json.failures, "number");
    assert.ok(r.json.ranAt);
    assert.ok(noKeys(r.text));
    assert.ok(existsSync(LIMITS));
  });
});
