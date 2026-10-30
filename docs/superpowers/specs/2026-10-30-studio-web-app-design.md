# Studio web app: design

Approved in conversation 2026-10-30. Covers pieces 2-4 of the studio: **(2) asset library in the web app, (3) local web app, (4) in-app chat** with a ChatGPT subscription or an OpenAI API key. Piece 1, the [MCP server](2026-10-30-mcp-server-design.md), is built; this app is the third caller of the same `cli/core/`, after the `kie` CLI and the MCP server.

## Goal

Do everything the `kie` CLI and the MCP tools do, from one local page: generate takes, keep a reference library, start from presets, finish films, watch spend and chat with an assistant that can use the same tools. The same budget, daily cap, job records and file-safety rules apply whichever way a job starts.

## Decisions

| Question | Decision |
|---|---|
| Main layout | Prompt bar and feed (Higgsfield-style): takes in the middle, prompt bar at the bottom, chat as a side panel. |
| Visual direction | Warm dark "projection room" with the engine showing: real model ids, resolution and cost on every take; chat shows each tool step. |
| Chat spending | Never asks. Only the per-job limit and the daily cap stop it, and both are enforced in core. |
| Chat backends | ChatGPT subscription through `codex app-server`, or an OpenAI API key with function calling over the MCP tools. |
| Screens in v1 | Studio, Library, Presets, Films, Spend, Settings. |
| Hosting | Local only: `npm run studio`, bound to 127.0.0.1. |

## Structure

```
web/
  package.json        own dependencies, like mcp/ and render/
  server/
    main.mjs          starts the HTTP server, prints the URL, opens the browser
    http.mjs          node:http router, session-key check, static files, SSE
    api/*.mjs         one module per area: generate, jobs, library, presets, films, spend, settings, chat
    events.mjs        watches runs/.jobs and the library, pushes changes over SSE
    chat/
      tools.mjs       in-process MCP client over createServer() (InMemoryTransport)
      openai.mjs      API-key backend: Responses API with function calling
      codex.mjs       subscription backend: codex app-server over JSON-RPC stdio
      transcript.mjs  one shape for messages and tool steps, whichever backend
  src/                React + TypeScript page, built with Vite
    app/              shell, top nav, spend meter, router
    studio/           feed, take tile, take viewer, prompt bar, chips, price
    chat/             panel, message, tool-step line, connection picker
    library/ presets/ films/ spend/ settings/
    theme/            tokens (colour, type, spacing) and base CSS
  tests/              server tests (node:test) and component tests (Vitest)
```

- The server is a thin layer, like `cli/kie.mjs` and `mcp/server.mjs`: validate input, call `cli/core/`, return JSON. It never reimplements pricing, limits or job states.
- Data stays where it is: `runs/` (films), `runs/.jobs/` (job records), `runs/.ledger.jsonl`, `library/`. `KIE_RUNS_DIR` and `KIE_LIBRARY_DIR` still relocate them.
- Server dependencies: none beyond Node ≥20 and the existing `mcp/` package (for `createServer()` and the SDK client). Page dependencies: React, Vite, Vitest, Testing Library, as dev dependencies of `web/`. The built page is served from `web/dist/`.
- `npm run studio` (root script) builds the page if `web/dist/` is missing or stale, starts the server on port 4317 (next free port if taken) and opens the browser.

## Security of the local server

- Binds to `127.0.0.1` only.
- At start it makes a random session key, keeps it in memory and writes it into the served `index.html`. Every `/api` request must send it in an `X-Studio-Key` header. Requests without it get 403. This stops another website from making the browser send "generate" requests to the app.
- Rejects any request whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding).
- No CORS headers. Uploads go through the existing `confinePath` / `checkLocalFile` rules; files outside the allowed roots are never read.
- Secrets are never sent to the page. Settings reports only whether a key is present.

## Spend guard

- Every job, from the page, the API-key chat or the Codex chat, goes through `submitJob`, so the daily cap and its reservations apply unchanged.
- **New in core: a per-job ceiling.** `limits.json` gains an optional `perJobUsd`. When set, `reserve` refuses any job whose estimate is above it, whatever `budget_usd` the caller passed. Unset keeps today's behaviour. This makes "never asks" safe: the assistant can choose a budget, but not above the ceiling.
- `limits.json` writers become `kie limits` and the Settings screen. No MCP tool and no chat path writes it.
- The Codex backend runs with a read-only sandbox, network off and every command or file-change approval request declined by the server, so the assistant cannot edit `limits.json` or call the local API itself. Its only way to act is the motion-design MCP tools.

## Screens

The top nav is Studio, Library, Presets, Films, Spend and Settings. Today's spend meter (`$2.10 / $10.00` and a thin amber bar) sits in the top right on every screen.

### Studio

- **Feed:** takes newest first, in a masonry grid. Each tile shows `model-id · duration · resolution · $cost` in the mono face. A running take shows elapsed time; a failed take shows the reason in plain words and whether it was charged ("refused by kie, not charged"); a fallback take shows `→ wavespeed`.
- **Take viewer:** opens a take large with its prompt and settings, plus Reuse (copies settings into the prompt bar), Save to library and Frames (free 8-frame contact sheet).
- **Prompt bar:** prompt text, then chips for model, duration, aspect ratio, resolution and `@asset` references. The Generate button shows the live price from `estimate`. When a limit would refuse the job, the button is disabled and says why ("over today's cap by $0.40").
- **Working in:** a film picker above the feed (`zethus-hero ▾`, or new). Takes are filed in that run folder.
- **Chat panel:** collapsible on the right. See [Chat](#chat).

### Library

A grid of saved images, videos and audio with kind filters (character, product, logo, style, and the rest of `KINDS`). Drag files in to save; each asset shows its `@name` and which takes used it.

### Presets

The motion-design preset gallery with preview stills. "Use this" fills the prompt bar with the preset prompt; the chat can adapt it to the subject.

### Films

One card per run folder. A film page lists its takes in order and finishes the film with the free local tools:

- Assemble: chosen shots, optional music or voice-over and crossfades, loudness-normalised.
- Captions: an SRT burned in.
- Variants: reframe to 9:16 or 1:1.
- Text cards: exact titles, logos or numbers via the render templates.
- A player and a download button for each output.

### Spend

Today's total against the cap, a 14-day bar chart and a table of jobs (time, model, cost, cost source, state, film).

- A job with an upstream id that is still unsettled gets **Check again** (a free status read through `waitJob`).
- An `uncertain` job with no upstream id shows the instruction from `uncertainMessage` and the `kie job resolve` command. Resolving stays a human step in the CLI, as the MCP spec decided.

### Settings

- Chat connection: ChatGPT subscription (shows "Codex: logged in", or how to log in) or OpenAI API key (paste once; shows "key saved ✓" afterwards), and the model for the API-key mode.
- Limits: daily cap and per-job ceiling, written to `limits.json`.
- Providers: kie and WaveSpeed key presence, plus the `kie doctor` result.

## Chat

- Both backends use the same MCP tools that Claude Code and Codex already see.
- The page receives one transcript shape, whichever backend runs: user messages, assistant text (streamed), and tool steps. A tool step shows name, short arguments and result, such as `estimate minimax-h3 4s 480p → $0.16 ×3` or `video → j-20261030-7f3a running`.
- **API-key backend** (`chat/openai.mjs`):
  - The server lists the tools from an in-process MCP client connected to `createServer()` and offers them to the OpenAI Responses API as functions.
  - It runs the loop: model calls a function, server calls the MCP tool, result goes back to the model.
  - The key lives in `~/.config/kie/openai.key` (mode 600) or `OPENAI_API_KEY`. The Settings model list comes from the key's `/v1/models` response, not from a hard-coded list.
- **Subscription backend** (`chat/codex.mjs`):
  - Starts `codex app-server` as a child process and speaks its JSON-RPC protocol over stdio. Protocol types are generated with `codex app-server generate-ts` at build time and checked in.
  - One thread per chat, working directory set to the repo, read-only sandbox.
  - MCP tool-call events become tool steps. Approval requests for commands or file changes are declined.
  - Codex calls the motion-design MCP server as its own stdio process, which shares the same files and spend lock.
- A job started from the chat appears in the feed through the job watcher, not through the chat, so both backends show up the same way.
- Chat history is kept per film in `runs/<film>/chat.jsonl`, so reopening a film restores its conversation.

## Live updates

The page opens one Server-Sent Events stream. `events.mjs` watches `runs/.jobs/` and `library/` with `fs.watch`, with a 2-second poll as fallback, and sends `job`, `asset` and `spend` events. Takes, the spend meter and the Spend table update without reloading.

## Visual direction

References from Mobbin:

- Prompt bar and feed: [Higgsfield](https://mobbin.com/screens/0ee48fec-bc56-409e-ba7c-fb23d26dc854), [Artlist](https://mobbin.com/screens/0e1f328b-ecba-44df-b076-d1b1a9b16cc3), [Krea](https://mobbin.com/screens/1a52bcc0-ee5f-4ee1-ac6e-73e2b2276075), [Leonardo](https://mobbin.com/screens/601dfbe8-9940-4ae9-b97f-48bbfac9db3b), [Magnific](https://mobbin.com/screens/dd43712d-02c8-4f19-ae39-2c2e438a546b), [Runway](https://mobbin.com/screens/4dcb6dcc-950e-4cbd-b521-fe4da3f16426).
- Cost on every result: [fal](https://mobbin.com/screens/81a65bb8-9abf-4c16-9b5c-3c5513123a91).
- Library: [Frame.io](https://mobbin.com/screens/318d2594-3527-491a-80ff-1e64dc89a0fc), [Squarespace](https://mobbin.com/screens/21d22a54-ab22-4f51-ab9c-a72e59c4f8f2).
- Spend: [Gumloop](https://mobbin.com/screens/690a3101-806b-4ddb-b670-0bc190897916), [LangChain](https://mobbin.com/screens/86925057-b5b9-4c85-9787-9dcbee1d7b76).

Direction ("projection room, engine showing"):

- Warm near-black ground, about `#0e0d0c`, with raised surfaces about `#161412`, `#1b1917` and `#2a2724`, and warm off-white text about `#ece7df`. The footage is the brightest thing on screen.
- One amber accent, about `#e8a33d`, used only for Generate, the spend meter and costs.
- Two faces: a sans for interface text and a mono for every number, model id and tool step (tabular figures).
- The final tokens are set in `web/src/theme/` during the build and recorded in a `DESIGN.md` after it. Functional text is at least 11px and body text 13-14px. The impeccable checks run on the built screens.

## Errors

Core's typed errors map to one sentence and one next step in the page:

| Code | Meaning | Page shows |
|---|---|---|
| 2 | budget or cap | Generate disabled before the click with the gap ("over today's cap by $0.40, raise it in Settings"); in chat, the assistant says so and stops |
| 3 | invalid request | the field at fault, for example "Seedance 2 takes 4-15s" |
| 4 | provider error | red tile with "not charged" or "may have been charged" from the job state; fallback to WaveSpeed happens as today and shows `→ wavespeed` |
| 5 | uncertain | "still checking" tile keeping the job id; Check again, or the resolve instruction when there is no upstream id |

- If the server is unreachable, the page shows "Studio server isn't running, run `npm run studio`" instead of a blank screen.
- If chat is not configured, the panel shows the two connection options.
- A library drop of the wrong type or size is refused with the reason.

## Build order

1. Core: `perJobUsd` in `limits.json` and `reserve`, with tests.
2. Server skeleton: `npm run studio`, session key, Host check, static files, SSE, and read-only API (status, models, presets, runs, jobs, spend, library list).
3. Page shell and theme: nav, spend meter, tokens, empty screens.
4. Studio: feed, tiles, take viewer, prompt bar with live estimate, generate and wait.
5. Library: list, upload, save from take, `@asset` chips.
6. Presets gallery.
7. Films: film page, assemble, captions, variants, text cards, player.
8. Spend and Settings, including the limits writer.
9. Chat with the API-key backend and transcript UI.
10. Chat with the Codex backend.
11. Browser walk-through, impeccable pass, `DESIGN.md`, README section.

## Testing

All of these run without spending money:

- **Server** (`node:test`): real `cli/core` with a fake provider in `deps`.
  - Each endpoint's happy path.
  - The cap and the per-job ceiling refusing a job.
  - Fallback to WaveSpeed after a confirmed-free kie failure.
  - An uncertain job being kept and re-checked.
  - 403 without the session key, and 403 for a wrong `Host`.
  - No key value in any response or log.
- **Chat:** a fake OpenAI and a fake `codex app-server` replay recorded exchanges. The tests check that tool steps reach the transcript, that a chat-started job reaches the feed through SSE, and that a command-approval request from Codex is declined.
- **Page** (Vitest and Testing Library): price on the Generate button, disabled-with-reason states, tile states (running, succeeded, failed charged and not charged, uncertain, fallback) and the chat tool-step line.
- **Manual:** the real app opened in a browser, each screen clicked through with screenshots, generation in `--dry-run` style preview mode.
- **Paid acceptance, only when Alex says so:** one real 4s H3 clip (about $0.16) from the prompt bar, then one from the chat.

## Out of scope

- A drag-and-drop timeline editor; Films uses an ordered list.
- More than one user, remote access, accounts.
- Phone layouts; the target is a laptop screen.
- Resolving uncertain jobs from the page.
- ChatGPT as an MCP client (it still needs an HTTPS transport, a tunnel and a login).
