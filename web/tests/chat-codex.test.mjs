import { RUNS, LIBRARY, tmp } from "./helpers.mjs";
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const codex = await import("../server/chat/codex.mjs");
const { createChat } = await import("../server/chat/session.mjs");
const { writeConnection } = await import("../server/chat/config.mjs");
const { readChat, budgetSentence } = await import("../server/chat/transcript.mjs");
const { REPO_ROOT } = await import("../../cli/lib/run.mjs");

const FAKE = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));
// initialize and account/read as a real codex-cli 0.154.0 answered them (email replaced).
const INITIALIZE = { userAgent: "motion_design_studio/0.154.0", codexHome: "/Users/someone/.codex", platformFamily: "unix", platformOs: "macos" };
const LOGGED_IN = { account: { type: "chatgpt", email: "someone@example.com", planType: "plus" }, requiresOpenaiAuth: true };
const LOGGED_OUT = { account: null, requiresOpenaiAuth: true };
const OURS = { name: "motion-design", runtimeStatus: "connected" };

const ids = { threadId: "$thread", turnId: "$turn" };
const delta = (itemId, text, early = false) => ({ early, notify: "item/agentMessage/delta", params: { ...ids, itemId, delta: text } });
const message = (id, text) => ({ notify: "item/completed", params: { ...ids, item: { type: "agentMessage", id, text } } });
const toolCall = (id, tool, args) => ({
  notify: "item/started",
  params: { ...ids, item: { type: "mcpToolCall", id, server: "motion-design", tool, status: "inProgress", arguments: args, result: null, error: null } },
});
const toolDone = (id, tool, args, status, result) => ({
  notify: "item/completed",
  params: { ...ids, item: { type: "mcpToolCall", id, server: "motion-design", tool, status, arguments: args, result, error: null } },
});
const completed = (status = "completed") => ({ notify: "turn/completed", params: { threadId: "$thread", turn: { id: "$turn", items: [], status, error: null } } });

const ESTIMATE = { model: "seedance-2-5", duration_s: 4, resolution: "480p" };
const REFUSAL =
  "Error 2: Refused, nothing spent. Estimated $0.56 is above the $0.50 per-job limit. Ask the user; only they can raise it, with: kie limits --per-job N\nNext: ask the user";

let n = 0;
const open = [];
/** A Codex backend over the fake app-server, playing `exchange`. Returns it and a reader for the fake's log. */
function fakeCodex(exchange) {
  const name = `codex-${++n}`;
  const exFile = join(tmp, `${name}.json`);
  const logFile = join(tmp, `${name}.log`);
  writeFileSync(exFile, JSON.stringify({ initialize: INITIALIZE, account: LOGGED_IN, mcpServers: [OURS], ...exchange }));
  const backend = codex.createCodex({ command: process.execPath, prefixArgs: [FAKE, exFile, logFile], args: () => ["app-server"] });
  open.push(backend);
  const log = () =>
    readFileSync(logFile, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
  const sent = (method) => log().filter((l) => l.in?.method === method).map((l) => l.in.params);
  return { backend, log, sent };
}
after(() => open.forEach((b) => b.close()));

const chatWith = (backend) => createChat({ backends: { codex: backend }, tools: { instructions: async () => "MCP instructions." } });
const lines = (film) => readChat(film).entries.map((e) => (e.kind === "tool" ? `${e.name} ${e.args} → ${e.result}` : `${e.kind}: ${e.text}`));

describe("how Codex is started", () => {
  const config = [
    "[mcp_servers.context7]",
    'command = "npx"',
    '[mcp_servers."Atlassian"]',
    "url = \"https://mcp.atlassian.com/v1/sse\"",
    "[mcp_servers.figma.env]",
    'X = "1"',
    "[mcp_servers.motion-design]",
    'command = "node"',
    "[plugins.\"stripe@claude\"]",
  ].join("\n");

  test("the MCP servers in config.toml are found by name, ours left out", () => {
    assert.deepEqual(codex.configuredMcpServers(config), ["context7", "Atlassian", "figma"]);
  });

  test("the arguments turn off other tools and servers and point motion-design at this studio's folders, with no key in them", () => {
    const args = codex.codexArgs({ repo: "/repo", node: "/bin/node", runsDir: RUNS, libraryDir: LIBRARY, limitsFile: "/l.json", keyEnvs: ["KIE_API_KEY", "WAVESPEED_API_KEY"], configText: config });
    assert.equal(args[0], "app-server");
    for (const f of codex.DISABLED_FEATURES) assert.ok(args.join(" ").includes(`--disable ${f}`), f);
    const c = args.filter((_, i) => args[i - 1] === "-c");
    assert.deepEqual(c.filter((x) => x.endsWith(".enabled=false")), ["mcp_servers.context7.enabled=false", "mcp_servers.Atlassian.enabled=false", "mcp_servers.figma.enabled=false"]);
    assert.ok(c.includes('mcp_servers.motion-design.command="/bin/node"'));
    assert.ok(c.includes('mcp_servers.motion-design.args=["/repo/mcp/server.mjs"]'));
    assert.ok(c.includes(`mcp_servers.motion-design.env={KIE_RUNS_DIR=${JSON.stringify(RUNS)},KIE_LIBRARY_DIR=${JSON.stringify(LIBRARY)},KIE_LIMITS_FILE="/l.json"}`));
    assert.ok(c.includes('mcp_servers.motion-design.env_vars=["KIE_API_KEY","WAVESPEED_API_KEY"]'));
    assert.ok(c.includes('mcp_servers.motion-design.default_tools_approval_mode="approve"'));
    assert.ok(c.includes('web_search="disabled"'), "web pages could steer a chat that spends without asking");
    assert.ok(!args.join(" ").includes(process.env.KIE_API_KEY), "names only, never the key");
  });

  test("every request Codex can send has an answer, and approvals are declined", () => {
    assert.deepEqual(codex.ANSWERS["item/commandExecution/requestApproval"](), { decision: "decline" });
    assert.deepEqual(codex.ANSWERS["item/fileChange/requestApproval"](), { decision: "decline" });
    assert.deepEqual(codex.ANSWERS["item/permissions/requestApproval"](), { permissions: {}, scope: "turn" });
    assert.equal(codex.ANSWERS["mcpServer/elicitation/request"]().action, "decline");
    assert.ok("denied" in codex.ANSWERS.execCommandApproval().decision);
  });
});

describe("login status", () => {
  test("logged in: the plan, never the email", async () => {
    const { backend, sent } = fakeCodex({});
    const s = await backend.status();
    assert.deepEqual(s, { installed: true, loggedIn: true, plan: "ChatGPT plus", message: null });
    assert.ok(!JSON.stringify(s).includes("someone@"));
    assert.deepEqual(sent("initialize")[0].clientInfo.name, "motion_design_studio");
    assert.deepEqual(sent("account/read"), [{ refreshToken: false }]);
    assert.equal(sent("thread/start").length, 0, "status never starts a thread");
  });

  test("logged out, and not installed, are one sentence each", async () => {
    const { backend } = fakeCodex({ account: LOGGED_OUT });
    assert.deepEqual(await backend.status(), { installed: true, loggedIn: false, plan: null, message: codex.NOT_LOGGED_IN });
    assert.deepEqual(await backend.ready(), { ok: false, message: codex.NOT_LOGGED_IN });
    const missing = codex.createCodex({ command: join(tmp, "no-such-codex") });
    assert.deepEqual(await missing.status(), { installed: false, loggedIn: false, plan: null, message: codex.NOT_INSTALLED });
  });

  test("a chat message with Codex logged out is refused with connect: true", async () => {
    writeConnection({ backend: "codex", model: null });
    const { backend } = fakeCodex({ account: LOGGED_OUT });
    await assert.rejects(chatWith(backend).send("cx-out", "hi"), (err) => err.status === 409 && err.extra.connect === true);
  });
});

describe("a Codex turn", () => {
  test("streams text and tool steps, declines a command approval, and saves the thread for the film", async () => {
    writeConnection({ backend: "codex", model: null });
    const { backend, sent, log } = fakeCodex({
      threadId: "thr-a",
      turn: [
        delta("m1", "Checking ", true),
        delta("m1", "the price."),
        message("m1", "Checking the price."),
        toolCall("t1", "estimate", ESTIMATE),
        { request: "item/commandExecution/requestApproval", params: { ...ids, itemId: "cmd-1", command: "ls runs", cwd: "/" } },
        toolDone("t1", "estimate", ESTIMATE, "completed", { content: [{ type: "text", text: "$0.56" }], structuredContent: { estimateUsd: 0.56, allowed: true }, _meta: null }),
        message("m2", "About $0.56."),
        completed(),
      ],
    });
    const chat = chatWith(backend);
    await chat.send("cx-one", "What would 4s cost?");
    await chat.idle("cx-one");

    assert.deepEqual(lines("cx-one"), ["user: What would 4s cost?", "assistant: Checking the price.", "estimate seedance-2-5 4s 480p → $0.56", "assistant: About $0.56."]);
    assert.equal(readChat("cx-one").codexThread, "thr-a");
    const [start] = sent("thread/start");
    assert.equal(start.cwd, REPO_ROOT);
    assert.equal(start.sandbox, "read-only");
    assert.equal(start.approvalPolicy, "never");
    assert.match(start.developerInstructions, /working in the film "cx-one"/);
    assert.match(start.developerInstructions, /MCP instructions\./);
    assert.deepEqual(sent("turn/start")[0].input, [{ type: "text", text: "What would 4s cost?", text_elements: [] }]);
    const answer = log().find((l) => l.in?.id === 1000 && !l.in.method);
    assert.deepEqual(answer.in.result, { decision: "decline" }, "the approval request was declined");
  });

  test("the next message resumes the film's thread", async () => {
    const { backend, sent } = fakeCodex({ turn: [message("m3", "Sure."), completed()] });
    const chat = chatWith(backend);
    await chat.send("cx-one", "And 8s?");
    await chat.idle("cx-one");
    assert.equal(sent("thread/resume")[0].threadId, "thr-a");
    assert.equal(sent("thread/start").length, 0);
    assert.equal(sent("turn/start")[0].input[0].text, "And 8s?");
    assert.equal(lines("cx-one").at(-1), "assistant: Sure.");
  });

  test("a thread Codex no longer has starts again, with the film's chat so far as a recap", async () => {
    const { backend, sent } = fakeCodex({ resume: "missing", threadId: "thr-b", turn: [message("m4", "Yes."), completed()] });
    const chat = chatWith(backend);
    await chat.send("cx-one", "Still there?");
    await chat.idle("cx-one");
    assert.equal(sent("thread/start").length, 1);
    assert.equal(readChat("cx-one").codexThread, "thr-b");
    const text = sent("turn/start")[0].input[0].text;
    assert.match(text, /^Earlier in this film's chat:\nUser: What would 4s cost\?\nYou: Checking the price\./);
    assert.match(text, /\n\nNow:\nStill there\?$/);
  });

  test("a limit refusal interrupts the turn and the assistant says so; nothing is asked", async () => {
    const args = { run: "cx-cap", prompt: "A paper fox.", model: "seedance-2-5", duration_s: 4, resolution: "480p" };
    const { backend, sent } = fakeCodex({
      turn: [
        toolCall("t2", "generate_video", args),
        toolDone("t2", "generate_video", args, "completed", { content: [{ type: "text", text: REFUSAL }], structuredContent: null, _meta: null }),
        { waitFor: "turn/interrupt" },
        completed("interrupted"),
      ],
    });
    const chat = chatWith(backend);
    await chat.send("cx-cap", "Make it.");
    await chat.idle("cx-cap");
    assert.deepEqual(sent("turn/interrupt"), [{ threadId: "thr-new", turnId: "turn-1" }]);
    const entries = readChat("cx-cap").entries;
    assert.equal(entries[1].result, "stopped by the limits, nothing spent");
    assert.equal(entries[2].text, budgetSentence(REFUSAL.slice("Error 2: ".length).split("\nNext:")[0]));
  });

  test("another MCP server live in the thread stops the turn before it starts", async () => {
    const { backend, sent } = fakeCodex({ mcpServers: [OURS, { name: "context7", runtimeStatus: "connected" }] });
    const chat = chatWith(backend);
    await chat.send("cx-guard", "hi");
    await chat.idle("cx-guard");
    assert.equal(sent("turn/start").length, 0);
    assert.match(lines("cx-guard")[1], /^notice: Codex has other MCP servers on for this chat \(context7\)/);
  });

  test("a failed tool check stops the turn too", async () => {
    const { backend, sent } = fakeCodex({ mcpStatus: "error" });
    const chat = chatWith(backend);
    await chat.send("cx-guard-err", "hi");
    await chat.idle("cx-guard-err");
    assert.equal(sent("turn/start").length, 0);
    assert.match(lines("cx-guard-err")[1], /^notice: Codex did not say which tools are on/);
  });

  test("Stop interrupts Codex and ends the turn with a notice", async () => {
    const { backend, sent } = fakeCodex({ turn: [delta("m5", "Thinking"), { waitFor: "turn/interrupt" }, completed("interrupted")] });
    const chat = chatWith(backend);
    await chat.send("cx-stop", "Long one.");
    while (!sent("turn/start").length) await new Promise((r) => setTimeout(r, 20));
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(chat.stop("cx-stop"), true);
    await chat.idle("cx-stop");
    assert.equal(sent("turn/interrupt").length, 1);
    assert.deepEqual(lines("cx-stop"), ["user: Long one.", "assistant: Thinking", "notice: Stopped."]);
  });
});
