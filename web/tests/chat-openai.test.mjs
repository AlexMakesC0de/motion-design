import { deps, generateStubs } from "./helpers.mjs";
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";

const { runTurn, listModels, sseEvents } = await import("../server/chat/openai.mjs");
const { createTools } = await import("../server/chat/tools.mjs");
const { createTurnLog } = await import("../server/chat/transcript.mjs");
const { fakeOpenAI, textReply, callReply } = await import("./fixtures/openai.mjs");

const KEY = "sk-test-0123456789abcdefghijklmnop";
const stubs = generateStubs({ estimateUsd: 0.56 });
const tools = createTools({ deps: stubs.deps });
after(() => tools.close());

function turn(fake, over = {}) {
  const seen = [];
  const log = createTurnLog((e) => seen.push(structuredClone(e)));
  const done = runTurn({ key: KEY, model: "gpt-test-1", instructions: "be brief", history: [], text: "Make a 4s fox clip.", tools, sink: log, fetch: fake.fetch, ...over });
  return { log, seen, done };
}

describe("sseEvents", () => {
  test("reads events split across chunks and CRLF line ends", async () => {
    const enc = new TextEncoder();
    const body = [enc.encode('event: a\r\ndata: {"type":"a",'), enc.encode('"n":1}\r\n\r\ndata: {"type":"b"}\n\n')];
    const out = [];
    for await (const e of sseEvents(body)) out.push(e);
    assert.deepEqual(out, [{ type: "a", n: 1 }, { type: "b" }]);
  });
});

describe("runTurn", () => {
  test("streams a plain answer into one assistant entry", async () => {
    const fake = fakeOpenAI({ replies: [textReply("Hello there.")] });
    const { log, seen, done } = turn(fake);
    assert.deepEqual(await done, {});
    assert.deepEqual(log.entries.map((e) => [e.kind, e.text, e.streaming]), [["assistant", "Hello there.", false]]);
    assert.ok(seen.some((e) => e.text === "Hello " && e.streaming), "the first delta reached the page on its own");
    const [req] = fake.requests;
    assert.equal(req.auth, true);
    assert.equal(req.body.model, "gpt-test-1");
    assert.equal(req.body.instructions, "be brief");
    assert.equal(req.body.stream, true);
    assert.equal(req.body.store, false);
    assert.deepEqual(req.body.input, [{ role: "user", content: "Make a 4s fox clip." }]);
    assert.equal(req.body.tools.length, 27);
  });

  test("runs the function loop: the model calls estimate, the MCP tool answers, the result goes back, then the model answers", async () => {
    const fake = fakeOpenAI({
      replies: [callReply("estimate", { model: "seedance-2-5", duration_s: 4, resolution: "480p" }), textReply("That is $0.56.")],
    });
    const { log, done } = turn(fake);
    assert.deepEqual(await done, {});
    assert.deepEqual(
      log.entries.map((e) => (e.kind === "tool" ? `${e.name} ${e.args} → ${e.result} (${e.state})` : `${e.kind}: ${e.text}`)),
      ["estimate seedance-2-5 4s 480p → $0.56 (done)", "assistant: That is $0.56."],
    );
    const second = fake.requests[1].body.input;
    assert.equal(second[1].type, "function_call");
    assert.equal(second[1].status, undefined, "output items go back without their status");
    assert.equal(second[2].type, "function_call_output");
    assert.equal(second[2].call_id, "call_1");
    assert.match(second[2].output, /"estimateUsd":0\.56/);
  });

  test("a job refused by the limits ends the turn: the model is not asked again", async () => {
    writeFileSync(process.env.KIE_LIMITS_FILE, JSON.stringify({ dailyUsd: 10, perJobUsd: 0.5 }));
    try {
      const fake = fakeOpenAI({
        replies: [callReply("generate_video", { run: "chat-cap", prompt: "A fox.", model: "seedance-2-5", duration_s: 4, resolution: "480p", provider: "kie" })],
      });
      const sent = stubs.calls.create.length;
      const { log, done } = turn(fake);
      const out = await done;
      assert.match(out.budget, /^Refused, nothing spent\. Estimated \$0\.56 is above the \$0\.50 per-job limit\./);
      assert.equal(fake.requests.length, 1);
      assert.equal(fake.left(), 0);
      assert.equal(stubs.calls.create.length, sent, "nothing was sent to a provider");
      assert.deepEqual(log.entries.map((e) => [e.name, e.state, e.result]), [["generate_video", "failed", "stopped by the limits, nothing spent"]]);
    } finally {
      rmSync(process.env.KIE_LIMITS_FILE, { force: true });
    }
  });

  test("arguments that are not JSON become a failed step the model reads, not a crash", async () => {
    const bad = callReply("estimate", {});
    for (const e of bad) if (e.item) e.item.arguments = "{oops";
    const fake = fakeOpenAI({ replies: [bad, textReply("Sorry.")] });
    const { log, done } = turn(fake);
    await done;
    assert.equal(log.entries[0].state, "failed");
    assert.equal(log.entries[0].result, "refused: the arguments were not valid JSON.");
  });

  test("a refused key is a connection error, and its message carries no key", async () => {
    const fake = fakeOpenAI({ replies: [{ status: 401, error: { message: `Incorrect API key provided: ${KEY}` } }] });
    await assert.rejects(turn(fake).done, (e) => e.connect === true && /refused the API key \(401\)/.test(e.message) && !e.message.includes(KEY));
  });

  test("a failed response and a stream error are one sentence each", async () => {
    const failed = [{ type: "response.failed", response: { error: { message: "server_error" } } }];
    await assert.rejects(turn(fakeOpenAI({ replies: [failed] })).done, { message: "OpenAI could not finish the reply: server_error" });
    const error = [{ type: "error", code: "x", message: "bad things", param: null }];
    await assert.rejects(turn(fakeOpenAI({ replies: [error] })).done, { message: "OpenAI error: bad things" });
  });

  test("Stop during a tool call ends the turn there: the next call is not run and the model is not asked again", async () => {
    const two = callReply("estimate", { model: "seedance-2-5", duration_s: 4 }, "call_a");
    const second = callReply("status", {}, "call_b").at(-2).item;
    const done = two.at(-1);
    done.response.output.push(second);
    const fake = fakeOpenAI({ replies: [two, textReply("Never.")] });
    const ctrl = new AbortController();
    const calls = [];
    const stopping = {
      functions: () => tools.functions(),
      async call(name, args, opts) {
        calls.push({ name, signal: opts?.signal });
        ctrl.abort(); // Stop pressed while the tool runs
        return { content: [{ type: "text", text: "$0.56" }], structuredContent: { estimateUsd: 0.56, allowed: true } };
      },
    };
    const { log, done: turnDone } = turn(fake, { tools: stopping, signal: ctrl.signal });
    await assert.rejects(turnDone, { message: "Stopped." });
    assert.deepEqual(calls.map((c) => c.name), ["estimate"], "the second call never ran");
    assert.equal(calls[0].signal, ctrl.signal, "the signal reaches the tool call");
    assert.equal(fake.requests.length, 1);
    assert.equal(log.entries[0].state, "done");
  });

  test("a tool call given a stopped signal throws instead of answering", async () => {
    await assert.rejects(tools.call("list_runs", {}, { signal: AbortSignal.abort() }));
  });

  test("Stop pressed before a tool call starts runs no tool", async () => {
    const fake = fakeOpenAI({ replies: [callReply("estimate", { model: "seedance-2-5" })] });
    const ctrl = new AbortController();
    const calls = [];
    const stopping = {
      functions: () => tools.functions(),
      call: async (name) => calls.push(name),
    };
    const realFetch = fake.fetch;
    const fetch = async (url, init) => {
      const res = await realFetch(url, init);
      ctrl.abort(); // Stop pressed while the reply streams in
      return res;
    };
    await assert.rejects(turn({ ...fake, fetch }, { tools: stopping, signal: ctrl.signal, fetch }).done, { message: "Stopped." });
    assert.deepEqual(calls, []);
  });

  test("earlier lines of the film go first, as messages", async () => {
    const fake = fakeOpenAI({ replies: [textReply("Yes.")] });
    await turn(fake, { history: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] }).done;
    assert.deepEqual(fake.requests[0].body.input.map((m) => m.content), ["hi", "hello", "Make a 4s fox clip."]);
  });
});

describe("listModels", () => {
  test("lists the key's text models, newest first, and drops audio, image, embedding and the like", async () => {
    const fake = fakeOpenAI({
      models: [
        { id: "gpt-old", created: 1 },
        { id: "gpt-new", created: 3 },
        { id: "o9-mini", created: 2 },
        { id: "gpt-new-audio-preview", created: 4 },
        { id: "text-embedding-3-large", created: 5 },
        { id: "gpt-image-2", created: 6 },
        { id: "whisper-1", created: 7 },
      ],
    });
    assert.deepEqual(await listModels({ key: KEY, fetch: fake.fetch }), ["gpt-new", "o9-mini", "gpt-old"]);
    assert.equal(fake.requests[0].auth, true);
  });
});

test("the shared deps stay in place: no real network call is possible here", () => {
  assert.throws(() => globalThis.fetch("https://api.openai.com/v1/models"), /network call attempted/);
  assert.equal(typeof deps.credits, "function");
});
