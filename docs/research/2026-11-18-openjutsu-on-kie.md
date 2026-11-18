# Openjutsu's features on kie

Checked on 2026-11-18 against [D3voz/openjutsu](https://github.com/D3voz/openjutsu)'s README, kie's [market](https://kie.ai/market), its [video editing list](https://kie.ai/market/video-editing), the model pages and the API docs at docs.kie.ai. Follows on from [the open-source alternatives note](2026-11-17-open-source-higgsfield-alternatives.md). Nothing was generated and nothing was spent.

## The short version

Openjutsu runs **MiniMax H3** on your own NVIDIA card through ComfyUI. kie sells the same model, so the model itself is within reach. What we can't get is the machinery Openjutsu wraps around it: SAM 3.1 tracks each person and builds a mask, H3 is told to redraw only that area, and a grey mannequin carries the motion. No editing model on kie takes a mask, a box or a track. You describe the change in words and the model decides where it goes.

So on kie, every Openjutsu mode becomes "send the video, the pictures and a well-written instruction". That is simpler to build, but there is less control: you can't promise that only the jacket changes, or say which of two people is swapped except in words.

Our Jutsu page today has only Openjutsu's simplest case: one character from a picture, through Kling motion control or Wan 2.2 Animate Replace.

## The models that matter

| Model on kie | What it takes | Limits | Price (from) |
| --- | --- | --- | --- |
| MiniMax H3 reference-to-video (`minimax-h3/reference-to-video`) | prompt, up to 9 pictures, up to 3 videos, up to 3 audio clips | prompt up to 7,000 characters; videos 2–15 s each and 15 s in all, at most 50 MB each, 23.976–60 fps; output 4–15 s at 768P or 2K; audio is always generated | $0.04/s at 768P, $0.065/s at 2K, billed on output seconds **plus** input video seconds; pictures after the fifth $0.02 each |
| Wan 2.7 video edit (`wan/2-7-videoedit`) | prompt, one video, one reference picture, negative prompt | video 2–10 s, up to 100 MB; 720p or 1080p | $0.08/s |
| Kling 3.0 Omni transformation (`kling-3.0-omni/transformation`) | prompt, one video, pictures, named "elements" you refer to as `@name` | video 3–15.5 s, at least 700 px a side; 720p, 1080p or 4K; no audio when a video is given | $0.0755/s |
| Gemini Omni 1.2 Flash (`google/gemini-omni-flash-1-2`) | a video-edit mode among others; up to 6 pictures, up to 2 saved characters | output as long as the input video; 360p to 4K | $0.02/s at the lowest resolution |
| HappyHorse video edit (`happyhorse/video-edit`) | prompt, one video; can keep the original audio | output as long as the input | billed on input plus output seconds; price not read |
| Already in Shard: Kling 2.6 / 3.0 motion control, Wan 2.2 Animate Replace | one video, one picture | — | $0.063/s, $0.1135/s, $0.03/s |

Image models for still edits: Nano Banana 2, GPT Image 2/2.6, MiniMax H3 Image edit (1–16 pictures, called `<Picture 1>`… in the prompt, from $0.0025), Flux Kontext, Seedream 5.5.

A worked price: swapping a 6-second clip into a 6-second H3 video at 768P is (6 + 6) × $0.04 = **$0.48**. The same through Kling 3.0 motion control is about 6 × $0.1135 = $0.68.

## Feature by feature

| Openjutsu feature | On kie? | How |
| --- | --- | --- |
| Simple swap (one character) | **Yes, have it** | Kling motion control or Wan Animate Replace today. H3 reference-to-video would be a third, cheaper route that also keeps the camera and the cuts. |
| Advanced swap (1–4 characters, "who becomes who") | **Partly** | H3 takes up to 9 pictures and Kling Omni takes named elements. Who becomes who is said in words ("the drummer becomes Picture 1"). Nothing tracks the people, so a wrong match only shows in the result. |
| Object swap: change (hair, jacket, car) | **Yes, by instruction** | H3, Wan 2.7 edit (one reference picture), Kling Omni, Gemini Omni, HappyHorse. Without a mask, other parts of the frame may change too. |
| Object swap: remove | **Yes, by instruction** | Same models. |
| Background change | **Yes, by instruction** | H3 and Kling Omni both list it. |
| Add an object where you draw a box | **No box** | Only "put a cake on the table" in words. |
| From picture (a still of the character in the video's pose, approved, then animated) | **Yes** | Take a frame from the video in the browser (a `<video>` drawn onto a canvas, so no ffmpeg needed), make the still with an image-edit model from the frame and the character picture, show it for approval, then animate it with H3 image-to-video or motion control. All of this already exists in Shard except grabbing the frame. |
| Relight (17 light looks) | **Yes** | Add the light to the still's instruction, or ask H3 to relight a video. Our 17 Looks could supply the words. |
| Fix faces | **No** | Openjutsu crops the face, redraws it close up and pastes it back. That needs tracking and compositing, and kie offers neither. kie's video upscaler sharpens the whole video, faces included, but doesn't redraw them. |
| Fix colours | **Not kie's job** | A local colour filter. Needs ffmpeg (broken on this Mac) or a browser export. |
| Check mask (free preview of what will be redrawn) | **No** | No masks on kie. The nearest thing is a cheap 768P draft. |
| Part to use (swap only part of the clip) | **Yes, and worth it** | A local trim before upload. It also cuts the price, because H3, HappyHorse and motion control all charge for the input's seconds, and it is required for H3, whose videos can't add up to more than 15 s. Needs ffmpeg or a browser trim. |
| No lip-sync | **Partly** | H3 always makes audio. Laying the original soundtrack back over the result needs ffmpeg; HappyHorse can keep the original audio itself. |
| Seed, resume from the last clip | **Seed only on some** | Gemini Omni and HappyHorse take a seed. Resuming is a local ComfyUI feature. |

## What to build, in order

Items 1 and 2 were built the same day: **Swap → Pro · MiniMax H3** on the Openjutsu page (model `minimax-h3-swap` in `cli/models.json`), priced on the output plus the clip's whole seconds, and **Part to use**, which cuts a clip on the server with ffmpeg (free). Not yet run against kie: the first real H3 take will show whether the contract and price hold.

1. **H3 reference-to-video as a third Jutsu route**, for single swaps first. It is the model Openjutsu is built on, cheaper than Kling 3.0 motion control at 768P, and its one request covers swap, change, remove, background and relight. Capture its input contract in `models.json` before anything else: a route without one drops its references.
2. **A trim before upload** ("part to use"). H3 refuses more than 15 s of video and bills every input second, so this has to come before or with item 1.
3. **From picture**: a frame from the clip, a still from an image model, approve it, then animate. It is the most reliable of the instruction-based routes, because you see and fix the still before paying for video.
4. **More than one character, and object edits**, as prompt templates on top of item 1, once a few single swaps show how well H3 follows instructions on kie.

Fix faces and Check mask are left out: kie has nothing to build them on.

## Still unknown

- How faithfully H3 on kie keeps the parts you didn't ask to change. Openjutsu's masks exist because H3 alone drifts. One 4-second draft at 768P (about $0.32 for a 4 s clip) would answer it; not run, as it costs money.
- Whether H3 on kie refuses real faces the way Seedance's public endpoint does (the reason Swapjutsu paints over faces).
- HappyHorse's price.

**Answered later the same day:** H3 on kie does drift. On dance6 it kept the room and outfit but sometimes made moves the dancer didn't, while Wan 2.2 followed every move at lower resolution. Upscaling and hosting the real pipeline are covered in [Upscaling swaps on kie, and where Openjutsu could really run](2026-11-18-upscaling-and-hosting-openjutsu.md).
