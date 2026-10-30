import { describe, test, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { mergeTask, useTasks } from "./useTasks";
import { emitForTests } from "../app/useStudio";
import { routes, task } from "../test-fixtures";

describe("mergeTask", () => {
  test("a new task goes first; an update replaces its old copy", () => {
    const a = task({ id: "t-aaaaaaaa", startedAt: "2026-10-31T10:00:00.000Z", state: "done" });
    const b = task({ id: "t-bbbbbbbb", startedAt: "2026-10-31T10:05:00.000Z" });
    let list = mergeTask([a], b);
    expect(list.map((t) => t.id)).toEqual(["t-bbbbbbbb", "t-aaaaaaaa"]);
    list = mergeTask(list, { ...b, state: "failed", error: "ffmpeg exited 1" });
    expect(list.map((t) => [t.id, t.state])).toEqual([["t-bbbbbbbb", "failed"], ["t-aaaaaaaa", "done"]]);
  });
});

describe("useTasks", () => {
  test("loads the film's tasks, takes this film's task events, and says when one settles", async () => {
    vi.stubGlobal("fetch", vi.fn(routes({ "/api/tasks": () => [task({ id: "t-old00000", state: "done" })] })));
    const settled = vi.fn();
    const { result } = renderHook(() => useTasks("zed", settled));
    await waitFor(() => expect(result.current.map((t) => t.id)).toEqual(["t-old00000"]));
    act(() => emitForTests({ event: "task", data: task({ id: "t-new00000", outS: 1.5 }) }));
    act(() => emitForTests({ event: "task", data: task({ id: "t-other000", run: "other" }) }));
    expect(result.current.map((t) => t.id)).toEqual(["t-new00000", "t-old00000"]);
    expect(settled).not.toHaveBeenCalled();
    act(() => emitForTests({ event: "task", data: task({ id: "t-new00000", state: "done", outputs: [{ name: "film.mp4", url: "/media/runs/zed/film.mp4" }] }) }));
    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ id: "t-new00000", state: "done" }));
  });
});
