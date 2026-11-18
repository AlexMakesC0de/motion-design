# Upscaling swaps on kie, and where Openjutsu could really run

Checked on 2026-11-18. Follows [Openjutsu on kie](2026-11-18-openjutsu-on-kie.md). Nothing was generated or spent, and no account was created. Prices are as each page showed them that day; anything marked *estimate* is our arithmetic, not a quote.

## Why this came up

On dance6, Wan 2.2 Animate Replace (720p, $0.75, under 6 minutes) followed every move of the original, while MiniMax H3 at 2K ($1.63, 17 minutes) was sharp but sometimes did moves the dancer never made. Two questions followed: can we upscale the accurate Wan take, and can we run Openjutsu's real pipeline somewhere, since it doesn't fit on the Mac (see the [Mac check](#why-not-the-mac)).

## 1. Video upscalers on kie

| | Kie Video Upscaler | Topaz Video Upscale |
|---|---|---|
| Model id | `video/upscale` | `topaz/video-upscale` |
| Pages | [kie.ai/video-upscaler](https://kie.ai/video-upscaler) | [kie.ai/topaz-video-upscaler](https://kie.ai/topaz-video-upscaler), [docs](https://docs.kie.ai/market/topaz/video-upscale) |
| Inputs | `video_url`, `resolution` (`1080P`, `2K` default, `4K`) | `video_url`, `upscale_factor` (`"1"`, `"2"` default, `"4"`) |
| Limits | 60 s, 50 MB, MP4/MOV/MKV | 50 MB; duration not stated |
| Price per second of input | 1080P $0.0075, 2K $0.015, 4K $0.03 (exact duration, no rounding) | $0.04 at 1x/2x, $0.07 at 4x |
| Sound and frames | Keeps the frame rate, frame count and AAC sound | Not stated |
| 13 s clip (*estimate*) | 2K about $0.20, 4K about $0.39 | 2x about $0.52, 4x about $0.91 |

The kie upscaler's id and fields come from its product page; its docs page (`docs.kie.ai/market/video/upscale`) returned 404, so the first real call confirms the contract. Portrait output uses the rotated box, so 2K portrait is 1440×2560, the same size as the H3 2K take.

An upscaler sharpens what is there. It cannot fix a wrong face or a smeared hand, but it does close most of the resolution gap between Wan (720p) and H3 2K.

## 2. Where Openjutsu's real technique could run

Openjutsu's advantage is that SAM 3.1 tracks the person and H3 redraws only inside that mask, with a mannequin guide for the motion. **No managed API we found accepts a mask for H3 or Wan Animate**, so the only way to get the real technique is to run its ComfyUI workflow on a rented NVIDIA GPU.

### The model files

From the official [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3/tree/main) repo (sizes read from the Hugging Face file listing):

- Video model `minimax_h3_ref2va_pruned_int8_convrot`: 21.0 GB (the file Openjutsu names)
- Text encoder Qwen3-VL 32B: int8 27.1 GB, nvfp4 15.7 GB, bf16 51.5 GB. The int4 file Openjutsu names is not in this repo.
- Video VAE int8 2.8 GB, audio VAE 0.6 GB
- Turbo LoRAs (4-step and 8-step) about 2 GB each
- Not sized: Qwen3-VL 8B, SAM 3.1, the DMAD LoRA, the face-fix models

Altogether about 60 to 70 GB (*estimate*). The 21 GB video model and 27 GB encoder do not both fit on a 24 GB card at once; ComfyUI swaps them through system RAM, which is why Openjutsu's test machine had 64 GB of RAM. A 48 GB or 80 GB card avoids most of that.

### Options

| Route | What it is | Price (as read) | 13 s clip (*estimate*) | Catch |
|---|---|---|---|---|
| **RunPod** pod or serverless + ComfyUI | Our own ComfyUI with Openjutsu's nodes; models on a network volume | Pods (Secure): 4090 $0.89/h, L40S $1.09/h, A100 80GB $2.09/h. Serverless: 4090 $1.34/h, L40S $1.89/h, A100 $2.99/h. Volume $0.07/GB/month ([pricing](https://www.runpod.io/pricing)) | About $0.20 to $0.75 per clip if a run takes 10 to 15 minutes, plus about $5/month storage | Setup work; cold starts load ~60 GB; run time on these cards is unmeasured |
| **Comfy Cloud** custom Builds | Comfy's own hosting with our nodes and models | RTX PRO 6000 96GB $3.49/h, 48GB $1.75/h, H100 $6.23/h, storage $0.20/GB/month, plans from $20/month ([pricing](https://www.comfy.org/cloud/pricing), [Builds](https://docs.comfy.org/development/deploy/cloud-custom-builds)) | About $0.60 to $0.90 on the 96 GB card | Must confirm H3 and SAM nodes run there; Openjutsu calls this path untested |
| **RunComfy** serverless | Hosted ComfyUI, install nodes, deploy a workflow as an API ([docs](https://docs.runcomfy.com/serverless/custom-workflows)) | L40S $2.99/h, A100 $4.99/h, Pro $19.99/month with 200 GB ([pricing](https://www.runcomfy.com/pricing)) | About $0.75 to $1.25 | Upload limits and cold starts not confirmed |
| **fal `minimax/h3-max/recast`** | Managed person replace on H3 Max; keeps motion, camera, cuts and sound | $0.085/s at 768p, $0.17/s at 1080p, plus input tokens ($0.022 per 1,000 after 4,096; about 6,750 per second) ([page](https://fal.ai/models/minimax/h3-max/recast)) | About $2.95 at 768p | No mask, so it is not Openjutsu's technique; a different provider and key |

Also seen, not useful on their own: fal `sam-3/video-rle` ($0.005 per 16 frames) and Replicate `lucataco/sam3-video` produce person masks, but nothing on those services takes the mask back in for H3. fal and WaveSpeed sell Wan 2.2 Animate Replace without a mask; fal's is due for removal on 2027-01-04. Not checked: ComfyDeploy, ViewComfy, Lambda, Segmind.

## Why not the Mac

Openjutsu's [README](https://github.com/D3voz/openjutsu) requires an NVIDIA GPU and was tested with 16 GB of video memory and 64 GB of RAM; it does not mention macOS. This Mac (M5 Pro, 24 GB shared memory) had 14 GB of free disk on 2026-11-18, against roughly 60 to 70 GB of models.

## Recommendation

1. **Now, on kie:** upscale the Wan take with `video/upscale` at 2K (about $0.20). Wan plus upscale is about $0.95 for 13 seconds, against $1.63 for H3 2K, and keeps Wan's accurate motion.
2. **For the real Openjutsu:** one RunPod test on an A100 80GB pod, with ComfyUI and Openjutsu's nodes, run by hand on dance6. It would measure the run time and cost per clip before anything is wired into the studio.
