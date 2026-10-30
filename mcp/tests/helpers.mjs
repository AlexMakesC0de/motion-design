// Every MCP test file imports this first. It points runs/, library/ and the
// limits file at a temp folder and sets a dummy key BEFORE the server (and the
// cli modules, which read these at import) load. Provider calls are stubs.
import { mkdtempSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const tmp = realpathSync(mkdtempSync(join(tmpdir(), "kie-mcp-")));
export const RUNS = join(tmp, "runs");
process.env.KIE_RUNS_DIR = RUNS;
process.env.KIE_LIBRARY_DIR = join(tmp, "library");
process.env.KIE_LIMITS_FILE = join(tmp, "limits.json");
process.env.KIE_API_KEY = "test-key-not-real";
mkdirSync(RUNS, { recursive: true });

const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { createServer } = await import("../server.mjs");

export const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const ff = (args) => spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

/** A real, decodable PNG. */
export function realPng(path, size = "1024x1024") {
  ff(["-f", "lavfi", "-i", `color=c=red:s=${size}`, "-frames:v", "1", path]);
  return path;
}

/** A real 2-second MP4 with no audio. */
export function realMp4(path) {
  ff(["-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=2", "-pix_fmt", "yuv420p", path]);
  return path;
}

/** Stubs for every call that would reach a provider, with a call log. */
export function stubs() {
  const calls = { create: [], wait: 0, upload: 0 };
  const generate = {
    preflight: async (catalog, route, o) => ({ estimatedUsd: 0.56, basis: "stub", cap: o.budgetUsd ?? 3, creditsBefore: 100 }),
    createTask: async (prov, family, model, input) => {
      calls.create.push({ provider: prov.name, model, input });
      return { taskId: `task-${calls.create.length}` };
    },
    waitForTask: async () => {
      calls.wait += 1;
      return { state: "success", urls: ["https://cdn.test/result.png"], data: { state: "success", creditsConsumed: 6 }, elapsedS: 2 };
    },
    download: async (url, path) => (hasFfmpeg ? realPng(path, "64x64") : path),
    creditsAfter: async () => 94,
  };
  const deps = {
    generate,
    upload: async () => {
      calls.upload += 1;
      return { url: `https://files.test/${calls.upload}.png` };
    },
    credits: async () => 100,
  };
  return { calls, deps };
}

export async function connect(deps) {
  const server = createServer({ deps });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  return client;
}

export const call = (client, name, args = {}) => client.callTool({ name, arguments: args });
export const errorOf = (r) => r._meta?.error;
