import { RUNS, LIBRARY, tmp } from "./helpers.mjs";
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const codex = await import("../server/chat/codex.mjs");
const { createChat } = await import("../server/chat/session.mjs");
const { writeConnection } = await import("../server/chat/config.mjs");
const { ChatError, readChat, budgetSentence, createTurnLog, MAX_STEPS } = await import("../server/chat/transcript.mjs");
const { REPO_ROOT } = await import("../../cli/lib/run.mjs");

const FAKE = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));
// `codex features list` from a real codex-cli 0.154.0, run with the studio's --disable and -c flags.
const FEATURES = readFileSync(new URL("./fixtures/codex-features-0.154.txt", import.meta.url), "utf8");
const featureOn = (name) => FEATURES.replace(new RegExp(`^${name} .*$`, "m"), `${name.padEnd(41)}stable             true`);
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
function fakeCodex(exchange, options = {}) {
  const name = `codex-${++n}`;
  const exFile = join(tmp, `${name}.json`);
  const logFile = join(tmp, `${name}.log`);
  writeFileSync(exFile, JSON.stringify({ initialize: INITIALIZE, account: LOGGED_IN, mcpServers: [OURS], ...exchange }));
  const backend = codex.createCodex({ command: process.execPath, prefixArgs: [FAKE, exFile, logFile], args: () => ["app-server"], ...options });
  open.push(backend);
  const log = () =>
    (existsSync(logFile) ? readFileSync(logFile, "utf8") : "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  const sent = (method) => log().filter((l) => l.in?.method === method).map((l) => l.in.params);
  return { backend, log, sent };
}
after(() => open.forEach((b) => b.close()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

  test("the features that would let Codex read local images or run code are off too", () => {
    // Both names checked against `codex features list` in codex-cli 0.154.0, which refuses unknown --disable names.
    assert.ok(codex.DISABLED_FEATURES.includes("view_image"));
    assert.ok(codex.DISABLED_FEATURES.includes("code_mode_host"));
  });

  test("goals, hooks, notify and every feature the review named as able to act outside the MCP tools are off at spawn", () => {
    const args = codex.codexArgs({ repo: "/repo", node: "/bin/node", configText: "" });
    const flags = args.join(" ");
    const named = ["goals", "hooks", "skill_search", "in_app_chat", "in_app_local_automation", "workspace_dependencies", "remote_plugin", "plugin_sharing", "sleep_tool", "guardian_approval", "tool_call_mcp_elicitation", "auth_elicitation", "multi_agent_v2"];
    for (const f of named) assert.ok(flags.includes(`--disable ${f} `), f);
    const c = args.filter((_, i) => args[i - 1] === "-c");
    assert.ok(c.includes("notify=[]"), "the user's notify program does not run on studio turns");
  });

  test("the feature list is read line by line, and only allow-listed features may be on", () => {
    const parsed = codex.parseFeatures(FEATURES);
    assert.equal(parsed.length, 140);
    assert.deepEqual(parsed.find((f) => f.name === "apply_patch_preserve_line_endings"), { name: "apply_patch_preserve_line_endings", stage: "under development", enabled: false });
    assert.deepEqual(codex.checkFeatures(FEATURES), parsed.filter((f) => f.enabled).map((f) => f.name), "the real list with the studio's flags passes");
    for (const f of parsed.filter((x) => x.enabled)) assert.ok(f.name in codex.ALLOWED_FEATURES, f.name);
    for (const f of codex.DISABLED_FEATURES) if (f !== "unified_exec") assert.ok(!(f in codex.ALLOWED_FEATURES), f);
    for (const name of ["goals", "hooks", "multi_agent_v2"]) {
      assert.throws(() => codex.checkFeatures(featureOn(name)), (e) => e instanceof ChatError && e.message.includes(name), name);
    }
    assert.throws(() => codex.checkFeatures("Error: unexpected argument\n"), (e) => e instanceof ChatError && /did not list its features/.test(e.message));
  });

  test("Codex must be the protocol's major.minor (or one allow-listed), with a message saying how to update", () => {
    assert.equal(codex.PROTOCOL_VERSION, "0.154");
    assert.equal(codex.checkVersion("motion_design_studio/0.154.0"), "0.154.0");
    assert.equal(codex.checkVersion("motion_design_studio/0.154.7 (Mac OS 26.0.0; arm64) xterm-256color"), "0.154.7");
    for (const v of ["0.155.0", "0.153.2", "1.154.0"]) {
      assert.throws(
        () => codex.checkVersion(`motion_design_studio/${v} (Mac OS 26.0.0; arm64)`),
        (e) => e instanceof ChatError && e.message.includes(`Codex ${v}`) && e.message.includes("npm install -g @openai/codex@0.154") && e.message.includes("npm --prefix web run codex-protocol"),
        v,
      );
    }
    assert.throws(() => codex.checkVersion(undefined), (e) => e instanceof ChatError && /did not say which version/.test(e.message));
  });

  test("the config.toml parser finds servers in every TOML layout, ours left out", () => {
    const found = (lines) => codex.configuredMcpServers(lines.join("\n"));
    assert.deepEqual(found(["[mcp_servers.'literal']", 'command = "npx"']), ["literal"], "a single-quoted literal key");
    assert.deepEqual(
      found(["[mcp_servers]", 'dotted.command = "npx"', "'lit-dot'.url = \"https://x\"", '"basic dot".command = "y"', 'motion-design.command = "node"']),
      ["dotted", "lit-dot", "basic dot"],
      "[mcp_servers] then dotted keys",
    );
    assert.deepEqual(
      found(["[mcp_servers]", 'inline = { command = "npx", args = ["-y", "a = b"] }', "'lit' = { url = \"https://x\" }", 'motion-design = { command = "node" }']),
      ["inline", "lit"],
      "[mcp_servers] then inline tables",
    );
    assert.deepEqual(
      found(['model = "gpt-5"', 'mcp_servers.toplevel.command = "npx"', 'mcp_servers . "spaced q" . url = "https://x"', "[other]", 'mcp_servers.not_ours.command = "x"']),
      ["toplevel", "spaced q"],
      "dotted keys outside any table header; inside [other] they belong to other",
    );
    assert.deepEqual(
      found(['mcp_servers = { a = { command = "x" }, "b c" = { url = "https://y" }, \'d\' = { command = "z" } }']),
      ["a", "b c", "d"],
      "one inline table of servers",
    );
    assert.deepEqual(found(['[mcp_servers."quoted".env]', 'X = "1"', "[profiles.mcp_servers.nope]", "x = 1"]), ["quoted"], "a sub-table; mcp_servers under another table is not ours");
    assert.deepEqual(
      found(['notes = """', "[mcp_servers.in_string]", "mcp_servers.also_string.x = 1", '"""', "[mcp_servers.after_string]", "command = 'x' # [mcp_servers.comment]"]),
      ["after_string"],
      "nothing inside a multi-line string or a comment",
    );
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
    assert.deepEqual(s, { installed: true, loggedIn: true, plan: "ChatGPT Plus", message: null });
    assert.ok(!JSON.stringify(s).includes("someone@"));
    assert.deepEqual(sent("initialize")[0].clientInfo.name, "motion_design_studio");
    assert.deepEqual(sent("account/read"), [{ refreshToken: false }]);
    assert.equal(sent("thread/start").length, 0, "status never starts a thread");
  });

  test("Codex starts without OPENAI_API_KEY in its environment; the provider key variables stay for the MCP server", async () => {
    process.env.OPENAI_API_KEY = "placeholder-not-a-key";
    try {
      const { backend, log } = fakeCodex({});
      await backend.status();
      const { envNames } = log()[0];
      assert.ok(!envNames.includes("OPENAI_API_KEY"));
      assert.ok(envNames.includes("KIE_API_KEY"));
      assert.equal(process.env.OPENAI_API_KEY, "placeholder-not-a-key", "the studio's own environment is untouched");
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  test("the plan reads as ChatGPT writes it", () => {
    assert.equal(codex.planName("plus"), "Plus");
    assert.equal(codex.planName("pro"), "Pro");
    assert.equal(codex.planName("team"), "Team");
    assert.equal(codex.planName("prolite"), "Pro Lite");
    assert.equal(codex.planName("edu_plus"), "Edu Plus");
    assert.equal(codex.planName("self_serve_business_usage_based"), "Business");
    assert.equal(codex.planName("enterprise_cbp_automation"), "Enterprise");
    assert.equal(codex.planName("some_new_plan"), "Some New Plan");
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

  test("before the first turn, codex features list runs with the app-server's own flags; a feature off the allowlist stops the turn, naming it", async () => {
    const { backend, sent, log } = fakeCodex({ features: featureOn("goals"), turn: [message("m", "Never."), completed()] }, { args: () => ["app-server", "--disable", "hooks", "-c", "notify=[]"] });
    const chat = chatWith(backend);
    await chat.send("cx-feat", "hi");
    await chat.idle("cx-feat");
    assert.deepEqual(log().find((l) => l.features).features, ["features", "list", "--disable", "hooks", "-c", "notify=[]"]);
    assert.equal(sent("thread/start").length, 0);
    assert.equal(sent("turn/start").length, 0);
    assert.match(lines("cx-feat")[1], /^notice: .*\bgoals\b/);
  });

  test("the feature check runs once per Codex process, and a list that fails stops the turn", async () => {
    const good = fakeCodex({ turn: [message("m", "Fine."), completed()] });
    const chat = chatWith(good.backend);
    await chat.send("cx-feat-once", "one");
    await chat.idle("cx-feat-once");
    await chat.send("cx-feat-once", "two");
    await chat.idle("cx-feat-once");
    assert.equal(good.log().filter((l) => l.features).length, 1);
    assert.equal(lines("cx-feat-once").at(-1), "assistant: Fine.");

    const { backend, sent } = fakeCodex({ features: "Error: something\n", featuresExit: 2 });
    const chat2 = chatWith(backend);
    await chat2.send("cx-feat-fail", "hi");
    await chat2.idle("cx-feat-fail");
    assert.equal(sent("turn/start").length, 0);
    assert.match(lines("cx-feat-fail")[1], /^notice: Codex did not list its features/);
  });

  test("a Codex of another version is refused before the turn starts, saying how to update", async () => {
    const { backend, sent } = fakeCodex({ initialize: { ...INITIALIZE, userAgent: "motion_design_studio/0.160.0 (Mac OS 26.0.0; arm64)" } });
    const chat = chatWith(backend);
    await chat.send("cx-version", "hi");
    await chat.idle("cx-version");
    assert.equal(sent("thread/start").length, 0);
    assert.match(lines("cx-version")[1], /^notice: Codex 0\.160\.0 .*npm install -g @openai\/codex@0\.154/);
  });

  test("an uncertain result (code 5) interrupts the turn and the assistant says what is uncertain", async () => {
    const args = { run: "cx-unsure", prompt: "A paper fox.", model: "seedance-2-5" };
    const text = "Error 5: socket hang up\nj-20261031-0a0b0c is uncertain.\nNext: do not resubmit";
    const { backend, sent } = fakeCodex({
      turn: [
        toolCall("t5", "generate_video", args),
        toolDone("t5", "generate_video", args, "completed", { content: [{ type: "text", text }], structuredContent: null, _meta: null }),
        { waitFor: "turn/interrupt" },
        completed("interrupted"),
      ],
    });
    const chat = chatWith(backend);
    await chat.send("cx-unsure", "Make it.");
    await chat.idle("cx-unsure");
    assert.equal(sent("turn/interrupt").length, 1);
    const entries = readChat("cx-unsure").entries;
    assert.deepEqual(entries[1].jobs, ["j-20261031-0a0b0c"]);
    assert.equal(entries[2].kind, "assistant");
    assert.match(entries[2].text, /^I can't tell whether generate_video went through \(socket hang up\).*Check the feed/);
  });

  test("a new thread's recap keeps the tool steps, so a job started earlier is not forgotten", () => {
    const entries = [{ id: "u", kind: "user", text: "Make it." }, { id: "t", kind: "tool", name: "generate_video", args: "seedance-2-5", state: "failed", result: "uncertain: still checking, do not resubmit", jobs: ["j-20261031-0a0b0c"] }];
    assert.match(codex.recap(entries), /You: \[tool step\] generate_video seedance-2-5 → failed: .*\(job j-20261031-0a0b0c\)/);
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

  test(`a turn stops after ${MAX_STEPS} tool calls without a final answer, with a notice`, { timeout: 10_000 }, async () => {
    const result = { content: [{ type: "text", text: "no runs" }], structuredContent: null, _meta: null };
    const steps = [];
    for (let i = 0; i < MAX_STEPS; i++) steps.push(toolCall(`r${i}`, "list_runs", {}), toolDone(`r${i}`, "list_runs", {}, "completed", result));
    const { backend, sent } = fakeCodex({ turn: [...steps, { waitFor: "turn/interrupt" }, completed("interrupted")] });
    const chat = chatWith(backend);
    await chat.send("cx-steps", "Loop forever.");
    await chat.idle("cx-steps");
    assert.equal(sent("turn/interrupt").length, 1);
    assert.match(lines("cx-steps").at(-1), new RegExp(`^notice: Stopped after ${MAX_STEPS} tool steps without a final answer`));
  });

  test("Stop with no turn/completed from Codex settles after the grace period and restarts Codex", { timeout: 10_000 }, async () => {
    const { backend, sent } = fakeCodex({ turn: [delta("m8", "Thinking"), { waitFor: "turn/interrupt" }] }, { interruptGraceMs: 200 });
    const chat = chatWith(backend);
    await chat.send("cx-hang", "Long one.");
    while (!sent("turn/start").length) await sleep(20);
    await sleep(50);
    chat.stop("cx-hang");
    await chat.idle("cx-hang");
    assert.deepEqual(chat.films(), []);
    assert.deepEqual(lines("cx-hang"), ["user: Long one.", "assistant: Thinking", "notice: Stopped."]);
    assert.equal((await backend.status()).loggedIn, true);
    assert.equal(sent("turn/start").length, 0, "a new app-server answered the check");
  });

  test("a request Codex never answers times out: the status check and a message both end", { timeout: 10_000 }, async () => {
    const stuck = fakeCodex({ noAnswer: ["account/read"] }, { requestTimeoutMs: 200 });
    const s = await stuck.backend.status();
    assert.equal(s.loggedIn, false);
    assert.match(s.message, /^Codex did not answer/);

    writeConnection({ backend: "codex", model: null });
    const { backend } = fakeCodex({ noAnswer: ["thread/start"] }, { requestTimeoutMs: 200 });
    const chat = chatWith(backend);
    await chat.send("cx-stuck", "hi");
    await chat.idle("cx-stuck");
    assert.match(lines("cx-stuck").at(-1), /^notice: Codex did not answer/);
  });

  test("a logged-out status check leaves another film's turn running, and stops Codex once it ends", { timeout: 10_000 }, async () => {
    const { backend, sent } = fakeCodex({ account: LOGGED_OUT, turn: [delta("m9", "Working"), { waitFor: "account/read" }, { sleep: 300 }, message("m9", "Working."), completed()] });
    const log = createTurnLog(() => {});
    const running = backend.turn({ film: "cx-shared", text: "hi", saved: { entries: [], codexThread: null }, instructions: "x", sink: log, signal: new AbortController().signal });
    while (!sent("turn/start").length) await sleep(20);
    assert.equal((await backend.status()).loggedIn, false);
    await running;
    assert.equal(log.entries.at(-1).text, "Working.");
    await backend.status();
    assert.equal(sent("turn/start").length, 0, "Codex was stopped after the turn, so the next check started a new one");
  });

  test("another turn's turn/completed does not end this turn", async () => {
    const other = { notify: "turn/completed", params: { threadId: "$thread", turn: { id: "turn-old", items: [], status: "completed", error: null } } };
    const { backend } = fakeCodex({ turn: [other, message("m10", "Mine."), completed()] });
    const chat = chatWith(backend);
    await chat.send("cx-match", "hi");
    await chat.idle("cx-match");
    assert.deepEqual(lines("cx-match"), ["user: hi", "assistant: Mine."]);
  });

  test("the tool check reads every page of servers", async () => {
    const { backend, sent } = fakeCodex({ mcpPages: [[OURS], [{ name: "context7", runtimeStatus: "connected" }]] });
    const chat = chatWith(backend);
    await chat.send("cx-pages", "hi");
    await chat.idle("cx-pages");
    assert.equal(sent("turn/start").length, 0);
    assert.deepEqual(sent("mcpServerStatus/list").map((p) => p.cursor ?? null), [null, "1"]);
    assert.match(lines("cx-pages")[1], /\(context7\)/);
  });

  test("only disabled, failed or cancelled servers are let through; anything else, even not started, is refused", async () => {
    const quiet = [OURS, { name: "a", runtimeStatus: "disabled" }, { name: "b", runtimeStatus: "failed" }, { name: "c", runtimeStatus: "cancelled" }];
    const ok = fakeCodex({ mcpServers: quiet, turn: [message("m11", "Fine."), completed()] });
    const chat = chatWith(ok.backend);
    await chat.send("cx-quiet", "hi");
    await chat.idle("cx-quiet");
    assert.equal(lines("cx-quiet").at(-1), "assistant: Fine.");

    const { backend, sent } = fakeCodex({ mcpServers: [OURS, { name: "d", runtimeStatus: "notStarted" }, { name: "e", runtimeStatus: null }, { name: "f", runtimeStatus: "authenticationRequired" }] });
    const chat2 = chatWith(backend);
    await chat2.send("cx-loud", "hi");
    await chat2.idle("cx-loud");
    assert.equal(sent("turn/start").length, 0);
    assert.match(lines("cx-loud")[1], /\(d, e, f\)/);
  });

  test("a tool call to another MCP server interrupts the turn at once, with a notice naming it", { timeout: 10_000 }, async () => {
    const foreign = {
      notify: "item/started",
      params: { ...ids, item: { type: "mcpToolCall", id: "x1", server: "context7", tool: "query-docs", status: "inProgress", arguments: {}, result: null, error: null } },
    };
    const { backend, sent } = fakeCodex({ turn: [foreign, { waitFor: "turn/interrupt" }, completed("interrupted")] });
    const chat = chatWith(backend);
    await chat.send("cx-foreign", "hi");
    await chat.idle("cx-foreign");
    assert.equal(sent("turn/interrupt").length, 1);
    assert.match(lines("cx-foreign").at(-1), /^notice: .*context7/);
  });
});
