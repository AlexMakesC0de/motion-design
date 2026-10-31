# Model routing and host compatibility

One shared skill supports Claude Code, Codex and Kimi. All three drive the same
`kie` CLI through the shell, so there is no host-specific generation route and no capability that exists in one client and not another.

| Task | Every host |
|---|---|
| Browse examples or draft a prompt | Local skill files; no generation, no key required |
| Read what a model can actually do | `kie models --capability video` |
| See a preset's route and fidelity | `kie presets` |
| Check cost and settings without spending | `kie preflight --model M --duration N --resolution R --ar R` |
| Create needed reference images | `kie image --run SLUG --prompt "..."` |
| Bring a local asset in | `kie upload <path>` |
| Reuse a character, product or screen across jobs | `kie asset save <name> <image>... --kind K --description "..."`, then `--ref <name>:identity` or `--ref <name>#n:first_frame` |
| Generate the complete film | `kie video --run SLUG --preset P` |
| Make a directed film from its saved plan | `kie still`, `kie shot` or `kie film`, `kie review`, `kie cut` (see [production.md](production.md)) |
| See today's spend against the cap, and unsettled jobs | `kie limits` |
| Wait for a job submitted with `--no-wait`, or rejoin after exit 5 | `kie job <local job id>` |
| Draw text, a logo, numbers or a screenshot | `kie render --template T` |
| Read a file's real duration, size and loudness | `kie probe <file>` |
| See a clip without playing it; get its last frame for the next shot | `kie frames <video> --run SLUG` |
| Add a music bed, a voiceover, or join takes | `kie assemble --run SLUG` |
| Burn captions | `kie caption --run SLUG` |
| Reframe to another aspect ratio | `kie variants --run SLUG` |
| Inspect and finish | Read the run directory; play the artifact |
| Drive the harness from chat (Claude Code, Codex) | the motion-design MCP server: status → estimate → generate_* → wait_job; see mcp/README.md |

Explicit user choices override defaults. The CLI is the only generation route (the motion-design MCP server calls the same code):
if it cannot run, finish the prompt and asset plan and explain what is missing.
Do not substitute a different provider, another MCP tool or a local renderer.

## Two resellers, automatic fallback

The same models are reached through kie.ai (primary, cheapest) and WaveSpeed
(fallback). `kie models` shows every route with its price and whether it is
verified; an arrow marks the primary. A route whose provider has no key on this
machine is **skipped with the reason**, not an error, so one key is enough.

A fallback fires only when a provider genuinely errors. It does **not** fire on
a budget refusal, on an invalid request, or — most importantly — on an
**uncertain** result, because that job may exist and paying twice is worse than
failing. Rejoin with `kie job <local job id>` instead.

A fallback is always the same model at another reseller; a different model is a
different entry. Output may still differ slightly between resellers, and the CLI
says so when it falls back. Report it if it happened — it is a route change, and
`production.md` asks for material route changes to be disclosed.

`--provider kie|wavespeed` pins one reseller and explains why the others were
skipped. `kie providers` shows what is configured.

## Never state a capability from memory

`kie models` prints each model's real durations, aspect ratios, reference roles,
native-audio support and estimated price. kie.ai's catalog moves fast enough
that any figure recalled from training data or from an earlier session is
untrustworthy — several generations of Seedance, Kling and Wan are live
simultaneously. Read the table; quote the table.

The CLI refuses an unknown model locally rather than forwarding it, so a guessed
`--model` fails instantly and for free (exit `3`) instead of after an upload.

Provider fields without a flag of their own (Seedance 2.5's `generate_audio`, for a silent film) go through `--param key=value`; `kie models --json` shows which fields each route declares.

## Which model for which job

Quality tiers from third-party model reviews Alex read on 2026-10-31 (S is
best). They are judgements of output quality, not capabilities, and we have not
verified them ourselves; `kie models` still decides what a model can do and
costs, and an explicit user choice always wins.

| Job | S tier | A tier |
|---|---|---|
| Motion graphics | `minimax-h3` | |
| Cinematic | `seedance-2-5` | |
| Working from reference images | `seedance-2-5` | `wan-3-0` |
| UGC-style footage | `wan-3-0` | |
| Lip sync | `seedance-2-5` | `wan-3-0` |
| Text to video | | `seedance-2-5` |
| Video edit | | `seedance-2-5`, `wan-3-0` |
| Animation | | `seedance-2-5`, Kling 4.0 Flash |

The same ratings live in `models.json` as `goodFor`, where the director's model
picker reads them (`kie plan --suggest`); a test fails if the two disagree, so
change both together.

When the user has not chosen a model, start from the S-tier entry for the job
and say why; drop to an A-tier entry when it is the cheaper or the only one
that fits the duration, ratio or references (read the price from
`kie preflight`). Kling 4.0 Flash is not in the catalog yet (the kie.ai page
listed it as coming soon on 2026-10-30), so it cannot be chosen until
`models.json` has a verified route for it.

## Native routes versus adaptations

`kie presets` labels each preset:

- **native** — the source prompt's own `prompt_model_label` maps to a model
  kie.ai exposes. Three presets qualify: `kinetic-typography` and
  `editorial-collage` (`minimax_h3`), and `footage-overlays` (`minimax_h3_max`).
  These run on the model their prompt was written for.
- **adaptation** — the remaining seven record `marketing_studio_video` or
  `marketing_studio_image`. That is Higgsfield's internal orchestration product,
  not a callable model, and **no raw API reproduces it** — Higgsfield's own
  included. Running these on Seedance or Kling is a legitimate adaptation and
  must be described as one.

Passing `--model` over a preset's native route makes the run an adaptation. The
CLI reports that; repeat it rather than letting a fidelity claim stand unearned.

Preset defaults and model capability sometimes disagree — several presets
default to 15s while their native model tops out at 10s. The CLI refuses and
prints both routes with what each costs in fidelity. Choosing between a retime
and a model change is the user's decision, and a retime needs an explicit
retiming map (see [production.md](production.md)); do not pick silently.

## Two engines, and when not to generate

`kie video` is photographic; `kie render` is graphic and draws exactly what it
is told. **Anything that must be *correct* rather than plausible — copy, a logo,
prices, chart values, a real screenshot — is a code render**, because a model
draws a picture of text and gets it wrong in ways no retry fixes. Read
[graphic-motion.md](graphic-motion.md) before choosing, and note that the two
are designed to meet: `--alpha` renders a strap or end card that composites onto
a generated film.

## Finishing order, which is not obvious and does show

Finishing is local ffmpeg: no key, no spend, no budget check.

```
generate/render → assemble (audio, joins) → variants (reframe) → caption
```

**Reframe before captioning, never after.** A caption burned into a 16:9 film
and then reframed to 9:16 lands mid-frame instead of the vertical safe area, and
`blur` mode reproduces it as a ghost in the letterbox band. Each ratio needs its
own captions anyway. `kie variants` detects the mistake and says so, but the
order is the fix.

`kie assemble` normalises loudness in two passes and reports what it actually
delivered rather than what it aimed at. It also warns when given more than one
shot — joining takes is finishing, not a licence to generate a film piecemeal.

Captions are drawn by the render engine and composited with `overlay`, **not**
by ffmpeg's `subtitles` filter, which needs libass that common builds lack. That
means `kie caption` needs `render/` installed; `assemble`, `variants` and
`probe` do not.

## Reference images

1. Decide whether an image is needed at all. Reuse supplied product photos,
   screenshots or existing assets when they meet the need. A prompt-only film
   needs no image job.
2. Prefer **GPT Image 2** (`--model gpt-image-2`), matching the source
   workflow's preference. `nano-banana-2` is stronger on text inside the image,
   which matters for typography presets; `seedream-5-pro` is the cheap tier for
   throwaway style frames. Select quality and resolution for the asset's role —
   do not silently accept a low default for a detail-critical reference.
3. Confirm cost with `kie preflight` before generating. Model presence in the
   table does not establish account access, and **no job may be submitted merely
   to probe cost or access**. `preflight` and `doctor` are read-only and exist
   for exactly this.
4. Submit only within image or production authorization. A request to review the
   film prompt first is a firm stop before image generation, uploads and video
   submission.

## Bind images to the film

Record why each image is used: `identity`, `style`, `first_frame`, `last_frame`
or `motion`. Keep content references distinct from style references. A general
style image must not silently become a fixed opening composition — that is what
the `first_frame` role means, and the CLI treats it as such, switching to a
model's image-to-video route when one is present.

A local image path is not a remote attachment. `--ref ./logo.png:identity` is
refused with an exit code, not a warning. Run `kie upload ./logo.png`, then pass
the URL it prints. Never invent an identifier, reuse an unrelated asset, or pass
a local path as a public URL.

Every submitted prompt, model, setting, reference role and returned URL is
written into `runs/<slug>/` automatically. Keep private campaign material there;
`runs/` is gitignored, and account configuration and private asset URLs must not
be copied into this skill package.

## Connection help

Installing this skill and authenticating to kie.ai are separate steps. The CLI
reads `KIE_API_KEY`, then `./.env`, then `~/.config/kie/key` — never a
command-line flag, because a key in argv lands in shell history and in the agent
transcript. Get one at <https://kie.ai/api-key>.

Run `kie doctor` to check the key, the account balance, catalog freshness and
preset routing in one read-only pass. Do not configure anything merely because
the user asked to browse or draft.
