// Subscription backend: `codex app-server` as a child process, spoken to in
// JSON-RPC over stdio, one JSON object per line (Codex 0.154 sends no
// "jsonrpc" field and needs none). The shapes used here are the generated
// types in ./codex-protocol (npm --prefix web run codex-protocol).
//
// Codex runs with a read-only sandbox and approval policy "never", in a
// thread whose working folder is the repo. Its only way to act is the
// motion-design MCP server, which it starts itself (node mcp/server.mjs, with
// the studio's runs/, library/ and limits file) from -c overrides given at
// spawn. Every other MCP server in ~/.codex/config.toml is turned off, and
// so are the features that bring tools of their own (the shell, plugins,
// apps, computer and browser use, image generation, sub-agents). Any approval
// request that still arrives (a command, a file change, more permissions) is
// declined.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { NAME as MCP_NAME, TOOL_TIMEOUT_SEC } from "../../../mcp/register.mjs";
import { LIBRARY_DIR, REPO_ROOT, RUNS_DIR } from "../../../cli/lib/run.mjs";
import { limitsPath } from "../../../cli/core/spend.mjs";
import { EXIT } from "../../../cli/lib/errors.mjs";
import { redact } from "../../../cli/lib/redact.mjs";
import { ChatError, appendChat, historyMessages } from "./transcript.mjs";

export { MCP_NAME };

/** Codex features that would give the chat tools besides the motion-design MCP server. Checked by codex at spawn. */
export const DISABLED_FEATURES = [
  "plugins",
  "apps",
  "computer_use",
  "browser_use",
  "browser_use_external",
  "image_generation",
  "multi_agent",
  "skill_mcp_dependency_install",
  "tool_suggest",
  "memories",
  "shell_tool",
  "unified_exec",
  "in_app_browser",
];

export const NOT_INSTALLED = "Codex isn't installed. Install it with npm install -g @openai/codex, or use an OpenAI API key.";
export const NOT_LOGGED_IN = "Codex isn't logged in. Run codex login in a terminal, then check again, or use an OpenAI API key.";

export const codexConfigPath = () => join(process.env.CODEX_HOME || join(homedir(), ".codex"), "config.toml");

/** The MCP servers named in config.toml's [mcp_servers.<name>] tables, ours left out. */
export function configuredMcpServers(text) {
  const names = new Set();
  for (const m of text.matchAll(/^\s*\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))[\].]/gm)) names.add(m[1] ?? m[2]);
  names.delete(MCP_NAME);
  return [...names];
}

const q = JSON.stringify; // a JSON string is a valid TOML basic string
const key = (name) => (/^[A-Za-z0-9_-]+$/.test(name) ? name : q(name));

/**
 * The app-server's arguments. Paths and variable names only: a key never
 * appears here. `keyEnvs` are the provider key variables Codex may pass
 * through to our MCP server (env_vars takes names, not values).
 */
export function codexArgs({ repo = REPO_ROOT, node = process.execPath, runsDir = RUNS_DIR, libraryDir = LIBRARY_DIR, limitsFile = limitsPath(), keyEnvs = [], configText = "" } = {}) {
  const s = `mcp_servers.${MCP_NAME}`;
  return [
    "app-server",
    ...DISABLED_FEATURES.flatMap((f) => ["--disable", f]),
    "-c", 'web_search="disabled"',
    ...configuredMcpServers(configText).flatMap((n) => ["-c", `mcp_servers.${key(n)}.enabled=false`]),
    "-c", `${s}.command=${q(node)}`,
    "-c", `${s}.args=[${q(join(repo, "mcp", "server.mjs"))}]`,
    "-c", `${s}.cwd=${q(repo)}`,
    "-c", `${s}.env={KIE_RUNS_DIR=${q(runsDir)},KIE_LIBRARY_DIR=${q(libraryDir)},KIE_LIMITS_FILE=${q(limitsFile)}}`,
    "-c", `${s}.env_vars=[${keyEnvs.map(q).join(",")}]`,
    "-c", `${s}.tool_timeout_sec=${TOOL_TIMEOUT_SEC}`,
    "-c", `${s}.required=true`,
    "-c", `${s}.default_tools_approval_mode="approve"`,
  ];
}

const DECLINED = "The studio chat cannot run commands or change files; it acts only through the motion-design tools.";
const unsupported = (method) => () => {
  throw new Error(`${method} is not supported by the studio`);
};

/**
 * The answer to each request Codex can send (methods.json's serverRequests).
 * Approvals are declined; questions get no answer; nothing is granted.
 */
export const ANSWERS = {
  "item/commandExecution/requestApproval": () => ({ decision: "decline" }),
  "item/fileChange/requestApproval": () => ({ decision: "decline" }),
  "item/permissions/requestApproval": () => ({ permissions: {}, scope: "turn" }),
  execCommandApproval: () => ({ decision: { denied: { rejection: DECLINED } } }),
  applyPatchApproval: () => ({ decision: { denied: { rejection: DECLINED } } }),
  "mcpServer/elicitation/request": () => ({ action: "decline", content: null, _meta: null }),
  "item/tool/requestUserInput": () => ({ answers: {} }),
  "item/tool/call": () => ({ contentItems: [], success: false }),
  "account/chatgptAuthTokens/refresh": unsupported("account/chatgptAuthTokens/refresh"),
  "attestation/generate": unsupported("attestation/generate"),
};

/** JSON-RPC over the child's stdio. */
function openRpc(child, { onNotification }) {
  let next = 1;
  const pending = new Map();
  const write = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
  createInterface({ input: child.stdout }).on("line", (line) => {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.id != null && m.method) {
      const answer = ANSWERS[m.method] ?? unsupported(m.method);
      try {
        write({ id: m.id, result: answer(m.params) });
      } catch (err) {
        write({ id: m.id, error: { code: -32601, message: err.message } });
      }
    } else if (m.id != null) {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) p.reject(Object.assign(new Error(m.error.message ?? "Codex error"), { rpc: m.error }));
      else p.resolve(m.result);
    } else if (m.method) {
      onNotification(m);
    }
  });
  child.on("exit", () => {
    for (const p of pending.values()) p.reject(new ChatError("Codex stopped."));
    pending.clear();
  });
  return {
    request(method, params) {
      const id = next++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        write({ id, method, params });
      });
    },
    notify(method, params) {
      write(params === undefined ? { method } : { method, params });
    },
  };
}

/** Earlier lines of the film, for a new thread (a film whose chat began with the other backend, or whose thread is gone). */
export function recap(entries) {
  const lines = historyMessages(entries, 20).map((m) => `${m.role === "user" ? "User" : "You"}: ${m.content}`);
  return lines.length ? `Earlier in this film's chat:\n${lines.join("\n")}\n\nNow:\n` : "";
}

/**
 * A Codex MCP tool call item as an MCP tool result, for the transcript. Our
 * server's errors start "Error <code>: ", so a refusal is read from the text
 * as well, in case Codex drops the result's isError or _meta.
 */
export function toolResult(item) {
  const content = item.result?.content ?? (item.error ? [{ type: "text", text: item.error.message }] : []);
  const typed = /^Error [1-5]: /.test(content.find((c) => c?.type === "text")?.text ?? "");
  return { ...(item.result ?? {}), content, isError: item.status === "failed" || Boolean(item.error) || typed };
}

/**
 * KIE_CODEX_COMMAND replaces the codex binary (the web tests point it at a
 * path that does not exist, so no test can reach the real Codex).
 * `command` and `prefixArgs` let tests run a fake app-server
 * (process.execPath, [fake-codex.mjs, ...]); `args` builds the real
 * arguments when the process starts.
 */
export function createCodex({ command = process.env.KIE_CODEX_COMMAND || "codex", prefixArgs = [], args, repo = REPO_ROOT, keyEnvs = [] } = {}) {
  const build =
    args ??
    (() => {
      const file = codexConfigPath();
      const configText = existsSync(file) ? readFileSync(file, "utf8") : "";
      return codexArgs({ repo, keyEnvs, configText });
    });
  const listeners = new Set();
  let proc = null;

  function start() {
    if (proc) return proc.ready;
    const child = spawn(command, [...prefixArgs, ...build()], { cwd: repo, stdio: ["pipe", "pipe", "pipe"] });
    child.stderr.resume(); // Codex logs there; not ours to keep
    child.stdin.on("error", () => {}); // a write after exit; the exit handler reports it
    const rpc = openRpc(child, { onNotification: (m) => listeners.forEach((fn) => fn(m)) });
    const p = { child, rpc };
    p.ready = new Promise((resolve, reject) => {
      child.on("error", (err) => reject(err.code === "ENOENT" ? new ChatError(NOT_INSTALLED, { connect: true }) : err));
      child.once("spawn", resolve);
    })
      .then(() => rpc.request("initialize", { clientInfo: { name: "motion_design_studio", title: "Motion-design studio", version: "0.1.0" }, capabilities: null }))
      .then(() => rpc.notify("initialized"));
    child.on("exit", () => {
      if (proc === p) proc = null;
    });
    p.ready.catch(() => {
      if (proc === p) proc = null;
      child.kill();
    });
    proc = p;
    return p.ready;
  }

  function stopProcess() {
    proc?.child.kill();
    proc = null;
  }

  async function status() {
    try {
      await start();
      const r = await proc.rpc.request("account/read", { refreshToken: false });
      const a = r?.account;
      if (!a) {
        stopProcess(); // after codex login, the next check starts a Codex that sees the new login
        return { installed: true, loggedIn: false, plan: null, message: NOT_LOGGED_IN };
      }
      const plan = a.type === "chatgpt" ? `ChatGPT ${a.planType}` : a.type === "apiKey" ? "an OpenAI API key" : a.type;
      return { installed: true, loggedIn: true, plan, message: null };
    } catch (err) {
      if (err.message === NOT_INSTALLED) return { installed: false, loggedIn: false, plan: null, message: NOT_INSTALLED };
      return { installed: true, loggedIn: false, plan: null, message: `Codex did not answer: ${redact(err.message)}` };
    }
  }

  /** Refuse to run a turn when Codex has another MCP server live in the thread anyway (a plugin's, say). */
  async function guard(threadId) {
    const r = await proc.rpc.request("mcpServerStatus/list", { threadId, detail: "toolsAndAuthOnly" }).catch(() => null);
    if (!Array.isArray(r?.data)) {
      throw new ChatError("Codex did not say which tools are on for this chat, so the turn was not started. Try again, or use an OpenAI API key.");
    }
    const others = r.data.filter((s) => s.name !== MCP_NAME && ["starting", "connected"].includes(s.runtimeStatus)).map((s) => s.name);
    if (others.length) {
      throw new ChatError(
        `Codex has other MCP servers on for this chat (${others.join(", ")}). The studio's chat runs only with the motion-design tools: turn those off in ~/.codex/config.toml, or use an OpenAI API key.`,
      );
    }
  }

  async function turn({ film, text, saved, instructions, sink, signal }) {
    await start();
    const { rpc, child } = proc;
    const threadParams = { cwd: repo, sandbox: "read-only", approvalPolicy: "never", developerInstructions: instructions };
    let threadId = saved.codexThread;
    let fresh = false;
    if (threadId) {
      try {
        await rpc.request("thread/resume", { threadId, ...threadParams });
      } catch {
        threadId = null; // gone from Codex's history; start again with a recap
      }
    }
    if (!threadId) {
      threadId = (await rpc.request("thread/start", threadParams)).thread.id;
      fresh = true;
      appendChat(film, [{ kind: "codex-thread", threadId }]);
    }
    await guard(threadId);
    const input = `${fresh ? recap(saved.entries) : ""}${text}`;

    return new Promise((resolve, reject) => {
      let turnId = null;
      let budget = null;
      const early = [];
      const interrupt = () => turnId && rpc.request("turn/interrupt", { threadId, turnId }).catch(() => {});
      const finish = (fn, value) => {
        listeners.delete(onMessage);
        signal.removeEventListener("abort", interrupt);
        child.off("exit", onExit);
        fn(value);
      };
      const onExit = () => finish(reject, new ChatError("Codex stopped in the middle of the reply. Send the message again."));

      function handle(m) {
        const p = m.params ?? {};
        const item = p.item;
        switch (m.method) {
          case "item/agentMessage/delta":
            sink.text(p.itemId, p.delta);
            break;
          case "item/started":
            if (item?.type === "mcpToolCall") sink.toolStart(item.id, item.server === MCP_NAME ? item.tool : `${item.server}/${item.tool}`, item.arguments);
            break;
          case "item/completed":
            if (item?.type === "agentMessage") sink.textDone(item.id, item.text);
            if (item?.type === "mcpToolCall") {
              const f = sink.toolDone(item.id, item.server === MCP_NAME ? item.tool : `${item.server}/${item.tool}`, toolResult(item), item.arguments);
              if (f?.code === EXIT.BUDGET && !budget) {
                budget = f.message; // the chat never asks before spending: a limit's refusal ends the turn
                interrupt();
              }
            }
            break;
          case "error":
            if (!p.willRetry) sink.notice(`Codex: ${redact(p.error?.message ?? "an error")}`);
            break;
          case "turn/completed": {
            const t = p.turn ?? {};
            if (budget) finish(resolve, { budget });
            else if (t.status === "failed") finish(reject, new ChatError(`Codex could not finish the reply: ${redact(t.error?.message ?? "no reason given")}`));
            else if (signal.aborted) finish(reject, new ChatError("Stopped."));
            else finish(resolve, {});
            break;
          }
        }
      }
      function onMessage(m) {
        const p = m.params ?? {};
        if (p.threadId !== threadId) return;
        if (!turnId) return void early.push(m);
        if (p.turnId && p.turnId !== turnId) return;
        handle(m);
      }

      listeners.add(onMessage);
      signal.addEventListener("abort", interrupt);
      child.once("exit", onExit);
      rpc.request("turn/start", { threadId, input: [{ type: "text", text: input, text_elements: [] }] }).then(
        (r) => {
          turnId = r.turn.id;
          for (const m of early.splice(0)) if (!m.params?.turnId || m.params.turnId === turnId) handle(m);
          if (signal.aborted) interrupt();
        },
        (err) => finish(reject, err),
      );
    });
  }

  return {
    name: "codex",
    status,
    async ready() {
      const s = await status();
      return s.loggedIn ? { ok: true } : { ok: false, message: s.message };
    },
    turn: ({ conn: _conn, ...rest }) => turn(rest),
    close: stopProcess,
  };
}
