// A stand-in for `codex app-server`, for tests. Run as
//   node fake-codex.mjs <exchange.json> <log.jsonl> [the real app-server args...]
// It answers initialize, account/read, thread/start, thread/resume,
// mcpServerStatus/list, turn/start and turn/interrupt from the exchange file,
// then plays the exchange's turn steps:
//   { "notify": method, "params": {...} }   a notification
//   { "request": method, "params": {...} }  a server request; waits for the answer
//   { "waitFor": method }                   waits until the client sends that method
//   { "sleep": ms }                         waits that long
// "noAnswer": [methods] lists requests it never answers (a stuck app-server).
// "mcpPages": [[servers], [servers], ...] answers mcpServerStatus/list a page
// at a time, by cursor, instead of "mcpServers" in one page.
// "$thread" and "$turn" anywhere in params become the current ids.
// A step with "early": true is sent before the turn/start response.
// The log gets { argv } first, then { in: message } for every line received.
// The shapes follow web/server/chat/codex-protocol; initialize and account/read
// are copied from a real codex-cli 0.154.0 (email replaced).
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const [exchangeFile, logFile, ...argv] = process.argv.slice(2);
const ex = JSON.parse(readFileSync(exchangeFile, "utf8"));
writeFileSync(logFile, `${JSON.stringify({ argv })}\n`);

let threadId = null;
let nextId = 1000;
const waiting = new Map(); // id or method → resolve
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const fill = (v) => JSON.parse(JSON.stringify(v ?? {}).replaceAll('"$thread"', JSON.stringify(threadId)).replaceAll('"$turn"', JSON.stringify(ex.turnId ?? "turn-1")));

async function play(steps) {
  for (const step of steps) {
    if (step.notify) send({ method: step.notify, params: fill(step.params) });
    else if (step.request) {
      const id = nextId++;
      const answered = new Promise((r) => waiting.set(id, r));
      send({ id, method: step.request, params: fill(step.params) });
      await answered;
    } else if (step.waitFor) await new Promise((r) => waiting.set(step.waitFor, r));
    else if (step.sleep) await new Promise((r) => setTimeout(r, step.sleep));
  }
}

function answer(m) {
  const reply = (result) => send({ id: m.id, result });
  const error = (message) => send({ id: m.id, error: { code: -32600, message } });
  if (ex.noAnswer?.includes(m.method)) return;
  switch (m.method) {
    case "initialize":
      return reply(ex.initialize);
    case "account/read":
      return reply(ex.account);
    case "thread/start":
      threadId = ex.threadId ?? "thr-new";
      return reply({ thread: { id: threadId }, model: "gpt-fake", cwd: m.params.cwd, sandbox: { type: "readOnly" } });
    case "thread/resume":
      if (ex.resume === "missing") return error(`no rollout found for thread id ${m.params.threadId}`);
      threadId = m.params.threadId;
      return reply({ thread: { id: threadId } });
    case "mcpServerStatus/list":
      if (ex.mcpStatus === "error") return error("mcpServerStatus/list failed");
      if (ex.mcpPages) {
        const page = Number(m.params.cursor ?? 0);
        return reply({ data: ex.mcpPages[page], nextCursor: page + 1 < ex.mcpPages.length ? String(page + 1) : null });
      }
      return reply({ data: ex.mcpServers ?? [], nextCursor: null });
    case "turn/start": {
      const steps = ex.turn ?? [];
      const early = steps.filter((s) => s.early);
      return play(early).then(() => {
        reply({ turn: { id: ex.turnId ?? "turn-1", items: [], status: "inProgress", error: null } });
        return play(steps.filter((s) => !s.early));
      });
    }
    case "turn/interrupt":
      return reply({});
    default:
      return error(`fake codex: no answer for ${m.method}`);
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  appendFileSync(logFile, `${JSON.stringify({ in: m })}\n`);
  if (m.method && waiting.has(m.method)) {
    waiting.get(m.method)();
    waiting.delete(m.method);
  }
  if (m.id != null && !m.method) {
    waiting.get(m.id)?.();
    waiting.delete(m.id);
  } else if (m.id != null) answer(m);
});
