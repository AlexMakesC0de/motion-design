import { deps, tmp } from "./helpers.mjs";
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const config = await import("../server/chat/config.mjs");
const { systemPrompt, section, ROUTING_FILE } = await import("../server/chat/prompt.mjs");
const { createTools, functionSchema } = await import("../server/chat/tools.mjs");

const FAKE_KEY = "sk-test-0123456789abcdefghijklmnop";

describe("chat connection and key", () => {
  test("nothing configured reads as no backend and no model", () => {
    assert.deepEqual(config.readConnection(), { backend: null, model: null });
    assert.equal(config.keySource(), null);
    assert.equal(config.openaiKey(), null);
  });

  test("a saved connection reads back; an unknown backend or odd model id is refused with code 3", () => {
    assert.deepEqual(config.writeConnection({ backend: "openai", model: "gpt-test-1" }), { backend: "openai", model: "gpt-test-1" });
    assert.throws(() => config.writeConnection({ backend: "claude" }), { code: 3, field: "backend" });
    assert.throws(() => config.writeConnection({ backend: "openai", model: "gpt 1; rm" }), { code: 3, field: "model" });
    assert.equal(statSync(config.chatConfigPath()).mode & 0o777, 0o600);
  });

  test("a pasted key is saved mode 600 and read back from the file; the environment wins over the file", () => {
    config.saveOpenaiKey(`  ${FAKE_KEY}\n`);
    assert.equal(statSync(config.openaiKeyPath()).mode & 0o777, 0o600);
    assert.equal(readFileSync(config.openaiKeyPath(), "utf8"), `${FAKE_KEY}\n`);
    assert.equal(config.keySource(), "file");
    assert.equal(config.openaiKey(), FAKE_KEY);
    process.env.OPENAI_API_KEY = "sk-from-env-0123456789abcdefghij";
    try {
      assert.equal(config.keySource(), "env");
      assert.equal(config.openaiKey(), "sk-from-env-0123456789abcdefghij");
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  test("something that is not a key is refused, and the message does not repeat it", () => {
    assert.throws(() => config.saveOpenaiKey("short"), (e) => e.code === 3 && !e.message.includes("short"));
    assert.throws(() => config.saveOpenaiKey("sk-has a space in the middle of it-0123"), { code: 3 });
  });
});

describe("system prompt", () => {
  test("is the film, the MCP server's instructions and the routing section, nothing new", () => {
    const routing = readFileSync(ROUTING_FILE, "utf8");
    const p = systemPrompt({ film: "zed", mcpInstructions: "Motion-design studio over kie.ai. Look first." });
    assert.match(p, /^You are the chat in the motion-design studio, working in the film "zed"\. Use run "zed"/);
    assert.ok(p.includes("Motion-design studio over kie.ai. Look first."));
    assert.match(p, /go ahead without asking for confirmation/);
    const which = section(routing, "Which model for which job");
    assert.match(which, /^## Which model for which job\n/);
    assert.ok(!which.includes("## Native routes"), "stops at the next section");
    assert.ok(p.endsWith(which));
  });
});

describe("tools over the in-process MCP client", () => {
  const tools = createTools({ deps });
  after(() => tools.close());

  test("offers the 37 MCP tools as function tools, without the schema keywords the Responses API rejects", async () => {
    const fns = await tools.functions();
    assert.equal(fns.length, 37);
    const video = fns.find((f) => f.name === "generate_video");
    assert.equal(video.type, "function");
    assert.equal(video.strict, false);
    assert.match(video.description, /^Spends kie credits\./);
    assert.deepEqual(video.parameters.required, ["run", "prompt"]);
    assert.ok(!JSON.stringify(fns).includes("$schema"));
    assert.ok(!JSON.stringify(fns).includes("propertyNames"));
    assert.deepEqual(functionSchema({ $schema: "x", type: "object", properties: { p: { propertyNames: {}, type: "object" } } }), {
      type: "object",
      properties: { p: { type: "object" } },
    });
  });

  test("the instructions are the MCP server's own", async () => {
    assert.match(await tools.instructions(), /^Motion-design studio over kie\.ai\./);
  });

  test("calls a tool, and an unknown tool comes back as an error result instead of a throw", async () => {
    const r = await tools.call("estimate", { model: "seedance-2-5", duration_s: 4, resolution: "480p" });
    assert.equal(typeof r.structuredContent.estimateUsd, "number");
    const bad = await tools.call("no_such_tool", {});
    assert.equal(bad.isError, true);
  });
});

test("the key file is never written outside its configured path", () => {
  assert.equal(config.openaiKeyPath(), join(tmp, "openai.key"));
  writeFileSync(config.openaiKeyPath(), "");
  assert.equal(config.keySource(), null);
});
