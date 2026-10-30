# Studio web app

A local page for everything the `kie` CLI and the MCP tools do. It runs on your Mac only.

## Start

1. `npm --prefix web install` (once)
2. `npm run studio`

This builds the page if needed, starts a server on http://127.0.0.1:4317 (or the next free port) and opens your browser. Ctrl-C stops it. `--no-open` skips the browser; `STUDIO_PORT=5000 npm run studio` picks another first port.

If you stop the server, the open page shows a banner and reconnects by itself when you start it again.

## Why it is safe to leave running

- It listens on 127.0.0.1 only and refuses requests addressed to any other host name.
- Every `/api` call must carry a random key that only the page it served knows, so another website cannot make your browser start jobs. The key changes on every start; an open page picks up the new one from the page the server serves.
- Jobs started here go through the same per-job limit, daily cap and job records as `kie` and the MCP server.

## Layout

- `server/`: `node:http` server, no dependencies. `api/*.mjs` call `cli/core`.
- `src/`: React page, built with Vite into `dist/`.
- `tests/`: server tests (`node --test`). Page tests sit next to their components (`vitest`).

Run them all with `npm run test:web` from the repo root.
