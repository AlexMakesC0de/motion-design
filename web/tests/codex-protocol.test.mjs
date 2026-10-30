import "./helpers.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// The Codex backend is written against the types generated from codex-cli
// (web/server/chat/codex-protocol, made by npm --prefix web run codex-protocol).
// These checks fail when the backend uses a method or value that the checked-in
// protocol does not have, or when the installed Codex is a newer version than
// the one the types came from.
const PROTOCOL = new URL("../server/chat/codex-protocol/", import.meta.url);
const methods = JSON.parse(readFileSync(new URL("methods.json", PROTOCOL), "utf8"));
const type = (rel) => readFileSync(new URL(rel, PROTOCOL), "utf8");
const source = readFileSync(new URL("../server/chat/codex.mjs", import.meta.url), "utf8");
const { ANSWERS } = await import("../server/chat/codex.mjs");

test("every method the backend sends or handles is in the generated protocol", () => {
  const requests = [...source.matchAll(/request\("([^"]+)"/g)].map((m) => m[1]);
  const notes = [...source.matchAll(/notify\("([^"]+)"/g)].map((m) => m[1]);
  const handled = [...source.matchAll(/case "([^"]+)":/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(requests)].sort(),
    ["account/read", "initialize", "mcpServerStatus/list", "thread/resume", "thread/start", "turn/interrupt", "turn/start"],
  );
  for (const m of requests) assert.ok(methods.clientRequests.includes(m), `client request ${m}`);
  for (const m of notes) assert.ok(methods.clientNotifications.includes(m), `client notification ${m}`);
  for (const m of handled) assert.ok(methods.serverNotifications.includes(m), `server notification ${m}`);
});

test("every request Codex can send the client has an answer", () => {
  assert.deepEqual(Object.keys(ANSWERS).sort(), [...methods.serverRequests].sort());
});

test("the values the backend sends are in the generated types", () => {
  assert.match(type("v2/SandboxMode.ts"), /"read-only"/);
  assert.match(type("v2/AskForApproval.ts"), /"never"/);
  assert.match(type("v2/CommandExecutionApprovalDecision.ts"), /"decline"/);
  assert.match(type("v2/ThreadStartParams.ts"), /developerInstructions/);
  assert.match(type("v2/TurnStartParams.ts"), /threadId: string,[^}]*input: Array<UserInput>/);
  assert.match(type("v2/ThreadItem.ts"), /"type": "mcpToolCall", id: string, server: string, tool: string, status: McpToolCallStatus, arguments: JsonValue/);
  assert.match(type("v2/ThreadItem.ts"), /"type": "agentMessage", id: string, text: string/);
  assert.match(type("v2/AgentMessageDeltaNotification.ts"), /itemId: string, delta: string/);
});

const installed = spawnSync("codex", ["--version"], { encoding: "utf8" });
test("the types come from the installed Codex's version", { skip: installed.status !== 0 && "codex is not installed" }, () => {
  assert.equal(
    methods.generatedBy,
    installed.stdout.trim(),
    "Codex was updated. Run: npm --prefix web run codex-protocol, then npm --prefix web run test:server",
  );
});
