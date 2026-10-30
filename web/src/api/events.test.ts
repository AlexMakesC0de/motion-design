import { describe, test, expect, vi } from "vitest";
import { parseSse, subscribe } from "./events";
import { setKeyForTests } from "./client";

describe("parseSse", () => {
  test("splits complete events and keeps the remainder", () => {
    const { events, rest } = parseSse('event: job\ndata: {"id":"a"}\n\n: ping\n\nevent: spend\ndata: {"sp');
    expect(events).toEqual([{ event: "job", data: { id: "a" } }]);
    expect(rest).toBe('event: spend\ndata: {"sp');
  });
});

describe("subscribe", () => {
  test("after a server restart it fetches the new key and reconnects", async () => {
    setKeyForTests("k-old");
    const stream = () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('event: spend\ndata: {"spentUsd":1}\n\n')); } }), { status: 200 });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/") return new Response('<meta name="studio-key" content="k-new">', { status: 200 });
      const k = (init?.headers as Record<string, string>)["x-studio-key"];
      return k === "k-new" ? stream() : new Response("{}", { status: 403 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const ups: boolean[] = [];
    const got: unknown[] = [];
    const stop = subscribe((e) => got.push(e), (up) => ups.push(up));
    await vi.waitFor(() => expect(got).toHaveLength(1), { timeout: 2000 });
    stop();
    expect(ups).toContain(true);
    expect(fetchMock.mock.calls.some(([u]) => u === "/")).toBe(true);
  });
});
