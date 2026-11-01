# Studio web app

A local page for everything the `kie` CLI and the MCP tools do. It runs on your Mac only.

## Start

1. `npm --prefix web install` (once)
2. `npm run studio`

This builds the page if needed, starts a server on http://127.0.0.1:4317 (or the next free port) and opens your browser. Ctrl-C stops it. `--no-open` skips the browser; `STUDIO_PORT=5000 npm run studio` picks another first port.

If you stop the server, the open page shows a banner and reconnects by itself when you start it again.

## Films

Each film in Projects has four steps. Every step stays open, and nothing is paid for until you press a button with a price on it.

1. **Idea:** what the film is about, its ratio and total length, and its scene list (titles and seconds, which you can rename, reorder and delete). **Plan scenes with chat** hands the idea to the chat, which saves a scene list.
2. **References:** each Library item the scenes use (`@library:name`), with its sheet or **Make its sheet**, and the pictures uploaded into each scene. It shows what is missing; it does not hold anything back.
3. **Scenes:** the same scene editor as Create, for this film. Each scene is one Seedance 2.5 generation: **New draft** (480p) and **Make final**, each with its price, and the list of versions to choose from. Under the cards, **Ask chat** has starters about the scene.
4. **Finish:** the film's takes and the finishing tools (assemble, captions, ratios, cards).

A film made before Shard (no `scenes.json`) opens on Finish as "takes only". Home's **What are we making?** starts a new film on its Idea step.

**Create** is a scratchpad: its scenes are kept in `runs/create/` and are not a film. **Save into film…** copies a scene, its pictures and its versions' videos into a film you pick or name, and opens it there; Create keeps its copy. The film then counts what those versions cost.

The director's storyboard (brief, shots, stills) is no longer shown in the studio. `kie plan`, `kie still`, `kie shot` and `kie film` still work in the terminal.

## Chat

The panel on the right of Studio is an assistant that uses the same tools as Claude Code and Codex: it can price a shot, generate it, wait for it, direct a film and finish it. Jobs it starts appear in the feed like any other.

Connect it once, in the panel or in Settings:

- **ChatGPT subscription:** install Codex (`npm install -g @openai/codex`) and run `codex login`. The studio runs Codex in the background; messages count against your ChatGPT plan, not an API bill.
- **OpenAI API key:** paste the key in Settings, or set `OPENAI_API_KEY` before `npm run studio`. A pasted key is saved in `~/.config/kie/openai.key`, readable only by you, and the page only ever shows that a key is saved. Pick the model from the list your key can use. Each message is billed to that OpenAI account.

The chat also needs the MCP server's packages: `npm --prefix mcp install` (once).

What to expect:

- It does not ask before spending. Your per-job limit and daily cap still apply to every job; when one refuses, the chat says so and stops.
- One message runs at most 24 tool calls. **Stop** ends a reply at once.
- Each film keeps its own conversation in `runs/<film>/chat.jsonl`, so reopening a film brings it back.
- Through Codex, the chat sees only the motion-design tools. Codex's other tool servers, its shell, web search, browser and plugins are switched off, and it cannot change files. Nothing in `~/.codex/config.toml` is edited.

## Why it is safe to leave running

- It listens on 127.0.0.1 only and refuses requests addressed to any other host name.
- Every `/api` call must carry a random key that only the page it served knows, so another website cannot make your browser start jobs. The key changes on every start; an open page picks up the new one from the page the server serves.
- Jobs started here go through the same per-job limit, daily cap and job records as `kie` and the MCP server.

## Layout

- `server/`: `node:http` server, no dependencies. `api/*.mjs` call `cli/core`. `chat/` runs the chat: `openai.mjs` (API key), `codex.mjs` (subscription, with the protocol types in `codex-protocol/`) and `transcript.mjs` (one message format for both).
- `src/`: React page, built with Vite into `dist/`.
- `tests/`: server tests (`node --test`). Page tests sit next to their components (`vitest`).

Run them all with `npm run test:web` from the repo root.
