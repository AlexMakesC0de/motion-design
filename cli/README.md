# `kie` — the execution layer

The skill decides **what** film to make. This decides **how** it reaches
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
`kie limits --daily 25` changes it. Jobs in flight hold their estimate
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

Every file is checked by its contents before it is sent: PNG, JPEG, WebP,
MP4, MOV, WAV, MP3, AAC or OGG, under 30 MB (200 MB for video). Results are
downloaded only from https URLs, only into the run directory.

### MCP server

`mcp/` is a separate package that exposes this layer to Claude Code and Codex
as tools (see [mcp/README.md](../mcp/README.md)). It calls the same
`cli/core` and `cli/lib` code, so it shares job records, the daily cap and the
asset library with the CLI: a job started over MCP shows up in `kie limits`
and `kie job`, and the other way round.

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
the real limits, a price, and a note saying what it is for.

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

### Reference rules

`input.refRules` holds what the provider documents as impossible:
`exclusiveGroups` (roles from different groups cannot share a job, e.g. Seedance
2.5's first frame with reference images) and `requires` (e.g. a last frame needs
a first frame). Violations are refused before anything is uploaded or spent.
An image-to-video model with its own contract carries it as `i2vInput`.
