# `kie`: Shard's command line

The studio, an agent or a skill decides **what** film to make. This decides **how** it reaches
kie.ai, what it costs, and where the record lands.

## The one structural rule

**No provider model id, endpoint or price appears anywhere in the skill prose.**
The skill says `kie video --preset kinetic-typography`; everything the providers
know lives in `models.json`.

This is not tidiness. kie.ai's catalog carries Seedance v1-lite through 2.5,
Kling v2.1 through 3.0 and Wan 2.2 through 3.0 *simultaneously*, and it moves
weekly. If model ids leak into markdown, the markdown rots silently and an agent
confidently calls a dead endpoint halfway through a paid film. One file to
update instead of six.

Corollary: **the CLI refuses an unknown model rather than forwarding it.**
`--model seedance-3` fails locally in milliseconds with the real list, not as a
404 after an upload.

## Layout

| Path | Does |
|---|---|
| `kie.mjs` | Arg parsing, command dispatch, the submit→poll→download→record path |
| `models.json` | The only place kie.ai knowledge lives |
| `lib/providers.mjs` | Provider config, per-provider keys, URL/body shapes, **the failover policy** |
| `lib/models.mjs` | Catalog load, model resolution, route selection, per-route input building |
| `lib/client.mjs` | Key resolution, HTTP, create-rate throttle, retry policy |
| `lib/poll.mjs` | Task polling, result-shape extraction, download |
| `lib/upload.mjs` | Local file → remote URL, the only sanctioned crossing |
| `lib/budget.mjs` | Pre-flight refusal |
| `lib/ledger.mjs` | Append-only spend record |
| `lib/run.mjs` | Run directories, artifact numbering |
| `lib/presets.mjs` | Preset lookup and native-vs-adaptation routing |
| `lib/errors.mjs` | The exit-code contract |
| `lib/ffmpeg.mjs` | Binary detection, probe, loudness measurement, ratio table |
| `lib/assemble.mjs` | Crossfade timing, the ad audio mix, two-pass loudness |
| `lib/caption.mjs` | SRT parsing/validation, alpha-overlay compositing |
| `lib/variants.mjs` | Aspect reframing and the caption-order guard |
| `lib/render.mjs` | Bridge to the Remotion project in `render/` |
| `director/menu.json` | The director's fixed vocabulary: sizes, angles, lenses, moves, lights, cuts, jobs, film types |
| `director/files.mjs` | The film's files (`brief.json`, `shots.json`, `reviews.json`, `cut.json`, `production.json`, `agreement.json`): atomic writes, a per-film lock, `.history/` (newest 50 versions), links refused |
| `director/brief.mjs` | The brief's fields and their checks |
| `director/check.mjs` | The script supervisor: errors that block, warnings that advise |
| `director/fit.mjs` | Can a model film a shot from its still, at what generated length and price |
| `director/pick.mjs` | The model picker, from `goodFor` ratings |
| `director/wording.mjs` | One shot worded for its model, from `promptProfile` |
| `director/plan.mjs`, `cost.mjs`, `show.mjs` | Saving and editing the plan, its cost, its text view |
| `director/still.mjs` | A shot's still (worded from the plan), the style still, reference sheets for Library assets |
| `director/film.mjs` | One take per shot, and Film all with its agreement |
| `director/media.mjs`, `board.mjs` | Which still and take each shot uses; the storyboard view behind `kie shots` |
| `director/review.mjs` | Frames of a take to judge, and the saved verdict |
| `director/redo.mjs` | Auto-redo: its setting (`production.json`) and the refilm within its limits |
| `director/cut.mjs` | The edit: trims, joins and fades into `film.mp4` |

Zero npm dependencies. Two optional binaries, and the CLI says which commands
need them: **ffmpeg** for finishing, and `render/`'s own `npm install` for
graphic motion. Generation needs neither.

## Exit codes are the contract

Agents branch on these. They are documented in `SKILL.md` and must not be
renumbered casually.

| Code | Meaning | The agent should |
|---|---|---|
| `0` | Done, artifact on disk | Inspect it |
| `1` | Usage error | Fix the invocation |
| `2` | **Budget refused** — nothing submitted, nothing spent | Report the estimate, ask |
| `3` | Unknown model / preset / role — never left the machine | Re-read `kie models` |
| `4` | Provider error, kie.ai's message relayed verbatim | Surface it |
| `5` | **Uncertain** — the job may exist | `kie job <local job id>`. **Never resubmit** |

Code `5` exists on its own because `production.md` forbids duplicate submission
after an ambiguous response. A create that times out, aborts mid-flight, or
returns 200 with no task id all land here rather than being retried into a
double charge. The only creates that *are* retried are those definitively
rejected before any work happened: an explicit `429`, or a connection that never
opened.

### Job records and the daily cap

Every paid job gets a local id (`j-20261030-a1b2c3`) written to
`runs/.jobs/` before anything is sent. `kie job <id>` waits for it and
downloads the result; `--no-wait` prints the id to come back with.

A daily cap in dollars (default $10) is checked before each submission:
`kie limits` shows the cap, today's spend and any unsettled jobs, and
`kie limits --daily 25` changes it. `kie limits --per-job 2` also refuses
any single job estimated above $2, whatever is left of the cap;
`--per-job off` removes that limit. Jobs in flight hold their estimate
against the cap until they settle. A job that fails with kie reporting 0
credits releases its hold; one with no cost report keeps it.

Cost is read from kie's task record (`creditsConsumed`), so `kie spend`
reports an actual figure per job. WaveSpeed reports none, so its jobs
count at the estimate.

When a submission ends uncertain without a task id, the job may exist.
Do not resubmit. Check the provider's task log, then record what you found:
`kie job resolve <id> --task <task id>` or `kie job resolve <id> --not-created`.

### Saved references (assets)

`kie asset save zed front.png side.png --kind character --description "Zed, a small round robot with one blue eye."`
copies the images into `library/zed/` (gitignored). Use them in any job:
`--ref zed:identity` sends every image of `zed`, `--ref zed#2:first_frame`
sends image 2. The CLI prints the mapping the prompt should use
(`@Image1 = zed#1`) and records it in the run. Uploads are reused for 20
hours, since kie deletes them after 24. Saving over a name needs
`--replace`; the previous version moves to `library/zed/.history/`.

A character can carry a real height: `--height 183` on `kie asset save`, or
`kie asset height zed 183` (`clear` removes it). It is said wherever the
character goes (its sheet prompt, scene references and Openjutsu swaps), so a
model draws them at the right size. The MCP `update_asset` tool takes it as
`heightCm`.

Every file is checked by its contents before it is sent: PNG, JPEG, WebP,
MP4, MOV, WAV, MP3, AAC or OGG, under 30 MB (200 MB for video). Results are
downloaded only from https URLs, only into the run directory.

### Director (planning)

`kie brief --run sea --file brief.json` saves a film's brief (takeaway,
length, frame, film type, tone, exact copy, sound) to `runs/sea/brief.json`.
`kie plan --run sea --file plan.json` saves its shot list to `shots.json`.
Every shot picks its size, angle, lens, depth, one move, light and cut from
`director/menu.json` (`kie plan --menu`); leave `model` out and the picker
fills it from the `goodFor` ratings in `models.json`, ruling out models that
cannot film the shot from its still. A plan the checker finds errors in is
refused (exit 1) with every reason; warnings are printed and never block.

`kie plan --run sea` shows the plan, the checker and the cost of one still
and one take per shot, at the length each take is generated (the shot plus a
one-second trim margin). `--wording` prints each shot's prompt in the shape
its model reads best (`promptProfile`), with the `--param` flags to pass;
`--suggest` explains each model choice. All of it is free. Old versions of
both files move to `runs/sea/.history/`. The craft behind the menu is in
`skills/motion-design/references/director/`.

### Director (making)

These spend kie credits unless noted. `--dry-run` plans the job and its
price and spends nothing; `--no-wait` returns once the job is submitted
(`kie job <id>` rejoins it). Each needs a plan that passes the checker
(`kie plan`), and the files they read are confined to `runs/`, `library/`
and `allowRoots`.

| Command | Does |
|---|---|
| `kie cast <asset> --run SLUG [--model M]` | A reference sheet for a Library character, product or location, made from its own images. Look at it, then `kie cast adopt <job id>` makes it the asset's first image (up to three earlier images follow it) |
| `kie voice list \| studio \| show <asset> \| set <asset> [--voice V] [--language L] [--file SCRIPT] \| record <asset> <file> \| local <asset> [--voice NAME] \| make <asset> [--dry-run] \| adopt <job id \| take> \| card <asset> [--name TEXT] [--words TEXT] \| clip <asset> --max-usd N [--resolution 480p\|720p] \| clear <asset>` | A Library character's voice. `record` keeps your own 2–30s recording (free; M4A and other formats are converted to MP3 by ffmpeg). `local` asks [VoiceStudio](https://github.com/debpalash/VoiceStudio), a free voice app running on this computer (`studio` lists its voices; `SHARD_VOICESTUDIO_URL` changes the address, which must stay on this computer). `make` spends one ElevenLabs v3 job reading the script in a preset voice. Listen to a take or sample, then `adopt` keeps it. `card` makes the voice card again (up to 15 seconds of the voice, cut at a pause, on a black 720p frame with the name; ffmpeg draws the name, or ImageMagick when ffmpeg cannot); `--words` saves exactly what it says. `clip` spends one Seedance 2.5 job: the character saying the card's words in that voice, lip-synced to the card; without `--max-usd` it prints the price. `adopt` keeps the clip too. Scenes send the talking clip whenever the character speaks, or the card until there is one |
| `kie still --run SLUG [--shot ID]...` | Each shot's first frame, in order; with no `--shot`, every shot without one. A shot that continues from the one before needs none |
| `kie shot --run SLUG --shot ID` | Film one shot from its still; also how a take is redone |
| `kie film --run SLUG --max-usd U` | Film every ready shot, wait for the takes, then film the shots that continue from them |
| `kie review --run SLUG --shot ID [--file REVIEW.json]` | Free. Without `--file`: the contact sheet and first and last frames of the take in use, and the shot's checks. With it: saves the verdict |
| `kie auto-redo on\|off --run SLUG [--max-usd U]` | Refilm takes judged redo on their own (`on` needs `--max-usd`) |
| `kie cut --run SLUG [--music M] [--vo V] [--end-card E] [--out F]` | Free, local. The edit, into `runs/SLUG/film.mp4` (`film-2.mp4` next time) |
| `kie shots --run SLUG [--json]` | Free. The storyboard: each shot's still, take and review |

**Stills.** The still is worded from the plan (look, framing from the menu,
the cast in their Library words, light) and made on the shot's `stillModel`
at the film's aspect ratio. The shot's cast go in as identity references and
the film's style still as a style reference, when the model takes references.
The style still is `look.styleStill`, else the first shot's still. It must be
a relative file inside the film folder; `..`, absolute paths, hidden folders
and addresses are refused. Stills are made one at a time, waiting between,
because the first becomes the style reference for the rest. With `--no-wait`
and no style still yet, only the first is made; run `kie still` again once it
lands. A still records a hash of its words, the film's aspect ratio and the
shot's still model. If any of them changes the still is stale, and it must be
remade before filming.

**Takes.** `kie shot` animates the still (image-to-video) at the generated
length, which is chosen from the route the take is submitted on (the shot
plus the trim margin), with the shot's wording and its model's params, audio
off unless it is a lip-sync shot. A shot on a continuous cut needs no still:
it starts on the real last frame of the shot before, so that shot must have
its take first. Filming a shot again clears a take somebody had chosen, so
the new one is the one in use. A missing or stale still, a take already in
flight, or a shot its model cannot film is refused with exit 1.

**Film all and the agreement.** `kie film --max-usd U` refuses (exit 2) when
what is left to film costs more than `U`. Otherwise it writes
`runs/<film>/agreement.json`: the agreed total, and each shot left to film
with its model, generated length and price then. From then on it films only
those shots, each at no more than its agreed price, and that price is the
take's budget, so the takes under one agreement never cost more than the
total. A shot that is not in the agreement, or whose price has risen, stops
the queue (exit 2) and needs a new total. Running `kie film` again with the
same total continues the agreement on record; a different total makes a new
one. A shot that has a take or is being filmed is skipped. A failed take is
reported and not refilmed (`kie shot` does that), and `kie film` then exits 4.

**Safety rules.**
- One take in flight per shot. It is checked early (before anything is
  uploaded) and again under the spend lock, so two callers cannot both pass.
  A take whose create ended uncertain counts as in flight: rejoin it, never
  resubmit.
- Each still and take is budgeted at its own estimated price (plus a cent
  for rounding), not the flat default, so a shot priced above $3 works. The
  per-job limit and the daily cap still apply.
- Film files are written through a new temporary file, never through a link,
  and saves of `shots.json` and `reviews.json` hold a per-film lock.
  `.history/` keeps the newest 50 versions of each file.

**Review and auto-redo.** `kie review` shows what to judge; the verdict is a
file: `{ "take": "<file>", "verdict": "pass|redo", "checks": [{ "check": "...",
"ok": true, "note": "..." }], "bestWindow": { "startS": 0.5 } }`. It is saved
against that take, so a new take is not taken as passed. `bestWindow` is
where the cut starts that shot. Auto-redo is off until the user switches it
on, in the studio or with `kie auto-redo on --max-usd U`, where `U` is the
most the film's takes may cost in all, first takes and redos together. With
it on, a redo verdict refilms the shot at once, at most 2 redos per shot and
within `U`; anything outside that is held back with the reason, and
`kie shot` stays the user's call. The setting is in `production.json`. The
MCP has no tool for it.

**The cut.** Each shot uses the take in use, starting at the review's best
window for that take, else 0.5 s in (the trim margin), for the planned length
(all of the take when it came back shorter). `dissolve` and `whip` cuts
cross-fade (0.5 s and 0.25 s); every other cut is a hard cut; a last shot cut
`fade-out` fades to black. `--end-card` (a rendered file) is joined after the
last shot with a hard cut; `--music` and `--vo` go through the same mix as
`kie assemble`. A bare file name is looked for in the run folder first. A shot
with on-screen copy gets a note: the cut does not draw text, so render it
with `kie render`. A take judged redo, or not yet reviewed, is still cut but
named in a note. `cut.json` records the segments, joins and notes.

### MCP server

`mcp/` is a separate package that exposes this layer to Claude Code and Codex
as tools (see [mcp/README.md](../mcp/README.md)). It calls the same
`cli/core` and `cli/lib` code, so it shares job records, the daily cap and the
asset library with the CLI: a job started over MCP shows up in `kie limits`
and `kie job`, and the other way round.

### Studio web app

`web/` is a local web app on the same `cli/core` (see
[web/README.md](../web/README.md)). Jobs started there share the job records,
the per-job limit, the daily cap and the asset library.

## Design decisions worth not undoing

**Video prompts come from a file, never argv.** These are 5–13KB with structured
newlines. Argv length limits and shell quote-mangling would corrupt them
silently — and you would blame the model. `--prompt-file` also puts the exact
submitted bytes on disk for free.

**`--ref` refuses a local path.** The skill states the rule twice in prose;
prose is skimmable, an exit code is not.

**Budget is a pre-flight refusal, not a report.** `SKILL.md` forbids submitting
a job to probe cost, and `production.md` forbids unbounded paid retry loops.
Both are only enforceable if the check happens before submission and can say no.

**Artifacts are numbered, never overwritten.** `production.md` says to retain
the original result for comparison, which is impossible if take two lands on
take one.

**Estimates and measurements are reported separately.** kie.ai exposes no
per-job cost — only an account balance. `estimatedUsd` comes from the hand-
entered prices here and is labelled a guess; credit deltas are sampled from the
account and labelled a fact. Dressing one up as the other is how a budget tool
stops being trustworthy.

**Failed jobs still enter the ledger.** A failed generation usually still costs
money; a ledger that records only successes under-reports spend systematically.

**The key is never a flag.** `KIE_API_KEY` → `./.env` → `~/.config/kie/key`. A
key in argv lands in shell history *and* in the agent transcript.

**Captions are rendered, not `subtitles`-filtered.** That ffmpeg filter needs
libass, and common builds lack it — Homebrew's 8.1.1 has neither `subtitles` nor
`drawtext`, and the failure reads as a filter-syntax error rather than a missing
feature. Captions are drawn by the render engine on alpha and composited with
`overlay`, which every build has. Better typography and the same brand kit as
every other template, for free.

**Loudness is two-pass and the delivered value is measured.** Single-pass
`loudnorm` is a dynamic normaliser: on this project's own test mix it landed at
−19.3 LUFS against a stated −16. The mix is now rendered, measured, and
re-normalised with the measured values fed back in — and then the *output* is
measured again, so `assembly.json` records what was delivered rather than what
was aimed at. Same rule as estimates versus credits.

**Reframe before captioning.** Captions burned in at 16:9 land mid-frame after a
9:16 reframe, and blur mode ghosts them into the letterbox band. `kie variants`
detects it via the run's `captions.json` and warns.

## Keeping `models.json` honest

Prices and schemas here were entered by hand — kie.ai's pricing and market pages
block non-browser traffic, so they could not be captured automatically.
Consequences:

- Every model starts `"verified": false`. `kie video` warns loudly on an
  unverified model. Flip it once you have seen real output from that model.
- The file carries a `captured` date and warns past `staleAfterDays`.
- `kie doctor` reports the key, balance, catalog age and unverified count.
- When a model's real schema disagrees with the table, **fix the table** — the
  table is what makes the refusals meaningful.

Adding a model is one entry: `capability`, `family`, provider `model` string,
the real limits, a price, and a note saying what it is for. A video model also
gets a `promptProfile` (the wording family, its prompt length limit and its
audio-off param), and a `goodFor` rating only when the table in
`skills/motion-design/references/tool-routing.md` rates it; a test keeps the
two in step.

## Two providers, one interface

kie.ai is primary and WaveSpeed is the fallback, because kie is cheap and
correspondingly less reliable. They are not shaped alike, and pretending
otherwise is what breaks:

| | kie.ai | WaveSpeed |
|---|---|---|
| Create | `POST /api/v1/jobs/createTask` | `POST /api/v3/{model}` |
| Model | a field in the body | **the URL path** |
| Body | `{ model, input }` | the input object itself |
| Poll | `?taskId=` query param | `/predictions/{id}/result` path |
| Errors | **in the body** (HTTP 200 + `code: 500`) | in the HTTP status |
| Balance | readable in credits | not exposed |
| Uploads | supported | not supported |

All of that is data in `models.json` under `providers`, so a third reseller is a
data edit. What is deliberately **not** configuration is the failover policy.

## When a fallback fires — and when it must not

A model carries an ordered list of routes. `canFailOver` in `providers.mjs`
allows a fallback on exactly one condition:

| Exit | Meaning | Fail over? |
|---|---|---|
| `4` | provider error — rejected, or failed upstream | **yes** |
| `2` | budget refused | no — our decision, not their outage. A fallback would spend what the cap just refused |
| `3`/`1` | invalid request | no — our bug. The second provider rejects it too, for money, after a delay |
| `5` | **uncertain** | **never** — the job may exist. Failing over pays twice *and* abandons the only rejoin handle |

WaveSpeed's own documentation reaches the same conclusion independently: *"do
not blindly retry POST submissions since disconnected responses may still
represent accepted predictions."*

**A fallback is always the same model at another reseller.** Falling over from
`minimax-h3` to Seedance would silently change the film, so a different model is
a separate entry in the table, never a route. Pinned by a test. Even a genuine
same-model fallback may not look identical — different defaults, possibly
different weights — and the CLI says so when it fires.

**Both attempts land in the ledger**, and `kie spend` breaks totals down per
provider, because a failed-over run may have been charged by both.

## Per-route contracts

`input` on each route is that route's real request shape, captured from its own
doc page. They disagree in ways that fail at submit with an unhelpful "This
field is required":

- kie's `wan` wants `duration` as a **string** and has no `aspect_ratio` at all
- kie's `seedance` wants it as an **integer** and requires `resolution`
- kie's `seedream` wants `quality: basic|high`, not the `low|medium|high` its
  siblings use
- the `first_frame` role is `first_frame_url` on kie and `image` on WaveSpeed

`buildInput` constructs the body from the route's contract and refuses locally
when a value is out of range. A route with `schemaVerified: false` has no
captured contract: the body is a guess, the CLI warns, and references are
**refused** rather than dropped silently, since there is no field to map them to.

### Prices follow the provider's billing unit

A route with `pricing: { per: "second", usdPerSecond: { <resolution>: <usd> } }`
is estimated as duration × the rate for the requested resolution, which is how
Seedance 2.5 and H3 bill on kie. `priceUsd` stays as the fallback when the
duration or resolution is unknown. `kie preflight --duration N --resolution R`
shows the estimate and how it was worked out.

### Passing a provider field the CLI has no flag for

`--param key=value` (repeatable) sends a field such as Seedance 2.5's
`generate_audio=false`. Only fields declared under the route's `input.params`
pass, with their type and allowed values checked locally. Anything else is
refused with exit 3, so a param can never replace the prompt or a reference
field. A route with no captured contract refuses every param.

### Camera and look picks

`kie video --pick key=id` (repeatable) adds camera and look words after the
prompt file's text, worded for the model (Hailuo gets its bracket command, for
example `[Push in]`). The keys are `move`, `speed`, `size`, `angle`, `lens`,
`light`, and the camera setup: `camera` (the body: `35mm-film`, `dv-camcorder`…),
`lensLook` (`anamorphic`, `warm-vintage`…) and `depth` (the aperture), which are
worded together as one "Shot on…" sentence, and `palette`, the colour palette
the grade follows (`blue-hour`, `teal-amber`…, or an `own-…` palette made from a
picture in the studio and kept in `library/palettes.json`), added as a
"Colour palette: …" line. The ids are the director's menu
(`kie plan --menu`, or `get_menu` over MCP).
`speed` needs a move other than `static`. An id the menu lacks, or a prompt
that goes past the model's `promptProfile.maxChars` only because of the added
block, is refused with exit 3 before anything is uploaded or spent. A prompt
with no picks is sent as before. `--dry-run` prints the added lines.
`prompt.txt` holds what was sent; `inputs.json` gains `picks` and `typedPrompt`.

### Reference rules

`input.refRules` holds what the provider documents as impossible:
`exclusiveGroups` (roles from different groups cannot share a job, e.g. Seedance
2.5's first frame with reference images) and `requires` (e.g. a last frame needs
a first frame). Violations are refused before anything is uploaded or spent.
An image-to-video model with its own contract carries it as `i2vInput`.
