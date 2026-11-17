// How to connect an agent host to the studio's MCP server, from the real repo
// path, and whether Claude Code and Codex already have it registered.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BEGIN, NAME, TOOL_TIMEOUT_SEC, serverCommand } from "../../../mcp/register.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const quote = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

function codexRegistered(home) {
  try {
    return readFileSync(join(home, ".codex", "config.toml"), "utf8").includes(BEGIN);
  } catch {
    return false;
  }
}

function claudeRegistered(home) {
  try {
    const file = join(home, ".claude.json");
    if (!existsSync(file)) return false;
    const servers = JSON.parse(readFileSync(file, "utf8"))?.mcpServers;
    return !!servers && typeof servers === "object" && NAME in servers;
  } catch {
    return false;
  }
}

export function mcpInfo(home = process.env.KIE_MCP_HOME || homedir()) {
  const server = serverCommand(ROOT);
  const parts = [server.command, ...server.args].map(quote).join(" ");
  return {
    server,
    claudeCode: `claude mcp add --scope user ${NAME} -- ${parts}`,
    codexToml: [`[mcp_servers.${NAME}]`, `command = ${JSON.stringify(server.command)}`, `args = ${JSON.stringify(server.args)}`, `tool_timeout_sec = ${TOOL_TIMEOUT_SEC}`].join("\n"),
    claudeDesktopJson: JSON.stringify({ mcpServers: { [NAME]: { command: server.command, args: server.args } } }, null, 2),
    install: `node ${quote(join(ROOT, "install.mjs"))}`,
    cli: "kie --help",
    registered: { claudeCode: claudeRegistered(home), codex: codexRegistered(home) },
  };
}

export function registerMcp(router) {
  router.get("/api/mcp", () => mcpInfo());
}
