# `kie` — the execution layer

The skill decides **what** film to make. This decides **how** it reaches
kie.ai, what it costs, and where the record lands.

## The one structural rule

**No kie.ai model id, endpoint or price appears anywhere in the skill prose.**
The skill says `kie video --preset kinetic-typography`; everything kie knows
lives in `models.json`.

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
| `lib/models.mjs` | Catalog load, model resolution, request validation, `--ref` parsing |
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
| `5` | **Uncertain** — the job may exist | `kie job <id>`. **Never resubmit** |

Code `5` exists on its own because `production.md` forbids duplicate submission
after an ambiguous response. A create that times out, aborts mid-flight, or
returns 200 with no task id all land here rather than being retried into a
double charge. The only creates that *are* retried are those definitively
rejected before any work happened: an explicit `429`, or a connection that never
opened.

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
