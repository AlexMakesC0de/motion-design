import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { EXIT } from "../cli/lib/errors.mjs";
import { estimateUsd, priceLabel, preflight } from "../cli/lib/budget.mjs";

const perSecond = {
  model: "m",
  priceUsd: 4.73,
  pricing: { per: "second", usdPerSecond: { "480p": 0.14, "720p": 0.315 } },
  input: { defaults: { duration: 5, resolution: "720p" } },
  prov: { label: "Test", credits: null },
};

describe("a per-second route is priced the way it bills", () => {
  test("duration × the rate for the requested resolution", () => {
    const e = estimateUsd(perSecond, { durationS: 4, resolution: "480p" });
    assert.equal(e.usd, 0.56);
    assert.match(e.basis, /4s × \$0\.14\/s at 480p/);
  });

  test("the contract's defaults fill a missing duration and resolution", () => {
    assert.equal(estimateUsd(perSecond, {}).usd, 1.575);
  });

  test("a string duration (wan's contract type) still prices", () => {
    assert.equal(estimateUsd(perSecond, { durationS: "4", resolution: "480p" }).usd, 0.56);
  });

  test("an unpriced resolution is priced at the highest rate, never the flat figure", () => {
    const e = estimateUsd(perSecond, { durationS: 4, resolution: "1080p" });
    assert.equal(e.usd, 1.26);
    assert.equal(e.basis, "4s × $0.315/s (highest rate; resolution unknown)");
  });

  test("seconds known but no resolution anywhere: 30s on 0.18/0.36/0.9 costs 30 × 0.9, not the flat 1.80", () => {
    const route = {
      priceUsd: 1.8,
      pricing: { per: "second", usdPerSecond: { "480p": 0.18, "720p": 0.36, "1080p": 0.9 } },
    };
    const e = estimateUsd(route, { durationS: 30 });
    assert.equal(e.usd, 27);
    assert.equal(e.basis, "30s × $0.9/s (highest rate; resolution unknown)");
    assert.equal(estimateUsd(route, { durationS: 30, resolution: "480p" }).usd, 5.4);
  });

  test("automatic duration (-1) falls back rather than pricing a negative job", () => {
    assert.equal(estimateUsd(perSecond, { durationS: -1 }).basis, "per-job-fallback");
  });

  test("a flat route ignores duration entirely", () => {
    const e = estimateUsd({ priceUsd: 0.06 }, { durationS: 30 });
    assert.deepEqual(e, { usd: 0.06, basis: "per-job" });
  });
});

describe("the budget check uses the per-second estimate", () => {
  test("a short draft fits a budget the flat price would have refused", async () => {
    const r = await preflight({}, perSecond, { budgetUsd: 1, durationS: 4, resolution: "480p" });
    assert.equal(r.estimatedUsd, 0.56);
  });

  test("a long final is refused even though the flat price would pass", async () => {
    await assert.rejects(
      preflight({}, perSecond, { budgetUsd: 5, durationS: 30, resolution: "720p" }),
      (e) => e.code === EXIT.BUDGET && /\$9\.45/.test(e.message),
    );
  });
});

describe("prices are labelled in the unit they bill in", () => {
  test("per-second routes list each resolution's rate", () => {
    assert.equal(priceLabel(perSecond), "480p $0.14/s 720p $0.315/s");
  });

  test("flat routes show the job price", () => {
    assert.equal(priceLabel({ priceUsd: 0.06 }), "$0.06");
  });
});

describe("an image route is priced per picture at the size or quality asked for", () => {
  const byRes = {
    model: "img",
    priceUsd: 0.05,
    pricing: { per: "image", by: "resolution", usd: { "1K": 0.03, "2K": 0.05, "4K": 0.08 } },
    input: { defaults: { resolution: "2K" } },
    prov: { label: "Test", credits: null },
  };
  const byQuality = { ...byRes, pricing: { per: "image", by: "quality", usd: { basic: 0.035, high: 0.07 } }, input: { defaults: { quality: "basic" } } };

  test("each resolution has its own price, so a 1K picture is not quoted at the 2K rate", () => {
    assert.deepEqual(estimateUsd(byRes, { resolution: "1K" }), { usd: 0.03, basis: "per image at resolution 1K" });
    assert.equal(estimateUsd(byRes, { resolution: "4k" }).usd, 0.08);
  });

  test("no resolution asked for: the route's default is priced", () => {
    assert.equal(estimateUsd(byRes, {}).usd, 0.05);
  });

  test("a value with no listed price is charged at the dearest, so the cap never undercounts", () => {
    const e = estimateUsd(byRes, { resolution: "8K" });
    assert.equal(e.usd, 0.08);
    assert.match(e.basis, /highest rate/);
  });

  test("a quality-priced route reads the quality, not the resolution", () => {
    assert.equal(estimateUsd(byQuality, {}).usd, 0.035);
    assert.equal(estimateUsd(byQuality, { quality: "high", resolution: "1K" }).usd, 0.07);
  });

  test("the budget check uses the picture's own price", async () => {
    const r = await preflight({}, byRes, { budgetUsd: 0.04, resolution: "1K" });
    assert.equal(r.estimatedUsd, 0.03);
  });

  test("the label lists every price", () => {
    assert.equal(priceLabel(byRes), "1K $0.03 2K $0.05 4K $0.08");
  });
});
