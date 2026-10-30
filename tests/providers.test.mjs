import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EXIT, CliError } from "../cli/lib/errors.mjs";
import { loadCatalog, buildInput, routesFor, cheapestRoute } from "../cli/lib/models.mjs";
import {
  getProvider,
  createUrl,
  queryUrl,
  createBody,
  readFailure,
  readTaskId,
  canFailOver,
} from "../cli/lib/providers.mjs";
import { summarise } from "../cli/lib/ledger.mjs";

const catalog = loadCatalog();
const kie = getProvider(catalog, "kie");
const ws = getProvider(catalog, "wavespeed");

describe("the two providers are not shaped alike", () => {
  test("kie puts the model in the body; wavespeed puts it in the URL", () => {
    assert.equal(
      createUrl(kie, "jobs", "bytedance/seedance-2-fast"),
      "https://api.kie.ai/api/v1/jobs/createTask",
    );
    assert.equal(
      createUrl(ws, "v3", "wavespeed-ai/minimax-h3/text-to-video"),
      "https://api.wavespeed.ai/api/v3/wavespeed-ai/minimax-h3/text-to-video",
    );
  });

  test("kie wraps the input; wavespeed sends it bare", () => {
    const input = { prompt: "x", duration: 5 };
    assert.deepEqual(createBody(kie, "jobs", "m", input), { model: "m", input });
    assert.deepEqual(createBody(ws, "v3", "m", input), input, "no wrapper, no model field");
  });

  test("kie's veo family is flat, not wrapped", () => {
    assert.deepEqual(createBody(kie, "veo", "veo3_1", { prompt: "x" }), {
      model: "veo3_1",
      prompt: "x",
    });
  });

  test("kie polls by query param; wavespeed by path", () => {
    assert.match(queryUrl(kie, "jobs", "abc123"), /recordInfo\?taskId=abc123$/);
    assert.equal(
      queryUrl(ws, "v3", "abc123"),
      "https://api.wavespeed.ai/api/v3/predictions/abc123/result",
    );
  });

  test("a task id is found under whichever key the provider uses", () => {
    assert.equal(readTaskId({ json: { data: { taskId: "k1" } } }), "k1");
    assert.equal(readTaskId({ json: { data: { id: "w1" } } }), "w1");
  });
});

describe("failure detection differs per provider, and getting it wrong is how a rejection reads as success", () => {
  test("kie reports failure in the BODY while returning HTTP 200", () => {
    const res = { ok: true, status: 200, json: { code: 500, msg: "This field is required" } };
    const failure = readFailure(kie, res);
    assert.ok(failure, "a 200 carrying code 500 must be a failure");
    assert.match(failure, /This field is required/);
  });

  test("kie's body code 200 is success", () => {
    assert.equal(readFailure(kie, { ok: true, status: 200, json: { code: 200, data: {} } }), null);
  });

  test("wavespeed reports failure in the HTTP status", () => {
    assert.equal(readFailure(ws, { ok: true, status: 200, json: { data: { id: "x" } } }), null);
    assert.match(
      readFailure(ws, { ok: false, status: 402, json: { message: "insufficient balance" } }),
      /insufficient balance/,
    );
  });

  test("a wavespeed body carrying a stray `code` is NOT treated as failure", () => {
    // Only kie declares errorInBody. Reading wavespeed's body the same way
    // would invent failures out of ordinary payload fields.
    assert.equal(readFailure(ws, { ok: true, status: 200, json: { code: 500 } }), null);
  });
});

describe("failover policy — the rule that must never become configuration", () => {
  const err = (code) => new CliError(code, "x");

  test("a provider error DOES fail over: nothing chargeable, nothing to rejoin", () => {
    assert.equal(canFailOver(err(EXIT.PROVIDER)), true);
  });

  test("an UNCERTAIN result NEVER fails over", () => {
    // The job may exist. Failing over would pay twice AND abandon the only
    // handle for rejoining it. WaveSpeed's own docs give the same warning.
    assert.equal(canFailOver(err(EXIT.UNCERTAIN)), false);
  });

  test("a budget refusal never fails over", () => {
    // Our decision, not their outage. A fallback would spend money the cap
    // just refused, at the moment nobody is watching.
    assert.equal(canFailOver(err(EXIT.BUDGET)), false);
  });

  test("an invalid request never fails over on the provider's dime", () => {
    assert.equal(canFailOver(err(EXIT.UNKNOWN)), false);
    assert.equal(canFailOver(err(EXIT.USAGE)), false);
  });

  test("success is not a failover condition", () => {
    assert.equal(canFailOver(err(EXIT.OK)), false);
    assert.equal(canFailOver(null), false);
    assert.equal(canFailOver(undefined), false);
  });
});

describe("routes reflect what this machine can actually reach", () => {
  test("a route whose provider has no key is skipped with the reason, not an error", () => {
    const model = catalog.models["minimax-h3"];
    const routes = routesFor(catalog, model);
    assert.equal(routes.length, 2);
    for (const r of routes) {
      if (!r.usable) assert.match(r.skipReason, /no .* key|was requested/);
    }
  });

  test("--provider pins to one reseller and explains the others", () => {
    const routes = routesFor(catalog, catalog.models["minimax-h3"], { only: "kie" });
    const ws = routes.find((r) => r.provider === "wavespeed");
    assert.equal(ws.usable, false);
    assert.match(ws.skipReason, /--provider kie was requested/);
  });

  test("cheapestRoute ignores routes with no key", () => {
    assert.equal(cheapestRoute([{ usable: false, priceUsd: 0.01 }, { usable: true, priceUsd: 5 }]).priceUsd, 5);
    assert.equal(cheapestRoute([{ usable: false, priceUsd: 1 }]), null);
  });

  test("every model reachable at all has a primary route listed first", () => {
    for (const m of catalog.list) {
      assert.ok(m.routes[0]?.provider, `${m.id} has a primary`);
    }
  });
});

describe("input is built against the ROUTE's contract, not the model's", () => {
  const seedance = catalog.models["seedance-2-fast"].routes[0];
  const wan = catalog.models["wan-2-6"].routes[0];
  const wsH3 = catalog.models["minimax-h3"].routes.find((r) => r.provider === "wavespeed");

  test("seedance takes duration as an integer", () => {
    const { input } = buildInput(seedance, { prompt: "x", duration: 4 });
    assert.strictEqual(input.duration, 4);
    assert.equal(input.resolution, "720p", "required default is filled in");
  });

  test("wan takes the same field as a STRING -- the trap that fails at submit", () => {
    const { input } = buildInput(wan, { prompt: "x", duration: 10 });
    assert.strictEqual(input.duration, "10");
  });

  test("wan is never sent an aspect_ratio, because it has no such parameter", () => {
    const { input } = buildInput(wan, { prompt: "x", duration: 5, aspect_ratio: "16:9" });
    assert.ok(!("aspect_ratio" in input), "sending one would be rejected");
  });

  test("an out-of-range duration is refused before submitting", () => {
    const { problems } = buildInput(seedance, { prompt: "x", duration: 30 });
    assert.match(problems[0], /outside its 4-15s range/);
  });

  test("a value outside the enum is refused with the allowed list", () => {
    const { problems } = buildInput(seedance, { prompt: "x", resolution: "4k" });
    assert.match(problems[0], /not allowed. Allowed: 480p, 720p/);
  });

  test("a missing required field is caught rather than sent", () => {
    const { problems } = buildInput(
      catalog.models["seedream-5-pro"].routes[0],
      { aspect_ratio: "1:1", quality: "basic" },
    );
    assert.match(problems[0], /"prompt" is required/);
  });

  test("reference roles map to each route's own field names", () => {
    const { input } = buildInput(seedance, {
      prompt: "x",
      refs: [
        { url: "https://a.test/1.png", role: "first_frame" },
        { url: "https://a.test/2.png", role: "identity" },
      ],
    });
    assert.equal(input.first_frame_url, "https://a.test/1.png");
    assert.deepEqual(input.reference_image_urls, ["https://a.test/2.png"], "array fields collect");
  });

  test("the same role maps to a different field on wavespeed", () => {
    const { input } = buildInput(wsH3, {
      prompt: "x",
      refs: [{ url: "https://a.test/1.png", role: "first_frame" }],
    });
    assert.equal(input.image, "https://a.test/1.png", "wavespeed calls it `image`");
  });

  test("a route with no captured contract drops `refs` rather than posting it raw", () => {
    const guessed = catalog.models["kling-3-0"].routes[0];
    const { input, unverified, problems } = buildInput(guessed, { prompt: "x", duration: 5 });
    assert.equal(unverified, true);
    assert.ok(!("refs" in input), "refs is our vocabulary, not a provider field");
    assert.deepEqual(problems, []);
  });

  test("a route with no contract REFUSES references rather than dropping them silently", () => {
    const guessed = catalog.models["kling-3-0"].routes[0];
    const { problems } = buildInput(guessed, {
      prompt: "x",
      refs: [{ url: "https://a.test/1.png", role: "identity" }],
    });
    assert.match(problems[0], /cannot be mapped to its input fields/);
  });
});

describe("the ledger separates providers, because a failover pays twice", () => {
  const rows = [
    { model: "minimax-h3", provider: "wavespeed", estimatedUsd: 0.1, status: "provider-error" },
    { model: "minimax-h3", provider: "kie", estimatedUsd: 0.45, status: "success", failedOver: true },
  ];

  test("both attempts are recorded, not just the one that worked", () => {
    const s = summarise(rows);
    assert.equal(s.jobs, 2);
    assert.equal(s.failures, 1);
    assert.equal(s.estimatedUsd, 0.55, "the failed attempt still counts toward spend");
  });

  test("per-provider totals make the cost of a fallback visible", () => {
    const s = summarise(rows);
    assert.equal(s.byProvider.length, 2);
    assert.equal(s.byProvider.find((p) => p.provider === "kie").estimated, 0.45);
  });

  test("failovers are counted", () => {
    assert.equal(summarise(rows).failovers, 1);
  });
});

describe("provider names are looked up as own keys only", () => {
  test("a built-in object key is not a provider", () => {
    for (const name of ["constructor", "__proto__", "toString"]) {
      assert.throws(() => getProvider(catalog, name), { code: EXIT.USAGE }, name);
    }
  });
});
