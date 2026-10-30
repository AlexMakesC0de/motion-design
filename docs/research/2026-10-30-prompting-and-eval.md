# Model-specific prompting rules and automatic evaluation

Read 2026-10-30 by a research agent. **[V]** vendor/official, **[T]** third party quoting or interpreting vendor docs, **[F]** unsourced practitioner folklore. The official Kling and Seedance pages could not be loaded directly, so those rules are second-hand where marked. Feeds [the quality plan](../quality-plan.md).

## Cross-model findings

- Every vendor guide shows one scene or a few shots per generation, never a 5-9 beat film. Seedance, Wan and Veo guides suggest 2-4 shots in 8-15s; Kling caps at 6 shots, 15s total.
- No published benchmark compares one long multi-shot prompt against one prompt per shot on the same content. Closest: frame-level prompts beat video-level prompts on adherence and scene confusion (https://arxiv.org/html/2505.20827v1); MSVBench finds high prompt alignment still drifts across shots (https://arxiv.org/html/2602.23969v1).
- Veo 3.1 preview in the Gemini API shut down 2026-10-22; GA Veo is on Google's enterprise platform and `gemini-omni-1.1-flash` is the suggested replacement (https://ai.google.dev/gemini-api/docs/video). Our Veo route is kie's, which is unaffected unless kie relied on the preview.
- **Our 3-6 KB, 5-9 beat prompts exceed every vendor's stated budget.**

## Seedance 2.x / 2.5

- Length: 2.0 runs 4-15s; 2.5 runs 4-30s with ≤50 refs. 2.5 guide: "no more than 500 Chinese characters or 1,000 English words"; longer prompts drop elements [T, https://prompt-architects.com/blog/216-how-to-prompt-seedance-2-0].
- Timestamps: 2.0 ignores them and reads only shot numbers; 2.5 accepts whole-second intervals that must be continuous [T, same].
- Runway: "precise timing is unstable, and forcing it can produce unpredictable results" on 2.0; let the model pace from the plot [T, https://runway.com/resources/seedance-2-0-prompt-guide].
- Label shots `Shot 1 / Shot 2` in event order; within a shot, camera or transition first, then action ("Shot 2: The camera cuts to a wide shot...") [Runway].
- "Lens switch" / "cut to" is community wording only [F, https://www.threads.com/@ai.academyhk/post/DPySrhODY97/].
- References: `@Image1..9`, `@Video1..3`, `@Audio1..3`, numbered by position within type. Bind each to a job ("@Image1 as first frame", "Reference @Video1 for camera"); an unbound reference lets the model "borrow anything from it". Most important assets first; 4-5 assets work better than the maximum [Runway; prompt-architects].
- Write `Subject 1@Image 1 runs` or add a noun so the digit does not fuse with the next word. Do not re-describe motion a reference video already shows.
- Multi-view sheets: 2.0 may read them as several people; 2.5 supports them. Prefer a headshot plus a full-body image. Real-face reference images are rejected.
- One camera move per shot; stacking push/pull/pan/tilt "increases image instability". Fast motion is where warping appears [Runway].
- No negative-prompt parameter; describe what should appear; close with "subtitle-free, no logo or watermark".
- Abstract emotion words give the model nothing visible to render.
- Audio symbols: `{}` dialogue, `()` music, `<>` sound effects, `【】` subtitles. Audio on by default.
- **`--seed`, `camera_fixed` and `frames` only apply to Seedance 1.x and are silently ignored on 2.x** [T, prompt-architects]. Every comparison therefore needs more than one sample per arm.

Skeleton: `Subject(@Image1 noun) + scene + style/lighting line. Shot 1: [one camera move], [framing], action. Shot 2: cut to [framing], action. (music) <sfx> {line}. No subtitles, no logo.`

## Kling 3.x (second-hand)

- Multi-shot up to 6 shots, 15s; custom mode gives each shot its own prompt and duration summing to the total, ≥1s each; per-shot prompt ≤512 chars; `prompt` and `multi_prompt` are mutually exclusive; `prompt` ignored when `shot_type=customize` [T, https://help.aliyun.com/en/model-studio/kling-video-generation-api-reference/, https://docs.magnific.com/api-reference/video/kling-v3/overview].
- Overall prompt ≤2,500 chars (Omni allows 3,072, recommends ≤2,500) [https://kling.ai/document-api/api/video/3-0-omni/image-to-video, search snippet].
- "Clearly label shots and describe each one's framing, subject, and motion"; define subjects first and keep wording identical across shots [T, https://blog.fal.ai/kling-3-0-prompting-guide/].
- Camera vocabulary: profile, macro close-up, tracking, POV, shot-reverse-shot; describe camera behaviour over time ("freezing when the subject pauses") [fal].
- I2V: the image anchors identity, layout and text; prompt only the change [fal].
- Elements: 2-4 views of a subject, referenced as `@ElementName`; I2V from a first frame allows ≤3 elements [T, https://vidmuse.ai/blog/kling-3-0-omni].
- Dialogue: `[Character A: Name, tone]: "line"`, unique consistent labels, action first then line [fal].
- Negative prompt support varies by provider and version; keep to ~5 terms [F, https://www.veed.io/learn/kling-3-0-prompts]. `cfg_scale` may only apply to v1.

Skeleton: `Master: [subject lock + style]. Shot 1 (3s): [framing, camera move] [@Element1 action]. Shot 2 (4s): ... Negative: blur, warping, text.`

## Veo 3.x

- Formula `[Cinematography] + [Subject] + [Action] + [Context] + [Style & Ambiance]` [V, https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1]. 4, 6 or 8s at 720p/1080p.
- Timed multi-shot: Google's own example uses `[00:00-00:02] ...` for 4 beats in 8s [V].
- Audio in separate sentences with `SFX:` and `Ambient noise:`. Dialogue syntax differs between Google pages (`A woman says, "..."` vs `the man says: ...`) [V, https://docs.cloud.google.com/vertex-ai/generative-ai/docs/video/video-gen-prompt-guide]; colon form claimed to avoid burned-in subtitles [T, https://www.screenweaver.ai/blog/prompting-veo-guide]. Test both.
- Ingredients: a reference image per character and setting, named in the prompt, reused for every shot [V]. Third parties report a 3-image limit and forced 8s [T, https://prompt-architects.com/blog/227-keeping-a-character-consistent-across-video-clips].
- I2V: prompt motion only; refer to "the woman" or "he" [T, https://molyin.com/guide/veo-3.1].
- Describe the wanted scene rather than negating. Garbled text common: generate clean, add text in post [T, https://blog.segmind.com/mastering-google-veo-3-beyond-prompting/].

Skeleton: `[Shot + lens + move], [subject], [action], [setting, light], [style]. SFX: ... Ambient: ... The man says: ...`

## MiniMax Hailuo

- ≤2,000 chars, "far more than a good shot needs" [V, https://platform.minimax.io/docs/api-reference/video-generation-t2v; T, https://www.eachlabs.ai/blog/how-to-write-better-hailuo-2-3-prompts].
- Bracketed camera commands, "more accurate" than plain language: `[Truck left/right]`, `[Pan left/right]`, `[Push in]`, `[Pull out]`, `[Pedestal up/down]`, `[Tilt up/down]`, `[Zoom in/out]`, `[Shake]`, `[Tracking shot]`, `[Static shot]` [V].
- Commas inside one bracket run simultaneously (≤3, e.g. `[Pan left,Pedestal up]`); separate brackets run in sequence where placed in the text [V].
- `[Push in]` moves the camera (background shifts); `[Zoom in]` magnifies flatly [T].
- I2V: image is the first frame; prompt the change and what stays still [T].
- One expression change per close-up, one signature move per action shot [T].
- Prompt optimizer on by default; turn off when relying on exact bracket commands [T].

Skeleton: `[Style]. [Tracking shot] Subject does one action, then [Push in] on one expression. Setting, light.`

## Wan 2.6 / 3.0

- Wan 2.6: prompt ≤1,500 chars, `negative_prompt` ≤500, `prompt_extend` default true [V, https://www.alibabacloud.com/help/en/model-studio/image-to-video-api-reference]. Wan 3.0: ≤20,000 chars, 2-30s, no negative field [T, https://fuser.studio/articles/wan-3-0-vs-wan-2-6].
- Multi-shot format: overall description, then `Shot 1 [0-3 s] ...` with transition and camera [V, https://www.alibabacloud.com/help/en/model-studio/text-to-video-prompt].
- 2.6 `shot_type=multi` works only with `prompt_extend=true` and overrides shot instructions in the prompt [V].
- Single take on 3.0/2.7: start with "One continuous shot".
- Alibaba's own failure list: real people by name, rapid scene changes in one clip, exact text legibility, very long or complex action, lip-sync to specific words [V].
- I2V formula: "Motion + Camera movement". Orbit arcs under 45°. Write "No dialogue." / "No background music." or the model invents them.

Skeleton: `[Overall story]. Shot 1 [0-3s]: [size/angle], [camera], action. Shot 2 [3-6s]: hard cut, ... Negative: blur, watermark, text.`

## Image-first keyframe practice

- Practitioners agree I2V improves identity and composition control; no independent benchmark found [T, https://dev.to/smophyai/text-to-video-vs-image-to-video-which-actually-produces-better-results-4h79]. ByteDance's Seedance 1.0 paper (potentially biased) reports Veo 3 sometimes altered lighting and textures relative to the reference (https://arxiv.org/html/2506.09113v1).
- Pipeline: character sheet (2-3 angles, 12 for large projects) → keyframes or a 3×3 storyboard grid → I2V on the frames [T, https://invideo.io/faq/seedream-45-vs-nano-banana-pro-which-ai-model-is-better/, https://help.apiyi.com/en/nano-banana-pro-ai-video-storyboard-character-consistency-guide-en.html, https://www.atlascloud.ai/blog/tips/seedream-5-0-15s-workflow].
- Copy the character description verbatim into every frame prompt (GPT Image 2 drifts on ethnicity, wardrobe, face); tell the model to use the sheet for identity only, not its layout or grey background [T, https://vicsee.com/blog/gpt-image-2-seedance-storyboard-workflow].
- Nano Banana Pro for photoreal adherence, Seedream for stylised (one comparison) [T, invideo].
- Chain shot N's last frame into shot N+1's first frame. Separating image and motion stages shows whether the keyframe or the motion prompt failed [T, dev.to].

## Evaluation methods, ranked by cost then signal

| # | Method | Cost | Signal |
|---|---|---|---|
| 1 | OCR on 4-8 sampled frames vs the expected string | ~0 | High for text. VLM judges are "too harsh on text rendering" (https://arxiv.org/pdf/2501.19252) |
| 2 | Per-beat VLM checklist on frames, plus Gemini on the full clip for motion | low | Moderate |
| 3 | DINOv2 similarity to the first frame or reference | very low | Good for identity drift, poor for quality |
| 4 | Learned reward models (VideoScore2, VideoAlign) as best-of-N rerankers | GPU/API | Moderate, with caveats |
| 5 | Flicker, flow warping, VBench dimensions | low | Weak as a ranking signal |
| 6 | Human pick | high | Ground truth |

- 8 uniform frames plus a task-specific rubric is standard (https://arxiv.org/pdf/2608.09111). VGI-Bench samples 2 fps with a complete/partial/failed rubric scored 1/0.5/0 (https://arxiv.org/html/2608.19583v3).
- VLM-judge agreement with humans ~0.5-0.75, ~70% pairwise. Gemini 3 Flash 73.2% pairwise, GPT-5-mini 64.3%, Claude Haiku 4.5 47.9% on frames (VGI-Bench). Native video input judges better. Weak on text, counting, fine artifacts.
- Best-of-N with VisionReward/VideoScore/VideoLLaMA3 verifiers works but every candidate is fully generated (https://arxiv.org/pdf/2503.18942). VideoScore2 gives scores with rationales (https://arxiv.org/pdf/2509.22799).
- VideoAlign motion-quality correlation with humans was only +0.161 in one study; reward models can suppress motion (https://arxiv.org/html/2605.14269v1, https://arxiv.org/pdf/2511.22974).
- Rule-based CLIP/DINO metrics showed ~28% alignment with humans on temporal coherence (VMBench, https://arxiv.org/html/2503.10076v2). VBench-2.0 Controllability and Human Fidelity dimensions are the relevant ones (https://arxiv.org/abs/2503.21755).
- Task-specific per-sample rubrics recover human rankings better than fixed benchmarks, and pairwise beats absolute scoring (VideoArgus, https://arxiv.org/pdf/2608.05485).
- No published practitioner best-of-N recipe. Inferred: 3-4 candidates at draft resolution, OCR and DINO gates, Gemini rubric on survivors, human pick.
