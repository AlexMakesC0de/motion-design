import { describe, test, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useScenes } from "./useScenes";
import { routes } from "../test-fixtures";
import { emitForTests } from "../app/useStudio";

const s1 = { id: "s1", title: "A", durationS: 4, ratio: "16:9", refs: [], cards: { goal: "", scene: "", stages: [], style: "", audio: "" }, versions: [], chosen: null };

describe("useScenes", () => {
  beforeEach(() => vi.useRealTimers());

  test("loads scenes for the run", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/films/create/scenes": () => ({ idea: null, scenes: [s1] }) })));
    const { result } = renderHook(() => useScenes("create"));
    await waitFor(() => expect(result.current.scenes.map((s) => s.id)).toEqual(["s1"]));
  });

  test("save is local at once and sends one PUT after a pause", async () => {
    const fetchMock = vi.fn(routes({ "/api/films/create/scenes": () => ({ idea: null, scenes: [s1] }), "/api/films/create/scenes/s1": () => s1 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useScenes("create"));
    await waitFor(() => expect(result.current.scenes.length).toBe(1));
    vi.useFakeTimers();
    act(() => result.current.save({ ...s1, title: "B" }));
    act(() => result.current.save({ ...s1, title: "BC" }));
    expect(result.current.scenes[0].title).toBe("BC");
    await act(async () => { vi.advanceTimersByTime(450); });
    const puts = fetchMock.mock.calls.filter((c) => c[1]?.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(JSON.parse(String(puts[0][1]?.body)).title).toBe("BC");
  });

  test("a job event for one of its versions reloads", async () => {
    const withV = { ...s1, versions: [{ job: "j-1", kind: "draft", resolution: "480p", prompt: "", createdAt: "", state: "submitted", media: null, estimateUsd: 0.56, actualUsd: null }] };
    const fetchMock = vi.fn(routes({ "/api/films/create/scenes": () => ({ idea: null, scenes: [withV] }) }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useScenes("create"));
    // The hook only reloads for jobs of scenes it holds, so the scene must be in before the event.
    await waitFor(() => expect(result.current.scenes[0]?.versions[0]?.job).toBe("j-1"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => emitForTests({ event: "job", data: { id: "j-1", state: "succeeded" } as never }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
