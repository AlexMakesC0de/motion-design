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
import { registerScenes } from "./api/scenes.mjs";
import { registerFrames } from "./api/frames.mjs";
import { registerLibrary } from "./api/library.mjs";
import { registerPresets } from "./api/presets.mjs";
import { registerPalettes } from "./api/palettes.mjs";
import { registerSkills } from "./api/skills.mjs";
import { registerMcp } from "./api/mcp.mjs";
import { registerFilms } from "./api/films.mjs";
import { registerFinish } from "./api/finish.mjs";
import { registerSettings } from "./api/settings.mjs";
import { registerChat } from "./api/chat.mjs";
import { registerDirector } from "./api/director.mjs";
import { registerJutsu } from "./api/jutsu.mjs";
import { registerInfluencers } from "./api/influencers.mjs";
import { createTools } from "./chat/tools.mjs";
import { createChat } from "./chat/session.mjs";
import { openaiBackend } from "./chat/openai.mjs";
import { anthropicBackend } from "./chat/anthropic.mjs";
import { compatibleBackend } from "./chat/compatible.mjs";
import { explorePrompt } from "./chat/prompt.mjs";
import { createCodex } from "./chat/codex.mjs";
import { loadCatalog } from "../../cli/lib/models.mjs";

export const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
/** How long shutdown waits for stopped chat turns to end and save. */
const CHAT_CLOSE_WAIT_MS = 3_000;

/**
 * An http.Server for the studio. `deps` replaces anything that reaches a
 * provider, in the MCP server's shape: `generate` (preflight, createTask,
 * waitForTask, download, creditsAfter), `upload` and `credits`. Tests pass
 * stubs. `closeAll()` also stops the event watchers. `resume` follows again
 * the studio jobs a previous run of the server left unsettled (main.mjs).
 * `finish` replaces the finishing tools or their install check (tests):
 * { tools: { assemble, burnCaptions, makeVariants, render }, check }.
 * `chat.fetch` replaces fetch for the API-key backends (tests pass a fake
 * service); `chat.codex` replaces how `codex app-server` is started (tests run
 * a fake: { command, prefixArgs, args }); `chat.closeWaitMs` is how long
 * shutdown waits for chat turns to save. The chat's MCP tools get the same
 * `deps` as everything else.
 */
export function createApp({ key, deps = {}, catalog = loadCatalog(), distDir = join(WEB_DIR, "dist"), pollMs, resume = false, finish = {}, chat: chatOptions = {} } = {}) {
  const router = createRouter();
  let events = null;
  let director = null;
  // A followed still or take that settles may let its film's queue move on (the rest of the stills, Film all).
  const follower = createFollower({
    catalog,
    deps,
    onChange: (id) => {
      events?.nudge();
      director?.settled(id);
    },
  });
  const following = follower.has;
  events = createEvents({ pollMs, snapshot: () => takeSnapshot({ following }) });
  const tasks = createTasks({ onChange: (task) => events.publish({ event: "task", data: task }) });
  router.get("/api/events", ({ res }) => {
    events.subscribe(res);
    return undefined;
  });
  router.get("/api/tasks", ({ query }) => tasks.list(query.get("run") || undefined));
  router.post("/api/tasks/:id/cancel", ({ params }) => ({ task: tasks.cancel(params.id) }));
  registerLook(router, { catalog, deps, following });
  registerGenerate(router, { catalog, deps, follower });
  registerScenes(router, { catalog, deps, follower });
  registerJutsu(router, { catalog, deps, follower });
  registerInfluencers(router, { catalog, deps, follower });
  registerFrames(router);
  registerLibrary(router, { catalog, deps, follower, following });
  registerPresets(router, { catalog });
  registerPalettes(router);
  registerSkills(router);
  registerMcp(router);
  registerFilms(router, { following, deps });
  registerFinish(router, { tasks, ...finish });
  director = registerDirector(router, { catalog, deps, follower, tasks });
  registerSettings(router, { catalog, deps });
  // Two chats: a film's, with every tool, and Explore's, whose tools are free and only read (mcp/explore.mjs).
  const fetch = chatOptions.fetch ?? globalThis.fetch;
  const keyBackends = (t) => ({
    openai: openaiBackend({ fetch, tools: t }),
    anthropic: anthropicBackend({ fetch, tools: t }),
    openrouter: compatibleBackend("openrouter", { fetch, tools: t }),
    compatible: compatibleBackend("compatible", { fetch, tools: t }),
  });
  const keyEnvs = Object.values(catalog.providers ?? {}).map((p) => p.keyEnv).filter(Boolean);
  const tools = createTools({ deps, catalog });
  const backends = keyBackends(tools);
  const codex = createCodex({ keyEnvs, ...chatOptions.codex });
  const chat = createChat({ backends: { ...backends, codex }, tools, publish: (e) => events.publish(e) });
  const exploreTools = createTools({ deps, catalog, mode: "explore" });
  const exploreCodex = createCodex({ keyEnvs, mode: "explore", ...chatOptions.codex });
  const explore = createChat({ backends: { ...keyBackends(exploreTools), codex: exploreCodex }, tools: exploreTools, publish: (e) => events.publish(e), prompt: explorePrompt });
  registerChat(router, { chat, backends, codex, explore });

  const server = createServer(createHandler({ key, router, distDir, media: serveMedia }));
  // A malformed request never reaches the handler; drop the socket quietly.
  server.on("clientError", (_err, socket) => socket.destroy());
  // Running chat turns are stopped, then given a moment to end and save their transcript before the tools and Codex go.
  server.closeAll = async () => {
    events.close();
    for (const film of chat.films()) chat.stop(film);
    for (const film of explore.films()) explore.stop(film);
    const settled = async (ms) => {
      let timer;
      await Promise.race([Promise.all([chat.idle(), explore.idle()]), new Promise((r) => (timer = setTimeout(r, ms)))]);
      clearTimeout(timer);
    };
    await settled(chatOptions.closeWaitMs ?? CHAT_CLOSE_WAIT_MS);
    tools.close().catch(() => {});
    exploreTools.close().catch(() => {});
    codex.close();
    exploreCodex.close();
    await settled(500); // a Codex turn still waiting ends when its app-server exits
    await new Promise((r) => {
      server.closeAllConnections?.();
      server.close(r);
    });
  };
  server.router = router;
  server.events = events;
  server.follower = follower;
  server.tasks = tasks;
  server.chat = chat;
  server.explore = explore;
  server.director = director;
  // Studio jobs a previous run left waiting. Safe beside a CLI or MCP waiter: core settles each job once.
  if (resume) follower.resume();
  return server;
}
