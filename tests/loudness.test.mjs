import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { parseLoudnorm } from "../cli/lib/ffmpeg.mjs";

const report = (o) => `[Parsed_loudnorm_0 @ 0x1] \n${JSON.stringify(o, null, 2)}\n`;

describe("parseLoudnorm", () => {
  test("reads a normal measurement as numbers", () => {
    const r = parseLoudnorm(report({ input_i: "-23.50", input_tp: "-4.10", input_lra: "3.20", input_thresh: "-33.70", target_offset: "7.50" }));
    assert.deepEqual(r, { inputI: -23.5, inputTp: -4.1, inputLra: 3.2, inputThresh: -33.7, targetOffset: 7.5 });
  });

  test("a silent track (-inf) gives null, not NaN, so probe still returns", () => {
    const r = parseLoudnorm(report({ input_i: "-inf", input_tp: "-inf", input_lra: "0.00", input_thresh: "-inf", target_offset: "inf" }));
    assert.equal(r.inputI, null);
    assert.equal(r.inputTp, null);
    assert.equal(r.inputThresh, null);
    assert.equal(r.targetOffset, null);
    assert.equal(r.inputLra, 0);
    assert.ok(Object.values(r).every((v) => v === null || Number.isFinite(v)));
  });

  test("text with no report gives null", () => {
    assert.equal(parseLoudnorm("nothing here"), null);
  });
});
