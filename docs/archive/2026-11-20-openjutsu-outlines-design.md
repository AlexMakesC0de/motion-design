# Openjutsu outlines: find people, cast them, paste back

> Archived on 2026-11-20. Step 0 failed and the plan was dropped; see [what we tried](2026-11-20-openjutsu-swap-experiments.md).

Approved in conversation on 2026-11-20, then revised the same day after two independent reviews (see [Reviews](#reviews)). Mockups are in `.superpowers/brainstorm/94038-1795137073/content/` (`pipeline.html`, `defaults.html`, `cast-picker.html`; not in git).

This builds on the Openjutsu tab (`web/src/jutsu/`, `web/server/api/jutsu.mjs`) and on the character heights added on 2026-11-20 (`heightCm` on Library characters: alex-h 187 cm, alex-formal 176 cm). It changes nothing those decided.

## Why

Alex asked on 2026-11-20 how to get Openjutsu to the level of Higgsfield Genjutsu. Two takes on the same clip set the baseline:

- `runs/jutsu/swap-6.mp4`: the first two-person swap (H3 at 768P, `red-square-0s-15s.mp4`, alex-h and alex-formal, $1.20). Identity and motion held. Alex: "they look pretty good".
- `runs/jutsu/swap-7.mp4`: a 4s test (4s to 8s) with a prompt for build and eyes ($0.32). Eyes were fixed; alex-formal stayed a head shorter; a black jacket from the source appeared on an arm.

What still separates us from Genjutsu:

- **H3 redraws the whole frame.** The crowd, the stones and the cathedral are repainted. Genjutsu says the rest of the shot "stays untouched".
- **The source people leak through.** H3 sees the original dancers, so it copies their coat and their sunglasses (which left nothing to copy for the eyes).
- **The sound is new.** H3 always generates audio.
- **Casting is words.** The prompt has to say "the man on the left" and "the woman on the right".

[OpenJutsu](https://github.com/D3voz/openjutsu) (open source, ComfyUI) solves the first three with SAM tracking, a grey mannequin motion reference, compositing original pixels outside the mask, and the source soundtrack. It runs H3 locally, where the grey figure is paired with a mask input. On kie, H3 (`minimax-h3/reference-to-video`) takes only videos, pictures and a prompt: no mask, no seed. So every mask step here runs on the user's machine, before or after the kie job, and whether H3 reads a grey figure without a mask is not known yet. Step 0 tests it before anything is built.

## Decisions

| Question | Decision |
|---|---|
| What is built | Find people, the motion reference, paste back, original sound, clips over 15s. Fix faces, object swap and SAM 3 come after person swaps reach Genjutsu quality. |
| What is always on (no switch) | Find people, the motion reference chosen by step 0, paste back, original sound, character heights. |
| What the user chooses | Who replaces whom (per person, or "Leave as is"); the part of a long clip (the whole clip by default, up to 30s in two H3 parts). Later: Fix faces (off by default, priced), what to change (people, a named object, the background, remove). |
| First step | Step 0: a paid 4s test of motion reference styles on the hardest part of the Red Square clip, before any code. |
| Outline engine for people | macOS: Apple Vision person instance masks, through a small Swift helper compiled on first use. Other platforms: SAM 3, later. |
| Outline engine for objects | SAM 3, later, on every platform. |
| How people are picked | Option B: adding a clip opens it large in the right panel with coloured outlines; click a person, pick a character or "Leave as is" beside the video. The form lists the cast. |
| How H3 is told who is who | By what is in the video it gets (each picked person drawn distinctly) plus position and picture order in the prompt. Never by the page's outline colours, which H3 does not see. |
| Where outlines are kept | Beside the clip: `runs/jutsu/clips/<clip>.outline/`. A clip is outlined once and reused. |

Turned down:

- **A hosted outliner** (fal or Replicate): a per-clip cost, a new provider account, and the footage leaves the machine.
- **SAM 3 for everything on macOS too**: a multi-GB download and a gated model before the first swap, and in practice it wants an NVIDIA GPU. Vision needs nothing.
- **The cast list inside the left form** (option A): the form is already full (its scroll was fixed on 2026-11-19), and clicking the person on the video is more direct than reading "man, left".
- **Building the flat grey mannequin straight away**: both reviews rated it the biggest risk, see step 0.

## Step 0: test the motion reference

The question: given no mask, does H3 make a better swap from a video where the picked people are drawn differently than from the raw clip?

- **Part**: 8s to 12s of `red-square.mp4`, where the two dancers overlap (the hardest case).
- **Rough outlines**: Apple Vision person masks on those 4s, from a throwaway Swift script (free).
- **Three paid runs**, H3 at 768P, 4s, $0.32 each ($0.96 in all), same pictures (alex-h first, alex-formal second), same prompt apart from one line describing the figures:
  1. **Flat**: each picked person a flat grey of their own shade (lighter for the first, darker for the second), with a 2 px dark line where they meet.
  2. **Clay**: each picked person's own light and shade, no colour, low contrast, so arms, head turn and folds stay readable; the second person a little darker.
  3. **Clay with edge**: clay, plus a thin coloured outline drawn into the video (warm for the first, cool for the second), named in the prompt by that colour.
- **Baseline, free**: the same 4s cut from `swap-6.mp4` (raw clip as the reference).
- **Judged on**: identity of both characters, alex-h visibly taller than alex-formal, motion detail (arms, hands at the face, head turns), nothing from the source people (coat, sunglasses), no grey left in the output.
- **Outcome**: the best of the four becomes the always-on motion reference. If the raw clip wins, H3 keeps getting the raw clip, and outlines are used for casting and paste back only; that still fixes the redrawn background and the new sound.

## What you see

Adding a reference video:

1. The clip tile shows "Finding people..." with progress.
2. The right panel switches from the Motion Library to the clip, large, with each person outlined in their own colour and numbered. A scrubber plays the clip; the outlines follow each person.
3. Clicking a person opens a picker beside the video: Library characters (with sheets), uploads, generations, and "Leave as is". The person's outline takes the character's name.
4. If the outliner split one person into two tracks, or joined two people, the panel lets you merge two tracks or split one at the current frame.
5. **Check mask**: before spending, a toggle shows what will be sent to H3 and what will be replaced, frame by frame.
6. The form shows the cast: `1 -> alex-h`, `2 -> alex-formal`, `3 (Leave as is)`. Clicking a row reopens the preview at that person.
7. The price line covers everything that spends: the H3 job, and a second part for a clip over 15s. Local steps are free and shown as such.

People seen for under 0.5s, or smaller than 2% of the frame, are listed but start as "Leave as is" (OpenJutsu leaves them alone for the same reason: H3 draws them as grey figures).

The Character tile and the single-picture flow stay. With one person in the clip, picking a character in the tile casts that person, exactly as today.

## The pieces

Each piece has one job and a small interface, so each is tested alone.

### 1. Outliner (`cli/core/outline/`)

```
outline(clipPath, { what: "people" }) -> OutlineResult
```

- **Vision engine** (`tools/outline-vision/`, Swift, macOS only): `VNGeneratePersonInstanceMaskRequest` on each frame. It returns at most 4 people per frame, in no fixed order, so on a busy square bystanders take slots and come and go.
- **Tracking**:
  - Each frame's people are matched to existing tracks by mask overlap (IoU) and by appearance (a colour histogram of the person), so two dancers who cross keep their ids.
  - A track that disappears for up to 0.5s and comes back with the same appearance is joined.
  - Each person's mask is held for 2 frames (as OpenJutsu does), which smooths flicker at the edges.
  - The merge and split controls in the panel fix what this misses.
- **Output**, written to `<clip>.outline/people/`:
  - `tracks.json`: engine, fps, width, height, frame count, and per track: `id`, `colour`, `label` (position at first appearance: "left", "centre", "right"), `firstS`, `lastS`, `areaShare`, and per frame a box and a simplified outline polygon. The page draws the overlay from the polygons (a browser cannot play the mask files).
  - `mask-<id>.mkv`: one lossless greyscale mask video per track (FFV1), for the local steps only.
  - `thumb-<id>.jpg`: a crop of the person at their largest.
- Outlining is a background task with progress, run on upload and on trim. A second request returns the stored result.

### 2. Motion reference (`cli/core/jutsu/reference.mjs`)

```
reference(clipPath, outline, { picked: [trackId...], style }) -> path of the video sent to H3
```

- `style` is what step 0 chose: `raw`, `flat`, `clay` or `clay-edge`. Raw sends the clip as today.
- Each picked person is drawn distinctly (shade, or shade plus edge colour), so H3 can tell overlapping people apart. People left as they are stay real.
- Audio is dropped from this file; the final video takes the source audio.
- The prompt is built from the cast: each picked person by position and by how they are drawn ("the lighter figure on the left"), the picture order, the Library heights, and one line on what the figures are.

### 3. Compositor (`cli/core/jutsu/composite.mjs`)

```
composite({ sourcePath, resultPath, sourceOutline, picked, resultOutline }) -> path of the final video
```

Measured on `swap-6.mp4` against its source (OpenCV ECC on the top 40% of the frame, six times from 0.5s to 14.5s): background shift 0.2 to 8.0 px, scale 0.984 to 0.996, H3 at 24 fps against the source's 30, 768x1344 against 720x1280, 15.08s against 15.00s. The remaining difference of 16.7 to 23.8 grey levels is mostly repainted content (crowd, cobbles), not a colour shift; at 9s H3 also changed where the two people stand relative to each other.

The steps, per clip:

1. **Timing**: find H3's time offset and stretch against the source from the motion in both (correlating per-frame motion energy), then map every source frame to an H3 time.
2. **Frame rate**: make H3 frames at the source's times by interpolation (ffmpeg `minterpolate` first; an optical-flow interpolator if that shows artefacts), so people do not judder against a smooth background.
3. **Shape**: scale H3 to the source width and crop the height difference, instead of stretching (the two aspect ratios differ by about 1.6%).
4. **Alignment**: estimate a homography from H3 to source with feature points and RANSAC, in a band around the paste mask, leaving out every person. Smooth the parameters over about 0.5s. If an estimate fails, keep the smoothed one.
5. **Colour**: one transform for the whole clip (Lab mean and spread, from the static background in that band), applied to all H3 frames, so the people match the real light without flicker.
6. **Track matching**: tracks found in the result are matched to the cast by position after alignment and by order, and checked against the cast count.
7. **Paste mask**: the union of the picked people in the source and the matched people in the result, grown by 12 px (40 px only where the result person is larger than the source person, as with a taller character), with headroom above the head, extended down from the feet for the shadow, minus any person left as is who is in front.
8. **Blend**: the source everywhere outside the paste mask; inside, the aligned and colour-matched H3 frame; a multiband blend across the seam.
9. **Sound**: the source clip's audio, cut to the same part.

These run in a Python helper with OpenCV, in a small `uv` environment installed on first use (about 60 MB). ffmpeg does the muxing. The raw H3 video is always kept beside the final one.

### 4. Long clips (`cli/core/jutsu/chain.mjs`)

- H3 takes 2 to 15s of video. A clip from 15 to 30s is cut into two parts that overlap by 1s; the page's limit for H3 rises from 15s to 30s for this.
- H3 on kie takes no seed, so the parts can differ in detail. To keep them together: part 2 also gets a still of each character from part 1's last frames as an extra picture, and the join is a hard cut at the lowest-motion frame in the overlap, not a crossfade (two different renders crossfaded show double limbs).
- The price shows both parts.

### 5. Openjutsu page

- **Right panel, clip preview**: video with the outline overlay drawn from `tracks.json` polygons, scrubber, click to pick, merge and split, Check mask, and the character picker beside it (reusing the current picker contents).
- **Form**: the cast list replaces the single Character tile when the clip has more than one person.
- **History**: each take shows its stage while running ("Making the reference", "On kie", "Pasting back") and keeps both the raw H3 video and the final one.

### Later, after person swaps reach Genjutsu quality

- **Fix faces**: try H3 at 2K ($0.065/s) first. If faces are still soft, a face pass as OpenJutsu does it: the face crop box smoothed over time, hands left out of the face mask, pieces of about 6.5s. Vision's face detection on macOS, so no InsightFace (whose `buffalo_l` model is non-commercial).
- **Object swap**: SAM 3 with a word ("jacket", "hair"), then the same reference and compositor steps; change, remove, background.
- **SAM 3 engine and other platforms**: `kie outline setup`, people on Windows and Linux.

## The run

```
add clip -> outline (local, background)
pick cast -> estimate (free), Check mask (free)
Generate:
  check everything that would refuse (free)
  motion reference (local)
  H3 on kie (paid, as today; two parts for 15-30s)
  outline the result (local)
  composite + sound (local)
  done: final video in History, raw H3 video beside it
```

### The request

`POST /api/jutsu/generate` gains:

- `cast`: a list of `{ track, image }` (an image is the same kind of name as today's `image`: an upload, `@asset#n` or `gen:<job>`). Tracks not listed are left as they are. This replaces `image` plus `images` when present; those stay for clips without outlines and for the API.
- `part`: optional `{ startS, lengthS }`, as the trim route takes today.

A typed prompt still wins, with heights added once, as today.

### Failures

- **Before spending**: no person picked; more than 9 pictures; a picked person not in the chosen part; any limit H3 already refuses (length, size, shape). All refused free with the reason, as today.
- **Outlining fails**: the clip still works with today's single-picture swap, without outlines, and the panel says why.
- **A local step fails after H3 succeeded**: the paid H3 video is kept in History with the reason; "Redo the free steps" reruns the local steps after H3 (outline the result, composite, sound). Money is never lost to a local failure.
- **Restarts**: each local stage writes its output next to the job. Resuming local stages after a restart is new work in `web/server/follow.mjs`, which today resumes kie jobs only.
- **Mirrors and reflections**: H3 copies a reflected source person; the panel warns when a clip is marked as having one (OpenJutsu has the same limit).

## Testing

- **Outliner**: on the 8s to 12s cut of `red-square.mp4`, Vision finds at least 2 main tracks (the dancers) that keep their ids through the overlap; bystanders may appear as extra tracks. `tracks.json` matches the clip's size and frame count. A synthetic clip (two coloured shapes that cross) checks that ids survive a crossing without a real model.
- **Motion reference**: for each style, pixels change only inside picked masks; two picked people are drawn differently.
- **Compositor**:
  - On the real `swap-6.mp4` and its source, measured in the **seam ring** (a 30 px band just outside the paste mask): the difference to the source after alignment and colour matching, which must drop well below today's (target set from step 0's numbers).
  - The output has the source's fps, length and audio, with no repeated frames inside the paste mask.
  - Warp and colour parameters change smoothly from frame to frame.
- **Routes**: the server tests stub the outliner and kie, as the Openjutsu tests stub kie now: cast to refs and prompt, refusals before spending, a local failure keeps the paid video.
- **Page**: clicking an outline casts the person; "Leave as is"; merge and split; Check mask; the cast shows in the form; the price line covers two parts.
- **End to end**: one real H3 swap of the Red Square clip with the cast picker, after asking Alex (it spends).

## Order of building

0. Step 0: the motion reference test ($0.96, approved 2026-11-20).
1. Compositor, built and tuned free on `swap-6.mp4` and its source, with rough Vision masks.
2. Outliner with the Vision engine: tracking, merge and split data, outline store, background task.
3. Motion reference in the chosen style, and the `cast` request with the prompt built from it.
4. The page: right-panel preview, cast list, Check mask, stages in History.
5. Long clips in two parts.
6. Later: Fix faces, object swap, SAM 3 and other platforms.

Steps 1 to 4 deliver the always-on defaults on macOS. Each later step is usable on its own.

## Not in this version

- More than one character in the same track (a person who changes into someone else mid-clip). OpenJutsu's montage tab does this.
- Relighting the character picture before the swap (OpenJutsu's "From picture" and FLUX relight).
- Lip-sync control (OpenJutsu's "No lip-sync": silent audio to H3 and a no-singing prompt). Worth adding once the source sound is always kept.
- Drawing a box to add an object.

## Reviews

Two independent reviewers, given only this spec and the code, rated the first version on 2026-11-20:

| | Engineering review | VFX review |
|---|---|---|
| Overall | 6/10 | 6/10 plan, 5/10 likely look |
| Biggest risk | The grey mannequin, untested on kie's H3 without a mask, built second | The same; plus overlapping people as one grey blob |
| First step | A paid 4s test before any code | The same, on the overlapping 8-12s part |

What changed because of them: step 0; each person drawn distinctly and named by position, not by page colour; clay and edge styles; the compositor's timing, interpolation, crop instead of stretch, homography in the seam band, smoothing over time, one colour transform per clip, track matching, a tighter mask with shadows and occlusion; the seam-ring test; Vision's 4-person limit, appearance matching and merge and split; polygons for the page overlay; the 15s H3 limit and the missing seed (two parts joined by a hard cut, part 2 given a still from part 1); local resume as new work; Check mask; Fix faces, object swap and SAM 3 moved later.
