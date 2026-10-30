import { describe, test, expect, beforeEach } from "vitest";
import { addRef, applyPreset, estimateBody, fitToModel, generateBody, getDraft, getRun, removeRef, resetForTests, reuseJob, setRun } from "./promptStore";
import { job, model } from "../test-fixtures";

beforeEach(() => resetForTests());

describe("promptStore", () => {
  test("Reuse copies a take's prompt and settings, and clears refs, preset and budget", () => {
    resetForTests({ refs: [{ source: "zed", role: "identity" }], preset: "x", budgetUsd: 5 });
    reuseJob(job({ durationS: "5", resolution: "720p", aspectRatio: "9:16" }));
    expect(getDraft()).toMatchObject({ prompt: "A fox runs.", model: "seedance-2-5", durationS: 5, resolution: "720p", aspectRatio: "9:16", refs: [], preset: null, budgetUsd: null });
  });

  test("Use this puts the preset's prompt and defaults in, and remembers the preset", () => {
    applyPreset({ id: "kinetic-typography", model: "minimax-h3", durationS: 15, aspectRatio: "16:9", prompt: "SOURCE" });
    expect(getDraft()).toMatchObject({ prompt: "SOURCE", model: "minimax-h3", durationS: 15, preset: "kinetic-typography" });
  });

  test("refs: adding the same asset and role twice keeps one; remove by index", () => {
    addRef({ source: "zed", role: "identity" });
    addRef({ source: "zed", role: "identity" });
    addRef({ source: "bottle", role: "style" });
    expect(getDraft().refs).toEqual([{ source: "zed", role: "identity" }, { source: "bottle", role: "style" }]);
    removeRef(0);
    expect(getDraft().refs).toEqual([{ source: "bottle", role: "style" }]);
  });

  test("fitToModel keeps settings the model takes and swaps the rest", () => {
    const m = model({ durationsS: [6, 10], aspectRatios: ["16:9"], resolutionOptions: ["768P", "2K"], defaultResolution: "768P", refRoles: ["first_frame"] });
    const d = { ...getDraft(), durationS: 10, aspectRatio: "21:9", resolution: "480p", refs: [{ source: "zed", role: "identity" }] };
    expect(fitToModel(m, d)).toEqual({ model: "seedance-2-5", durationS: 10, aspectRatio: "16:9", resolution: "768P", refs: [], budgetUsd: null });
  });

  test("the working film is remembered", () => {
    setRun("zethus-hero");
    expect(getRun()).toBe("zethus-hero");
    expect(localStorage.getItem("studio.run")).toBe("zethus-hero");
  });

  test("request bodies: camelCase for estimate, the MCP names for generate", () => {
    resetForTests({ prompt: "A fox", model: "seedance-2-5", durationS: 4, resolution: "480p", aspectRatio: "16:9", preset: "p1" });
    expect(estimateBody(getDraft(), model())).toEqual({ model: "seedance-2-5", durationS: 4, resolution: "480p", aspectRatio: "16:9", refs: [], budgetUsd: undefined });
    expect(generateBody(getDraft(), model(), "zed")).toEqual({
      run: "zed", prompt: "A fox", model: "seedance-2-5", duration_s: 4, preset: "p1", resolution: "480p", aspect_ratio: "16:9", refs: [], budget_usd: undefined,
    });
    const image = generateBody(getDraft(), model({ capability: "image" }), "zed");
    expect(image).not.toHaveProperty("duration_s");
  });
});
