# Model routing and host compatibility

One shared skill supports Claude Code, Codex and Kimi. All three drive the same
`kie` CLI through the shell, so there is no host-specific generation route, no
MCP to connect and no capability that exists in one client and not another.

| Task | Every host |
|---|---|
| Browse examples or draft a prompt | Local skill files; no generation, no key required |
| Read what a model can actually do | `kie models --capability video` |
| See a preset's route and fidelity | `kie presets` |
| Check cost and settings without spending | `kie preflight --model M --duration N --ar R` |
| Create needed reference images | `kie image --run SLUG --prompt "..."` |
| Bring a local asset in | `kie upload <path>` |
| Generate the complete film | `kie video --run SLUG --preset P` |
| Rejoin an uncertain or long job | `kie job <taskId> --run SLUG` |
| Draw text, a logo, numbers or a screenshot | `kie render --template T` |
| Read a file's real duration, size and loudness | `kie probe <file>` |
| Add a music bed, a voiceover, or join takes | `kie assemble --run SLUG` |
| Burn captions | `kie caption --run SLUG` |
| Reframe to another aspect ratio | `kie variants --run SLUG` |
| Inspect and finish | Read the run directory; play the artifact |

Explicit user choices override defaults. The CLI is the only generation route:
if it cannot run, finish the prompt and asset plan and explain what is missing.
Do not substitute a different provider, an MCP tool or a local renderer.

## Never state a capability from memory

`kie models` prints each model's real durations, aspect ratios, reference roles,
native-audio support and estimated price. kie.ai's catalog moves fast enough
that any figure recalled from training data or from an earlier session is
untrustworthy — several generations of Seedance, Kling and Wan are live
simultaneously. Read the table; quote the table.

The CLI refuses an unknown model locally rather than forwarding it, so a guessed
`--model` fails instantly and for free (exit `3`) instead of after an upload.

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
