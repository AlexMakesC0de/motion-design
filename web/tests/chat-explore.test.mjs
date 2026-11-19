// Explore's chat and the API-key backends added with it: Explore's tools
// cannot spend or change anything, propose_take reaches the page as a
// proposal, Anthropic and OpenAI-compatible services run the tool loop, and
// keys are saved but never read back out. Every service is a fake fetch.
import { KEY, RUNS, tmp, req, generateStubs } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { createApp } = await import("../server/app.mjs");
const { createTools } = await import("../server/chat/tools.mjs");
const { barLine } = await import("../server/api/chat.mjs");
const { codexArgs } = await import("../server/chat/codex.mjs");
const { explorePrompt } = await import("../server/chat/prompt.mjs");
const anthropic = await import("../server/chat/anthropic.mjs");
const compatible = await import("../server/chat/compatible.mjs");
const { createTurnLog } = await import("../server/chat/transcript.mjs");
const { fakeOpenAI, textReply, callReply } = await import("./fixtures/openai.mjs");
const { SPENDING_TOOLS } = await import("../../mcp/server.mjs");
const { EXPLORE_TOOLS } = await import("../../mcp/explore.mjs");

const OPENAI_KEY = "sk-test-0123456789abcdefghijklmnop";
const ANTHROPIC_KEY = "sk-ant-test-0123456789abcdefghijkl";
const stubs = generateStubs({ estimateUsd: 0.56 });
let fake = fakeOpenAI();
const seen = [];

let app, port;
before(async () => {
  app = createApp({ key: KEY, deps: stubs.deps, distDir: join(tmp, "nodist"), pollMs: 200, chat: { fetch: (...a) => fake.fetch(...a) } });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());

async function call(path, { method = "GET", body } = {}) {
  const r = await req(port, path, { method, body });
  seen.push(r.text);
  return r;
}

const until = async (check, ms = 5_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await check();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("timed out waiting");
};

const sse = (events) => events.map((e) => `event: ${e.type ?? "message"}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const stream = (events) => new Response(sse(events), { status: 200, headers: { "content-type": "text/event-stream" } });

describe("Explore's tools", () => {
  test("are only the free ones that read, plus propose_take: nothing that spends, saves or deletes", async () => {
    const tools = createTools({ catalog: undefined, mode: "explore" });
    try {
      const names = (await tools.functions()).map((f) => f.name).sort();
      assert.deepEqual(names, [...EXPLORE_TOOLS].sort());
      for (const name of SPENDING_TOOLS) assert.ok(!names.includes(name), `${name} must not be in Explore`);
      for (const name of ["remove_asset", "save_asset", "delete_scene", "save_plan"]) assert.ok(!names.includes(name));
      const refused = await tools.call("generate_video", { run: "explore", prompt: "x", model: "seedance-2-5" });
      assert.equal(refused.isError, true);
    } finally {
      await tools.close();
    }
  });

  test("propose_take checks the plan, prices it per take and in all, and spends nothing", async () => {
    const tools = createTools({ deps: stubs.deps, mode: "explore" });
    try {
      const before = stubs.calls.create.length;
      const r = await tools.call("propose_take", {
        kind: "video",
        prompt: "A rainy neon alley at night, slow push-in.",
        model: "seedance-2-5",
        duration_s: 5,
        aspect_ratio: "16:9",
        picks: { light: "neon" },
        refs: [{ source: "nobody-here", role: "identity" }],
        sound: false,
        count: 2,
      });
      assert.equal(r.isError, undefined);
      const sc = r.structuredContent;
      assert.equal(sc.proposal.model, "seedance-2-5");
      assert.equal(sc.proposal.sound, false);
      assert.equal(sc.proposal.count, 2);
      assert.deepEqual(sc.proposal.refs, [], "a missing Library item is left out");
      assert.match(sc.problems.join(" "), /No Library item "nobody-here"/);
      assert.equal(sc.allowed, false);
      assert.ok(sc.estimateUsd > 0);
      assert.equal(sc.totalUsd, Math.round(sc.estimateUsd * 2 * 100) / 100);
      assert.equal(stubs.calls.create.length, before);
      const bad = await tools.call("propose_take", { kind: "video", prompt: "x", model: "seedance-2-5", picks: { light: "disco-ball" } });
      assert.equal(bad.isError, true);
    } finally {
      await tools.close();
    }
  });
});

describe("Explore's system prompt and context", () => {
  test("says the chat cannot generate and the user presses Generate", () => {
    const p = explorePrompt({ mcpInstructions: "Shard in Explore mode." });
    assert.match(p, /You cannot generate and nothing you call spends money/);
    assert.match(p, /propose_take/);
    assert.ok(!/go ahead without asking/.test(p));
  });

  test("the bar reaches the model as one short line, with anything odd left out", () => {
    const line = barLine({
      kind: "video",
      model: "seedance-2-5",
      aspectRatio: "16:9",
      durationS: 5,
      look: "neo-noir",
      picks: { light: "neon", "<script>": "x" },
      refs: [{ source: "mara", role: "identity" }, { source: 5 }],
      sound: true,
      count: 2,
      apiKey: "sk-should-not-appear",
    });
    assert.equal(line, "(The prompt bar now: video · model seedance-2-5 · 16:9 · 5s · look neo-noir · picks light neon, script x · references mara as identity · sound on · 2 takes.)");
    assert.equal(barLine(null), null);
  });

  test("Explore's Codex starts our MCP server in explore mode; a film's does not", () => {
    const env = (args) => args.find((a) => a.includes(".env={"));
    assert.match(env(codexArgs({ mode: "explore" })), /KIE_MCP_MODE="explore"/);
    assert.doesNotMatch(env(codexArgs({})), /KIE_MCP_MODE/);
  });
});

describe("Explore's chat over the API", () => {
  test("a turn that proposes a take fills a tool step's proposal; the user's words are saved without the bar line", async () => {
    await call("/api/chat-settings/openai-key", { method: "PUT", body: { key: OPENAI_KEY } });
    await call("/api/chat-settings", { method: "PUT", body: { backend: "openai", model: "gpt-test-1" } });
    fake = fakeOpenAI({
      replies: [
        callReply("propose_take", { kind: "image", prompt: "A red fox in snow, golden light.", model: "nano-banana-2", aspect_ratio: "1:1" }),
        textReply("I picked Nano Banana 2 for a crisp still."),
      ],
    });
    const r = await call("/api/explore/chats/c-fox1", { method: "POST", body: { text: "a fox in the snow", bar: { kind: "image", count: 1 } } });
    assert.equal(r.status, 200, r.text);
    const view = await until(async () => {
      const v = (await call("/api/explore/chats/c-fox1")).json;
      return !v.busy && v.entries.some((e) => e.kind === "assistant") ? v : null;
    });
    const step = view.entries.find((e) => e.kind === "tool");
    assert.equal(step.name, "propose_take");
    assert.equal(step.state, "done", step.result);
    assert.equal(step.proposal.model, "nano-banana-2");
    assert.equal(step.proposal.kind, "image");
    assert.ok(step.proposal.estimateUsd > 0);
    assert.equal(view.entries[0].text, "a fox in the snow");
    const sent = fake.requests[0].body.input.at(-1).content;
    assert.match(sent, /^a fox in the snow\n\n\(The prompt bar now: image/);
    assert.match(fake.requests[0].body.instructions, /You cannot generate/);
    const toolNames = fake.requests[0].body.tools.map((t) => t.name);
    assert.ok(!toolNames.includes("generate_image"));
    const saved = readFileSync(join(RUNS, "explore", "chats", "c-fox1.jsonl"), "utf8");
    assert.ok(!saved.includes("prompt bar now"));
  });

  test("each conversation is its own file; the list shows open ones, newest first, titled by the first message", async () => {
    fake = fakeOpenAI({ replies: [textReply("Sure.")] });
    assert.equal((await call("/api/explore/chats/c-owl2", { method: "POST", body: { text: "an owl at midnight" } })).status, 200);
    await until(async () => ((await call("/api/explore/chats/c-owl2")).json.busy ? null : true));
    const list = (await call("/api/explore/chats")).json;
    assert.deepEqual(
      list.map((c) => [c.id, c.title, c.messages, c.archived]),
      [
        ["c-owl2", "an owl at midnight", 1, false],
        ["c-fox1", "a fox in the snow", 1, false],
      ],
    );
    assert.equal((await call("/api/explore/chats/c-fox1")).json.entries[0].text, "a fox in the snow", "the other conversation is untouched");
    assert.deepEqual((await call("/api/explore/chats/c-new9")).json.entries, [], "a conversation nothing was said in is empty");
    assert.equal((await call("/api/explore/chats/../x")).status, 404);
    assert.equal((await call("/api/explore/chats/BAD")).status, 404);
  });

  test("archiving hides a conversation from the page and lists it for Settings; restoring brings it back", async () => {
    const a = await call("/api/explore/chats/c-owl2/archived", { method: "PUT", body: { archived: true } });
    assert.deepEqual(a.json, { id: "c-owl2", archived: true });
    assert.deepEqual((await call("/api/explore/chats")).json.map((c) => c.id), ["c-fox1"]);
    assert.deepEqual((await call("/api/explore/chats?archived=1")).json.map((c) => [c.id, c.archived]), [["c-owl2", true]]);
    assert.ok(existsSync(join(RUNS, "explore", "chats", "c-owl2.jsonl")), "kept on disk");
    assert.equal((await call("/api/explore/chats/c-owl2/archived", { method: "PUT", body: { archived: "yes" } })).status, 400);
    assert.equal((await call("/api/explore/chats/c-none/archived", { method: "PUT", body: { archived: true } })).status, 404);
    await call("/api/explore/chats/c-owl2/archived", { method: "PUT", body: { archived: false } });
    assert.deepEqual((await call("/api/explore/chats")).json.map((c) => c.id), ["c-owl2", "c-fox1"]);
  });

  test("deleting removes the conversation's file for good, archived or not", async () => {
    await call("/api/explore/chats/c-owl2/archived", { method: "PUT", body: { archived: true } });
    assert.deepEqual((await call("/api/explore/chats/c-owl2", { method: "DELETE" })).json, { id: "c-owl2", deleted: true });
    assert.ok(!existsSync(join(RUNS, "explore", "chats", "c-owl2.jsonl")));
    assert.deepEqual((await call("/api/explore/chats?archived=1")).json, []);
    assert.equal((await call("/api/explore/chats/c-owl2", { method: "DELETE" })).status, 404);
  });

  test("the old single Explore chat moves in as a conversation, once", async () => {
    const old = join(RUNS, "explore", "chat.jsonl");
    writeFileSync(old, `${JSON.stringify({ id: "u1", kind: "user", at: "2026-01-01T00:00:00.000Z", text: "a paper boat" })}\n`);
    const list = (await call("/api/explore/chats")).json;
    const moved = list.find((c) => c.title === "a paper boat");
    assert.ok(moved, JSON.stringify(list));
    assert.ok(!existsSync(old));
    assert.equal((await call("/api/explore/chats")).json.filter((c) => c.title === "a paper boat").length, 1);
    await call(`/api/explore/chats/${moved.id}`, { method: "DELETE" });
  });

  test("Explore's run is hidden from the films list", async () => {
    const films = (await call("/api/films")).json;
    assert.ok(!films.some((f) => f.run === "explore"));
  });
});

describe("Anthropic", () => {
  test("a pasted key is saved mode 600 beside chat.json and only its presence comes back", async () => {
    const r = await call("/api/chat-settings/keys/anthropic", { method: "PUT", body: { key: ANTHROPIC_KEY } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.keys.anthropic.keySaved, true);
    assert.equal(statSync(join(tmp, "chat-anthropic.key")).mode & 0o777, 0o600);
    assert.equal((await call("/api/chat-settings/keys/nobody", { method: "PUT", body: { key: ANTHROPIC_KEY } })).status, 404);
  });

  test("the model list comes from /v1/models with the key in x-api-key", async () => {
    const heard = [];
    fake = {
      fetch: async (url, init = {}) => {
        heard.push({ url: String(url), key: init.headers?.["x-api-key"] === ANTHROPIC_KEY, version: init.headers?.["anthropic-version"] });
        return new Response(JSON.stringify({ data: [{ id: "claude-old", created_at: "2025-01-01" }, { id: "claude-new", created_at: "2026-10-01" }] }));
      },
    };
    const r = await call("/api/chat-settings/models?backend=anthropic");
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.models, ["claude-new", "claude-old"]);
    assert.deepEqual(heard[0], { url: "https://api.anthropic.com/v1/models?limit=100", key: true, version: "2023-06-01" });
  });

  test("the tool loop: tool_use runs the MCP tool, the result goes back as tool_result, thinking blocks go back unchanged", async () => {
    const bodies = [];
    const replies = [
      [
        { type: "message_start", message: { id: "m1", content: [] } },
        { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Price it." } },
        { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-1" } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tu_1", name: "list_looks", input: {} } },
        { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "" } },
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: "tool_use" } },
        { type: "message_stop" },
      ],
      [
        { type: "message_start", message: { id: "m2", content: [] } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Neo-noir " } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "fits." } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
        { type: "message_stop" },
      ],
    ];
    const fetch = async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return stream(replies.shift());
    };
    const tools = createTools({ mode: "explore" });
    const log = createTurnLog(() => {}, { throttleMs: 0 });
    try {
      const out = await anthropic.runTurn({ key: ANTHROPIC_KEY, model: "claude-test", instructions: "be brief", history: [{ role: "assistant", content: "hi" }], text: "a noir alley", tools, sink: log, fetch });
      assert.deepEqual(out, {});
    } finally {
      await tools.close();
    }
    assert.equal(bodies[0].system, "be brief");
    assert.equal(bodies[0].messages[0].role, "user", "history starts with the user");
    assert.ok(bodies[0].tools.every((t) => t.input_schema && !t.parameters));
    const [assistant, results] = bodies[1].messages.slice(-2);
    assert.deepEqual(assistant.content[0], { type: "thinking", thinking: "Price it.", signature: "sig-1" });
    assert.deepEqual(assistant.content[1], { type: "tool_use", id: "tu_1", name: "list_looks", input: {} });
    assert.equal(results.role, "user");
    assert.equal(results.content[0].type, "tool_result");
    assert.equal(results.content[0].tool_use_id, "tu_1");
    assert.deepEqual(
      log.entries.map((e) => [e.kind, e.kind === "tool" ? e.state : e.text]),
      [
        ["tool", "done"],
        ["assistant", "Neo-noir fits."],
      ],
    );
  });

  test("a refusal ends the turn with a sentence", async () => {
    const fetch = async () =>
      stream([
        { type: "message_start", message: { id: "m", content: [] } },
        { type: "message_delta", delta: { stop_reason: "refusal" } },
        { type: "message_stop" },
      ]);
    await assert.rejects(anthropic.runTurn({ key: "k", model: "m", instructions: "", history: [], text: "x", tools: { functions: async () => [] }, sink: createTurnLog(() => {}), fetch }), /declined/);
  });
});

describe("OpenRouter and other OpenAI-compatible services", () => {
  test("only an https address, or http on this computer, is accepted", async () => {
    const bad = await call("/api/chat-settings/models?backend=compatible&baseUrl=http://example.com/v1");
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.field, "baseUrl");
  });

  test("a model on this computer needs no key; the list comes from its /models", async () => {
    const heard = [];
    fake = {
      fetch: async (url, init = {}) => {
        heard.push({ url: String(url), auth: Boolean(init.headers?.authorization) });
        return new Response(JSON.stringify({ data: [{ id: "qwen3:8b" }, { id: "llama3.2" }] }));
      },
    };
    const r = await call("/api/chat-settings/models?backend=compatible&baseUrl=http://localhost:11434/v1");
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.models, ["llama3.2", "qwen3:8b"]);
    assert.deepEqual(heard[0], { url: "http://localhost:11434/v1/models", auth: false });
    const set = await call("/api/chat-settings", { method: "PUT", body: { backend: "compatible", model: "qwen3:8b", baseUrl: "http://localhost:11434/v1" } });
    assert.equal(set.status, 200, set.text);
    assert.equal(set.json.baseUrl, "http://localhost:11434/v1");
    assert.equal(set.json.model, "qwen3:8b");
  });

  test("OpenRouter lists only models that can call tools", async () => {
    await call("/api/chat-settings/keys/openrouter", { method: "PUT", body: { key: "sk-or-test-0123456789abcdefghij" } });
    fake = {
      fetch: async () =>
        new Response(JSON.stringify({ data: [{ id: "a/tools", supported_parameters: ["tools"] }, { id: "b/no-tools", supported_parameters: ["temperature"] }] })),
    };
    const r = await call("/api/chat-settings/models?backend=openrouter");
    assert.deepEqual(r.json.models, ["a/tools"]);
  });

  test("the tool loop: streamed tool-call pieces are joined, run, and answered with a tool message", async () => {
    const bodies = [];
    const replies = [
      [
        { choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "list_", arguments: "" } }] } }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "looks", arguments: "{}" } }] } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ],
      [{ choices: [{ index: 0, delta: { content: "Done." } }] }, { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }],
    ];
    const fetch = async (url, init) => {
      bodies.push({ url, body: JSON.parse(init.body) });
      return stream(replies.shift());
    };
    const tools = createTools({ mode: "explore" });
    const log = createTurnLog(() => {}, { throttleMs: 0 });
    try {
      await compatible.runTurn({ base: "https://openrouter.ai/api/v1", key: "k", model: "a/tools", instructions: "sys", history: [], text: "hi", tools, sink: log, fetch });
    } finally {
      await tools.close();
    }
    assert.equal(bodies[0].url, "https://openrouter.ai/api/v1/chat/completions");
    assert.deepEqual(bodies[0].body.messages[0], { role: "system", content: "sys" });
    const msgs = bodies[1].body.messages;
    assert.equal(msgs.at(-2).tool_calls[0].function.name, "list_looks");
    assert.equal(msgs.at(-1).role, "tool");
    assert.equal(msgs.at(-1).tool_call_id, "c1");
    assert.equal(log.entries.find((e) => e.kind === "tool").name, "list_looks");
  });
});

test("no response ever carried a key", () => {
  for (const text of seen) {
    for (const k of [OPENAI_KEY, ANTHROPIC_KEY, "sk-or-test-0123456789abcdefghij"]) assert.ok(!text.includes(k));
  }
});
