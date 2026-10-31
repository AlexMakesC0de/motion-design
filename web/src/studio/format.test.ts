import { describe, test, expect } from "vitest";
import { clip, elapsed, frameRatio, mediaFile, onlyBudgetBlocks, refusalReason, shotSpec, takeCost, takeName, takeSpec, takeStatus } from "./format";
import type { JobView } from "../api/types";
import { estimate, job } from "../test-fixtures";

const NOW = Date.parse("2026-10-31T10:01:05.000Z");

describe("tile text", () => {
  test("spec line and cost: actual when known, ~estimate otherwise", () => {
    expect(takeSpec(job())).toBe("seedance-2-5 · 4s · 480p");
    expect(takeSpec(job({ durationS: "5", resolution: null }))).toBe("seedance-2-5 · 5s");
    expect(takeCost(job())).toBe("$0.50");
    expect(takeCost(job({ actualUsd: null }))).toBe("~$0.56");
  });

  test("running shows elapsed time", () => {
    expect(elapsed("2026-10-31T10:00:00.000Z", NOW)).toBe("1:05");
    expect(takeStatus(job({ state: "submitted", following: true }), NOW)).toEqual({ kind: "running", label: "running 1:05" });
    expect(takeStatus(job({ state: "sending" }), NOW)).toEqual({ kind: "running", label: "running 1:05" });
  });

  test("an unsettled job nobody is following says so instead of a clock that never stops", () => {
    expect(takeStatus(job({ state: "submitted", following: false }), NOW)).toEqual({ kind: "unwatched", label: "not being watched" });
    expect(takeStatus(job({ state: "uncertain", following: false }), NOW)).toEqual({ kind: "unwatched", label: "not being watched" });
  });

  test("each failed state says whether it was charged", () => {
    const label = (over: Partial<JobView>) => {
      const s = takeStatus(job({ error: "kie.ai: task failed: content policy\nmore", ...over }), NOW);
      return s.kind === "failed" ? [s.label, s.reason] : null;
    };
    expect(label({ state: "failed-confirmed-free", costSource: "create-rejected" })).toEqual(["refused by kie, not charged", "kie.ai: task failed: content policy"]);
    expect(label({ state: "failed-confirmed-free", costSource: "task-record" })?.[0]).toBe("not charged");
    expect(label({ state: "failed-charged", actualUsd: 0.4 })?.[0]).toBe("charged $0.40");
    expect(label({ state: "failed-unconfirmed" })?.[0]).toBe("may have been charged");
    expect(label({ state: "refused" })).toEqual(["not sent, not charged", "Stopped before sending."]);
  });

  test("uncertain is still checking; succeeded is done", () => {
    expect(takeStatus(job({ state: "uncertain", following: true }), NOW)).toEqual({ kind: "uncertain", label: "still checking" });
    expect(takeStatus(job(), NOW)).toEqual({ kind: "done" });
  });

  test("media helpers", () => {
    expect(mediaFile("/media/runs/zed/out%202.mp4")).toBe("out 2.mp4");
    expect(frameRatio("9:16")).toBe(0.5625);
    expect(frameRatio("16:9")).toBe(1.7778);
    expect(frameRatio(null)).toBe(1);
    expect(frameRatio("0:0")).toBe(1);
  });

  test("a shot's line is model, duration and ratio, leaving out what the take does not have", () => {
    expect(shotSpec(job({ model: "minimax-h3", durationS: "6", aspectRatio: "9:16" }))).toBe("minimax-h3 · 6s · 9:16");
    expect(shotSpec(job({ capability: "image", model: "gpt-image-2", durationS: null, aspectRatio: null }))).toBe("gpt-image-2");
  });

  test("clip puts the text on one line and cuts it with an ellipsis", () => {
    expect(clip("A fox\n  runs.", 60)).toBe("A fox runs.");
    expect(clip("abcdefghij", 5)).toBe("abcde…");
    expect(clip("abcde", 5)).toBe("abcde");
  });
});

describe("takeName", () => {
  const name = (over: Partial<JobView>) => takeName(job(over), takeStatus(job(over), NOW));

  test("a succeeded take: model, duration and the prompt", () => {
    expect(name({ model: "minimax-h3", durationS: 6, prompt: "Ink drop blooms into the Zethus wordmark" })).toBe("Open minimax-h3 6s take: Ink drop blooms into the Zethus wordmark");
  });

  test("a long prompt is cut at about 60 characters", () => {
    const long = "Ink drop blooms into the Zethus wordmark while the camera slowly pulls back from the table";
    const n = name({ prompt: long });
    expect(n).toBe(`Open seedance-2-5 4s take: ${long.slice(0, 60).trimEnd()}…`);
  });

  test("an image has no duration, and a take with no prompt has no colon", () => {
    expect(name({ model: "gpt-image-2", durationS: null, prompt: null })).toBe("Open gpt-image-2 take");
  });

  test("a take that did not succeed says what became of it", () => {
    expect(name({ state: "failed-charged", prompt: "A fox" })).toBe("Open seedance-2-5 4s failed take: A fox");
    expect(name({ state: "submitted", following: true, prompt: "A fox" })).toBe("Open seedance-2-5 4s running take: A fox");
    expect(name({ state: "submitted", following: false, prompt: "A fox" })).toBe("Open seedance-2-5 4s not being watched take: A fox");
    expect(name({ state: "uncertain", following: true, prompt: "A fox" })).toBe("Open seedance-2-5 4s uncertain take: A fox");
  });
});

describe("refusalReason", () => {
  test("allowed is null", () => {
    expect(refusalReason(estimate())).toBeNull();
  });

  test("over today's cap names the gap", () => {
    expect(refusalReason(estimate({ withinDailyCap: false, availableTodayUsd: 0.16, allowed: false }))).toBe("over today's cap by $0.40, raise it in Settings");
  });

  test("over the per-job limit names the gap", () => {
    expect(refusalReason(estimate({ withinPerJob: false, perJobUsd: 0.5, allowed: false }))).toBe("over the per-job limit by $0.06, raise it in Settings");
  });

  test("a problem from core is shown as core worded it", () => {
    expect(refusalReason(estimate({ problems: ["seedance-2-5 generates 4/5/6s, not 2s."], allowed: false }))).toBe("seedance-2-5 generates 4/5/6s, not 2s.");
  });

  test("only the job budget blocking can be lifted", () => {
    const e = estimate({ estimateUsd: 4.2, withinBudget: false, allowed: false });
    expect(refusalReason(e)).toBe("over this job's $3.00 budget");
    expect(onlyBudgetBlocks(e)).toBe(true);
    expect(onlyBudgetBlocks(estimate({ withinBudget: false, withinDailyCap: false }))).toBe(false);
  });
});
