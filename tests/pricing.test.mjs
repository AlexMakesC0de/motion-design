import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

describe("a reference video changes how a per-second route bills", () => {
  // kie's Seedance 2 Fast: a lower rate, charged on the input seconds as well as the output.
  const route = {
    priceUsd: 0.62,
    pricing: {
      per: "second",
      usdPerSecond: { "480p": 0.0585, "720p": 0.124 },
      videoInput: { field: "reference_video_urls", usdPerSecond: { "480p": 0.034, "720p": 0.075 }, maxInputS: 15 },
    },
    input: { defaults: { duration: 5, resolution: "720p" } },
  };

  test("no reference video: the usual rate on the output seconds", () => {
    assert.equal(estimateUsd(route, { durationS: 5, resolution: "720p", input: { reference_video_urls: [] } }).usd, 0.62);
    assert.equal(estimateUsd(route, { durationS: 5, resolution: "720p" }).usd, 0.62);
  });

  test("with one, its length is unknown here, so the longest the provider allows is counted", () => {
    const e = estimateUsd(route, { durationS: 5, resolution: "720p", input: { reference_video_urls: ["https://x/a.mp4"] } });
    assert.equal(e.usd, 1.5); // (5 + 15) × 0.075, where the flat reading said 0.62
    assert.equal(e.basis, "(5s + up to 15s of reference video) × $0.075/s at 720p");
  });

  test("a resolution with no video rate is priced at the dearest video rate", () => {
    const e = estimateUsd(route, { durationS: 5, resolution: "1080p", input: { reference_video_urls: ["u"] } });
    assert.equal(e.usd, 1.5);
    assert.match(e.basis, /highest rate/);
  });

  test("the budget check sees it", async () => {
    const withProv = { ...route, prov: { label: "Test", credits: null } };
    await assert.rejects(
      preflight({}, withProv, { budgetUsd: 1, durationS: 5, resolution: "720p", input: { reference_video_urls: ["u"] } }),
      (e) => e.code === EXIT.BUDGET && /\$1\.50/.test(e.message),
    );
  });
});

describe("speech is priced by the length of the script", () => {
  const route = { priceUsd: 0.12, pricing: { per: "characters", usdPer1000: 0.06, field: "text" } };

  test("5,000 characters cost five thousandths' worth, not the flat figure", () => {
    const e = estimateUsd(route, { input: { text: "a".repeat(5000) } });
    assert.equal(e.usd, 0.3);
    assert.equal(e.basis, "5000 characters × $0.06 per 1,000");
  });

  test("no script to measure falls back to the flat figure", () => {
    assert.deepEqual(estimateUsd(route, {}), { usd: 0.12, basis: "per-job-fallback" });
  });
});

describe("the catalog's prices as read on kie on 2026-11-17", () => {
  const catalog = JSON.parse(readFileSync(new URL("../cli/models.json", import.meta.url), "utf8"));
  const kie = (id) => catalog.models[id].routes.find((r) => r.provider === "kie");

  test("Kling 3.0 with audio: 22.7 and 30.2 credits a second", () => {
    assert.deepEqual(kie("kling-3-0").pricing.usdPerSecond, { "720p": 0.1135, "1080p": 0.151 });
    assert.equal(estimateUsd(kie("kling-3-0"), { durationS: 10, resolution: "1080p" }).usd, 1.51);
  });

  test("Seedance 2 Fast with a reference video: 15 credits a second on input plus output", () => {
    const e = estimateUsd(kie("seedance-2-fast"), { durationS: 5, resolution: "720p", input: { reference_video_urls: ["u"] } });
    assert.equal(e.usd, 1.5);
  });

  test("GPT Image 2 is priced by resolution", () => {
    assert.equal(estimateUsd(kie("gpt-image-2"), { resolution: "1K" }).usd, 0.03);
    assert.equal(estimateUsd(kie("gpt-image-2"), { resolution: "4K" }).usd, 0.08);
  });

  test("ElevenLabs speech is priced by the script's length", () => {
    assert.equal(estimateUsd(kie("elevenlabs-tts"), { input: { text: "a".repeat(3000) } }).usd, 0.18);
  });
});
