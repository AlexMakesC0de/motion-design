# Openjutsu, self-hosted: the plan (parked)

**Status: parked on 2026-11-18. No money will be spent on hosting.** This note records where the work stopped and how anyone could take it further. Openjutsu is open source, so the studio keeps its kie routes and leaves self-hosting to whoever wants to run it.

Background: [Openjutsu on kie](2026-11-18-openjutsu-on-kie.md) and [Upscaling swaps on kie, and where Openjutsu could really run](2026-11-18-upscaling-and-hosting-openjutsu.md).

## Where we got to

The studio's Openjutsu page swaps a person in a clip through kie. On one 13-second dance clip with one Library character, run on 2026-11-18:

| Route | Cost | Time | Result |
|---|---|---|---|
| MiniMax H3, 768P (`minimax-h3-swap`) | $1.00 | about 14 min | Right person and outfit; came back landscape (since fixed: the clip's own shape is now sent); noise in fast moves |
| MiniMax H3, 2K | $1.63 | about 17 min | Sharp, portrait, faithful face and outfit; sometimes makes moves the original never had, some jitter |
| Wan 2.2 Animate Replace, 720p | $0.75 | under 6 min | Follows every move of the original; softer face and clothes |

So on kie you choose between **detail** (H3) and **motion that matches** (Wan). Upscaling Wan does not help: the missing detail and the motion are the problem, not the pixel count.

## Why Openjutsu does better

[Openjutsu](https://github.com/D3voz/openjutsu) runs the same H3 model, but around it:

1. **SAM 3.1 outlines the person in every frame**, and H3 may repaint only inside the outline, so the room, camera and timing cannot drift.
2. **A grey mannequin performs the exact moves** (SolarRenderer LoRAs), so H3 dresses a pose instead of guessing the dance.
3. **A face-fix pass** (YOLO, SAM ViT-B, InsightFace) repairs likeness in close frames.

No hosted API found on 2026-11-18 accepts a mask for H3 or Wan Animate: not kie, fal, Replicate or WaveSpeed. The technique needs its ComfyUI workflow on an NVIDIA GPU.

It does not run on the Mac it was tried on (M5 Pro, 24 GB shared memory): the README requires an NVIDIA GPU and was tested with 16 GB of video memory and 64 GB of RAM; the models come to roughly 60 to 70 GB.

## The plan, if someone picks it up

### 1. Machine

An NVIDIA card with 48 to 80 GB of memory, so the 21 GB video model and the 27 GB text encoder need little swapping. Prices read on 2026-11-18 ([RunPod](https://www.runpod.io/pricing)):

- RunPod pod, A100 80GB: $2.09/h (Secure Cloud), $1.19/h (Community)
- RunPod pod, L40S 48GB: $1.09/h
- RunPod serverless, A100: $2.99/h; network volume $0.07/GB/month
- Alternatives: [Comfy Cloud](https://www.comfy.org/cloud/pricing) custom Builds (96 GB card $3.49/h), [RunComfy](https://www.runcomfy.com/pricing) (A100 $4.99/h)

A 24 GB card (RTX 4090) should work like Openjutsu's 16 GB test machine, with 64 GB or more of system RAM for the swapping.

### 2. Models

From [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3/tree/main) (sizes from its file listing):

- `diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors` (21.0 GB)
- a Qwen3-VL 32B text encoder: `int8_convrot` (27.1 GB) or `nvfp4_awq` (15.7 GB). Openjutsu names an int4 file that this repo does not have.
- `vae/minimax_h3_video_vae_int8_convrot.safetensors` (2.8 GB), `vae/minimax_h3_audio_vae_fp32.safetensors` (0.6 GB)
- a turbo LoRA, for example `loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors` (2.0 GB)
- from Openjutsu's README, not sized here: Qwen3-VL 8B int8, SAM 3.1 (`sam3.1_multiplex_fp16`), the DMAD LoRA, the SolarRenderer LoRAs, and for face fix the YOLO, SAM ViT-B and InsightFace `buffalo_l` files

### 3. Setup

Follow Openjutsu's README: ComfyUI 0.41.2 or newer, its custom node packs, the models in their folders, then `comfy-api-proxy` and the Next.js app. Keep the models on a persistent volume so a restart doesn't download 60+ GB again.

### 4. One test before building anything

Run Openjutsu by hand on one clip of 10 to 15 seconds with one character, and write down:

- time for each stage (find people, check mask, H3, face fix) and the total
- GPU cost per clip, from the time and the hourly price
- side by side with the kie H3 2K and Wan takes: does the person keep every move of the original, and do face, hands and clothes hold up in the fast moves?

Rough guess only, not measured: 10 to 15 minutes on an A100 for 13 seconds, so $0.35 to $0.75 per clip on a pod, plus about $5 a month to keep the models.

### 5. Only if the test wins: wire it into the studio

A third Swap tier ("Self-hosted") whose route calls the user's own ComfyUI or comfy-api-proxy address from settings, with no spend tracking since there is no kie bill. Openjutsu's README says it also works with the Comfy Developer Platform via `COMFY_BASE_URL` and `COMFY_API_KEY`, untested.

## Open questions

- Real run time and memory use on a 24, 48 and 80 GB card.
- Whether H3 and SAM 3.1 run on Comfy Cloud Builds.
- Whether fal's Wan VACE endpoints take per-frame masks (a possible managed middle road).
- Cold-start time when loading about 60 GB of models.

Ideas and results are welcome as issues or pull requests.
