# Studio web app

A local page for everything the `kie` CLI and the MCP tools do. It runs on your Mac only.

## Start

1. `npm --prefix web install` (once)
2. `npm run studio`

This builds the page if needed, starts a server on http://127.0.0.1:4317 (or the next free port) and opens your browser. Ctrl-C stops it. `--no-open` skips the browser; `STUDIO_PORT=5000 npm run studio` picks another first port.

If you stop the server, the open page shows a banner and reconnects by itself when you start it again.

## Storyboard

The **Storyboard** button above the feed switches a film from its takes to its storyboard. A film opens on it when it has a brief or a plan. It shows what the director in the chat (or `kie plan`) saved, and lets you make the film step by step. Nothing is paid for until you press a button with a price on it.

- **No plan yet:** type the idea under "What is the film?" and press **Plan this**. It goes to the chat as a request to plan the film.
- **Brief and timeline:** the takeaway, format and look, and a bar with each shot as wide as it is long.
- **Shot cards:** one per shot, with its still, size, model, take price and a line on where it stands (no still yet, still ready, still from before the last change, filming, take ready to review, take passed, take needs a redo, take failed). A shot that continues from the one before shows "continues from" and needs no still.
- **Inspector** (click a shot): edit its action, length, camera choices, models, why and checks, and save. The checker's findings for the shot show underneath; an error on the plan disables the buttons that spend. Under it:
  - **Stills:** **Make the still** (or **New still**) with its price. Earlier stills are shown; click one to use it instead.
  - **Take:** the video, a **Review**, and **Film this shot** (or **Film again**) with its price. It asks once more ("Film it for about $X?") before it spends.
- **Review:** shows the take's contact sheet and its checks. Untick a check that failed and say what is wrong, then **Pass** (only when every check is ticked) or **Needs a redo**.
- **Auto-redo:** off by default. **Auto-redo off** asks for the most all the takes may cost, redos included; then a take judged redo is filmed again on its own, twice at most per shot, within that total. **Turn off** switches it back.
- **Make N stills:** makes every missing still. When no still sets the look yet, only the first is made and the rest follow once it lands, so they match it.
- **Film all N:** disabled until every shot has a still. It shows the price of what is left, then asks "Film N shots for up to $X?". Confirming agrees that total: only those shots are filmed, each at no more than its price then. Shots that continue from another start once its take lands. If a shot is added or gets pricier, or a take is refused, the queue stops and says why; pressing **Film all** again agrees the new total.
- **Cut the film:** appears once every shot has a take. It trims, joins and fades the takes into `film.mp4` (free) and plays it under the storyboard.

The chat (see below) works on the same film: it can save the brief and plan, make stills, film and review, and the page updates as it does. It films only when you ask and uses the total you state; it cannot switch auto-redo on.

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
