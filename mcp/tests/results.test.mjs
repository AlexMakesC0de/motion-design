import { test } from "node:test";
import assert from "node:assert/strict";

import { EXIT, budget, uncertain, unknown } from "../../cli/lib/errors.mjs";
import { ok, fail } from "../results.mjs";

test("ok carries text and structured content", () => {
  const r = ok("done", { a: 1 });
  assert.deepEqual(r.structuredContent, { a: 1 });
  assert.equal(r.content[0].text, "done");
  assert.equal(r.isError, undefined);
});

test("code 2 says nothing was spent and to ask the user", () => {
  const r = fail(budget("Refused, nothing spent: estimate $0.56, $0.10 available today."));
  assert.equal(r.isError, true);
  assert.equal(r._meta.error.code, EXIT.BUDGET);
  assert.equal(r._meta.error.retryable, false);
  assert.match(r._meta.error.nextAction, /Ask the user/);
  assert.match(r.content[0].text, /^Error 2:/);
});

test("code 5 with an upstream id says to call wait_job, never to resubmit", () => {
  const r = fail(uncertain("read timed out", "task-77", { localJobId: "j-20261030-abcdef" }));
  assert.equal(r._meta.error.code, EXIT.UNCERTAIN);
  assert.match(r._meta.error.nextAction, /wait_job with job_id "j-20261030-abcdef"/);
  assert.match(r._meta.error.nextAction, /Do not resubmit/);
});

test("code 5 without an upstream id sends the user to kie's task log and kie job resolve", () => {
  const r = fail(uncertain("socket hang up", null, { localJobId: "j-20261030-abcdef" }));
  assert.match(r._meta.error.nextAction, /task log/);
  assert.match(r._meta.error.nextAction, /kie job resolve j-20261030-abcdef --task/);
  assert.match(r._meta.error.nextAction, /Do not resubmit/);
  assert.equal(r._meta.error.upstreamTaskId, null);
});

test("codes 3 and 4, and an unexpected error", () => {
  assert.equal(fail(unknown("bad role"))._meta.error.retryable, false);
  assert.equal(fail(Object.assign(new Error("busy"), { code: EXIT.PROVIDER }))._meta.error.retryable, true);
  const r = fail(new TypeError("x is undefined"));
  assert.equal(r._meta.error.code, EXIT.USAGE);
  assert.match(r._meta.error.nextAction, /status/);
});
