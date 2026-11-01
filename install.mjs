#!/usr/bin/env node
// Install the skill into every agent host that can read it, plus put `kie` on
// PATH. Symlinks, not copies: editing the skill here must change what every
// agent sees, or the three hosts drift and you debug a stale copy.
//
//   node install.mjs            # install everywhere detected
//   node install.mjs --dry-run  # show what would happen
//   node install.mjs --uninstall
//   node install.mjs --no-mcp   # skip registering the MCP server

import { existsSync, mkdirSync, lstatSync, symlinkSync, unlinkSync, readlinkSync, chmodSync, appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { serverCommand, applyClaude, applyCodex, claudeConfigs } from "./mcp/register.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SKILL_SRC = join(ROOT, "skills", "motion-design");
const CLI_SRC = join(ROOT, "cli", "kie.mjs");

const argv = new Set(process.argv.slice(2));
const DRY = argv.has("--dry-run");
const UNINSTALL = argv.has("--uninstall");

const HOSTS = [
  { name: "Claude Code", dir: join(homedir(), ".claude", "skills"), needsParent: true },
  { name: "Codex", dir: join(homedir(), ".codex", "skills"), needsParent: true },
  { name: "Kimi", dir: join(homedir(), ".kimi", "skills"), needsParent: false },
];

const BIN_DIRS = [join(homedir(), ".local", "bin"), join(homedir(), "bin")];

let changed = 0;
const log = (s) => console.log(s);

function linkInto(dir, name, target, hostName) {
  const dest = join(dir, name);

  if (UNINSTALL) {
    if (existsSync(dest) && lstatSync(dest).isSymbolicLink()) {
      if (!DRY) unlinkSync(dest);
      changed += 1;
      log(`  removed  ${dest}`);
    }
    return;
  }

  if (existsSync(dest)) {
    const isLink = lstatSync(dest).isSymbolicLink();
    if (isLink && readlinkSync(dest) === target) {
      log(`  ok       ${hostName}: already linked`);
      return;
    }
    if (!isLink) {
      log(`  SKIP     ${dest} exists and is not a symlink — move it aside first.`);
      return;
    }
    if (!DRY) unlinkSync(dest);
  }

  if (!DRY) {
    mkdirSync(dir, { recursive: true });
    symlinkSync(target, dest);
  }
  changed += 1;
  log(`  linked   ${hostName}: ${dest}`);
}

log(`${UNINSTALL ? "Uninstalling" : "Installing"} motion-design${DRY ? " (dry run)" : ""}\n`);

log("skill");
let installedAny = false;
for (const host of HOSTS) {
  const parent = dirname(host.dir);
  // Only create a skills dir for a host that actually exists on this machine --
  // otherwise every install invents ~/.kimi for someone who does not use Kimi.
  if (host.needsParent && !existsSync(parent) && !UNINSTALL) {
    log(`  skip     ${host.name}: ${parent} not found (host not installed)`);
    continue;
  }
  if (!host.needsParent && !existsSync(parent) && !existsSync(host.dir) && !UNINSTALL) {
    log(`  skip     ${host.name}: ${parent} not found (host not installed)`);
    continue;
  }
  linkInto(host.dir, "motion-design", SKILL_SRC, host.name);
  installedAny = true;
}

log("\ncli");
if (!UNINSTALL && !DRY) chmodSync(CLI_SRC, 0o755);
const binDir = BIN_DIRS.find((d) => existsSync(d)) ?? BIN_DIRS[0];
if (!existsSync(binDir) && !UNINSTALL) {
  if (!DRY) mkdirSync(binDir, { recursive: true });
  log(`  created  ${binDir}`);
}
linkInto(binDir, "kie", CLI_SRC, "kie");

if (!UNINSTALL) {
  const onPath = (process.env.PATH ?? "").split(":").includes(binDir);
  if (!onPath) {
    log(`\n  ! ${binDir} is not on your PATH. Add this to ~/.zshrc:`);
    log(`      export PATH="${binDir}:$PATH"`);
  }

  const keyfile = join(homedir(), ".config", "kie", "key");
  const hasKey = process.env.KIE_API_KEY || existsSync(keyfile) || existsSync(join(ROOT, ".env"));
  if (!hasKey) {
    log(`\n  ! No kie.ai key found. Store it once, readable only by you:`);
    log(`      mkdir -p ~/.config/kie && printf '%s' 'YOUR_KEY' > ~/.config/kie/key && chmod 600 ~/.config/kie/key`);
    log(`    Get one at https://kie.ai/api-key. Never pass it as a CLI flag.`);
  }
}

// MCP server: Claude Code at user scope, Codex in a marked block of
// ~/.codex/config.toml. Only our own entries are ever added, changed or removed.
if (!argv.has("--no-mcp")) {
  log("\nmcp server");
  const want = serverCommand(ROOT);
  if (!UNINSTALL && !existsSync(join(ROOT, "mcp", "node_modules", "@modelcontextprotocol", "sdk"))) {
    if (DRY) {
      log("  would run npm install in mcp/");
    } else {
      const r = spawnSync("npm", ["install", "--prefix", join(ROOT, "mcp")], { stdio: "inherit" });
      log(r.status === 0 ? "  installed mcp/ dependencies" : "  FAIL     npm install in mcp/; run it by hand: npm --prefix mcp install");
    }
  }

  const say = {
    add: DRY ? "would add" : "added",
    update: DRY ? "would update (node path changed)" : "updated (node path changed)",
    remove: DRY ? "would remove" : "removed",
    none: "ok, nothing to change",
    conflict: "SKIP: a motion-design entry exists that is not ours; left alone",
    conflictCodex: "SKIP: our marked block in config.toml contains other settings; move them outside the markers, then run again",
    skip: "skip",
    failed: "FAIL: the claude CLI returned an error",
  };
  // Each Claude profile keeps its own user-scope servers, so register in every one.
  for (const configDir of claudeConfigs()) {
    const c = applyClaude(want, { uninstall: UNINSTALL, dryRun: DRY, configDir });
    if (["add", "update", "remove"].includes(c.action)) changed += 1;
    log(`  Claude Code${configDir ? ` (${basename(configDir)})` : ""}: ${say[c.action]}${c.reason ? ` (${c.reason})` : ""}`);
  }

  const codexDir = join(homedir(), ".codex");
  if (existsSync(codexDir)) {
    const x = applyCodex(join(codexDir, "config.toml"), want, { uninstall: UNINSTALL, dryRun: DRY });
    if (["add", "update", "remove"].includes(x.action)) changed += 1;
    log(`  Codex:       ${say[x.action === "conflict" ? "conflictCodex" : x.action]}${x.backup ? ` (backup ${x.backup})` : ""}`);
  } else {
    log("  Codex:       skip (~/.codex not found)");
  }
}

log(
  `\n${changed} change(s)${DRY ? " (dry run — nothing written)" : ""}.` +
    (UNINSTALL || DRY ? "" : `\nNext: kie doctor`),
);

if (!installedAny && !UNINSTALL) {
  log(`\nNo agent hosts detected. The CLI still works standalone.`);
}
