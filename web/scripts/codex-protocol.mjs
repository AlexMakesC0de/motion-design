#!/usr/bin/env node
// Regenerate the Codex app-server protocol types the chat's subscription
// backend relies on, from the installed codex CLI. Runs
// `codex app-server generate-ts` into a temp folder, then copies only the
// files the backend uses (and every file they import) into
// server/chat/codex-protocol/, plus methods.json: the method names of every
// client request, server request and server notification in this version.
// Free and offline: generating types starts no server and no thread.
//
//   npm --prefix web run codex-protocol
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "server", "chat", "codex-protocol");

/** The shapes codex.mjs reads or writes. Each pulls in what it imports. */
const ROOTS = [
  "InitializeParams.ts",
  "InitializeResponse.ts",
  "ClientNotification.ts",
  "v2/GetAccountParams.ts",
  "v2/GetAccountResponse.ts",
  "v2/ThreadStartParams.ts",
  "v2/ThreadStartResponse.ts",
  "v2/ThreadResumeParams.ts",
  "v2/TurnStartParams.ts",
  "v2/TurnStartResponse.ts",
  "v2/TurnInterruptParams.ts",
  "v2/ListMcpServerStatusParams.ts",
  "v2/ListMcpServerStatusResponse.ts",
  "v2/ItemStartedNotification.ts",
  "v2/ItemCompletedNotification.ts",
  "v2/AgentMessageDeltaNotification.ts",
  "v2/TurnCompletedNotification.ts",
  "v2/ErrorNotification.ts",
  "v2/CommandExecutionRequestApprovalResponse.ts",
  "v2/FileChangeRequestApprovalResponse.ts",
  "v2/PermissionsRequestApprovalResponse.ts",
  "v2/McpServerElicitationRequestResponse.ts",
  "v2/ToolRequestUserInputResponse.ts",
  "v2/DynamicToolCallResponse.ts",
  "ApplyPatchApprovalResponse.ts",
  "ExecCommandApprovalResponse.ts",
];

const methods = (text) => [...text.matchAll(/"method": "([^"]+)"/g)].map((m) => m[1]);

const tmp = mkdtempSync(join(tmpdir(), "codex-ts-"));
try {
  const gen = spawnSync("codex", ["app-server", "generate-ts", "--out", tmp], { encoding: "utf8" });
  if (gen.status !== 0) {
    process.stderr.write(`codex app-server generate-ts failed (is codex installed?):\n${gen.stderr || gen.error?.message}\n`);
    process.exit(1);
  }
  const version = spawnSync("codex", ["--version"], { encoding: "utf8" }).stdout.trim();
  const keep = new Set();
  const visit = (rel) => {
    if (keep.has(rel)) return;
    keep.add(rel);
    const text = readFileSync(join(tmp, rel), "utf8");
    for (const m of text.matchAll(/from "(\.[^"]+)"/g)) visit(normalize(join(dirname(rel), `${m[1]}.ts`)));
  };
  ROOTS.forEach(visit);

  rmSync(OUT, { recursive: true, force: true });
  for (const rel of [...keep].sort()) {
    mkdirSync(dirname(join(OUT, rel)), { recursive: true });
    cpSync(join(tmp, rel), join(OUT, rel));
  }
  const read = (f) => readFileSync(join(tmp, f), "utf8");
  const index = {
    generatedBy: version,
    clientRequests: methods(read("ClientRequest.ts")),
    clientNotifications: methods(read("ClientNotification.ts")),
    serverRequests: methods(read("ServerRequest.ts")),
    serverNotifications: methods(read("ServerNotification.ts")),
  };
  writeFileSync(join(OUT, "methods.json"), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`${keep.size} type files and methods.json from ${version} in ${OUT}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
