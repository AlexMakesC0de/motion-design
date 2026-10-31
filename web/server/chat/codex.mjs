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
// apps, computer and browser use, image generation and viewing, code mode,
// sub-agents), keep a thread working on its own (goals) or run the user's
// programs (hooks, notify). Before the first turn on a Codex process, the
// same flags go through `codex features list`: every feature still on must be
// on ALLOWED_FEATURES, and Codex must be the version the protocol types were
// generated from. Codex gets the studio's environment without OPENAI_API_KEY. Any approval
// request that still arrives (a command, a file change, more permissions) is
// declined. Before a turn, every other server must report disabled, failed or
// cancelled; during one, a call to any other server interrupts it.
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
import { ChatError, MAX_STEPS, appendChat, historyMessages } from "./transcript.mjs";

export { MCP_NAME };

/**
 * Codex features turned off at spawn: anything that gives the chat tools
 * besides the motion-design MCP server, runs code or the user's programs,
 * keeps a thread going after the studio's turn (goals), spawns agents, asks
 * the user through Codex's own UI, or is not needed by the chat. Names from
 * `codex features list` in codex-cli 0.154.0, which refuses unknown names.
 */
export const DISABLED_FEATURES = [
  "plugins",
  "apps",
  "computer_use",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "image_generation",
  "multi_agent",
  "multi_agent_v2",
  "skill_mcp_dependency_install",
  "skill_search",
  "tool_suggest",
  "memories",
  "shell_tool",
  "shell_snapshot",
  "unified_exec",
  "unified_exec_tty",
  "in_app_browser",
  "in_app_chat",
  "in_app_local_automation",
  "in_app_dictation",
  "in_app_updates",
  "view_image",
  "code_mode_host",
  "goals",
  "hooks",
  "workspace_dependencies",
  "remote_plugin",
  "plugin_sharing",
  "sleep_tool",
  "guardian_approval",
  "tool_call_mcp_elicitation",
  "auth_elicitation",
  "mentions_v2",
  "fast_mode",
  "personality",
];

/**
 * The features that may still be on after DISABLED_FEATURES, each checked in
 * codex-cli 0.154.0 with the studio's flags. Any other feature on refuses the
 * turn: a new Codex feature is off-limits until someone reads what it does.
 */
export const ALLOWED_FEATURES = {
  compaction_image_budget: "caps images kept when a long thread is compacted; context bookkeeping only",
  content_item_kinds: "the shapes of content items in the protocol; no tool, no action",
  enable_request_compression: "compresses requests to OpenAI; transport only",
  remote_compaction_v2: "OpenAI compacts a long thread's context; needed for long film chats",
  unbounded_connection_retries: "retries a dropped connection to OpenAI; Stop still interrupts the turn",
  unified_exec:
    "stays on in 0.154 whatever --disable says; it is the engine behind the shell tool, which shell_tool=false removes, and the sandbox is read-only with every command approval declined",
  // Removed: Codex no longer reads these flags, so on or off changes nothing.
  collaboration_modes: "removed in Codex: the flag does nothing",
  item_ids: "removed in Codex: the flag does nothing",
  resize_all_images: "removed in Codex: the flag does nothing",
  sqlite: "removed in Codex: the flag does nothing",
  steer: "removed in Codex: the flag does nothing",
  terminal_resize_reflow: "removed in Codex: the flag does nothing",
  tool_search_always_defer_mcp_tools: "removed in Codex: the flag does nothing",
  tui_app_server: "removed in Codex: the flag does nothing",
  unified_exec_zsh_fork: "removed in Codex: the flag does nothing",
};

const PROTOCOL = JSON.parse(readFileSync(new URL("./codex-protocol/methods.json", import.meta.url), "utf8"));
/** The Codex major.minor the protocol types (and the feature allowlist) were taken from. */
export const PROTOCOL_VERSION = String(PROTOCOL.generatedBy).match(/(\d+\.\d+)\.\d+/)?.[1] ?? null;
/** Other major.minor versions checked against this protocol and allowlist. */
export const ALLOWED_CODEX_VERSIONS = [];

/** `codex features list` as [{ name, stage, enabled }]: one feature a line, "name  stage words  true|false". */
export function parseFeatures(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_.-]+)\s+(\S.*?)\s+(true|false)\s*$/);
    if (m) out.push({ name: m[1], stage: m[2], enabled: m[3] === "true" });
  }
  return out;
}

/** The names of the features on, when every one is allow-listed; otherwise a ChatError naming the rest. */
export function checkFeatures(text) {
  const features = parseFeatures(text);
  if (!features.length) throw new ChatError("Codex did not list its features, so the turn was not started. Check that codex runs in a terminal, or use an OpenAI API key.");
  const on = features.filter((f) => f.enabled).map((f) => f.name);
  const unknown = on.filter((name) => !Object.hasOwn(ALLOWED_FEATURES, name));
  if (unknown.length) {
    throw new ChatError(
      `Codex has features on that the studio's chat has not checked (${unknown.join(", ")}), so the turn was not started. ` +
        "Turn them off in ~/.codex/config.toml, use the Codex version the studio was checked with, or use an OpenAI API key.",
    );
  }
  return on;
}

/** The Codex version from initialize's userAgent ("<client>/0.154.0 (...)"), when it is one the studio was checked against. */
export function checkVersion(userAgent) {
  const m = typeof userAgent === "string" ? userAgent.match(/^[^/\s]+\/(\d+)\.(\d+)\.(\d+)/) : null;
  if (!m) throw new ChatError("Codex did not say which version it is, so the turn was not started. Update Codex, or use an OpenAI API key.");
  const version = `${m[1]}.${m[2]}.${m[3]}`;
  const minor = `${m[1]}.${m[2]}`;
  if (minor !== PROTOCOL_VERSION && !ALLOWED_CODEX_VERSIONS.includes(minor)) {
    throw new ChatError(
      `Codex ${version} is not the version the studio's chat was checked with (${PROTOCOL_VERSION}.x), so the turn was not started. ` +
        `Install that one with npm install -g @openai/codex@${PROTOCOL_VERSION}, or update the studio for this Codex ` +
        "(npm --prefix web run codex-protocol, then re-check its feature allowlist), or use an OpenAI API key.",
    );
  }
  return version;
}

export const NOT_INSTALLED = "Codex isn't installed. Install it with npm install -g @openai/codex, or use an OpenAI API key.";
export const NOT_LOGGED_IN = "Codex isn't logged in. Run codex login in a terminal, then check again, or use an OpenAI API key.";

export const codexConfigPath = () => join(process.env.CODEX_HOME || join(homedir(), ".codex"), "config.toml");

/**
 * A TOML key at `s[i]`: dotted segments, each bare, "basic" or 'literal',
 * with spaces around the dots. Returns { path, end } or null.
 */
function readKey(s, i) {
  const path = [];
  for (;;) {
    while (s[i] === " " || s[i] === "\t") i++;
    let m;
    if (s[i] === '"') {
      m = s.slice(i).match(/^"((?:[^"\\]|\\.)*)"/);
      if (!m) return null;
      try {
        path.push(JSON.parse(m[0]));
      } catch {
        path.push(m[1]);
      }
    } else if (s[i] === "'") {
      m = s.slice(i).match(/^'([^']*)'/);
      if (!m) return null;
      path.push(m[1]);
    } else {
      m = s.slice(i).match(/^[A-Za-z0-9_-]+/);
      if (!m) return null;
      path.push(m[0]);
    }
    i += m[0].length;
    while (s[i] === " " || s[i] === "\t") i++;
    if (s[i] !== ".") return { path, end: i };
    i++;
  }
}

/** The first-level key names of the inline table that starts at `s[i]` ("{"). */
function inlineKeys(s, i) {
  const names = [];
  let depth = 0;
  let expectKey = false;
  for (; i < s.length; i++) {
    const c = s[i];
    if (expectKey && depth === 1 && !/\s/.test(c)) {
      expectKey = false;
      const k = readKey(s, i);
      if (k) {
        names.push(k.path[0]);
        i = k.end - 1;
        continue;
      }
    }
    if (c === '"' || c === "'") {
      const close = c === '"' ? /^"(?:[^"\\]|\\.)*"/ : /^'[^']*'/;
      const m = s.slice(i).match(close);
      if (m) i += m[0].length - 1;
    } else if (c === "{" || c === "[") {
      depth++;
      if (depth === 1) expectKey = true;
    } else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) break;
    } else if (c === "," && depth === 1) expectKey = true;
  }
  return names;
}

/**
 * The MCP servers config.toml names, ours left out, in every layout TOML
 * allows: [mcp_servers.<name>] headers (bare, "basic" or 'literal' names),
 * [mcp_servers] followed by dotted keys or inline tables, dotted keys before
 * any header, and mcp_servers = { ... }. Lines inside multi-line strings are
 * skipped. Not a full TOML parser: a server still missed is caught during a
 * turn, when its first tool call interrupts it.
 */
export function configuredMcpServers(text) {
  const names = new Set();
  let table = [];
  let inString = null; // the closing """ or ''' of a multi-line string
  for (const raw of text.split(/\r?\n/)) {
    if (inString) {
      if (raw.includes(inString)) inString = null;
      continue;
    }
    const line = raw.trimStart();
    if (line.startsWith("[")) {
      const k = readKey(line, line.startsWith("[[") ? 2 : 1);
      table = k ? k.path : [];
      if (table[0] === "mcp_servers" && table.length > 1) names.add(table[1]);
      continue;
    }
    const k = readKey(line, 0);
    if (!k || line[k.end] !== "=") continue;
    const path = [...table, ...k.path];
    const value = line.slice(k.end + 1).trimStart();
    if (path[0] === "mcp_servers") {
      if (path.length > 1) names.add(path[1]);
      else if (value.startsWith("{")) for (const n of inlineKeys(value, 0)) names.add(n);
    }
    const quote = value.match(/^("""|''')/)?.[1];
    if (quote && !value.slice(3).includes(quote)) inString = quote;
  }
  names.delete(MCP_NAME);
  return [...names];
}

const PLANS = { prolite: "Pro Lite", ent26: "Enterprise", unknown: null };

/** A ChatGPT plan as ChatGPT writes it: "plus" is Plus, "edu_pro" is Edu Pro; business and enterprise variants are Business and Enterprise. */
export function planName(type) {
  if (typeof type !== "string" || !type) return null;
  if (type in PLANS) return PLANS[type];
  if (/^self_serve_business_/.test(type)) return "Business";
  if (/^enterprise_/.test(type)) return "Enterprise";
  return type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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
    "-c", "notify=[]",
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

/** Other servers' states that bring no tools into a thread (McpServerConnectionStatus). */
const QUIET = new Set(["disabled", "failed", "cancelled"]);

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

/** How long Codex has to answer one request. A turn's own length is not limited; only each reply is. */
export const REQUEST_TIMEOUT_MS = 30_000;
/** How long Codex has to end a turn after turn/interrupt before the studio stops waiting and restarts it. */
export const INTERRUPT_GRACE_MS = 10_000;

/** JSON-RPC over the child's stdio. A request with no reply in `timeoutMs` fails, and `onTimeout` hears of it. */
function openRpc(child, { onNotification, timeoutMs, onTimeout = () => {} }) {
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
      clearTimeout(p.timer);
      if (m.error) p.reject(Object.assign(new Error(m.error.message ?? "Codex error"), { rpc: m.error }));
      else p.resolve(m.result);
    } else if (m.method) {
      onNotification(m);
    }
  });
  child.on("exit", () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new ChatError("Codex stopped."));
    }
    pending.clear();
  });
  return {
    request(method, params) {
      const id = next++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new ChatError(`Codex did not answer ${method} within ${Math.round(timeoutMs / 1000)}s.`));
          onTimeout(method);
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
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
 * arguments when the process starts. `requestTimeoutMs` and
 * `interruptGraceMs` are shortened by tests.
 */
export function createCodex({
  command = process.env.KIE_CODEX_COMMAND || "codex",
  prefixArgs = [],
  args,
  repo = REPO_ROOT,
  keyEnvs = [],
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  interruptGraceMs = INTERRUPT_GRACE_MS,
} = {}) {
  const build =
    args ??
    (() => {
      const file = codexConfigPath();
      const configText = existsSync(file) ? readFileSync(file, "utf8") : "";
      return codexArgs({ repo, keyEnvs, configText });
    });
  const listeners = new Set();
  let proc = null;
  let running = 0; // turns in progress on the shared app-server
  let stopWhenIdle = false; // a check found no login while turns ran: stop Codex once they end

  /** Stop Codex now, or once the running turns end. */
  function stopSoon() {
    if (running) stopWhenIdle = true;
    else stopProcess();
  }

  /** Start Codex, or reuse the running one. Resolves the process record once it has answered initialize. */
  function start() {
    if (proc) return proc.ready;
    // Codex logs in with ChatGPT; an OpenAI key in the studio's environment is not its to see.
    const { OPENAI_API_KEY: _openaiKey, ...env } = process.env;
    const args = build();
    const child = spawn(command, [...prefixArgs, ...args], { cwd: repo, env, stdio: ["pipe", "pipe", "pipe"] });
    child.stderr.resume(); // Codex logs there; not ours to keep
    child.stdin.on("error", () => {}); // a write after exit; the exit handler reports it
    const rpc = openRpc(child, {
      onNotification: (m) => listeners.forEach((fn) => fn(m)),
      timeoutMs: requestTimeoutMs,
      onTimeout: () => {
        if (proc === p) stopSoon(); // a stuck app-server: the next try starts a new one
      },
    });
    const p = { child, rpc, args, env, userAgent: null, vetted: null };
    p.ready = new Promise((resolve, reject) => {
      child.on("error", (err) => reject(err.code === "ENOENT" ? new ChatError(NOT_INSTALLED, { connect: true }) : err));
      child.once("spawn", resolve);
    })
      .then(() => rpc.request("initialize", { clientInfo: { name: "motion_design_studio", title: "Motion-design studio", version: "0.1.0" }, capabilities: null }))
      .then((init) => {
        p.userAgent = init?.userAgent ?? null;
        rpc.notify("initialized");
        return p;
      });
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

  /** `codex features list` run with the app-server's own flags: its output, or a ChatError. */
  function listFeatures(p) {
    const flags = p.args[0] === "app-server" ? p.args.slice(1) : p.args;
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...prefixArgs, "features", "list", ...flags], { cwd: repo, env: p.env, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.setEncoding("utf8").on("data", (d) => (out += d));
      child.stderr.resume();
      const timer = setTimeout(() => child.kill(), requestTimeoutMs);
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err.code === "ENOENT" ? new ChatError(NOT_INSTALLED, { connect: true }) : err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out);
        else reject(new ChatError(`Codex did not list its features (codex features list ended with ${code ?? "a timeout"}), so the turn was not started. Check that codex runs in a terminal, or use an OpenAI API key.`));
      });
    });
  }

  /**
   * Before the first turn on a Codex process: its version must be the
   * protocol's, and every feature on must be allow-listed. Checked once per
   * process; a process that fails is stopped, so the next turn starts a new
   * one (and checks again) after the user changes something.
   */
  function vet(p) {
    p.vetted ??= (async () => {
      checkVersion(p.userAgent);
      checkFeatures(await listFeatures(p));
    })();
    p.vetted.catch(() => {
      if (proc === p) stopSoon();
    });
    return p.vetted;
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
        stopSoon(); // after codex login, the next check starts a Codex that sees the new login
        return { installed: true, loggedIn: false, plan: null, message: NOT_LOGGED_IN };
      }
      const name = a.type === "chatgpt" ? planName(a.planType) : null;
      const plan = a.type === "chatgpt" ? (name ? `ChatGPT ${name}` : "ChatGPT") : a.type === "apiKey" ? "an OpenAI API key" : a.type;
      return { installed: true, loggedIn: true, plan, message: null };
    } catch (err) {
      if (err.message === NOT_INSTALLED) return { installed: false, loggedIn: false, plan: null, message: NOT_INSTALLED };
      return { installed: true, loggedIn: false, plan: null, message: `Codex did not answer: ${redact(err.message)}` };
    }
  }

  /**
   * Refuse to run a turn when Codex has another MCP server that may be live
   * in the thread anyway (a plugin's, say). McpServerConnectionStatus has a
   * "disabled" value of its own, so a server turned off by enabled=false is
   * told apart from one not started yet: only disabled, failed and cancelled
   * servers are let through, and every page of the list is read.
   */
  async function guard(threadId) {
    const others = [];
    let cursor = null;
    for (let page = 0; page < 100; page++) {
      const r = await proc.rpc.request("mcpServerStatus/list", { threadId, detail: "toolsAndAuthOnly", ...(cursor ? { cursor } : {}) }).catch(() => null);
      if (!Array.isArray(r?.data)) {
        throw new ChatError("Codex did not say which tools are on for this chat, so the turn was not started. Try again, or use an OpenAI API key.");
      }
      others.push(...r.data.filter((s) => s.name !== MCP_NAME && !QUIET.has(s.runtimeStatus)).map((s) => s.name));
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    if (cursor) throw new ChatError("Codex listed too many MCP servers to check, so the turn was not started. Use an OpenAI API key.");
    if (others.length) {
      throw new ChatError(
        `Codex has other MCP servers on for this chat (${others.join(", ")}). The studio's chat runs only with the motion-design tools: turn those off in ~/.codex/config.toml, or use an OpenAI API key.`,
      );
    }
  }

  async function turn(opts) {
    running++;
    try {
      return await runTurn(opts);
    } finally {
      running--;
      if (!running && stopWhenIdle) {
        stopWhenIdle = false;
        stopProcess();
      }
    }
  }

  async function runTurn({ film, text, saved, instructions, sink, signal }) {
    const p = await start();
    await vet(p);
    const { rpc, child } = p;
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
      let settled = false;
      let budget = null; // a limit refused a job
      let foreign = null; // Codex called another MCP server
      let steps = 0;
      let grace = null;
      const early = [];
      const name = (item) => (item.server === MCP_NAME ? item.tool : `${item.server}/${item.tool}`);

      // After turn/interrupt, Codex has a grace period to send turn/completed; then the studio stops waiting.
      const interrupt = () => {
        if (!turnId) return;
        rpc.request("turn/interrupt", { threadId, turnId }).catch(() => {});
        grace ??= setTimeout(() => {
          end();
          if (proc?.child === child) stopProcess(); // a Codex that ignores an interrupt is not trusted with the next turn
        }, interruptGraceMs);
      };
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(grace);
        listeners.delete(onMessage);
        signal.removeEventListener("abort", interrupt);
        child.off("exit", onExit);
        fn(value);
      };
      /** How the turn ended, from what stopped it. `status` is turn/completed's, if it came. */
      const end = (t = {}) => {
        if (budget) finish(resolve, { budget });
        else if (foreign) finish(reject, new ChatError(`Codex tried to use another MCP server (${foreign}), so the turn was stopped. The studio's chat runs only with the motion-design tools: turn that server off in ~/.codex/config.toml, or use an OpenAI API key.`));
        else if (signal.aborted) finish(reject, new ChatError("Stopped."));
        else if (steps >= MAX_STEPS) finish(reject, new ChatError(`Stopped after ${MAX_STEPS} tool steps without a final answer. Ask again with a narrower request.`));
        else if (t.status === "failed") finish(reject, new ChatError(`Codex could not finish the reply: ${redact(t.error?.message ?? "no reason given")}`));
        else finish(resolve, {});
      };
      const onExit = () => finish(reject, signal.aborted ? new ChatError("Stopped.") : new ChatError("Codex stopped in the middle of the reply. Send the message again."));

      function handle(m) {
        const p = m.params ?? {};
        const item = p.item;
        switch (m.method) {
          case "item/agentMessage/delta":
            sink.text(p.itemId, p.delta);
            break;
          case "item/started":
            if (item?.type === "mcpToolCall") {
              sink.toolStart(item.id, name(item), item.arguments);
              if (item.server !== MCP_NAME && !foreign) {
                foreign = String(item.server); // the backstop for a server the start-up checks missed
                interrupt();
              }
            }
            break;
          case "item/completed":
            if (item?.type === "agentMessage") sink.textDone(item.id, item.text);
            if (item?.type === "mcpToolCall") {
              const f = sink.toolDone(item.id, name(item), toolResult(item), item.arguments);
              if (f?.code === EXIT.BUDGET && !budget) {
                budget = f.message; // the chat never asks before spending: a limit's refusal ends the turn
                interrupt();
              } else if (++steps === MAX_STEPS) interrupt();
            }
            break;
          case "error":
            if (!p.willRetry) sink.notice(`Codex: ${redact(p.error?.message ?? "an error")}`);
            break;
          case "turn/completed":
            if (p.turn?.id === turnId) end(p.turn);
            break;
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
