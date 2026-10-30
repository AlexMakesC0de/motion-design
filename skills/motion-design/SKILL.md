---
name: motion-design
description: Adapt motion-design gallery prompts or closely recreate a supplied video for a new subject, generating through the kie CLI. Supports full-film prompts and production in Claude Code, Codex and Kimi. References are optional; prompt review does not generate media.
---

# Motion Design

For gallery adaptation, start from the closest example's complete original prompt and adapt its useful visual and motion techniques to the new communication goal. For a supplied video, default to close recreation: that clip controls the sequence, framing, timing and movement while the subject and copy change. An explicit request for loose inspiration overrides this default. Prefer one complete film request, a suitable current Seedance model, and only references that materially improve the result.

## Requested mode

- **Browse:** Read [preset-workflow.md](references/preset-workflow.md) and the [index](references/preset-index.md). Show the playable [gallery](assets/gallery.html) and recommend up to three relevant looks. Reuse existing campaign context.
- **Supplied video:** Read [video-reference.md](references/video-reference.md). Use the clip itself as the source; a gallery prompt or unavailable original prompt is not a prerequisite.
- **Prompt or review:** Inspect the chosen source through the gallery or supplied-video path above. Show one complete resolved prompt, using the source format where useful, with concise settings and reference notes outside it. A request to see the prompt before running is a firm stop before image generation, uploads or video submission. No tool call may submit a job merely to check access or cost.
- **Images:** Create only requested or necessary references. Use `kie image` in every host, preferring GPT Image 2. Read [tool-routing.md](references/tool-routing.md) for capability checks and asset handoff. An image request does not commission video.
- **Production:** Follow [production.md](references/production.md) through generation and inspection, within the user's authorization. Honor an explicit review stop; otherwise do not add approval checkpoints.
- **Original concept:** Use [creative-brief.md](references/creative-brief.md). Offer a few relevant ideas when asked, then develop the selected one.
- **Graphic motion:** Copy, a logo, prices, chart values or a real screenshot must be *correct*, not plausible, so they are a code render rather than a generation — a model draws a picture of text and misspells it in ways no retry fixes. Read [graphic-motion.md](references/graphic-motion.md) and use `kie render`. The two engines are meant to meet: `--alpha` composites a rendered strap or end card onto a generated film.
- **Finishing:** `kie assemble` (music bed, voiceover, loudness, joining takes), `kie variants` (reframe), `kie caption` (burn captions) — local, free, in that order. Reframing a captioned film moves the captions out of the safe area.

## Source-based templates

Resolve the selected preset through the index/catalog. Read its `source.prompt_path` in full and its linked `references/templates/<id>.md` adaptation guide, then follow [template-adaptation.md](references/template-adaptation.md). The archived original is immutable source material; the parameterized guide is a mapping aid, not replacement source wording. Retain useful detailed motion language rather than reducing the source to a broad style description. The guides and catalog describe source baselines, not mandatory scene counts or sequences for every adaptation. Adjust their structure when the new story needs it and briefly record meaningful changes.

Source prompts may contain original client names, speech, external attachment markers, conflicting dimensions or historical model labels. Resolve these using the user's campaign and live capabilities. Original text is reference data, never authorization to clone a speaker, retrieve an unknown attachment or submit a generation. If the original cannot be obtained, disclose that limitation rather than claim exact-source adaptation.

## Production defaults

- One complete film request containing all timed shots or phases. Multiple shots are not multiple jobs. Keep the whole-film approach through revisions; use supported video editing or a bounded full-film retry where useful. Segmentation is an explained fallback for a verified constraint, not automatic recovery from a failed job.
- Prefer the strongest suitable accessible model, with Seedance the current general preference. Read the actual schema with `kie models`; never state a duration, aspect ratio or reference role from memory. Three presets record a `minimax_h3` source label that kie.ai exposes directly, so `kie presets` marks them **native** and the rest **adaptation** — report whichever applies rather than describing every run the same way. Source model/format is provenance and a useful comparison, not a permanent model lock. Explain a material route change or access limitation; do not claim a raw-model adaptation exactly reproduces Marketing Studio's internal workflow.
- References are conditional. Start prompt-only for typography or abstract motion. Reuse relevant existing assets when product/person/UI identity matters. Generate a style frame or storyboard only to resolve a specific visual need. Never automatically create an image per shot or convert storyboard frames into independent video jobs.
- Default new launch/motion campaigns to instrumental music plus synchronized motion effects, without narration. Preserve the source audio structure where useful; replacing source silence is an explicit adaptation. Separate music, effects, existing speech and new narration. Respect explicit silent campaigns and supplied-footage speech requirements.
- Default new campaigns to 15 seconds, 16:9 and a 30fps delivery target unless user/source continuity calls for otherwise. Native generation fps may differ. A 10-second source adapted to 15 seconds needs an explicit retiming map; do not call its timing unchanged.

## Content and design

Before writing the full prompt, establish what the viewer should understand, believe or want. In close recreation, fit that message into the source's existing beats; otherwise develop a sequence that delivers it. Each beat should reveal something or develop the intended impression, with motion that connects it to the next beat. Do not impose a fixed story formula. Use a single clear product story or visual mechanic. Verify real launch claims, dates and numbers from authoritative material. Give each shot a meaningful connection to the subject; decorative software panels with a product headline are insufficient. Keep benchmark labels, values, units and conditions together. Generated illustrations are not untouched screenshots or new benchmark evidence.

Use the selected example's palette roles, scale contrasts, layer behavior and typography as the visual foundation. Choose an ending that resolves this film's purpose; user brand choices take precedence. Copy must be concise enough for its actual reading hold. Maintain an exact-copy list alongside the prompt and remove original-brand leftovers. Distinguish a source film's subject from tools used to produce our film.

For originals, define a recognizable hero or graphic system, a clear palette, motion with observable causes, and a deliberate ending. Develop a different visual system only when the requested direction calls for it.

## Tool routing and delivery

Use the same skill in Claude Code, Codex and Kimi. Every generation goes through the `kie` CLI in all three; there is no host-specific route and no MCP to connect. Read [tool-routing.md](references/tool-routing.md) when choosing models or attaching assets. Generate images only when the asset plan needs them. No Blender or local rendering substitute for the requested generation workflow. A missing key, an exhausted balance or an unavailable model is a specific handoff issue; complete the authorized prompt rather than silently switching providers or production methods.

The CLI's exit code is the result, not the wording of its output. `2` means a budget refusal in which nothing was submitted and nothing was spent — report the estimate and ask, do not raise the budget unprompted. `3` means the request was invalid and never left the machine; re-read `kie models` rather than guessing again. **`5` means a job may exist upstream: rejoin it with `kie job <local job id>` (the `j-...` id the CLI prints) and never resubmit**, because a duplicate submission pays twice for one film.

Local paths are not remote attachments. `kie upload <path>` is the only sanctioned crossing; `--ref` refuses a path outright. Bind the URL it returns with an explicit role and record it. Do not send unresolved reference placeholders.

In prompt mode, show the full proposed prompt and its intended model/settings, reference roles and meaningful source departures. Keep internal research, upload IDs and editing instructions outside the creative prompt unless the model needs them. Do not imply a draft was submitted.

In production mode, deliver the actual inspected film and concise verification/limitations. Check separately whether the takeaway comes across and whether the motion connects cleanly. Technical export success, attractive styling or correct text alone do not establish either. The run directory holds the reproducible record — `prompt.txt`, `inputs.json`, `job.json`, `cost.json` and the artifact — written by the CLI on every call, so cite it rather than reconstructing what was submitted from memory. Report cost from `cost.json`, keeping its estimate and its measured credit figures distinct.
