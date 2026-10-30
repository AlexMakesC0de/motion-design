import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { loadCatalog } from "../cli/lib/models.mjs";
import { getProvider, taskCost } from "../cli/lib/providers.mjs";
import { EXIT } from "../cli/lib/errors.mjs";
import { queryTask, createTask } from "../cli/lib/client.mjs";
import { waitForTask } from "../cli/lib/poll.mjs";

const catalog = loadCatalog();
const kie = getProvider(catalog, "kie");
const ws = getProvider(catalog, "wavespeed");

describe("cost comes from the provider's own task record", () => {
  test("kie credits convert at $0.005 each", () => {
    assert.deepEqual(taskCost(kie, { creditsConsumed: 112 }), { usd: 0.56, credits: 112 });
  });

  test("a failed task's 0 is a confirmed zero, not a missing value", () => {
    assert.deepEqual(taskCost(kie, { creditsConsumed: 0 }), { usd: 0, credits: 0 });
  });

  test("no figure, or a provider with no conversion, is null", () => {
    assert.equal(taskCost(kie, { state: "success" }), null);
    assert.equal(taskCost(ws, { creditsConsumed: 5 }), null);
  });
});

describe("a failed task is read as failed, not as unreadable", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => (globalThis.fetch = realFetch));

  test("kie's body code 501 with a task record returns the record", async () => {
    const record = { taskId: "t1", state: "fail", failMsg: "bad frame", creditsConsumed: 0 };
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 501, msg: "failed", data: record }), { status: 200 });
    assert.deepEqual(await queryTask(kie, "jobs", "t1", { key: "k", attempts: 1 }), record);
  });

  test("a body error with no task record is still an error", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 401, msg: "bad key" }), { status: 200 });
    await assert.rejects(queryTask(kie, "jobs", "t1", { key: "k", attempts: 1 }), /could not read task t1/);
  });
});

describe("a task that succeeded with nothing to download", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => (globalThis.fetch = realFetch));

  test("is flagged so the job is not recorded as a failure", async () => {
    const record = { taskId: "t1", state: "success", creditsConsumed: 112 };
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 200, msg: "ok", data: record }), { status: 200 });
    await assert.rejects(
      waitForTask(kie, "jobs", "t1", { key: "k", timeoutMs: 1000 }),
      (e) => e.succeededWithoutUrl === true && e.data.creditsConsumed === 112,
    );
  });
});

describe("waitForTask marks only its own deadline as a timeout", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => (globalThis.fetch = realFetch));

  test("running past the deadline is code 5 with timedOut", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 200, msg: "ok", data: { taskId: "t1", state: "generating" } }), { status: 200 });
    await assert.rejects(
      waitForTask(kie, "jobs", "t1", { key: "k", timeoutMs: -1 }),
      (e) => e.code === EXIT.UNCERTAIN && e.timedOut === true,
    );
  });

  test("an unreadable task (bad key) is code 5 without timedOut", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 401, msg: "bad key" }), { status: 200 });
    await assert.rejects(
      waitForTask(kie, "jobs", "t1", { key: "k", timeoutMs: 1000 }),
      (e) => e.code === EXIT.UNCERTAIN && !e.timedOut,
    );
  });
});

describe("an HTTP 5xx answer to a create", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => (globalThis.fetch = realFetch));

  test("is ambiguous, not a rejection: uncertain, and sent exactly once", async () => {
    let requests = 0;
    globalThis.fetch = async () => (requests++, new Response("bad gateway", { status: 502 }));
    await assert.rejects(
      createTask(kie, "jobs", "bytedance/seedance-2-5", { prompt: "a fox" }, { key: "k" }),
      (e) => e.code === EXIT.UNCERTAIN && e.taskId === null && /502/.test(e.message) && /MAY have been created/.test(e.message),
    );
    assert.equal(requests, 1);
  });
});
