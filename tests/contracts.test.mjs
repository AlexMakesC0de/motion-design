import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { effectiveRoute, buildInput, parseParams } from "../cli/lib/models.mjs";
import { EXIT } from "../cli/lib/errors.mjs";

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

describe("--param values are read as the types providers expect", () => {
  test("booleans and numbers parse; anything else stays a string", () => {
    assert.deepEqual(parseParams(["generate_audio=false", "seed=42", "output_format=mov"]), {
      generate_audio: false,
      seed: 42,
      output_format: "mov",
    });
  });

  test("a value may itself contain '='", () => {
    assert.deepEqual(parseParams(["note=a=b"]), { note: "a=b" });
  });

  test("a spec without '=' is a usage error", () => {
    assert.throws(() => parseParams(["generate_audio"]), { code: EXIT.USAGE });
  });

  test("no params is an empty object", () => {
    assert.deepEqual(parseParams(undefined), {});
  });
});

describe("params pass only where the route's contract declares them", () => {
  const route = {
    model: "acme/v",
    input: {
      params: {
        generate_audio: { type: "boolean" },
        output_format: { type: "string", enum: ["mp4", "mov"] },
      },
    },
  };

  test("a declared field passes through with its value", () => {
    const { input, problems } = buildInput(route, { prompt: "x", params: { generate_audio: false } });
    assert.deepEqual(problems, []);
    assert.strictEqual(input.generate_audio, false);
  });

  test("an undeclared field is refused, listing what is allowed", () => {
    const { problems } = buildInput(route, { prompt: "x", params: { first_frame_url: "https://evil.test" } });
    assert.match(problems[0], /no passthrough field "first_frame_url". Allowed: generate_audio, output_format/);
  });

  test("a wrong type is refused", () => {
    const { problems } = buildInput(route, { prompt: "x", params: { generate_audio: "no" } });
    assert.match(problems[0], /generate_audio must be a boolean/);
  });

  test("a value outside the enum is refused", () => {
    const { problems } = buildInput(route, { prompt: "x", params: { output_format: "avi" } });
    assert.match(problems[0], /output_format="avi" is not allowed. Allowed: mp4, mov/);
  });

  test("a route with no captured contract refuses params rather than guessing", () => {
    const { problems, input } = buildInput({ model: "acme/guess" }, { prompt: "x", params: { generate_audio: false } });
    assert.match(problems[0], /cannot be checked/);
    assert.ok(!("params" in input) && !("generate_audio" in input));
  });
});

describe("Nano Banana 2's captured contract", () => {
  test("every reference image goes into image_input as a list, up to 10", async () => {
    const { loadCatalog, routesFor } = await import("../cli/lib/models.mjs");
    const catalog = loadCatalog();
    const [route] = routesFor(catalog, { ...catalog.models["nano-banana-2"], id: "nano-banana-2" });
    assert.equal(route.model, "nano-banana-2");
    const refs = [{ role: "identity", url: "https://x/1.png" }, { role: "style", url: "https://x/2.png" }];
    const built = buildInput(effectiveRoute(route, true), { prompt: "p", aspect_ratio: "21:9", refs, params: {} });
    assert.deepEqual(built.problems, []);
    assert.deepEqual(built.input, { aspect_ratio: "21:9", resolution: "2K", output_format: "png", prompt: "p", image_input: ["https://x/1.png", "https://x/2.png"] });
    const many = Array.from({ length: 11 }, (_, i) => ({ role: "identity", url: `https://x/${i}.png` }));
    assert.match(buildInput(route, { prompt: "p", refs: many, params: {} }).problems.join(), /takes at most 10 in image_input; got 11/);
  });
});
