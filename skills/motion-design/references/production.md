# Full-film production and media handoff

Read only for authorized asset/video production. User-requested prompt review ends before generation or upload.

## Resolve the film and route

For gallery work, read the selected original prompt and adaptation guide, then use [template-adaptation.md](template-adaptation.md). For a supplied video, follow [video-reference.md](video-reference.md) with the clip as the source. Create the compact before/after review record in [quality-review.md](quality-review.md). Select the strongest suitable accessible model, preferring current Seedance where a preset has no native route. Inspect duration, aspect ratio, reference roles/limits and audio support with `kie models`, never from memory; `kie presets` shows the route and fidelity a given preset resolves to.

Keep source endpoint/format as provenance. A Marketing Studio SaaS source and a Seedance adaptation are different routes; preserve the creative template while disclosing this difference. Do not guess an unavailable preset slug or interpret catalog exposure as account entitlement. `kie preflight` and `kie doctor` are read-only and answer cost and access questions without spending; **never submit a generation as a probe.** A budget refusal (exit `2`) submits nothing and spends nothing — report the estimate rather than raising the cap unprompted.

One request should contain the entire film. A provider failure does not establish that the duration or shot count is unsupported. Inspect the returned error and current schema before changing approach. If the preferred route is unavailable, explain a concrete suitable fallback. A material change to the user's one-film method requires their acceptance; do not silently begin separate clip production.

## Decide whether references help

- **Prompt-only:** Type, abstract motion and scenes whose identity can be expressed adequately in text.
- **Existing assets:** Product appearance, recognizable people, actual software outputs or supplied footage. Use the minimum set covering the required identity/content.
- **Generated references:** A style frame, hero design or storyboard that resolves a specific ambiguity. Follow [tool-routing.md](tool-routing.md): `kie image` in every host, preferring GPT Image 2. Inspect the result. A storyboard is optional full-film reference material, not an instruction to create one video per frame.

Identify each asset's purpose: identity, style, motion reference, start frame or end frame. A generic reference must not accidentally become a start frame that fixes the film to one layout. Use a storyboard contact sheet only when supported as a general reference and explicitly describe its panels as temporal guidance; never supply it as the literal opening image.

Reuse acquired assets. Do not regenerate source screenshots to make them look more polished. Only create assets the chosen request will actually use. Record whether the model output is an illustration or preserves original source media; do not promise pixel-exact screenshots from conditioning alone.

## Submit the complete request

Upload only the selected assets with `kie upload`, then bind the URLs it returns through `--ref <url>:<role>` with real roles. A local path passed to `--ref` is refused outright. Preserve the exact reviewed creative prompt; technical adaptation should not silently change its content. Include every shot and shared motion rule in the same request, with one requested output by default. Never send unresolved source attachment markers, draft paths or placeholders as remote inputs.

For audio-enabled campaigns, include both the soundscape and music directions in the full prompt and enable native audio where supported. Music and effects do not imply narration. If native audio is unavailable, explain the needed audio route before changing the workflow. Respect explicit silence or source-speech instructions.

The CLI writes the reproducible record itself into `runs/<slug>/` on every call — `prompt.txt` (the exact submitted bytes), `inputs.json` (source prompt path and hash, model, settings, reference roles), `job.json` and `cost.json`. Add what only you know: deliberate changes, the exact-copy list, and source or evidence URLs. A failed or uncertain submission is not a completed film. **Exit `5` means the job may exist upstream — rejoin it with `kie job <taskId> --run <slug>`, never resubmit**, because a duplicate submission pays twice for one film. A corrective retry writes `out-2.mp4` beside the original rather than replacing it.

## Inspect and revise

Inspect playback for the full sequence: shot order, transitions, camera amplitudes, light/dark passages, pacing, identity, text, data and ending. Compare with both the original reference and product content map. Fill the observed result and evidence in the [quality review](quality-review.md), including any uninspected requirement. Representative stills alone cannot establish smooth temporal behavior.

Listen for music/effects synchronization, unintended speech, clipped audio and a clean ending. Exact copy and benchmark values must survive the rendered frames; prompt instructions are not proof. The original preview's polish is not a guarantee of first-attempt output.

Default to one corrective full-film generation within the authorized run, unless the user sets another retry or budget limit. Pass `--budget` to make that limit enforced rather than intended. Retain the original result for comparison — artifact numbering does this automatically, so never delete a take to make room for another. After that, report the unresolved issue and next action rather than starting an unbounded paid loop. Do not make segmentation the corrective default.

Technical finishing such as trimming/conforming is optional and must not replace the intended generation method. An exact typography/source-media composite is a disclosed fallback when generated content fails, not a mandatory production pipeline. Finishing beyond what the model returns is deliberately out of scope here; do not introduce Blender or a local render pipeline as a substitute for the requested generation. Verify the delivered duration, dimensions, fps, audio, copy and final hold. A 15-second 30fps delivery has 450 frames, but frame count alone says nothing about visual fidelity.

Deliver the inspected film or the precise remaining limitation. Distinguish prompt-ready, submitted, completed and reviewed states.
