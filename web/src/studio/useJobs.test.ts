import { describe, test, expect } from "vitest";
import { mergeJob } from "./useJobs";
import { job } from "../test-fixtures";

describe("mergeJob", () => {
  test("a new job goes first; an update replaces the old copy in place of order", () => {
    const a = job({ id: "j-20261031-aaaaaa", createdAt: "2026-10-31T09:00:00.000Z" });
    const b = job({ id: "j-20261031-bbbbbb", createdAt: "2026-10-31T10:00:00.000Z", state: "submitted" });
    let list = mergeJob([a], b);
    expect(list.map((j) => j.id)).toEqual(["j-20261031-bbbbbb", "j-20261031-aaaaaa"]);
    list = mergeJob(list, { ...a, state: "failed-charged" });
    expect(list.map((j) => [j.id, j.state])).toEqual([["j-20261031-bbbbbb", "submitted"], ["j-20261031-aaaaaa", "failed-charged"]]);
  });
});
