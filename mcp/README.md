# motion-design MCP server

Lets Claude Code and Codex use the kie harness as tools: look at models and
costs, save reference assets, generate stills and videos inside the spend
limits, wait for them, and finish films. It runs locally over stdio and calls
the same code as the `kie` CLI.

## Set up

1. Install the CLI and its key first (see the main README); `kie doctor` should pass.
2. `node install.mjs` from the repo root. It installs this folder's
   dependencies and registers the server:
   - Claude Code: `claude mcp add --scope user motion-design -- <node> <repo>/mcp/server.mjs`
   - Codex: a block between `# >>> motion-design >>>` and `# <<< motion-design <<<`
     in `~/.codex/config.toml` (backed up first).
   `node install.mjs --dry-run` shows what it would change. `--uninstall`
   removes only these two entries. `--no-mcp` skips this step.
3. Restart the host and ask it to call `status`.

## Tools

| Group | Tools | Cost |
|---|---|---|
| Look | `status`, `list_models`, `list_presets`, `estimate`, `list_runs`, `get_run` | free |
| Assets | `save_asset`, `list_assets`, `get_asset` | free |
| Generate | `generate_image`, `generate_video`, `wait_job` | spends kie credits |
| Finish | `frames`, `probe`, `assemble`, `variants`, `caption`, `render` | free, local |

## Limits that protect your money

- Every job has a per-job budget, and all jobs share a daily cap
  (`~/.config/kie/limits.json`, $10 by default). Change it with
  `kie limits --daily N`; no tool can.
- A job that may exist upstream (error 5) is never resubmitted. Check kie's
  task log and record the outcome with `kie job resolve`.
- Files are read only from `runs/`, `library/` and folders you list under
  `allowRoots` in the limits file. Relative paths mean inside `runs/`.

## Restrictions on what a client can pass

- `assemble`'s `transition.kind` must be a plain ffmpeg xfade name
  (`^[a-z0-9]+$`, such as `fade` or `wipeleft`). It is pasted into an ffmpeg
  filter, so anything else is refused.
- In `render`, every image path inside `props` is confined to the allowed
  folders (`runs/`, `library/`, `allowRoots`) and must not name a hidden
  folder. `file:` URLs in `props` are refused. The renderer turns image paths
  into `file://` URLs for a headless browser, so an unconfined path would
  copy any image on the machine into a render.
- `brand` is a brand-kit name from `brand/`, never a path. `out` is a plain
  file name inside the run folder.

## Errors

Errors are tool results with `isError: true`. The text starts `Error <code>:`
and ends with the next action; `_meta.error` holds `{ code, retryable,
nextAction, localJobId, upstreamTaskId }`. Codes match the CLI: 1 usage,
2 budget or cap (nothing spent), 3 invalid request or path, 4 provider error,
5 outcome unknown.

## Tests

`npm --prefix mcp test` (or `npm run test:mcp` from the root). Every provider
call is stubbed; nothing is spent.
