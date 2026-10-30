import { describe, test, expect, vi, beforeEach } from "vitest";
import { api, ApiError, setKeyForTests } from "./client";

beforeEach(() => setKeyForTests("k-123"));

describe("api", () => {
  test("sends the studio key and parses JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await api("/api/ping")).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][1].headers["x-studio-key"]).toBe("k-123");
  });

  test("posts a JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await api("/api/estimate", { method: "POST", body: { model: "x" } });
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"model":"x"}');
    expect(init.headers["content-type"]).toBe("application/json");
  });

  test("an error response becomes an ApiError with core's code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 2, message: "Over the cap." } }), { status: 402 })));
    await expect(api("/api/x")).rejects.toMatchObject({ code: 2, status: 402, message: "Over the cap." });
  });

  test("a network failure is an ApiError with offline set", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = (await api("/api/x").catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.offline).toBe(true);
  });
});
