import { RUNS, tmp } from "./helpers.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const t = await import("../server/chat/transcript.mjs");

const ok = (structuredContent, text = "") => ({ content: [{ type: "text", text }], structuredContent });
const err = (code, message) => ({
  isError: true,
  content: [{ type: "text", text: `Error ${code}: ${message}\nNext: something` }],
  _meta: { error: { code } },
});

describe("tool-step lines", () => {
  test("arguments read as model, duration, resolution, then a clipped prompt; the run is left out", () => {
    assert.equal(t.argsLine({ model: "minimax-h3", duration_s: 4, resolution: "480p" }), "minimax-h3 4s 480p");
    assert.equal(
      t.argsLine({ run: "zed", model: "seedance-2-5", duration_s: 5, prompt: "A fox runs through deep snow at dawn, low sun", refs: [{}, {}] }),
      'seedance-2-5 5s 2 refs "A fox runs through deep snow at…"',
    );
    assert.equal(t.argsLine({ job_id: "j-20261030-7f3a00" }), "j-20261030-7f3a00");
    assert.equal(t.argsLine({ run: "zed" }), "zed", "the run alone, when it is all there is");
    assert.equal(t.argsLine({}), "");
  });

  test("results: an estimate is its price, a submit is the job and its state, a wait is the outcome and cost", () => {
    assert.equal(t.resultLine("estimate", ok({ estimateUsd: 0.16, allowed: true })), "$0.16");
    assert.equal(t.resultLine("estimate", ok({ estimateUsd: 0.9, allowed: false })), "$0.90 · not allowed");
    assert.equal(t.resultLine("generate_video", ok({ localJobId: "j-20261030-7f3a00", state: "submitted" })), "j-20261030-7f3a00 submitted");
    assert.equal(t.resultLine("wait_job", ok({ outcome: "succeeded", actualUsd: 0.5 })), "succeeded $0.50");
    assert.equal(t.resultLine("list_runs", ok({ runs: [] }, "zed  2 take(s)  2026-10-30\nother")), "zed  2 take(s)  2026-10-30");
  });

  test("a typed core error is one line by its code", () => {
    assert.equal(t.resultLine("generate_video", err(2, "Refused, nothing spent. Estimated $0.56.")), "stopped by the limits, nothing spent");
    assert.equal(t.resultLine("generate_video", err(3, "Seedance 2 takes 4-15s. More text.")), "refused: Seedance 2 takes 4-15s.");
    assert.equal(t.resultLine("wait_job", err(4, "kie.ai said no. Retry.")), "provider error: kie.ai said no.");
    assert.equal(t.resultLine("generate_video", err(5, "j-1 may exist.")), "uncertain: still checking, do not resubmit");
  });

  test("failure() reads the code from _meta, or from the text when only that came through", () => {
    assert.deepEqual(t.failure(err(2, "Refused, nothing spent.")), { code: 2, message: "Refused, nothing spent." });
    assert.deepEqual(t.failure({ content: [{ type: "text", text: "Error 4: down\nNext: retry" }], isError: true }), { code: 4, message: "down" });
    assert.equal(t.failure(ok({ estimateUsd: 1 })), null);
    const timedOut = { isError: true, content: [{ type: "text", text: "tool call timed out after 300s" }] };
    assert.deepEqual(t.failure(timedOut), { code: null, message: "tool call timed out after 300s" });
    assert.equal(t.resultLine("wait_job", timedOut), "failed: tool call timed out after 300s");
  });

  test("a limit refusal becomes the assistant's last sentence: core's reason, then the way out", () => {
    const message =
      "Refused, nothing spent. Estimated $0.56; $0.16 of today's $10.00 cap is available ($9.84 spent or held). Ask the user; only they can raise it, with: kie limits --daily N";
    assert.equal(
      t.budgetSentence(message),
      "Refused, nothing spent. Estimated $0.56; $0.16 of today's $10.00 cap is available ($9.84 spent or held). I've stopped here: raise the limit in Settings, or ask me for something cheaper.",
    );
  });
});

describe("chat.jsonl", () => {
  test("appends in order, makes the film's folder, and reads back entries and the Codex thread", () => {
    const u = t.userEntry("Make a 4s logo sting.");
    const a = { ...t.assistantEntry("Estimating first.", false) };
    const s = { ...t.toolEntry("estimate", { model: "minimax-h3", duration_s: 4 }), result: "$0.16", state: "done" };
    t.appendChat("chat-a", [u]);
    t.appendChat("chat-a", [a, s, { kind: "codex-thread", threadId: "thr-1" }]);
    assert.ok(statSync(join(RUNS, "chat-a")).isDirectory());
    const back = t.readChat("chat-a");
    assert.deepEqual(back.entries.map((e) => e.kind), ["user", "assistant", "tool"]);
    assert.equal(back.entries[2].args, "minimax-h3 4s");
    assert.equal(back.codexThread, "thr-1");
  });

  test("a film with no chat yet is empty, and a torn last line is skipped", () => {
    assert.deepEqual(t.readChat("chat-none"), { entries: [], codexThread: null });
    mkdirSync(join(RUNS, "chat-torn"), { recursive: true });
    writeFileSync(join(RUNS, "chat-torn", "chat.jsonl"), `${JSON.stringify(t.userEntry("hi"))}\n{"kind":"assis`);
    assert.equal(t.readChat("chat-torn").entries.length, 1);
  });

  test("a bad film name is refused, and a chat.jsonl that links elsewhere is never written through", () => {
    assert.throws(() => t.appendChat("../escape", [t.userEntry("x")]), { code: 1 });
    mkdirSync(join(RUNS, "chat-link"), { recursive: true });
    writeFileSync(join(tmp, "outside.jsonl"), "");
    symlinkSync(join(tmp, "outside.jsonl"), join(RUNS, "chat-link", "chat.jsonl"));
    assert.throws(() => t.appendChat("chat-link", [t.userEntry("x")]), { code: 3 });
    assert.equal(readFileSync(join(tmp, "outside.jsonl"), "utf8"), "");
  });

  test("a chat.jsonl that links to a missing file is refused, and nothing is created outside runs/", () => {
    mkdirSync(join(RUNS, "chat-dangling"), { recursive: true });
    const target = join(tmp, "dangling-target.jsonl");
    symlinkSync(target, join(RUNS, "chat-dangling", "chat.jsonl"));
    assert.throws(() => t.appendChat("chat-dangling", [t.userEntry("x")]), { code: 3 });
    assert.throws(() => t.readChat("chat-dangling"), { code: 3 });
    assert.equal(existsSync(target), false);
  });

  test("a film folder that is a link is refused, wherever it points", () => {
    mkdirSync(join(tmp, "elsewhere"), { recursive: true });
    symlinkSync(join(tmp, "elsewhere"), join(RUNS, "chat-dirlink"));
    assert.throws(() => t.appendChat("chat-dirlink", [t.userEntry("x")]), { code: 3 });
    assert.throws(() => t.readChat("chat-dirlink"), { code: 3 });
    assert.equal(existsSync(join(tmp, "elsewhere", "chat.jsonl")), false);

    symlinkSync(join(tmp, "missing-dir"), join(RUNS, "chat-dirlink-dangling"));
    assert.throws(() => t.appendChat("chat-dirlink-dangling", [t.userEntry("x")]), { code: 3 });
    assert.equal(existsSync(join(tmp, "missing-dir")), false);
  });

  test("history for a model is the user and assistant text only", () => {
    const entries = [t.userEntry("one"), { ...t.toolEntry("status", {}), state: "done" }, t.assistantEntry("two", false), t.noticeEntry("Stopped.")];
    assert.deepEqual(t.historyMessages(entries), [
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
    ]);
  });
});

describe("createTurnLog", () => {
  test("text deltas build one assistant entry per key; tool steps go from running to done; every change is reported", () => {
    const changes = [];
    const log = t.createTurnLog((e) => changes.push(`${e.kind}:${e.kind === "tool" ? e.state : e.text}`));
    log.text("m1", "Che");
    log.text("m1", "cking.");
    log.textDone("m1", "Checking.");
    log.toolStart("call-1", "estimate", { model: "minimax-h3", duration_s: 4 });
    const f = log.toolDone("call-1", "estimate", ok({ estimateUsd: 0.26, allowed: true }));
    assert.equal(f, null);
    assert.deepEqual(changes, ["assistant:Che", "assistant:Checking.", "assistant:Checking.", "tool:running", "tool:done"]);
    assert.deepEqual(
      log.entries.map((e) => (e.kind === "tool" ? [e.name, e.args, e.result, e.state] : [e.kind, e.text, e.streaming])),
      [["assistant", "Checking.", false], ["estimate", "minimax-h3 4s", "$0.26", "done"]],
    );
  });

  test("toolDone returns the typed error, and settle() leaves nothing streaming or running", () => {
    const log = t.createTurnLog(() => {});
    log.toolStart("a", "generate_video", {});
    assert.deepEqual(log.toolDone("a", "generate_video", err(2, "Refused, nothing spent.")), { code: 2, message: "Refused, nothing spent." });
    log.text("m", "half a sen");
    log.toolStart("b", "wait_job", { job_id: "j-1" });
    log.settle();
    assert.equal(log.entries[1].streaming, false);
    assert.deepEqual([log.entries[2].state, log.entries[2].result], ["failed", "stopped before it finished"]);
  });

  test("say() and notice() add finished lines", () => {
    const log = t.createTurnLog(() => {});
    log.say("Done.");
    log.notice("Stopped.", "info");
    assert.deepEqual(log.entries.map((e) => [e.kind, e.text, e.streaming ?? e.tone]), [["assistant", "Done.", false], ["notice", "Stopped.", "info"]]);
  });
});
