import { KEY, RUNS, tmp, req } from "./helpers.mjs";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { createApp } = await import("../server/app.mjs");

// The studio with Codex as a fake app-server (fixtures/fake-codex.mjs): logged
// in, one turn that says hello, so the API's Codex path runs end to end.
const FAKE = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));
const exFile = join(tmp, "api-codex.json");
const logFile = join(tmp, "api-codex.log");
writeFileSync(
  exFile,
  JSON.stringify({
    initialize: { userAgent: "motion_design_studio/0.154.0", codexHome: "/Users/someone/.codex", platformFamily: "unix", platformOs: "macos" },
    account: { account: { type: "chatgpt", email: "someone@example.com", planType: "plus" }, requiresOpenaiAuth: true },
    mcpServers: [{ name: "motion-design", runtimeStatus: "connected" }],
    threadId: "thr-api",
    turn: [
      { notify: "item/completed", params: { threadId: "$thread", turnId: "$turn", item: { type: "agentMessage", id: "m1", text: "Hello from Codex." } } },
      { notify: "turn/completed", params: { threadId: "$thread", turn: { id: "$turn", items: [], status: "completed", error: null } } },
    ],
  }),
);

let app, port;
before(async () => {
  app = createApp({ key: KEY, distDir: join(tmp, "nodist"), chat: { codex: { command: process.execPath, prefixArgs: [FAKE, exFile, logFile], args: () => ["app-server"] } } });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());

test("Codex's status shows the plan and never the email; choosing it needs no model; a message runs a Codex turn", async () => {
  const status = await req(port, "/api/chat-settings/codex");
  assert.deepEqual(status.json, { installed: true, loggedIn: true, plan: "ChatGPT plus", message: null });
  assert.ok(!status.text.includes("someone@"));

  const set = await req(port, "/api/chat-settings", { method: "PUT", body: { backend: "codex" } });
  assert.equal(set.status, 200, set.text);
  assert.equal(set.json.backend, "codex");

  const sent = await req(port, "/api/chat/api-codex", { method: "POST", body: { text: "Hi" } });
  assert.equal(sent.status, 200, sent.text);
  await app.chat.idle("api-codex");
  const back = await req(port, "/api/chat/api-codex");
  assert.deepEqual(back.json.entries.map((e) => `${e.kind}: ${e.text}`), ["user: Hi", "assistant: Hello from Codex."]);
  assert.match(readFileSync(join(RUNS, "api-codex", "chat.jsonl"), "utf8"), /"kind":"codex-thread","threadId":"thr-api"/);
  const started = readFileSync(logFile, "utf8").split("\n").filter((l) => l.includes('"thread/start"'));
  assert.equal(started.length, 1);
});
