# Higgsfield pipeline: what actually drives quality

Read 2026-10-30 by a research agent from Higgsfield's own pages plus third-party walkthroughs. **C** = stated by Higgsfield or directly observed; **I** = inferred. Higgsfield blog paths are under `https://higgsfield.ai/blog/`, help-center paths under `https://higgsfield.ai/creator-hub/help-center/`. Feeds [the quality plan](../quality-plan.md).

Higgsfield's pages never document how panel settings become model inputs.

## Cinema Studio

- Model: 3.5 was "powered by Seedance 2.0" (C, https://x.com/higgsfield/status/2044533035895558648); 4.0 names Seedance 2.5 (C, help-center/tools/how-do-i-use-cinema-studio). Engine is chosen per shot and panel settings persist across engines (C, https://higgsfield.ai/cinematic-video-generator). Same panel runs Kling 3.0, Veo 3.1 and WAN (C, blog/ai-video-camera-control).
- 4.0 controls: camera body (Modern, 35mm Film, 8mm Film, DV Camcorder); lens (Clean Sharp, Anamorphic, Vintage Anamorphic, Warm Vintage, Halation Vintage); aperture f/1.4, f/4, f/11; 30+ movement presets, one per shot; tempo (Auto, Chaotic, Dynamic, Calm, Single shot); genre, era, lighting presets, 50+ colour templates, emotion wheel tagged to @characters (C, blog/cinema-studio-4-0-complete-guide). 3.5 had focal length 8-75mm; 2.0 had 8-50mm.
- How settings reach the model: **nothing public.** Higgsfield: "the settings carry the technical direction, so the prompt covers the scene"; a lighting preset is "a firmer constraint than text" (C, blog/ai-video-camera-control). Their own example prompts still name real gear ("Arri Alexa Mini LF", "Laowa 24mm Probe") (C, blog/cinema-studio-3.5-full-tutorial). Most likely expanded into prompt text (I). No evidence of conditioning inputs.
- Still first: 2.0 was explicitly "Hero Frame First" with start/end frame upload (C, blog/cinema-studio-guide). 3.5/4.0 are video-first with native audio in the same pass (C). The short-film guide still feeds Popcorn frames into Cinema Studio shots (C, blog/ai-short-film-pipeline).
- 4.0 limits: up to 30s at 1080p, up to 50 references (API: 30 images, 10 videos, 10 audio), Edit Video, forward/backward Extend; references bound as "@Image 1" with a stated role (C).
- Published prompt structure (C, 3.5 tutorial): style opener, reference instructions, anti-IP and realism constraints, cinematography and lighting with a 60/30/10 split, skin and physics notes, numbered timestamped shot list with cut types, audio and aspect specs, negative constraints ("NO slow-motion").

## AI Director / Supercomputer

- Cinema Studio 3.5 chat ("Claude Chat", "Mr. Higgs") splits a script into shots with camera parameters pre-filled and sees the project's Elements by @tag (C, blog/cinema-studio-3.5-full-tutorial). Output per shot: a prompt plus Genre/Style/Camera settings. "Claude never triggers generation directly" (C). No regenerate loop, no evaluation step.
- Supercomputer: brief → plan → credit cost → approval; routes per step among Soul, Cinema Studio, Seedance, Nano Banana and LLMs (C, https://higgsfield.ai/supercomputer-intro). No automated self-review listed. Pipeline page: shot list, parallel shot generation, assembly (C, blog/ai-short-film-pipeline).
- Third party, worth copying: DirectorAgent (https://github.com/RohanKhollamkar/directoragent). LLM picks a 6-beat arc and a `render_class` per shot; a fixed table maps it to a model and drift threshold (face → Seedance 2.0 at 0.78, complex_motion → Kling 3.0 at 0.72, abstract_fluid → Wan 2.6 at 0.65, wide_environment → Veo 3.1 at 0.70); CLIP ViT-B-32 cosine of a mid-frame against the source photo; up to 3 retries per shot; cost gate.

## Popcorn

- Storyboard image tool: 4, 6 or 8 connected frames, up to 4 image references, auto or per-frame manual mode, 3:4 to 16:9 (C, help-center/ai-models/how-do-i-use-popcorn). Model and architecture unpublished. Likely one multi-reference generation (I); closest equivalents are Nano Banana, GPT Image or Seedream with multiple references plus a grid prompt.
- Frames become start frames or references for Kling or Veo; last frame of one clip chains as the next start frame (C). Third-party keyframe tutorial: Kling preferred for hitting an exact end frame, Seedance for looser multi-shot (https://www.michydev.com/higgsfield-cinema-studio-3-keyframe-animation-tutorial/).
- About 5 credits per scene of up to 8 frames (C, blog/ai-short-film-pipeline).

## Elements and Soul ID

- Soul ID: trained identity from 5-20 photos, ~3-10 minutes, ~25 credits one-time, works only in Soul 2.0 / Soul Cinema (third party, https://scriptable.com/posts/higgsfield/avatars-and-soul-training/). Method unstated.
- Elements: named saved assets (character, location, prop) from one or more images, no training (C). Inserted by @name; images injected behind the scenes (third party). Real people need Soul ID first (C, help-center/ai-models/how-do-i-use-seedance).
- Injection into video is the model's own multi-reference input, not weights: Seedance 2.0 up to 9 images / 3 videos / 3 audio; 2.5 up to 30 / 10 / 10 (C). Roles @character, @style, @motion (copies camera behaviour from a video), @audio (C). Kling treats a connected image as a start frame, so character refs need the Element tag (C, help-center/tools/how-do-i-use-canvas).
- Observed asset practice (C, blog/seedance4k-breakdown): character sheets on neutral grey (one face, one full body); locations in Soul Cinema at 16:9 wide 3/4; props in Nano Banana Pro because GPT Image looked flat; all saved as Elements; Claude writes prompts referencing the names.

## Reference-driven features

- DoP: Higgsfield's own i2v model, one keyframe plus a camera preset, 3 or 5s, no text-only (C, help-center/ai-models/how-do-i-use-dop). Model guide: DoP when camera work is the point, Seedance for realistic motion, Kling for stylised or longer clips, Wan for first/last-frame control, Hailuo for fast high-dynamic motion (C, help-center/ai-models/which-ai-model-should-i-use).
- Draw-to-Video: sketch arrows/shapes/text on the image, then any video model (C, https://curiousrefuge.com/blog/how-to-use-higgsfield-draw-to-animation).
- Lipsync Studio wraps Veo 3.1, Kling Lipsync, Wan Speak, Sync Lipsync 3 (C, help-center/ai-models/how-do-i-use-lipsync-voiceover-and-aspect-ratios).
- Upscale: Topaz and ByteDance up to 4K (C, PetaPixel).
- Video-to-video keeps motion/composition and regenerates the changed part (C, https://higgsfield.ai/video-to-video); backends unstated. No Recast page found.
- Marketing Studio: scrapes a product URL, pairs with an avatar, generates script/shots/edit on Seedance 2.0 with up to 9 refs, 15s clips max (C, https://higgsfield.ai/marketing-studio-intro). CLI skill lists nine modes (C, https://github.com/higgsfield-ai/skills).

## Default multi-shot workflow and cost

- Official pipeline (C, blog/ai-short-film-pipeline): script breakdown → Soul ID per character → Popcorn storyboard per scene → Cinema Studio shots fed by Popcorn frames → Seed Audio → Supercomputer assembly. **Image-first with reference chaining.**
- Credits (~$0.05 each): ~75 for an 8s 720p shot, ~150 for 15s 1080p (C, same page). Cinema Studio 4.0 with audio: 105 for 15s 720p, 240 for 15s 1080p (C, blog/cinema-studio-4-0-complete-guide). That is about $5.25 for 15s 720p, against our measured $4.73 on kie.
- No single default model; the CLI skill defaults video to `seedance_2_5` (C).
- Guidance: chain short clips with matching first/last frames because identity and lighting degrade past ~30s (C); Seedance help says problems often appear around 5-8s (C).

## Prompt enhancement

- UI Enhance toggle; Soul API defaults `enhance_prompt` to true (https://github.com/massimoseq3/UGC-OS/pull/704, third party). Enhancer drift reported (https://chasejarvis.com/blog/higgsfield-soul/).
- Per-model shaping claimed but undocumented; hidden templates in product-photo skills (C, github.com/higgsfield-ai/skills).

## Techniques that matter for quality, ranked by likely impact

1. Still keyframes and reference sheets before any video, passed as start/end frames or references.
2. Reusable references (neutral-background character sheets, location and prop stills) injected into every shot with an explicit role.
3. Model per shot: Seedance for people, Kling for exact end frames and motion transfer, Wan for first/last frame, Veo for wide environments.
4. Chain clips last-frame-to-first-frame; keep each clip ~8-15s.
5. Structured, sectioned prompts with timestamped shot beats and negative locks.
6. Separate "look" settings from the action prompt; keep wording identical across shots.
7. Automated drift scoring against the source image with a bounded retry count (DirectorAgent, not Higgsfield).
8. Low-resolution test pass, then re-render the keeper at final quality; upscale afterwards.
9. One variable changed per iteration; visual anchors (hair, clothing) in the prompt.
10. Know whether a prompt enhancer is rewriting your wording.

**Not documented anywhere found:** how camera/lens/aperture settings reach the model; Popcorn's model; Soul ID training; any automated evaluation loop; Recast's backend.
