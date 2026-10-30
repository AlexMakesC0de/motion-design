// Wires the studio together: router + API modules + media + events + page.
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter, createHandler } from "./http.mjs";
import { serveMedia } from "./media.mjs";
import { createEvents, takeSnapshot } from "./events.mjs";
import { createFollower } from "./follow.mjs";
import { registerLook } from "./api/look.mjs";
import { registerGenerate } from "./api/generate.mjs";
import { registerFrames } from "./api/frames.mjs";
import { registerLibrary } from "./api/library.mjs";
import { registerPresets } from "./api/presets.mjs";
import { loadCatalog } from "../../cli/lib/models.mjs";

export const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * An http.Server for the studio. `deps` replaces anything that reaches a
 * provider, in the MCP server's shape: `generate` (preflight, createTask,
 * waitForTask, download, creditsAfter), `upload` and `credits`. Tests pass
 * stubs. `closeAll()` also stops the event watchers. `resume` follows again
 * the studio jobs a previous run of the server left unsettled (main.mjs).
 */
export function createApp({ key, deps = {}, catalog = loadCatalog(), distDir = join(WEB_DIR, "dist"), pollMs, resume = false } = {}) {
  const router = createRouter();
  let events = null;
  const follower = createFollower({ catalog, deps, onChange: () => events?.nudge() });
  const following = follower.has;
  events = createEvents({ pollMs, snapshot: () => takeSnapshot({ following }) });
  router.get("/api/events", ({ res }) => {
    events.subscribe(res);
    return undefined;
  });
  registerLook(router, { catalog, deps, following });
  registerGenerate(router, { catalog, deps, follower });
  registerFrames(router);
  registerLibrary(router, { catalog, following });
  registerPresets(router, { catalog });

  const server = createServer(createHandler({ key, router, distDir, media: serveMedia }));
  // A malformed request never reaches the handler; drop the socket quietly.
  server.on("clientError", (_err, socket) => socket.destroy());
  server.closeAll = () =>
    new Promise((r) => {
      events.close();
      server.closeAllConnections?.();
      server.close(r);
    });
  server.router = router;
  server.events = events;
  server.follower = follower;
  // Studio jobs a previous run left waiting. Safe beside a CLI or MCP waiter: core settles each job once.
  if (resume) follower.resume();
  return server;
}
