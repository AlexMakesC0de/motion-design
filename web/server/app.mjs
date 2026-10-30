// Wires the studio together: router + API modules + media + events + page.
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRouter, createHandler } from "./http.mjs";
import { serveMedia } from "./media.mjs";
import { createEvents, takeSnapshot } from "./events.mjs";
import { createFollower } from "./follow.mjs";
import { createTasks } from "./tasks.mjs";
import { registerLook } from "./api/look.mjs";
import { registerGenerate } from "./api/generate.mjs";
import { registerFrames } from "./api/frames.mjs";
import { registerLibrary } from "./api/library.mjs";
import { registerPresets } from "./api/presets.mjs";
import { registerFilms } from "./api/films.mjs";
import { registerFinish } from "./api/finish.mjs";
import { registerSettings } from "./api/settings.mjs";
import { loadCatalog } from "../../cli/lib/models.mjs";

export const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * An http.Server for the studio. `deps` replaces anything that reaches a
 * provider, in the MCP server's shape: `generate` (preflight, createTask,
 * waitForTask, download, creditsAfter), `upload` and `credits`. Tests pass
 * stubs. `closeAll()` also stops the event watchers. `resume` follows again
 * the studio jobs a previous run of the server left unsettled (main.mjs).
 * `finish` replaces the finishing tools or their install check (tests):
 * { tools: { assemble, burnCaptions, makeVariants, render }, check }.
 */
export function createApp({ key, deps = {}, catalog = loadCatalog(), distDir = join(WEB_DIR, "dist"), pollMs, resume = false, finish = {} } = {}) {
  const router = createRouter();
  let events = null;
  const follower = createFollower({ catalog, deps, onChange: () => events?.nudge() });
  const following = follower.has;
  events = createEvents({ pollMs, snapshot: () => takeSnapshot({ following }) });
  const tasks = createTasks({ onChange: (task) => events.publish({ event: "task", data: task }) });
  router.get("/api/events", ({ res }) => {
    events.subscribe(res);
    return undefined;
  });
  router.get("/api/tasks", ({ query }) => tasks.list(query.get("run") || undefined));
  registerLook(router, { catalog, deps, following });
  registerGenerate(router, { catalog, deps, follower });
  registerFrames(router);
  registerLibrary(router, { catalog, following });
  registerPresets(router, { catalog });
  registerFilms(router, { following });
  registerFinish(router, { tasks, ...finish });
  registerSettings(router, { catalog, deps });

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
  server.tasks = tasks;
  // Studio jobs a previous run left waiting. Safe beside a CLI or MCP waiter: core settles each job once.
  if (resume) follower.resume();
  return server;
}
