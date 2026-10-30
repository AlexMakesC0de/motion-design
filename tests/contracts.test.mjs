import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { effectiveRoute, buildInput } from "../cli/lib/models.mjs";

describe("an image-to-video call uses the image-to-video contract", () => {
  const route = {
    model: "acme/t2v",
    i2vModel: "acme/i2v",
    input: { enums: { aspect_ratio: ["16:9"] }, required: ["prompt", "aspect_ratio"] },
    i2vInput: { required: ["prompt"] },
  };

  test("the i2v model brings its own captured input", () => {
    const call = effectiveRoute(route, true);
    assert.equal(call.model, "acme/i2v");
    assert.deepEqual(call.input, route.i2vInput);
  });

  test("with no captured i2v contract, the t2v contract carries over", () => {
    const { i2vInput, ...noI2vInput } = route;
    assert.deepEqual(effectiveRoute(noI2vInput, true).input, route.input);
  });

  test("no first frame, no switch", () => {
    assert.equal(effectiveRoute(route, false), route);
  });

  test("a route with no separate i2v model is called as it is", () => {
    const single = { model: "acme/one", input: {} };
    assert.equal(effectiveRoute(single, true), single);
  });
});

describe("reference rules a model documents are enforced locally", () => {
  const route = {
    model: "acme/v",
    input: {
      refFields: {
        first_frame: "first_frame_url",
        last_frame: "last_frame_url",
        identity: "reference_image_urls",
      },
      refRules: {
        exclusiveGroups: [["first_frame", "last_frame"], ["identity"]],
        requires: { last_frame: "first_frame" },
        note: "Frame mode and reference mode are separate.",
      },
    },
  };
  const ref = (role, n = 1) => ({ url: `https://a.test/${role}${n}.png`, role });

  test("a first frame plus reference images is refused, naming both", () => {
    const { problems } = buildInput(route, { prompt: "x", refs: [ref("first_frame"), ref("identity")] });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /cannot combine first_frame with identity/);
    assert.match(problems[0], /Frame mode and reference mode are separate/);
  });

  test("first and last frame together are one mode, so they pass", () => {
    const { problems } = buildInput(route, { prompt: "x", refs: [ref("first_frame"), ref("last_frame")] });
    assert.deepEqual(problems, []);
  });

  test("a last frame on its own is refused", () => {
    const { problems } = buildInput(route, { prompt: "x", refs: [ref("last_frame")] });
    assert.match(problems[0], /"last_frame" needs a "first_frame"/);
  });

  test("several identity images are still one mode", () => {
    const { problems, input } = buildInput(route, { prompt: "x", refs: [ref("identity", 1), ref("identity", 2)] });
    assert.deepEqual(problems, []);
    assert.equal(input.reference_image_urls.length, 2);
  });

  test("a route without rules is unaffected", () => {
    const plain = { model: "acme/p", input: { refFields: route.input.refFields } };
    assert.deepEqual(buildInput(plain, { prompt: "x", refs: [ref("first_frame"), ref("identity")] }).problems, []);
  });
});
