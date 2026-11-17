# motion-design MCP server

Lets Claude Code and Codex use the kie harness as tools: look at models and
costs, save reference assets, generate stills and videos inside the spend
limits, wait for them, direct a film from brief to cut, and finish films. It runs locally over stdio and calls
the same code as the `kie` CLI.

## Set up

1. Install the CLI and its key first (see the main README); `kie doctor` should pass.
2. `node install.mjs` from the repo root. It installs this folder's
   dependencies and registers the server:
   - Claude Code: `claude mcp add --scope user motion-design -- <node> <repo>/mcp/server.mjs`,
     in the default config and in every profile folder under `~/.claude-profiles`
     that has its own `.claude.json` (each profile keeps its own servers).
   - Codex: a block between `# >>> motion-design >>>` and `# <<< motion-design <<<`
     in `~/.codex/config.toml` (backed up first). The block sets
     `tool_timeout_sec = 300`, because Codex defaults to 60 s per tool call and
     `wait_job` alone can wait 120 s. If anything other than our own lines sits
     between the markers (Codex's config writer can add a table there), the
     installer leaves the file alone and tells you to move it outside the markers.
   `node install.mjs --dry-run` shows what it would change. `--uninstall`
   removes only these two entries. A `motion-design` entry in Claude Code at
   local or project scope is never touched. `--no-mcp` skips this step.
3. Restart the host and ask it to call `status`.

## Tools

| Group | Tools | Cost |
|---|---|---|
| Look | `status`, `list_models`, `list_presets`, `estimate`, `list_runs`, `get_run` | free |
| Assets | `save_asset`, `list_assets`, `get_asset`, `update_asset`, `remove_asset` | free (`remove_asset` moves the item to `library/.trash`) |
| Generate | `generate_image`, `generate_video`, `wait_job` | spends kie credits |
| Finish | `frames`, `probe`, `assemble`, `variants`, `caption`, `render` | free, local |
| Direct | `get_menu`, `get_brief`, `save_brief`, `get_plan`, `save_plan`, `update_shot`, `check_plan`, `suggest_model`, `shot_wording` | free, local |
| Make (look) | `get_shots`, `review_shot`, `save_review`, `adopt_sheet`, `cut_film` | free, local (`save_review` can spend, see below) |
| Make (spend) | `make_sheet`, `make_still`, `film_shot`, `film_all` | spends kie credits; each takes `dry_run` |
| Scenes (look) | `save_idea`, `list_scenes`, `get_scene_prompt`, `save_scene`, `add_scene_image`, `choose_version`, `delete_scene`, `copy_scene` | free, local |
| Scenes (spend) | `draft_scene`, `final_scene` | spends kie credits |
| Skills | `list_skills`, `get_skill` | free, local |

## Skills

Your skill library is the `skills/` folder in the repo (see the main README). `list_skills` gives each skill's name and description. `get_skill` returns its instructions, and with `file` it returns any file inside its folder; paths that leave the folder are refused. Each skill is also an MCP **prompt** with an optional `request` argument, so hosts that show prompts as slash commands can run it by name. Prompts are read when the server starts, so restart the host after `kie skill add`.

## Scenes

The studio's Create > Scene tab, through tools. Create's own run is `create`.
A scene is one Seedance 2.5 reference-to-video generation, built from cards
(goal, scene, stages, style, audio) and up to 9 images; the studio and these
tools share `cli/director/scene-make.mjs`, so both send the same prompt.

- `save_scene` with an `id` replaces only the fields given (cards merge by
  key; `stages`, when given, replace the list). Change what the user named.
- A stage can carry `picks` (`move`, `speed`, `size`, `angle`) and the cards
  `picks` (`lens`, `light`): ids from `get_menu`, worded by Shard before the
  typed text. The cards' picks merge by key; send a key as `null` to remove it.
- `generate_video` takes the same six `picks` in one object (`move`, `speed`,
  `size`, `angle`, `lens`, `light`). Their words are added after the prompt,
  worded for the model. A prompt the picks push past the model's limit is
  refused before anything is spent.
- `get_scene_prompt` is free: the exact prompt, the images in order, what
  would stop it, and the draft, 720p and 1080p prices. Read it before spending.
- `draft_scene` (480p, draft mode) and `final_scene` (720p or 1080p) refuse
  with nothing spent while the prompt has problems; then `wait_job`.
- `add_scene_image` copies a picture into `runs/<film>/refs/` and returns the
  `file:refs/...` source for the scene's refs.
- `save_idea` saves what a film is about and, optionally, its scene list
  (titles and lengths); `copy_scene` copies a scene, its pictures and its
  versions' videos into another film, as the studio's Save into film does.

## Making a film

After the plan, the order is `make_still` for each shot (first shot first, it
sets the look), `get_shots` to show the storyboard, `film_all`, `wait_job`,
`review_shot` and `save_review` for every take, then `cut_film`. The spending
tools return a job id at once; call `wait_job`. Use them only as far as the
user asked.

- `film_all`'s `max_usd` is the total the user stated in this conversation,
  never one the assistant worked out. The first call writes
  `runs/<film>/agreement.json` (the total, and each shot left to film with
  its price). Later calls with the same total continue it and film only
  those shots, each at no more than its agreed price. A shot added since, or
  one whose price rose, stops it (code 2) and the user must agree a new
  total. It never refilms a failed take; `film_shot` does, once the user
  says so. Call it again after `wait_job` for the shots that continue from
  earlier ones.
- One take in flight per shot: `film_shot` and `film_all` refuse while the
  shot has an unsettled take, and never resubmit one that ended uncertain.
- Each still and take is budgeted at its own estimated price, so shots above
  $3 work; the per-job limit and the daily cap still apply.
- A shot's still must not be stale (its words, the film's aspect ratio or its
  still model changed since): `make_still` again before `film_shot`. A shot
  on a continuous cut needs no still.
- Auto-redo is the user's setting (studio, or `kie auto-redo`). No tool turns
  it on. With it on, `save_review` with a `redo` verdict refilms the shot at
  once (at most 2 redos per shot, within the total the user set) and says so;
  with it off, a redo waits for the user.
- `make_sheet` and `adopt_sheet` make and adopt a reference sheet for a
  Library character, product or location; only when the user asked to cast.
- `cut_film` reads `music`, `vo` and `end_card` from the run folder (through
  the same path checks as `assemble`) and writes a numbered `film.mp4`.

## Limits that protect your money

- Every job has a per-job budget, and all jobs share a daily cap
  (`~/.config/kie/limits.json`, $10 by default). Change it with
  `kie limits --daily N`; no tool can.
- `kie limits --per-job N` refuses any single job estimated above $N,
  whatever budget a tool call asks for. It is off until you set it.
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
  folder. `file:` URLs and `http:` or `https:` URLs in `props` are refused
  (remote URLs would be fetched from this machine). The renderer turns image paths
  into `file://` URLs for a headless browser, so an unconfined path would
  copy any image on the machine into a render.
- `brand` is a brand-kit name from `brand/`, never a path. `out` is a plain
  file name inside the run folder; if that file already exists the call is
  refused (code 3) rather than overwriting it. Omit `out` to number it.
- A job's price is estimated per second where the provider bills per second.
  With a known duration but no known resolution it assumes the highest rate.

## Errors

Errors are tool results with `isError: true`. The text starts `Error <code>:`
and ends with the next action; `_meta.error` holds `{ code, retryable,
nextAction, localJobId, upstreamTaskId }`. Codes match the CLI: 1 usage,
2 budget or cap (nothing spent), 3 invalid request or path, 4 provider error,
5 outcome unknown.

## Tests

`npm --prefix mcp test` (or `npm run test:mcp` from the root). Every provider
call is stubbed; nothing is spent.
