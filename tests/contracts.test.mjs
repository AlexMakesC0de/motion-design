import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { effectiveRoute } from "../cli/lib/models.mjs";

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
