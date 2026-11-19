# Shard studio

A local page for everything the `kie` CLI and the MCP tools do. It runs on your own machine and only answers it.

## Start

1. `npm --prefix web install` (once)
2. `npm run studio`

This builds the page if needed, starts a server on http://127.0.0.1:4317 (or the next free port) and opens your browser. Ctrl-C stops it. `--no-open` skips the browser; `STUDIO_PORT=5000 npm run studio` picks another first port.

If you stop the server, the open page shows a banner and reconnects by itself when you start it again.

## Studio

The page you land on. Describe a scene in the prompt box; **Plan with AI** (or Enter) asks the AI you connected to plan one take: it picks the model, a Look, camera and lighting, and any Library character, product or place you name with `@`, writes the full prompt, and fills the bar. The green **Generate** button shows the price, and only pressing it spends. Everything the AI set stays yours to change, and with no AI connected the bar works on its own.

- **The bar:** References, Look, Camera and Lighting above the box (each Auto until you or the AI pick one; Camera and Lighting are for video), then Image or Video, model, resolution, ratio, duration, sound on or off, and 1 to 4 takes.
- **The AI:** Settings, **Chat AI**: your ChatGPT subscription through Codex, or an API key for OpenAI, Anthropic, OpenRouter or another OpenAI-compatible service (Gemini, DeepSeek, Mistral, Groq, xAI, or a free model on this computer through Ollama or LM Studio). Keys are saved on this computer and never shown again. The Studio's AI only has Shard's free tools: it can look things up and price a plan, never generate.
- **Conversations:** each visit starts a new one; the panel at the left lists the earlier ones with their takes. Hover one to **Archive** it (hidden here, kept, and listed in Settings under **Archived conversations** to restore or delete) or **Delete** it for good. They are kept in `runs/explore/chats/`.

## Create Video

Video opens on Create Video: one prompt, one take. Under the prompt box is a row of chips from the director's menu: Move (with a speed), Shot size, Angle, Lens and Lighting. Pick any of them and Shard adds their words after your prompt, in the wording the chosen model reads best (a Hailuo model gets its bracket command, such as `[Push in]`). The chips do not change the price. **Reuse** on a take made with chips brings back what you typed and the chips.

## Films

Each film in Films has four steps. Every step stays open, and nothing is paid for until you press a button with a price on it.

1. **Idea:** what the film is about, its ratio and total length, and its scene list (titles and seconds, which you can rename, reorder and delete). **Copy plan for Claude Code** copies a request you paste into Claude Code (or Codex), which plans the scenes through the MCP server.
2. **Cast:** each Library item the scenes use (`@library:name`), with its sheet or **Make its sheet**, and the pictures uploaded into each scene. It shows what is missing; it does not hold anything back.
3. **Scenes:** the same scene editor as Create, for this film. Each scene is one Seedance 2.5 generation: **New draft** (480p) and **Make final**, each with its price, and the list of versions to choose from. A stage's camera move, speed, shot size and angle, and the scene's lens and lighting, can be picked as chips from the director's menu; Shard writes their words into the prompt before what you typed.
4. **Finish:** the film's takes and the finishing tools (assemble, captions, ratios, cards).

A film made before Shard (no `scenes.json`) opens on Finish as "takes only". **New film** (`#/newfilm`, from Films) asks **What are we making?** and starts a new film on its Idea step.

**Create** is a scratchpad: its scenes are kept in `runs/create/` and are not a film. **Save into film…** copies a scene, its pictures and its versions' videos into a film you pick or name, and opens it there; Create keeps its copy. The film then counts what those versions cost.

The director's storyboard (brief, shots, stills) is no longer shown in the studio. `kie plan`, `kie still`, `kie shot` and `kie film` still work in the terminal.

## Skills

**Skills** lists the saved skills (each runs in Claude Code or Codex as `/name` and through the MCP server), lets you add one from a folder on this Mac, and shows its instructions.

## Agents

The Studio page's chat plans takes but never makes them (see Studio above). To make films by asking, use Claude Code, Codex or Claude Desktop with the MCP server: the **MCP** page shows the setup command for each, and jobs an agent starts appear in the studio like any other. A film's own chat backend (`server/chat/`) is still on the server, without a panel on the page.

## Why it is safe to leave running

- It listens on 127.0.0.1 only and refuses requests addressed to any other host name.
- Every `/api` call must carry a random key that only the page it served knows, so another website cannot make your browser start jobs. The key changes on every start; an open page picks up the new one from the page the server serves.
- Jobs started here go through the same per-job limit, daily cap and job records as `kie` and the MCP server.

## Layout

- `server/`: `node:http` server, no dependencies. `api/*.mjs` call `cli/core`. `chat/` runs the chat: `openai.mjs` (API key), `codex.mjs` (subscription, with the protocol types in `codex-protocol/`) and `transcript.mjs` (one message format for both).
- `src/`: React page, built with Vite into `dist/`.
- `tests/`: server tests (`node --test`). Page tests sit next to their components (`vitest`).

Run them all with `npm run test:web` from the repo root.
