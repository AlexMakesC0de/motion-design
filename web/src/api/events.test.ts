import { describe, test, expect } from "vitest";
import { parseSse } from "./events";

describe("parseSse", () => {
  test("splits complete events and keeps the remainder", () => {
    const { events, rest } = parseSse('event: job\ndata: {"id":"a"}\n\n: ping\n\nevent: spend\ndata: {"sp');
    expect(events).toEqual([{ event: "job", data: { id: "a" } }]);
    expect(rest).toBe('event: spend\ndata: {"sp');
  });
});
