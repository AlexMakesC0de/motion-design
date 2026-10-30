// Every server test imports this first. It points runs/, library/ and the
// limits file at a temp folder BEFORE cli modules load (they read these at
// import), and makes any real network call throw.
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const tmp = realpathSync(mkdtempSync(join(tmpdir(), "kie-web-")));
export const RUNS = join(tmp, "runs");
export const LIBRARY = join(tmp, "library");
process.env.KIE_RUNS_DIR = RUNS;
process.env.KIE_LIBRARY_DIR = LIBRARY;
process.env.KIE_LIMITS_FILE = join(tmp, "limits.json");
process.env.KIE_API_KEY = "test-key-not-real";
mkdirSync(RUNS, { recursive: true });
mkdirSync(LIBRARY, { recursive: true });
globalThis.fetch = () => {
  throw new Error("network call attempted in a web server test");
};

export const KEY = "test-session-key-0123456789abcdef";

/** Stubs for every call that would reach a provider. */
export const deps = { credits: async () => 100 };

/**
 * Fake provider calls for the generate and follow tests, with a call log.
 * Same shape as mcp/tests/helpers.mjs: `generate` replaces preflight,
 * createTask, waitForTask, download and creditsAfter inside cli/core.
 */
export function generateStubs({ estimateUsd = 0.56 } = {}) {
  const calls = { create: [], wait: 0, download: 0, upload: 0 };
  const generate = {
    preflight: async (_catalog, _route, o) => ({ estimatedUsd: estimateUsd, basis: "stub", cap: o.budgetUsd ?? 3, creditsBefore: 100 }),
    createTask: async (prov, _family, model, input) => {
      calls.create.push({ provider: prov.name, model, input });
      return { taskId: `task-${calls.create.length}` };
    },
    waitForTask: async () => {
      calls.wait += 1;
      return { state: "success", urls: ["https://cdn.test/result.mp4"], data: { state: "success", creditsConsumed: 6 }, elapsedS: 2 };
    },
    download: async (_url, path) => {
      calls.download += 1;
      writeFileSync(path, "fake media");
      return path;
    },
    creditsAfter: async () => 94,
  };
  const upload = async () => {
    calls.upload += 1;
    return { url: `https://files.test/${calls.upload}.png` };
  };
  return { calls, generate, deps: { ...deps, generate, upload } };
}

/**
 * One HTTP request through node:http (fetch is disabled, and fetch cannot
 * set Host). Resolves { status, headers, text, json, buf }.
 */
export function req(port, path, { method = "GET", headers = {}, body, key = KEY, host = `127.0.0.1:${port}` } = {}) {
  return new Promise((resolve, reject) => {
    const h = { host, ...(key ? { "x-studio-key": key } : {}), ...headers };
    let payload;
    if (body !== undefined) {
      payload = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
      h["content-type"] ??= "application/json";
      h["content-length"] = payload.length;
    }
    const r = request({ host: "127.0.0.1", port, path, method, headers: h }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString("utf8");
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json, buf });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}
