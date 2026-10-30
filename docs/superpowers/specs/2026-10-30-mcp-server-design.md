# MCP server for the kie harness: design

Approved in conversation 2026-10-30; revised the same day after an outside review (see [Revision log](#revision-log)). First of four pieces toward a Higgsfield-like studio: **(1) MCP server**, then (2) asset library in the web app, (3) local web app, (4) in-app chat with ChatGPT subscription or API key. Pieces 2-4 get their own specs. Quality work is tracked separately in [the quality plan](../../quality-plan.md).

## Goal

Generate, inspect and finish films by chatting in Claude Code or Codex, with the same rules the `kie` CLI enforces today, plus a reusable asset library and a daily spend cap.

## Decisions

| Question | Decision |
|---|---|
| Clients in v1 | Claude Code and Codex over local stdio. ChatGPT later: it needs an HTTPS transport, a tunnel and a login. |
| Architecture | Shared core. CLI and MCP server are thin layers over `cli/core/`; the web app becomes a third caller later. |
| Spend guard | Per-job budget (as today) plus a daily cap enforced through reservations. No tool can raise the cap. |
| Assets in v1 | Yes: a simple named library. |

## Structure

```
cli/
  core/            logic; returns plain data, never prints, never exits
    catalog.mjs    models, presets, preflight (read-only)
    jobs.mjs       local job records: create, transition, list pending (new)
    generate.mjs   reserve, submit, wait, reconcile, record (moved out of kie.mjs)
    spend.mjs      limits, reservations, daily total (new)
    assets.mjs     asset library and reference expansion (new)
    inputs.mjs     local-file and URL validation (new)
    finish.mjs     assemble, variants, caption, probe, frames
  lib/             unchanged low-level modules (client, poll, upload, ffmpeg, ...)
  kie.mjs          formatter: parse args → call core → print → exit code
mcp/
  package.json     own dependencies (@modelcontextprotocol/sdk), like render/
  server.mjs       stdio server: validate input → call core → tool result
```

- Core throws typed errors carrying the existing exit codes: 2 budget or cap, 3 invalid request, 4 provider error, 5 uncertain. The CLI maps them to exit codes as now. MCP maps them to tool results with `isError: true` that state the next action.
- Data stays in `runs/` (films), `runs/.jobs/` (job records), `runs/.ledger.jsonl` (spend) and a new `library/` (assets). All gitignored; `KIE_RUNS_DIR` / `KIE_LIBRARY_DIR` relocate them.

## Jobs: a local id before any network call

Every paid submission gets a **local job id** (`j-<yyyymmdd>-<random>`) written to `runs/.jobs/<id>.json` before kie is contacted. The record moves through these states:

| State | Meaning | Counts against the cap at |
|---|---|---|
| `reserved` | written, not yet sent | estimate |
| `sending` | written immediately before the create call; the call's outcome is not yet recorded | estimate |
| `submitted` | provider returned an upstream task id | estimate |
| `uncertain` | the create call ended ambiguously; the job may exist, and there may be no upstream id | estimate |
| `succeeded` | result downloaded | actual cost, else estimate (`costSource` says which) |
| `failed-confirmed-free` | provider failed it and its record reports 0 charged (kie `creditsConsumed: 0`) | 0 |
| `failed-unconfirmed` | failed with no charge confirmation (e.g. WaveSpeed has no cost readout) | estimate |
| `failed-charged` | failed, and the task record reports a charge | actual cost |
| `refused` | our own check refused it before sending; nothing left the machine | 0 |

- **An uncertain job is never resubmitted automatically**, by the CLI, the server or the fallback logic. Same rule as today.
- With an upstream id, `wait_job` keeps polling it.
- Without one, the job stays `uncertain` and keeps counting at its estimate. The tool result tells the user to check kie's task log, then record the outcome with `kie job resolve <local id> --task <upstream id>` (rejoin) or `--not-created`.
- `resolve` exists only in the CLI, as a human decision. MCP has no tool for it.
- The record keeps: local id, upstream id (or null), provider, model, run, estimate, actual cost, `costSource` (`task-record`, `estimate` or `none`), submission time as UTC ISO plus the IANA timezone used for the daily boundary, and each state change with a timestamp.
- **Actual cost comes from the task record's `creditsConsumed`** (documented on kie task details), not from balance differences. Balance differences are wrong once two jobs overlap. They stay in the ledger as a cross-check only.

## Spend guard

- Limits file `~/.config/kie/limits.json`, `{ "dailyUsd": 10 }` by default. `kie limits --daily N` changes it. No MCP tool writes it.
- **Available today** = cap − Σ over job records whose submission day (in the recorded timezone) is today, each at the amount the [jobs table](#jobs-a-local-id-before-any-network-call) gives for its state.
- **Reserve, then submit, then reconcile:**
  1. Take the lock, read the job records, check `estimate ≤ available` and the per-job budget, write the `reserved` record, release the lock. The lock is held only for this local read and write, never during a network call.
  2. Submit to kie with no lock held. Move the record to `submitted`, `uncertain` or a failure state.
  3. `wait_job` (or the CLI's own wait) moves it to its final state with the actual cost.
- **Lock:** `runs/.spend.lock`, created with O_EXCL, containing pid and time. It is stale when the pid is not alive or the lock is older than 30 seconds, and a stale lock is removed with a warning. Waiters retry for up to 5 seconds, then fail with code 4 ("spend lock busy"). Nothing is submitted in that case.
- **Abandoned records:** `status` and the next reservation sweep records older than 10 minutes whose process is gone.
  - A stale `reserved` record never reached the network, so it becomes `refused` with reason `abandoned` and counts 0.
  - A stale `sending` record may have reached kie, so it becomes `uncertain` and keeps its estimate.
- `submitted` and `uncertain` records are never released automatically. Each holds its estimate until a poll or `kie job resolve` settles it. They stop affecting the cap at the next local midnight like everything else.
- Known limit: an agent with shell access can run `kie limits` or `kie job resolve` itself. The host's command-approval prompt is the guard for that path.

## Tools

Every tool returns `structuredContent` that matches a declared `outputSchema`, plus a short human-readable text block. Annotations: `readOnlyHint` on look tools; `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: true` on the two generate tools. Their descriptions start with "Spends kie credits."

**Look (free, read-only)**

| Tool | Returns |
|---|---|
| `status` | keys, kie balance, catalog age, today's spend and available amount, jobs in `reserved`/`submitted`/`uncertain` |
| `list_models` | per model: durations, aspect ratios, reference roles, price, verified flag |
| `list_presets` | presets with native/adaptation fidelity, source prompt path and guide path |
| `estimate` | cost of a planned job and whether the per-job budget and available cap allow it; reserves nothing |
| `list_runs`, `get_run` | runs with prompt, settings, takes, job records, cost and review notes |

**Assets (free)**

| Tool | Does |
|---|---|
| `save_asset` | name, kind (`character`, `product`, `location`, `style`), description, 1-4 images from validated local paths or earlier takes; copies them into `library/<name>/` |
| `list_assets` | names, kinds, descriptions, image counts |
| `get_asset` | full record plus downscaled previews returned as MCP image content, numbered `#1..#n` |

**Generate (spends; guarded)**

| Tool | Does |
|---|---|
| `generate_image` | prompt, model, refs, resolution, aspect ratio, `params`, budget → reserves, submits, returns `{ localJobId, upstreamTaskId|null, state, estimateUsd, refMapping }` |
| `generate_video` | same, plus prompt text or preset, duration |
| `wait_job` | by local job id; waits up to `max_wait_s` (default 60, max 120); on success downloads artifacts and returns paths, actual cost and a preview as image content (the image itself, or an 8-frame contact sheet for video) |

- `params` passes route fields such as `generate_audio` through, checked against the route's captured contract. Unknown or out-of-range fields are refused with code 3.
- The server never edits the prompt. Job records list the assets and images used.

**Finish and inspect (free, local)**

`frames` (8-frame contact sheet, first and last frame PNGs), `probe`, `assemble`, `variants`, `caption`, `render`: thin wrappers over the existing commands.

**Deliberately absent:** raising the cap, resolving uncertain jobs, deleting anything, audio generation (routes unverified), shot plans.

## References

A ref is `{ source, role }`. `source` takes one of three forms:

| Form | Meaning |
|---|---|
| `zed` | every image of asset `zed`, in stored order |
| `zed#2` | image 2 of asset `zed` only (1-based, as numbered by `get_asset`) |
| local path or `https://` URL | one file |

Expansion and mapping rules:

1. Refs expand in the order given; an asset expands in its stored order. `[zed, crm#1]` with `zed` holding two images becomes images 1, 2, 3.
2. `first_frame` and `last_frame` take exactly one image. A multi-image asset without `#n` in those roles is refused (code 3), naming the choices.
3. Array roles (`identity`, `style`) accept any number of images up to the route's limit, checked after expansion.
4. Numbering follows the provider's convention per type (`@Image1` is the first image across all image refs). The response's `refMapping` lists each number against its asset and image (`@Image1 = zed#1`), and the job record stores it, so the prompt can be written against it.
5. Route-level exclusions are checked after expansion. For example, Seedance 2.5 refuses `first_frame` combined with reference images, and that is refused locally (code 3) before anything is reserved.

## Inputs and file safety

The server runs locally for your own agent. The risk it guards against is a prompt-injected agent sending a private file to kie as a "reference".

- **Local paths** are resolved with `realpath` (following symlinks) and accepted only inside allowed roots: `runs/`, `library/`, and directories listed under `allowRoots` in `~/.config/kie/limits.json`. That list is empty by default and has no MCP tool to change it. Anything else is refused with code 3 naming the allowed roots. Hidden path segments (`.ssh`, `.config`, `.env*`) are refused even inside a root.
- **Type** is checked by magic bytes, not extension. Images: PNG, JPEG, WebP. Video: MP4/MOV. Audio: WAV, MP3, AAC, OGG.
- **Size and dimensions** are checked against the route's documented limits where captured (e.g. Seedance 2.5 images 300-6000 px, under 30 MB, aspect 0.4-2.5), otherwise a ceiling of 30 MB for images and 200 MB for video.
- **URLs:** `https://` only. The server never fetches a URL you give it; kie does. So there is no request from this machine to an address you supplied, and no local-network exposure.
- **Result downloads** go only to URLs returned by the provider for that task. They must be `https://`, are streamed with a size ceiling, and are written only inside the run directory.
- `save_asset` takes local files or earlier takes, never URLs.

## Asset library

```
library/<name>/
  asset.json    { name, kind, description, images: [{ n, file, sha256, bytes, width, height,
                  upload: { url, at } }], createdAt, updatedAt, usedIn: [run slugs] }
  1.png 2.png   originals, copied in, never modified
  .history/<timestamp>/   previous version on replace
```

- Names use the run-slug rule (`^[a-z0-9][a-z0-9-]{0,80}$`).
- Saving over an existing name is refused unless `replace: true`. Replacement moves the previous `asset.json` and images into `.history/<timestamp>/`.
- kie deletes uploads after 24 hours (docs.kie.ai file-upload quickstart, read 2026-10-30). An upload URL is reused when its sha256 matches and it is under 20 hours old. Otherwise the image is re-uploaded at job time and the record updated.
- CLI parity: `kie asset save|list|show`.

## Installer

- **Claude Code:** `claude mcp get motion-design` first.
  - Absent: add it at user scope.
  - Present with our exact command: leave it.
  - Present with a different command: report it and change nothing.
- **Codex:** `~/.codex/config.toml` is edited only within a marked block (`# >>> motion-design >>>` … `# <<< motion-design <<<`) holding `[mcp_servers.motion-design]`. If that table already exists outside the markers, it is reported and left alone. The file is backed up to `config.toml.bak-<timestamp>` before the first edit.
- `--uninstall` removes only an entry that is ours: the Claude Code entry whose command matches, and the Codex marked block. Unrelated servers and settings are never touched.
- Re-running install or uninstall is a no-op when nothing needs changing. `--dry-run` prints every intended change.

## Errors

All are tool results with `isError: true`, `structuredContent: { code, retryable, nextAction, ... }` and readable text.

| Code | Text |
|---|---|
| 2 | Refused, nothing spent. Estimate $X; $Y available today (or over the per-job budget). Ask the user. |
| 3 | What was invalid and the allowed values or roots. |
| 4 | Provider error or spend lock busy, and whether a same-model fallback was tried. |
| 5 | Job `<local id>` may exist upstream. With an upstream id: call `wait_job`. Without one: the user must check kie's task log and run `kie job resolve`. Do not resubmit. |

`wait_job` reaching `max_wait_s` is a normal result (`state: submitted`, not an error). Job records persist, so a restarted server resumes and `status` lists unsettled jobs.

## Build order

Each step keeps `kie` working and all tests green.

1. **Catalog fixes:**
   - H3 kie route: `minimax-h3/text-to-video` and `minimax-h3/image-to-video`; 768P/2K at 8/13 credits/s; no aspect ratio on i2v; audio cannot be disabled.
   - Seedance 2.5 fields `generate_audio`, `return_last_frame` and `draft`, plus the `bytedance/seedance-2-5-draft` finalize model (`draft_task_id`, 1080p only).
   - Correct the WaveSpeed Seedance 2.5 price. WaveSpeed lists $0.18/$0.36/$0.90 per second at 480p/720p/1080p; the recorded $0.81 was 480p for 5s at 10% off.
   - Add the `params` passthrough.
2. Extract `cli/core/` command by command; the existing 110 tests pass after each move.
3. Job records, reservations, spend guard, `kie limits`, `kie job resolve`, and cost from `creditsConsumed`.
4. Input validation (`core/inputs.mjs`) applied to every existing path-taking command.
5. Asset library, reference expansion, `kie asset`.
6. `frames`.
7. MCP server, installer registration.

## Testing

Free and offline, in `node --test`:

- **Jobs:**
  - every state transition;
  - a create that times out before returning an id ends `uncertain` with no upstream id, and nothing resubmits it;
  - `resolve` both ways;
  - abandoned `reserved` records become `refused`, abandoned `sending` records become `uncertain`.
- **Spend:**
  - fixture records across states sum correctly;
  - the midnight boundary in a non-UTC timezone;
  - two concurrent reservations near the cap: exactly one succeeds;
  - a stale lock (dead pid) is recovered;
  - the lock is not held during a stubbed slow submit;
  - a failed job without a charge confirmation still counts its estimate.
- **Refs:**
  - expansion order and `refMapping`;
  - a multi-image asset is refused in `first_frame`;
  - `#n` out of range is refused;
  - route limits are applied after expansion;
  - the Seedance 2.5 frame-plus-reference exclusion.
- **Inputs:**
  - a symlink escaping a root is refused;
  - hidden segments are refused;
  - a wrong magic number or an oversize file is refused;
  - `http://` is refused;
  - downloads cannot escape the run directory.
- **Installer:**
  - against a temp HOME with a pre-existing unrelated Codex config and MCP entries: install twice gives an identical file, and uninstall leaves the unrelated entries byte-identical.
- **MCP:**
  - an in-memory client calls every tool against a stubbed provider;
  - asserts `structuredContent` validates against each `outputSchema`, `isError` on each code, the code-5 wording with and without an upstream id, and image content in previews.

**One live acceptance run, after asking first (about $0.20):**

- In Claude Code:
  1. Save Zed as an asset.
  2. Generate one still with GPT Image 2.5 at 1K (~6 credits) and see the preview in chat.
  3. Animate it with H3 image-to-video at 768P for 4s (~32 credits).
  4. Call `frames`.
  5. Confirm the job record's actual cost came from `creditsConsumed`.
- In Codex: confirm the tools list and `status`.

## Out of scope

ChatGPT access, the web app, in-app chat, audio generation, shot plans and the quality comparison.

## Revision log

- 2026-10-30: first version approved in conversation.
- 2026-10-30, after outside review:
  - Added local job ids written before submission, so an uncertain job without an upstream id is still tracked. A `sending` state marks the in-flight create, so a crash mid-call ends `uncertain`, not free.
  - The spend lock is no longer held across the network call; reservations with recovery replace it.
  - Failed jobs count 0 only when the provider confirms no charge.
  - Cost now comes from `creditsConsumed` instead of balance differences, which double-count overlapping jobs (a problem the review exposed indirectly).
  - Defined multi-image asset reference mapping and `#n` selection.
  - Added input and file-safety rules.
  - Made the installer idempotent and scoped to our own entries.
  - Added structured MCP results, tool annotations and `isError`.
- 2026-10-30, while planning step 3: added `failed-charged`, because a failed task whose record reports credits consumed is neither free nor unconfirmed. A create the provider rejects outright is `failed-confirmed-free`, matching the existing failover rule. A budget or cap refusal writes no job record. Finishing functions stay in `cli/lib/` rather than moving to `core/finish.mjs`; the MCP server calls them directly.
- 2026-10-30, while planning steps 4-5: the content checks apply wherever a file can leave the machine (uploads, local references, asset images); the allowed-folders rule applies to every path the MCP server receives. The CLI keeps accepting any path a human types, guarded by the host's command approval, and its `--ref` still refuses raw local paths (assets and URLs only). Reference expansion lives in `core/refs.mjs`.
- 2026-10-30, while planning step 7:
  - Error details are in `_meta.error`, not `structuredContent`: SDK 1.32 clients validate `structuredContent` against the `outputSchema` even on `isError` results.
  - The read-only views live in `cli/core/views.mjs`, shared with the coming web app.
  - Relative client paths resolve inside `runs/`; every path is confined to the allowed roots, media or not (`confinePath`).
  - `generate_video` takes a preset for defaults only; the prompt is always required, so the raw source-prompt path does not exist over MCP.
  - A job that fails after submission is not failed over by the server; `wait_job` says whether it was charged and the agent decides.
  - Previews are ffmpeg JPEGs (768 px for images, the contact sheet at 1024 px for video).
- 2026-10-30, while building steps 5-7:
  - `assemble`'s transition name is limited to a plain ffmpeg xfade name (`^[a-z0-9]+$`), because it is pasted into an ffmpeg filter and a free string could add filter options.
  - Image paths inside `render` props are confined to the allowed folders and `file:` URLs are refused, because the renderer loads them as `file://` URLs in a headless browser and would otherwise copy any image on the machine into a render.
- 2026-10-30, after verified review findings (branch `harness-mcp`):
  - Codex block: ours only when its body is exactly the header, `command`, `args` and `tool_timeout_sec` lines (a block from before the timeout line still counts); anything else between the markers is a conflict for install and uninstall, because toml_edit can place a table before our trailing END comment. The block sets `tool_timeout_sec = 300` (Codex defaults to 60 s), and the server instructions say to call `status` after a timeout before generating again.
  - Per-second pricing with a known duration and an unknown resolution uses the highest listed rate, not the flat fallback; the WaveSpeed H3 route now has per-second pricing (unverified, a floor).
  - `assemble`, `caption` and `render` refuse an `out` that already exists in the run (code 3).
  - After a job is submitted, a failed `library.recordUse` becomes a warning and the result still carries `localJobId`; `upstreamTaskId` is always a string.
  - A silent track's loudness is null, not NaN, so `probe` returns (`parseLoudnorm`).
  - `wait_job` reports "pending" only for `waitForTask`'s own deadline (`timedOut: true`); any other code-5 error is rethrown naming the job, which stays submitted.
  - A Claude Code entry counts as ours only at user scope; the same name at another scope is a conflict for install and ignored by uninstall.
  - Render props refuse `http:` and `https:` URLs over MCP (code 3).
