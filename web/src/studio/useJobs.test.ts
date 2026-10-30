import { describe, test, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { mergeJob, mergeJobs, useJobs } from "./useJobs";
import { job } from "../test-fixtures";
import type { JobView } from "../api/types";

describe("mergeJob", () => {
  test("a new job goes first; an update replaces the old copy in place of order", () => {
    const a = job({ id: "j-20261031-aaaaaa", createdAt: "2026-10-31T09:00:00.000Z" });
    const b = job({ id: "j-20261031-bbbbbb", createdAt: "2026-10-31T10:00:00.000Z", state: "submitted" });
    let list = mergeJob([a], b);
    expect(list.map((j) => j.id)).toEqual(["j-20261031-bbbbbb", "j-20261031-aaaaaa"]);
    list = mergeJob(list, { ...a, state: "failed-charged" });
    expect(list.map((j) => [j.id, j.state])).toEqual([["j-20261031-bbbbbb", "submitted"], ["j-20261031-aaaaaa", "failed-charged"]]);
  });

  test("an older copy never replaces a newer one", () => {
    const fresh = job({ state: "succeeded", updatedAt: "2026-10-31T10:05:00.000Z" });
    const stale = job({ state: "submitted", updatedAt: "2026-10-31T10:01:00.000Z" });
    expect(mergeJob([fresh], stale)[0].state).toBe("succeeded");
    // Same moment, new detail (the follower let go): taken.
    expect(mergeJob([fresh], { ...fresh, following: true })[0].following).toBe(true);
  });
});

describe("mergeJobs", () => {
  test("a loaded list keeps a job the stream already reported newer, and jobs it does not list yet", () => {
    const held = [
      job({ id: "j-20261031-aaaaaa", state: "succeeded", updatedAt: "2026-10-31T10:05:00.000Z" }),
      job({ id: "j-20261031-cccccc", createdAt: "2026-10-31T11:00:00.000Z", state: "submitted" }),
    ];
    const loaded = [job({ id: "j-20261031-aaaaaa", state: "submitted", updatedAt: "2026-10-31T10:01:00.000Z" })];
    const merged = mergeJobs(held, loaded);
    expect(merged.map((j) => [j.id, j.state])).toEqual([["j-20261031-cccccc", "submitted"], ["j-20261031-aaaaaa", "succeeded"]]);
  });
});

describe("useJobs", () => {
  test("switching films fast: a slow answer for the film left behind is ignored", async () => {
    const answers: Record<string, (list: JobView[]) => void> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const run = new URLSearchParams(String(input).split("?")[1]).get("run")!;
        return new Promise<Response>((resolve) => (answers[run] = (list) => resolve(new Response(JSON.stringify(list)))));
      }),
    );
    const { result, rerender } = renderHook(({ run }) => useJobs(run), { initialProps: { run: "alpha" } });
    rerender({ run: "beta" });
    await waitFor(() => expect(Object.keys(answers).sort()).toEqual(["alpha", "beta"]));
    await act(async () => answers.beta([job({ id: "j-20261031-bbbbbb", run: "beta" })]));
    await act(async () => answers.alpha([job({ id: "j-20261031-aaaaaa", run: "alpha" })]));
    expect(result.current.jobs.map((j) => j.run)).toEqual(["beta"]);
  });

  test("of two reloads of one film, only the later answer counts", async () => {
    const pending: Array<(list: JobView[]) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => pending.push((list) => resolve(new Response(JSON.stringify(list)))))),
    );
    const { result } = renderHook(() => useJobs("zed"));
    await waitFor(() => expect(pending.length).toBe(1));
    act(() => void result.current.reload());
    await waitFor(() => expect(pending.length).toBe(2));
    await act(async () => pending[1]([job({ id: "j-20261031-bbbbbb" })]));
    await act(async () => pending[0]([job({ id: "j-20261031-aaaaaa" })]));
    expect(result.current.jobs.map((j) => j.id)).toEqual(["j-20261031-bbbbbb"]);
  });
});
