import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { loadCatalog, buildInput, effectiveRoute } from "../cli/lib/models.mjs";
import { estimateUsd } from "../cli/lib/budget.mjs";

const catalog = loadCatalog();
const frame = (role) => ({ url: `https://a.test/${role}.png`, role });

describe("MiniMax H3 is called on kie with its documented contract", () => {
  const h3 = catalog.models["minimax-h3"];
  const kie = h3.routes[0];

  test("kie is primary, with the real model ids", () => {
    assert.equal(kie.provider, "kie");
    assert.equal(kie.model, "minimax-h3/text-to-video");
    assert.equal(kie.i2vModel, "minimax-h3/image-to-video");
  });

  test("image-to-video sends no aspect_ratio and defaults to 768P, not the doc's 2K", () => {
    const { input, problems } = buildInput(effectiveRoute(kie, true), {
      prompt: "x",
      duration: 4,
      aspect_ratio: "16:9",
      refs: [frame("first_frame")],
    });
    assert.deepEqual(problems, []);
    assert.ok(!("aspect_ratio" in input));
    assert.equal(input.resolution, "768P");
    assert.equal(input.first_frame_url, "https://a.test/first_frame.png");
  });

  test("text-to-video requires an aspect ratio and refuses 3s", () => {
    assert.deepEqual(buildInput(kie, { prompt: "x", duration: 6, aspect_ratio: "9:16" }).problems, []);
    assert.match(buildInput(kie, { prompt: "x", duration: 3 }).problems[0], /outside its 4-15s range/);
  });

  test("4s at 768P is priced at 8 credits a second", () => {
    assert.equal(estimateUsd(kie, { durationS: 4, resolution: "768P" }).usd, 0.16);
  });

  test("the WaveSpeed route is priced per second at its listed rates", () => {
    const wsRoute = h3.routes.find((r) => r.provider === "wavespeed");
    assert.equal(wsRoute.pricing.per, "second");
    assert.equal(wsRoute.priceUsd, 0.2);
    assert.equal(estimateUsd(wsRoute, { durationS: 10, resolution: "480p" }).usd, 0.4);
    assert.equal(estimateUsd(wsRoute, { durationS: 10, resolution: "1080p" }).usd, 1.6);
    // No resolution given: the route's captured default (480p) is what is sent.
    assert.equal(estimateUsd(wsRoute, { durationS: 10 }).usd, 0.4);
  });

  test("audio is declared native, because it cannot be switched off", () => {
    assert.equal(h3.nativeAudio, true);
    assert.ok(!kie.input.params?.generate_audio);
  });
});

describe("Seedance 2.5 on kie matches its documented contract", () => {
  const s = catalog.models["seedance-2-5"];
  const kie = s.routes[0];
  const ws = s.routes.find((r) => r.provider === "wavespeed");

  test("kie is primary and cheaper than WaveSpeed at every listed resolution", () => {
    assert.equal(kie.provider, "kie");
    for (const res of ["480p", "720p", "1080p"]) {
      assert.ok(kie.pricing.usdPerSecond[res] < ws.pricing.usdPerSecond[res], res);
    }
  });

  test("audio can be switched off, and a 30s job is in range", () => {
    const { input, problems } = buildInput(kie, {
      prompt: "x",
      duration: 30,
      params: { generate_audio: false, return_last_frame: true },
    });
    assert.deepEqual(problems, []);
    assert.strictEqual(input.generate_audio, false);
    assert.strictEqual(input.return_last_frame, true);
  });

  test("a first frame with reference images is refused before submitting", () => {
    const { problems } = buildInput(kie, { prompt: "x", duration: 5, refs: [frame("first_frame"), frame("identity")] });
    assert.match(problems[0], /cannot combine first_frame with identity/);
  });

  test("a 4s 480p draft costs 28 credits a second, not the 15s price", () => {
    assert.equal(estimateUsd(kie, { durationS: 4, resolution: "480p" }).usd, 0.56);
  });

  test("the draft finalize model is recorded for later use", () => {
    assert.equal(kie.draftFinalize.model, "bytedance/seedance-2-5-draft");
  });
});
