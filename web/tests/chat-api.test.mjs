import { KEY, RUNS, tmp, req, generateStubs } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";

const { createApp } = await import("../server/app.mjs");
const { fakeOpenAI, textReply, callReply } = await import("./fixtures/openai.mjs");

const OPENAI_KEY = "sk-test-0123456789abcdefghijklmnop";
const stubs = generateStubs({ estimateUsd: 0.56 });
let fake = fakeOpenAI();
const seen = []; // every response body, to check no key ever leaves the server

let app, port;
before(async () => {
  // The fake is swapped per test; the app calls whichever is current.
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

/** Subscribe to /api/events; `events` fills as they arrive. */
function subscribe() {
  const events = [];
  let buf = "";
  const r = request({ host: "127.0.0.1", port, path: "/api/events", headers: { host: `127.0.0.1:${port}`, "x-studio-key": KEY } }, (res) => {
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      buf += chunk;
      let cut;
      while ((cut = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        const event = block.match(/^event: (.+)$/m)?.[1];
        const data = block.match(/^data: (.+)$/m)?.[1];
        if (event && data) events.push({ event, data: JSON.parse(data) });
      }
    });
  });
  r.on("error", () => {});
  r.end();
  return { events, close: () => r.destroy() };
}

const until = async (check, ms = 5_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = check();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out waiting");
};

describe("not connected", () => {
  test("the settings say nothing is set up", async () => {
    const r = await call("/api/chat-settings");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, {
      backend: null,
      model: null,
      openai: { keySaved: false, keySource: null, keyFile: process.env.KIE_OPENAI_KEY_FILE, keyEnv: "OPENAI_API_KEY" },
    });
  });

  test("sending a message is refused with connect: true, so the page shows the two options; nothing is saved", async () => {
    const r = await call("/api/chat/chat-none", { method: "POST", body: { text: "hello" } });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.connect, true);
    assert.equal(r.json.error.message, "Chat isn't connected. Choose the ChatGPT subscription, or paste an OpenAI API key.");
    assert.equal(existsSync(join(RUNS, "chat-none")), false);
  });

  test("Codex's status says when it isn't installed", async () => {
    const r = await call("/api/chat-settings/codex");
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { installed: false, loggedIn: false, plan: null, message: "Codex isn't installed. Install it with npm install -g @openai/codex, or use an OpenAI API key." });
  });

  test("the model list needs a key first", async () => {
    const r = await call("/api/chat-settings/models");
    assert.equal(r.status, 409);
    assert.equal(r.json.error.connect, true);
  });
});

describe("connecting with an API key", () => {
  test("a pasted key is saved mode 600 and only its presence comes back", async () => {
    const r = await call("/api/chat-settings/openai-key", { method: "PUT", body: { key: OPENAI_KEY } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.openai.keySaved, true);
    assert.equal(r.json.openai.keySource, "file");
    assert.equal(statSync(process.env.KIE_OPENAI_KEY_FILE).mode & 0o777, 0o600);
    const bad = await call("/api/chat-settings/openai-key", { method: "PUT", body: { key: "nope" } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.field, "key");
  });

  test("the model list comes from the key's /v1/models", async () => {
    fake = fakeOpenAI({ models: [{ id: "gpt-test-1", created: 2 }, { id: "tts-1", created: 3 }] });
    const r = await call("/api/chat-settings/models");
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { models: ["gpt-test-1"] });
    assert.equal(fake.requests[0].auth, true);
  });

  test("a refused key is a 409 with connect: true", async () => {
    fake = fakeOpenAI();
    fake.fetch = async () => new Response(JSON.stringify({ error: { message: `bad key ${OPENAI_KEY}` } }), { status: 401 });
    const r = await call("/api/chat-settings/models");
    assert.equal(r.status, 409);
    assert.equal(r.json.error.connect, true);
  });

  test("the API-key backend needs a model; with one it is saved", async () => {
    const none = await call("/api/chat-settings", { method: "PUT", body: { backend: "openai" } });
    assert.equal(none.status, 400);
    assert.equal(none.json.error.field, "model");
    const r = await call("/api/chat-settings", { method: "PUT", body: { backend: "openai", model: "gpt-test-1" } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.backend, "openai");
    assert.equal(r.json.model, "gpt-test-1");
    const odd = await call("/api/chat-settings", { method: "PUT", body: { backend: "claude" } });
    assert.equal(odd.status, 400);
  });
});

describe("a chat turn", () => {
  test("tool steps and streamed text reach the page as chat events, and the film's chat.jsonl keeps them", async () => {
    fake = fakeOpenAI({ replies: [callReply("estimate", { model: "seedance-2-5", duration_s: 4, resolution: "480p" }), textReply("About $0.56.")] });
    const sub = subscribe();
    await until(() => sub.events.some((e) => e.event === "hello"));
    const r = await call("/api/chat/chat-one", { method: "POST", body: { text: "  What would 4s cost?  " } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.entry.kind, "user");
    assert.equal(r.json.entry.text, "What would 4s cost?");
    await app.chat.idle("chat-one");
    await until(() => sub.events.some((e) => e.event === "chat" && e.data.busy === false && e.data.entry === null));
    sub.close();

    const chat = sub.events.filter((e) => e.event === "chat" && e.data.film === "chat-one");
    assert.ok(chat.some((e) => e.data.entry?.kind === "tool" && e.data.entry.state === "running"));
    assert.ok(chat.some((e) => e.data.entry?.kind === "tool" && e.data.entry.result === "$0.56"));
    assert.ok(chat.some((e) => e.data.entry?.kind === "assistant" && e.data.entry.streaming));

    const back = await call("/api/chat/chat-one");
    assert.equal(back.json.busy, false);
    assert.deepEqual(
      back.json.entries.map((e) => (e.kind === "tool" ? `${e.name} ${e.args} → ${e.result}` : `${e.kind}: ${e.text}`)),
      ["user: What would 4s cost?", "estimate seedance-2-5 4s 480p → $0.56", "assistant: About $0.56."],
    );
    const lines = readFileSync(join(RUNS, "chat-one", "chat.jsonl"), "utf8").trim().split("\n");
    assert.equal(lines.length, 3);
  });

  test("a second message sends the first exchange as history", async () => {
    fake = fakeOpenAI({ replies: [textReply("Sure.")] });
    await call("/api/chat/chat-one", { method: "POST", body: { text: "And 8s?" } });
    await app.chat.idle("chat-one");
    assert.deepEqual(
      fake.requests[0].body.input.map((m) => m.content),
      ["What would 4s cost?", "[tool step] estimate seedance-2-5 4s 480p → done: $0.56", "About $0.56.", "And 8s?"],
    );
    assert.match(fake.requests[0].body.instructions, /working in the film "chat-one"/);
  });

  test("a job the chat starts reaches the feed through the job watcher, as a job event", async () => {
    fake = fakeOpenAI({
      replies: [
        callReply("generate_video", { run: "chat-job", prompt: "A paper fox.", model: "seedance-2-5", duration_s: 4, resolution: "480p", provider: "kie" }),
        textReply("Started it."),
      ],
    });
    const sub = subscribe();
    await until(() => sub.events.some((e) => e.event === "hello"));
    await call("/api/chat/chat-job", { method: "POST", body: { text: "Make it." } });
    await app.chat.idle("chat-job");
    const job = await until(() => sub.events.find((e) => e.event === "job" && e.data.run === "chat-job"));
    sub.close();
    assert.match(job.data.id, /^j-\d{8}-[0-9a-f]{6}$/);
    assert.equal(job.data.model, "seedance-2-5");
    const step = (await call("/api/chat/chat-job")).json.entries.find((e) => e.kind === "tool");
    assert.equal(step.result, `${job.data.id} submitted`);
    const listed = (await call("/api/jobs?run=chat-job")).json;
    assert.equal(listed[0].id, job.data.id);
  });

  test("a submit whose outcome is unknown ends the turn with a line saying so; the next message still knows the job", async () => {
    const create = stubs.generate.createTask;
    stubs.generate.createTask = async () => {
      throw new Error("socket hang up");
    };
    try {
      fake = fakeOpenAI({
        replies: [callReply("generate_video", { run: "chat-unsure", prompt: "A paper fox.", model: "seedance-2-5", duration_s: 4, resolution: "480p", provider: "kie" }), textReply("Trying again.")],
      });
      await call("/api/chat/chat-unsure", { method: "POST", body: { text: "Make it." } });
      await app.chat.idle("chat-unsure");
    } finally {
      stubs.generate.createTask = create;
    }
    assert.equal(fake.requests.length, 1, "the model was not asked again");
    const entries = (await call("/api/chat/chat-unsure")).json.entries;
    const step = entries.find((e) => e.kind === "tool");
    assert.equal(step.result, "uncertain: still checking, do not resubmit");
    assert.match(step.jobs[0], /^j-\d{8}-[0-9a-f]{6}$/);
    assert.match(entries.at(-1).text, /^I can't tell whether generate_video went through \(socket hang up\).*Check the feed/);

    fake = fakeOpenAI({ replies: [textReply("It's still being checked.")] });
    await call("/api/chat/chat-unsure", { method: "POST", body: { text: "continue" } });
    await app.chat.idle("chat-unsure");
    const history = fake.requests[0].body.input.map((m) => m.content);
    assert.ok(history.some((c) => c.startsWith("[tool step] generate_video") && c.includes(step.jobs[0])), history.join("\n"));
  });

  test("one turn per film at a time; Stop ends it with a notice", async () => {
    fake = fakeOpenAI();
    // An OpenAI that never answers until the request is aborted.
    fake.fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    const first = await call("/api/chat/chat-busy", { method: "POST", body: { text: "one" } });
    assert.equal(first.status, 200);
    const second = await call("/api/chat/chat-busy", { method: "POST", body: { text: "two" } });
    assert.equal(second.status, 409);
    assert.equal((await call("/api/chat/chat-busy")).json.busy, true);
    const stop = await call("/api/chat/chat-busy/stop", { method: "POST" });
    assert.deepEqual(stop.json, { stopped: true });
    await app.chat.idle("chat-busy");
    const after = (await call("/api/chat/chat-busy")).json;
    assert.equal(after.busy, false);
    assert.deepEqual(after.entries.map((e) => [e.kind, e.text]), [["user", "one"], ["notice", "Stopped."]]);
  });

  test("an empty message and a bad film name are refused", async () => {
    assert.equal((await call("/api/chat/chat-one", { method: "POST", body: { text: "  " } })).status, 400);
    assert.equal((await call("/api/chat/Bad%20Film", { method: "POST", body: { text: "hi" } })).status, 400);
  });
});

test("shutdown waits for a running turn to end, so its transcript is saved", async () => {
  // An OpenAI that answers an abort only after a moment, as a real stream does.
  let fetched = false;
  const slow = (_url, init) =>
    new Promise((_resolve, reject) => {
      fetched = true;
      init.signal.addEventListener("abort", () => setTimeout(() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), 150));
    });
  const other = createApp({ key: KEY, deps: stubs.deps, distDir: join(tmp, "nodist"), chat: { fetch: slow } });
  await new Promise((r) => other.listen(0, "127.0.0.1", r));
  await other.chat.send("chat-shutdown", "one");
  await until(() => fetched);
  assert.deepEqual(other.chat.films(), ["chat-shutdown"]);
  await other.closeAll();
  const saved = readFileSync(join(RUNS, "chat-shutdown", "chat.jsonl"), "utf8");
  assert.match(saved, /"kind":"notice","at":"[^"]+","text":"Stopped\."/);
});

test("no response ever carried the OpenAI key", () => {
  assert.ok(seen.length > 10);
  for (const text of seen) assert.ok(!text.includes(OPENAI_KEY), text);
});
