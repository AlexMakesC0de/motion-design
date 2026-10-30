import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NAME, planCodex, applyCodex, claudeEntry, planClaude, applyClaude } from "../mcp/register.mjs";

const want = { command: "/usr/local/bin/node", args: ["/repo/mcp/server.mjs"] };
const UNRELATED = `model = "gpt-5.5"

[mcp_servers.context7]
url = "https://mcp.context7.com/mcp"

[mcp_servers.markitdown]
command = "uvx"
args = ["markitdown-mcp"]
`;

describe("Codex config.toml", () => {
  test("install twice gives an identical file", () => {
    const once = planCodex(UNRELATED, want);
    assert.equal(once.action, "add");
    const twice = planCodex(once.text, want);
    assert.equal(twice.action, "none");
    assert.equal(twice.text, once.text);
    assert.match(once.text, /\[mcp_servers\.motion-design\]\ncommand = "\/usr\/local\/bin\/node"\nargs = \["\/repo\/mcp\/server\.mjs"\]\ntool_timeout_sec = 300\n/);
  });

  test("uninstall restores the original byte for byte", () => {
    const installed = planCodex(UNRELATED, want).text;
    const removed = planCodex(installed, want, { uninstall: true });
    assert.equal(removed.action, "remove");
    assert.equal(removed.text, UNRELATED);
  });

  test("a motion-design table someone else wrote is reported and left alone", () => {
    const theirs = `${UNRELATED}\n[mcp_servers.motion-design]\ncommand = "other"\n`;
    const plan = planCodex(theirs, want);
    assert.equal(plan.action, "conflict");
    assert.equal(plan.text, theirs);
  });

  test("a changed node path updates only our block", () => {
    const installed = planCodex(UNRELATED, want).text;
    const plan = planCodex(installed, { ...want, command: "/opt/node/bin/node" });
    assert.equal(plan.action, "update");
    assert.ok(plan.text.startsWith(UNRELATED));
    assert.match(plan.text, /\/opt\/node\/bin\/node/);
  });

  test("anything else inside our markers is a conflict for install and uninstall, text untouched", () => {
    const installed = planCodex(UNRELATED, want).text;
    // toml_edit can put a new table between our last line and the trailing END comment.
    const withForeign = installed.replace("# <<<", '[projects."/x"]\ntrust_level = "trusted"\n# <<<');
    assert.notEqual(withForeign, installed);
    for (const uninstall of [false, true]) {
      const plan = planCodex(withForeign, want, { uninstall });
      assert.equal(plan.action, "conflict");
      assert.equal(plan.text, withForeign);
    }
  });

  test("a block from before tool_timeout_sec existed is still ours and gets updated", () => {
    const legacy = `${UNRELATED}\n# >>> motion-design >>>\n[mcp_servers.motion-design]\ncommand = "/usr/local/bin/node"\nargs = ["/repo/mcp/server.mjs"]\n# <<< motion-design <<<\n`;
    const plan = planCodex(legacy, want);
    assert.equal(plan.action, "update");
    assert.match(plan.text, /tool_timeout_sec = 300/);
    assert.equal(planCodex(legacy, want, { uninstall: true }).text, UNRELATED);
  });

  test("applyCodex backs the file up before writing, and a dry run writes nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "kie-codex-"));
    const path = join(dir, "config.toml");
    writeFileSync(path, UNRELATED);
    assert.equal(applyCodex(path, want, { dryRun: true }).action, "add");
    assert.equal(readFileSync(path, "utf8"), UNRELATED);
    const r = applyCodex(path, want);
    assert.equal(r.action, "add");
    assert.equal(readFileSync(r.backup, "utf8"), UNRELATED);
    assert.equal(readdirSync(dir).length, 2);
  });
});

describe("Claude Code", () => {
  const out = (cmd, args, scope = "User config (available in all your projects)") => `${NAME}:\n  Scope: ${scope}\n  Type: stdio\n  Command: ${cmd}\n  Args: ${args}\n`;
  const runner = (stdout, status = 0) => {
    const log = [];
    const run = (args) => {
      log.push(args);
      return args[1] === "get" ? { status, stdout } : { status: 0, stdout: "" };
    };
    return { run, log };
  };

  test("claudeEntry reads command and args, and absence", () => {
    assert.deepEqual(claudeEntry(runner(out("/usr/local/bin/node", "/repo/mcp/server.mjs")).run), {
      state: "present",
      scope: "User config (available in all your projects)",
      command: "/usr/local/bin/node",
      args: "/repo/mcp/server.mjs",
    });
    assert.equal(claudeEntry(runner(out("n", "a", "Local config (private to you in this project)")).run).scope, "Local config (private to you in this project)");
    assert.equal(claudeEntry(runner("", 1).run).state, "absent");
    assert.equal(claudeEntry(() => ({ missing: true })).state, "no-cli");
  });

  test("planClaude: add, leave, update, conflict, skip", () => {
    const ours = { state: "present", scope: "User config (available in all your projects)", command: want.command, args: want.args.join(" ") };
    assert.equal(planClaude({ state: "absent" }, want).action, "add");
    assert.equal(planClaude(ours, want).action, "none");
    assert.equal(planClaude({ ...ours, command: "/old/node" }, want).action, "update");
    assert.equal(planClaude({ ...ours, command: "npx", args: "someone-else" }, want).action, "conflict");
    assert.equal(planClaude({ state: "no-cli" }, want).action, "skip");
    assert.equal(planClaude({ ...ours, command: "npx", args: "someone-else" }, want, { uninstall: true }).action, "none");
  });

  test("a same-named entry at another scope is never ours: conflict to install, none to uninstall", () => {
    const local = {
      state: "present",
      scope: "Local config (private to you in this project)",
      command: want.command,
      args: want.args.join(" "),
    };
    assert.equal(planClaude(local, want).action, "conflict");
    assert.equal(planClaude(local, want, { uninstall: true }).action, "none");
    assert.equal(planClaude({ ...local, scope: "Project config (shared via .mcp.json)" }, want).action, "conflict");
    assert.equal(planClaude({ ...local, scope: null }, want).action, "conflict");
    const r = runner(out(want.command, want.args.join(" "), "Local config (private to you in this project)"));
    applyClaude(want, { uninstall: true, run: r.run });
    assert.ok(!r.log.some((a) => a[1] === "remove"), "never removes an entry at another scope");
  });

  test("applyClaude adds at user scope with our exact command, and removes only ours", () => {
    const fresh = runner("", 1);
    applyClaude(want, { run: fresh.run });
    assert.deepEqual(fresh.log.at(-1), ["mcp", "add", "--scope", "user", NAME, "--", want.command, ...want.args]);
    const ours = runner(out(want.command, want.args.join(" ")));
    applyClaude(want, { uninstall: true, run: ours.run });
    assert.deepEqual(ours.log.at(-1), ["mcp", "remove", NAME, "-s", "user"]);
  });
});
