# kie.ai catalog and cross-provider prices

Read 2026-10-30 by a research agent through a summarising fetcher. **Spot-check any figure before baking it into `cli/models.json`** (the CLI's rule is that a measured job beats a page). 1 kie credit = $0.005. [P] = https://kie.ai/pricing, [M] = https://kie.ai/market, otherwise the `kie.ai/<slug>` page linked. (sec) = search summary or third-party blog, not a direct read. Prices per second unless stated. Feeds [the quality plan](../quality-plan.md).

## kie video

| Model | Modes / refs | Duration, res, audio | kie price |
|---|---|---|---|
| Seedance 2.5 `bytedance/seedance-2-5` (beta, https://kie.ai/seedance-2-5) | first frame; first+last; reference mode (30 img + 10 video + 10 audio, ≤50; modes cannot be mixed); **Draft mode** (480p preview, task id valid 7 days, then upscale to final). No multi-shot param. | 4-30s or auto; 480/720/1080p; 21:9-9:16 + adaptive; native audio **with a toggle**; `return_last_frame` | 28/63/158 cr/s at 480/720/1080p without video input; with video input 17/38/95 cr/s billed on input+output seconds. Matches our measured 945 cr for 15s 720p. |
| Seedance 2 / 2-fast (https://kie.ai/seedance-2) | first; first+last; refs (9 img, 3 video, 3 audio) | 4-15s or -1; 480-1080p + 4K (H.265); Fast 480/720p only | Fast 480p 6.8 (video input) / 11.7; Fast 720p 15 / 24.8. Standard: page shows no rows; [P] "from" 11.5 cr/s. **Standard 720/1080/4K not found.** |
| Kling 4.0 (https://kie.ai/kling-4-0) | reference-to-video (Omni: ≤10 img, ≤5 video, ≤7 elements, ≤3 voices); **keyframe-to-video (first + ≤8 keyframes + last)**; T2V/I2V. No multi-shot, no camera params. | 3-30s; 720/1080p; stereo audio; 21:9-9:16 | 720p 28.5 cr/s; 1080p 42.5. With video input 17 / 25.5 billed on max(2× output, input+output). 4.0 Flash "coming soon". |
| Kling 3.0 (https://kie.ai/kling-3-0) | std/pro/4K; start+end frame; Elements field (undocumented); **multi-shot up to 5 shots within 15s** | 3-15s; audio toggle | std 14 (no audio) / 20 (audio); pro 18 / 27; 4K 67 |
| Kling 3.0 motion control (https://kie.ai/kling-3-0-motion-control) | std 720p / pro 1080p; motion video 3-30s | | 20 / 27 cr/s. Omni "from" 14, turbo "from" 18 [P]; their pages 404. |
| MiniMax H3 / Hailuo 03 (https://kie.ai/hailuo-h3) | T2V; I2V (first or first+last); reference (9 img, 3 video, 3 audio) | 4/5-15s (page contradicts itself); 768P or 2K; stereo audio; 21:9-9:16 | **768P 8 cr/s, 2K 13 cr/s.** Input video billed. First 5 images free, then 4 cr each. |
| Wan 3.0 `wan/3-0-video` (https://kie.ai/wan-3-0) | T2V; first; first+last; reference (10 img + 5 video + 5 audio); document-to-video; webpage-to-video | 2-30s or -1; 480/720/1080p; audio on by default | 8 / 16 / 32 cr/s; "Prime" from 12.2 [P] |
| Veo 3.1 (https://kie.ai/veo-3-1) | Lite/Fast: T2V, I2V, reference. Quality: T2V, I2V. Start+end frames; Extend; Get-1080p; Get-4K | 4/6/8s; 720p/1080p/4K; 16:9 or 9:16 | **Per video:** Lite 30/35/150 cr (720/1080/4K); Fast 60/65/180; Quality 250/255/370; Extend 60. Whether 4s and 8s cost the same is not stated. |
| HappyHorse 1.1 (https://kie.ai/happyhorse-1-1) | T2V, I2V, reference (9 img) | 3-15s; 720/1080p | 22.5 / 29 cr/s |
| Vidu Q4 (https://kie.ai/vidu-q4) | I2V; reference (15 img + 3 audio) | 3-16s; 540p-4K; audio toggle | 540p 7.2, 720p 15.2, 1080p 19.2, 2K 30.4, 4K 62.4 |
| PixVerse V6 (https://kie.ai/pixverse-v6) | T2V; I2V; transition (first+last); reference (1-7); extend; `generate_multi_clip_switch` | ≤15s; 360-1080p; audio toggle | 720p 7.2 / 9.6 (audio); 1080p 14.4 / 18.4. V6 Max [P] 720p 8.8/12, 1080p 17.6/22.4 |
| Grok Imagine (https://kie.ai/grok-imagine; version unstated) | T2V; I2V (7 img via `@image1`); extend +6/+10s; upscale | ≤30s at 720p, ≤15s at 1080p; audio always on | 2.4 / 4.5 / 8 cr/s at 480/720/1080p |
| Gemini Omni video | page 404 | | from 63 cr per video [P] |
| Runway (https://kie.ai/runway-api) | I2V, T2V, extend | 5/10s | only extend priced: 12 cr 720p, 30 cr 1080p |
| Not on kie | Sora, Luma | | |

Lip-sync/avatar [P, "from"]: OmniHuman 2.0 14 cr/s at 720p; Kling AI Avatar 8; InfiniteTalk 3; volcengine lip-sync 8.

## kie images (USD per image) and utilities

| Model | Refs | 1K / 2K / 4K |
|---|---|---|
| Nano Banana Pro (https://kie.ai/nano-banana-pro) | 8 | $0.09 / $0.09 / $0.12 (FAQ on same page says $0.12 / $0.24) |
| Nano Banana 2 (https://kie.ai/nano-banana-2) | 10 | $0.04 / $0.06 / $0.09 |
| Nano Banana 2.1 (https://kie.ai/nano-banana-2-1) | 10, no mask | $0.02 / $0.03 / $0.045 |
| GPT Image 2 (https://kie.ai/gpt-image-2) | 16 | $0.03 / $0.05 / $0.08 |
| GPT Image 2.5 sunburst/flare (https://kie.ai/gpt-image-2-5) | 16, transparent bg | $0.03 / $0.05 / $0.08 |
| Seedream 5 Pro (https://kie.ai/seedream-5-pro) | 10, layer decomposition | $0.035 / $0.07, + $0.0025 per extra input image |
| Flux 3 Klein (https://kie.ai/flux-3) | edit 1-10 | $0.008 / $0.0125 / $0.0325 |
| Flux Kontext, Seedream 5 Flash, Qwen Image Edit | not captured | from $0.025, $0.0162, $0.025 per MP [P] |

Utilities: Topaz Video Upscaler 8 cr/s at 1×/2×, 14 cr/s at 4× (https://kie.ai/topaz-video-upscaler); Topaz Image from $0.05; Recraft Remove Background $0.005; Recraft Crisp Upscale from $0.0025 [P].

## Price matrix (USD per clip)

| Model | kie 5s/720p | Elsewhere 5s/720p | kie 10s/1080p | Elsewhere 10s/1080p | Cheapest |
|---|---|---|---|---|---|
| Seedance 2.5 | $1.575 | BytePlus/Replicate $1.156, WaveSpeed $1.80, fal $2.37 (sec) | $7.90 | BytePlus $5.69, WaveSpeed $9.00, fal $11.64 | BytePlus ~27% cheaper, **but BytePlus does not sell to AU/US/UK/CA/NZ** (cellcog). kie beats WaveSpeed and fal. |
| Seedance 2 Fast 720p | $0.62 | fal $1.21 | n/a | n/a | kie |
| Kling 4.0 | $0.71 | fal/WaveSpeed $0.785 | $2.13 | $2.35 | kie ~10% |
| Kling 3.0 std / pro | $0.50 audio ($0.35 silent) | fal $0.63 ($0.42) (sec) | $1.35 ($0.90) | fal $1.68 ($1.12) (sec) | kie ~17-20% |
| Veo 3.1 (8s clip) | Lite $0.15, Fast $0.30, Quality $1.25 flat | Google/fal Standard ~$3.20, Fast $0.80-1.20 (sec) | Fast $0.325 | | kie 3-10× cheaper **if flat per-video pricing is real** |
| Hailuo H3 | 768P $0.20 | MiniMax $0.40, WaveSpeed $0.50 (sec) | 2K $0.65 | $1.30-2.60 (sec) | kie ~50% |
| Wan 3.0 | $0.40 | WaveSpeed $0.50 | $1.60 | Alibaba $2.00 (sec) | kie ~20% |
| HappyHorse 1.1 | $0.56 | $0.70 | $1.45 | $1.80-1.89 | kie ~20% |
| Grok Imagine | $0.11 | fal/xAI $0.70 (sec) | $0.40 | $2.50 (sec) | suspicious 6× gap; verify version |
| PixVerse V6 | $0.24 audio | not found | $0.92 | not found | |
| Vidu Q4 | $0.38 | not found | $0.96 | not found | |

Sources for the matrix:

- Seedance 2.5 third-party comparisons: https://www.8frame.co/blog/seedance-2-5-price-comparison-2026 (checked 2026-10-18), https://cellcog.ai/blog/seedance-2-5-pricing/ (2026-10-14). The BytePlus ModelArk and Replicate pages returned no figures.
- WaveSpeed Seedance 2.5 (https://wavespeed.ai/models/bytedance/seedance-2.5/text-to-video, read 2026-10-30): $0.18/$0.36/$0.90/$1.80 per second at 480p/720p/1080p/4K. The playground shows $0.324 at 720p (10% off). **The $0.81 in our `models.json` is 480p × 5s at 10% off, not comparable to kie's 720p rate. WaveSpeed is not a cheaper Seedance 2.5 route.**
- fal Seedance 2.5 (https://fal.ai/models/bytedance/seedance-2.5/text-to-video): ~$0.22/s at 480p, ~$0.473/s at 720p, ~$1.164/s at 1080p (playground note only). fal Seedance 2.0 (https://fal.ai/models/bytedance/seedance-2.0/text-to-video): 720p $0.3034, Fast $0.2419, 1080p $0.682.
- Kling 4.0: https://fal.ai/models/kling/v4/text-to-video and https://wavespeed.ai/blog/ai-news/kling-4-0-is-coming-what-we-know-and-how-to-prepare-on-wavespeedai/ ($0.157 at 720p, $0.235 at 1080p). Official https://kling.ai/dev/pricing (sec) lists unit rates with package-dependent dollar values.
- Kling 3.0 fal (sec, Voyager page 2026-09-09): pro $0.112 / $0.168; std $0.084 / $0.126.
- Veo 3.1 WaveSpeed (https://wavespeed.ai/models/google/veo3.1/text-to-video): $0.20/s silent, $0.40/s audio at 720p/1080p. **Veo 3.1 Preview in the Gemini API shut down 2026-10-22** (https://ai.google.dev/gemini-api/docs/video); GA Veo is on Google's enterprise platform, price not found.
- MiniMax $0.08/$0.13 per s, WaveSpeed H3 $0.10/$0.14, Wan 3.0 WaveSpeed $0.10 and Alibaba $0.05/$0.10/$0.20, HappyHorse fal/WaveSpeed, Grok Imagine 1.5 fal/xAI $0.08/$0.14/$0.25 and xAI Lite $0.02-0.03: all (sec).
- Image prices elsewhere (sec): Gemini API Nano Banana 2.1 $0.0336 / $0.0504 at 1K/2K; Nano Banana Pro on Google $0.134 / $0.24. kie is cheaper on every image model checked.

## Consistency features

| Feature | Models |
|---|---|
| Multi-image reference | Seedance 2.5 (30/10/10), Kling 4.0 (10 img + 5 video + 7 elements + 3 voices), Hailuo H3 (9/3/3), Wan 3.0 (10/5/5), Vidu Q4 (15), HappyHorse 1.1 (9), Seedance 2 (9/3/3), PixVerse (7), Grok (7), Veo 3.1 Lite/Fast (count unstated) |
| First+last frame | Seedance 2/2.5, Wan 3.0, Hailuo H3, PixVerse transition, Veo 3.1, Kling 3.0/4.0 |
| Multi-keyframe | Kling 4.0: up to 8 in-between keyframes |
| Multi-shot in one job | Kling 3.0 (≤5 shots in 15s), PixVerse V6 multi-clip; Kling 4.0 multi-shot only on fal ("Multi Prompt") |
| Draft then final | Seedance 2.5 Draft mode (480p preview → final on the same task id) |
| Camera presets as parameters | none on kie; camera is prompt-only. Kling 3.0 motion control transfers motion from a video |
| Keyframe/reference editing | GPT Image 2/2.5 (16 refs), Seedream 5 Pro (10), Nano Banana 2/2.1 (10), Flux 3 Klein (10), Nano Banana Pro (8) |

## Cheap video understanding for scoring

From https://ai.google.dev/gemini-api/docs/pricing and https://ai.google.dev/gemini-api/docs/video-understanding (read 2026-10-30): default media resolution ≈100 tokens/s (66 tokens per frame at 1 fps + 32 audio tokens/s); high ≈300 tokens/s.

| Model | Input $/1M | 10s clip, default |
|---|---|---|
| gemini-3.5-flash-lite | $0.30 | ~$0.0003 |
| gemini-3.1-flash-lite | $0.25 | ~$0.00025 |
| gemini-3.8-flash | $0.75 until 2026-12-31, then $1.50 | ~$0.00075 |
| gemini-3.1-pro-preview | $2.00 | ~$0.002 |

Output tokens extra, not priced.

## Not verified

Seedance 2 standard kie prices; Kling 3.0 omni/turbo pages; Gemini Omni video; Runway generation prices; Kling 4.0 Flash; whether Veo 3.1 on kie is flat across 4/6/8s; which Grok Imagine version kie prices; Replicate prices directly; Google GA Veo pricing; the BytePlus price table.

## Direct re-read, later on 2026-10-30

Every route in `cli/models.json` was re-read from the raw page HTML (not a summary), and the catalog was updated from that read; each route's `pricing.source` or `priceNote` quotes it. Where the two disagree, `models.json` wins. Corrections to the table above:
- The kie.ai/seedance-2-0 page's visible default tab is **Fast**; standard Seedance 2 is 19/41/102/208 credits/s (480p/720p/1080p/4K) without video input, found in the page's embedded pricing.
- MiniMax H3 on WaveSpeed is $0.04/$0.06/$0.08/$0.16 per second (480p/540p/768p/1080p), not about $0.10/s.
- MiniMax H3 Max (`minimax/hailuo-h3-max-t2v`) could not be found anywhere on kie.ai or its docs.
- The kie docs name Veo's models `veo3`, `veo3_fast` and `veo3_lite`, Kling 3.0's `kling-3.0/video`, and Suno's `ai-music-api/generate`; the catalog's ids for those three routes are unverified.

## Re-read on 2026-11-17

Every kie route was read again, for [improvement 2](../improvements.md). Eleven of fourteen still match. What changed in `cli/models.json` and the estimate (`cli/lib/budget.mjs`):
- **Kling 3.0 went up.** kie.ai/kling-3-0 now says 15.1 credits/s without audio and 22.7 with at 720P, 20.2 and 30.2 at 1080P, and 75.5 at 4K. The catalog had 20 and 27 with audio. It now holds 22.7 and 30.2 ($0.1135 and $0.151 a second).
- **A reference video on Seedance 2 Fast is now counted.** kie charges 6.8 credits/s (480P) or 15 (720P) on the input seconds plus the output seconds. The video's length is not known when the price is asked for, so the estimate counts 15 seconds of input, the most kie accepts. A 5-second take at 720p with a reference video is estimated at $1.50, where it used to say $0.62.
- **GPT Image 2 is priced by resolution** (6/10/16 credits at 1K/2K/4K), and **ElevenLabs speech by the script's length** (12 credits per 1,000 characters).

Still not counted:
- Kling without audio (the estimate assumes audio, so it overcounts a silent job) and Kling at 4K.
- A reference video on Kling 3.0: its route has no captured contract, so the reference is refused before anything is sent.
- Veo 3.1's tiers (Lite, Fast, Quality): which one the route's id selects is not known, so the dearest non-4K figure stands.
- Hailuo H3's input images after the fifth (4 credits each), and Seedream's input images after the first (0.5 credits each).
- kie's bonus credits on large top-ups, which make every real price about 10% lower than the list price used here.
- MiniMax H3 Max was not re-checked, and no WaveSpeed page was re-read.

New on kie's pricing page and not in the catalog: Seedance 2.5 Flash, Seedance 2 Mini, Kling 3.0 Omni, Turbo and Motion Control, MiniMax H3 Image. These were seen through a page summary, not read directly.
