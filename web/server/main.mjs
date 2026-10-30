#!/usr/bin/env node
// npm run studio: build the page if its sources changed, start the server on
// 127.0.0.1 (4317 or the next free port), open the browser. The session key
// is made here, kept in memory and never printed.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createApp, WEB_DIR } from "./app.mjs";

const newest = (dir) => {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
  }
  return t;
};

export function needsBuild(webDir = WEB_DIR) {
  const built = join(webDir, "dist", "index.html");
  if (!existsSync(built)) return true;
  const sources = [join(webDir, "index.html"), join(webDir, "vite.config.ts")].filter(existsSync).map((p) => statSync(p).mtimeMs);
  return Math.max(newest(join(webDir, "src")), ...sources) > statSync(built).mtimeMs;
}

export function listenOnFreePort(server, first = 4317, tries = 20) {
  return new Promise((resolve, reject) => {
    let port = first;
    const attempt = () => {
      server.once("error", (err) => {
        if (err.code === "EADDRINUSE" && port < first + tries) {
          port += 1;
          attempt();
        } else reject(err);
      });
      server.listen(port, "127.0.0.1", () => resolve(server.address().port));
    };
    attempt();
  });
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(cmd, [url], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (!existsSync(join(WEB_DIR, "node_modules"))) {
    process.stderr.write("The studio's page dependencies are missing. Run: npm --prefix web install\n");
    process.exit(1);
  }
  if (needsBuild()) {
    process.stderr.write("Building the studio page…\n");
    const b = spawnSync("npm", ["--prefix", WEB_DIR, "run", "build"], { stdio: "inherit" });
    if (b.status !== 0) process.exit(b.status ?? 1);
  }
  const key = randomBytes(24).toString("base64url");
  const app = createApp({ key });
  const port = await listenOnFreePort(app, Number(process.env.STUDIO_PORT) || 4317);
  const url = `http://127.0.0.1:${port}/`;
  process.stdout.write(`Studio running at ${url}  (Ctrl-C to stop)\n`);
  if (!args.has("--no-open")) openBrowser(url);
  const stop = () => app.closeAll().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
