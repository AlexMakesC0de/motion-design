import { KEY, tmp, req } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// A fake home, so nothing reads the real ~/.claude.json or ~/.codex.
const home = join(tmp, "mcphome");
process.env.KIE_MCP_HOME = home;
mkdirSync(join(home, ".codex"), { recursive: true });

const { createApp } = await import("../server/app.mjs");

let app, port;
before(async () => {
  app = createApp({ key: KEY, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());

describe("mcp api", () => {
  test("commands come from the real repo path; nothing registered in an empty home", async () => {
    const r = await req(port, "/api/mcp");
    assert.equal(r.status, 200, r.text);
    const j = r.json;
    assert.ok(j.server.args[0].endsWith(join("mcp", "server.mjs")));
    assert.match(j.claudeCode, /^claude mcp add --scope user motion-design -- /);
    assert.ok(j.claudeCode.includes(j.server.args[0]));
    assert.match(j.codexToml, /^\[mcp_servers\.motion-design\]\ncommand = ".*"\nargs = \[.*\]\ntool_timeout_sec = 300$/);
    assert.deepEqual(Object.keys(JSON.parse(j.claudeDesktopJson).mcpServers), ["motion-design"]);
    assert.match(j.install, /^node .*install\.mjs$/);
    assert.equal(j.cli, "kie --help");
    assert.deepEqual(j.registered, { claudeCode: false, codex: false });
  });

  test("registered reads the Codex marker and the Claude Code server entry", async () => {
    writeFileSync(join(home, ".codex", "config.toml"), "# >>> motion-design >>>\n[mcp_servers.motion-design]\n# <<< motion-design <<<\n");
    writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { "motion-design": { command: "node" } } }));
    assert.deepEqual((await req(port, "/api/mcp")).json.registered, { claudeCode: true, codex: true });
    writeFileSync(join(home, ".claude.json"), "{ not json");
    assert.deepEqual((await req(port, "/api/mcp")).json.registered, { claudeCode: false, codex: true });
  });
});
