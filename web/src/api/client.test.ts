import { describe, test, expect, vi, beforeEach } from "vitest";
import { api, ApiError, setKeyForTests, studioKey } from "./client";

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

  test("a file goes as the raw body, named in X-File-Name, never as JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const data = new Blob([new Uint8Array([1, 2, 3])]);
    await api("/api/library/incoming", { file: { data, name: "zed pose.png" } });
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(data);
    expect(init.headers["content-type"]).toBe("application/octet-stream");
    expect(init.headers["x-file-name"]).toBe("zed%20pose.png");
    expect(init.headers["x-studio-key"]).toBe("k-123");
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

  test("a refused key after a server restart picks up the new key from the page and retries once", async () => {
    const page = '<html><head><meta name="studio-key" content="k-new"></head></html>';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Missing or wrong studio key." } }), { status: 403 }))
      .mockResolvedValueOnce(new Response(page, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await api("/api/spend")).toEqual({ ok: true });
    expect(fetchMock.mock.calls[1][0]).toBe("/");
    expect(fetchMock.mock.calls[2][1].headers["x-studio-key"]).toBe("k-new");
    expect(studioKey()).toBe("k-new");
  });

  test("a second refusal is reported, not retried forever", async () => {
    const page = '<meta name="studio-key" content="k-same">';
    const refused = () => new Response(JSON.stringify({ error: { message: "Missing or wrong studio key." } }), { status: 403 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(refused())
      .mockResolvedValueOnce(new Response(page, { status: 200 }))
      .mockResolvedValueOnce(refused());
    vi.stubGlobal("fetch", fetchMock);
    await expect(api("/api/spend")).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
