// Wires the studio together: router + API modules + media + events + page.
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter, createHandler } from "./http.mjs";
import { serveMedia } from "./media.mjs";
import { createEvents } from "./events.mjs";
import { createFollower } from "./follow.mjs";
import { registerLook } from "./api/look.mjs";
import { registerGenerate } from "./api/generate.mjs";
import { registerFrames } from "./api/frames.mjs";
import { loadCatalog } from "../../cli/lib/models.mjs";

export const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * An http.Server for the studio. `deps` replaces anything that reaches a
 * provider, in the MCP server's shape: `generate` (preflight, createTask,
 * waitForTask, download, creditsAfter), `upload` and `credits`. Tests pass
 * stubs. `closeAll()` also stops the event watchers.
 */
export function createApp({ key, deps = {}, catalog = loadCatalog(), distDir = join(WEB_DIR, "dist"), pollMs } = {}) {
  const router = createRouter();
  const follower = createFollower({ catalog, deps });
  const events = createEvents({ pollMs });
  router.get("/api/events", ({ res }) => {
    events.subscribe(res);
    return undefined;
  });
  registerLook(router, { catalog, deps });
  registerGenerate(router, { catalog, deps, follower });
  registerFrames(router);

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
  return server;
}
