// Register the MCP server with Claude Code and Codex, touching only our own
// entry: the Claude Code server whose args are our server.mjs, and the Codex
// block between our markers. Zero dependencies, so install.mjs can import it
// before mcp/node_modules exists.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

export const NAME = "motion-design";
export const BEGIN = `# >>> ${NAME} >>>`;
export const END = `# <<< ${NAME} <<<`;
// The optional leading newline is the blank line we add before the block, so
// removing it restores the file exactly.
const BLOCK = new RegExp(`\\n?${BEGIN}\\n[\\s\\S]*?${END}\\n`);
const FOREIGN = new RegExp(`^\\s*\\[mcp_servers\\.(?:${NAME}|"${NAME}")\\]\\s*$`, "m");

/** The command hosts run: this node (absolute, so a GUI-launched host without our PATH still finds it). */
export function serverCommand(root, node = process.execPath) {
  return { command: node, args: [join(root, "mcp", "server.mjs")] };
}

export function codexBlock(want) {
  return [BEGIN, `[mcp_servers.${NAME}]`, `command = ${JSON.stringify(want.command)}`, `args = ${JSON.stringify(want.args)}`, END, ""].join("\n");
}

/** What to do to config.toml's text. Nothing outside our markers ever changes. */
export function planCodex(text, want, { uninstall = false } = {}) {
  const has = BLOCK.test(text);
  if (uninstall) return has ? { action: "remove", text: text.replace(BLOCK, "") } : { action: "none", text };
  if (FOREIGN.test(text.replace(BLOCK, ""))) return { action: "conflict", text };
  if (has) {
    const next = text.replace(BLOCK, (m) => (m.startsWith("\n") ? "\n" : "") + codexBlock(want));
    return next === text ? { action: "none", text } : { action: "update", text: next };
  }
  const base = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  return { action: "add", text: `${base}${base ? "\n" : ""}${codexBlock(want)}` };
}

export function applyCodex(path, want, { uninstall = false, dryRun = false, now = new Date() } = {}) {
  const exists = existsSync(path);
  if (!exists && uninstall) return { action: "none" };
  const plan = planCodex(exists ? readFileSync(path, "utf8") : "", want, { uninstall });
  if (dryRun || !["add", "update", "remove"].includes(plan.action)) return { action: plan.action };
  let backup = null;
  if (exists) {
    backup = `${path}.bak-${now.toISOString().replace(/[:.]/g, "-")}`;
    copyFileSync(path, backup);
  }
  writeFileSync(path, plan.text);
  return { action: plan.action, backup };
}

export function runClaude(args) {
  const r = spawnSync("claude", args, { encoding: "utf8" });
  if (r.error?.code === "ENOENT") return { missing: true };
  return { status: r.status, stdout: r.stdout ?? "" };
}

/**
 * Our entry as Claude Code reports it. The output is parsed, never printed:
 * `claude mcp get` shows headers and env values, which can be secrets.
 */
export function claudeEntry(run = runClaude) {
  const r = run(["mcp", "get", NAME]);
  if (r.missing) return { state: "no-cli" };
  if (r.status !== 0) return { state: "absent" };
  const field = (label) => r.stdout.match(new RegExp(`^\\s*${label}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? null;
  return { state: "present", command: field("Command"), args: field("Args") };
}

export function planClaude(entry, want, { uninstall = false } = {}) {
  if (entry.state === "no-cli") return { action: "skip", reason: "the claude CLI is not on PATH" };
  const ours = entry.state === "present" && entry.args === want.args.join(" ");
  if (uninstall) return ours ? { action: "remove" } : { action: "none" };
  if (entry.state === "absent") return { action: "add" };
  if (!ours) return { action: "conflict" };
  return entry.command === want.command ? { action: "none" } : { action: "update" };
}

export function applyClaude(want, { uninstall = false, dryRun = false, run = runClaude } = {}) {
  const plan = planClaude(claudeEntry(run), want, { uninstall });
  if (dryRun) return plan;
  const remove = () => run(["mcp", "remove", NAME, "-s", "user"]);
  const add = () => run(["mcp", "add", "--scope", "user", NAME, "--", want.command, ...want.args]);
  let status = 0;
  if (plan.action === "remove") status = remove().status;
  if (plan.action === "update") status = remove().status || add().status;
  if (plan.action === "add") status = add().status;
  return status ? { ...plan, action: "failed" } : plan;
}
