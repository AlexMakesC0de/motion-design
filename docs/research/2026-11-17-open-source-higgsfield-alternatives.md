# Open-source Higgsfield alternatives: what Shard can learn

Read on 2026-11-17. Alex asked what Shard can learn and take from the projects listed in [Jutsu Studio's article](https://jutsustudio.com/blog/higgsfield-open-source-alternatives/) (updated 2026-11-14). This adds to [the Higgsfield pipeline research](2026-10-30-higgsfield-pipeline.md) and feeds [the improvements list](../improvements.md).

## How this was read

- The article was read in full.
- Each project's GitHub page (README, licence, stars, last push, and some source files and docs) was read the same day by three research helpers through the GitHub API. Nothing was cloned, installed or run.
- No project was tried. Every claim about how well something works is the project's own.
- The article is written by the makers of three of the projects (Jutsu Studio, Swapjutsu, Kawarimi). Weigh what it says about those accordingly.
- Not read: the code of most "studios" inside Open-Generative-AI, openfield's `docs/`, the workflow files of the ComfyUI projects, and any of the 113 challenge entries beyond their one-line descriptions.

## The short version

1. **Most of these are a generator with a gallery.** Only a few have what Shard already has: a price before you press the button, spend caps, a film structure, a character library. On planning and money, Shard is ahead of every project here that calls a paid API.
2. **The feature all of them chase, and Shard lacks, is character swap**: put your character into an existing video, keeping the performance. One project (Swapjutsu) does it through Seedance 2.5, the model Shard already uses, with all the preparation done on a Mac.
3. **The best ideas to take are small and about the takes you already have**: compare two takes, keep a failed take with a retry button, see the exact request that was sent, select many takes at once.
4. **Editing in the browser is possible without ffmpeg.** BeatDesign trims, captions and exports MP4 in Chrome. That matters here because ffmpeg is broken on this Mac and every finishing step depends on it.
5. **Code can be reused from only some of them.** Three of the most-starred have no licence, so they are ideas only.

## The projects

Stars and last push are from the GitHub API on 2026-11-17.

| Project | Licence | Stars | Last push | What it is | Generates through |
|---|---|---|---|---|---|
| [Anil-matcha/Open-Generative-AI](https://github.com/Anil-matcha/Open-Generative-AI) | MIT | 35,072 | 2026-11-16 | Web and desktop studio, "600+ models across 14 studios" | Muapi.ai (paid) |
| [wide-trace/open-higgsfield](https://github.com/wide-trace/open-higgsfield) | none | 6,158 | 2026-09-17 | Prompt bar and gallery, 38 models | Higgsfield's API, by the look of its key format |
| [SegFault42/HeliosGen](https://github.com/SegFault42/HeliosGen) | none | 3,429 | 2026-09-17 | Desktop node canvas | kie.ai, like Shard |
| [D3voz/openjutsu](https://github.com/D3voz/openjutsu) | MIT | 2,421 | 2026-10-30 | Character and object swap | Your own NVIDIA GPU |
| [Lightricks/LTX-Desktop](https://github.com/Lightricks/LTX-Desktop) | Apache-2.0 | 2,283 | 2026-11-11 | Local generation app (named in the article as a local option) | Your own GPU or a large Mac |
| [ClabstreamTeam/Open-Higgsfield-AI](https://github.com/ClabstreamTeam/Open-Higgsfield-AI) | none | 429 | 2026-04-19 | An internal team copy; dead | not documented |
| [BeatAPI/BeatDesign](https://github.com/BeatAPI/BeatDesign) | Apache-2.0 | 362 | 2026-11-04 | Canvas plus timeline editor that exports in the browser | BeatAPI (paid); editing needs no key |
| [wexloops/openfield](https://github.com/wexloops/openfield) | MIT text, not recognised by GitHub | 211 | 2026-11-03 | Studio of small apps for video, stills and 3D | Your own GPU |
| [Comfy-Org/comfy-openjutsu](https://github.com/Comfy-Org/comfy-openjutsu) | MIT | 156 | 2026-10-26 | Minimal character swap | Comfy's paid cloud |
| [lucataco/open-source-higgsfield](https://github.com/lucataco/open-source-higgsfield) | Apache-2.0 | 77 | 2026-10-30 | "Body Double": recast a performer, command line | Your own large GPU |
| [clawnify/OpenStudio](https://github.com/clawnify/OpenStudio) | MIT | 73 | 2026-11-17 | Image-only studio | OpenRouter (paid) |
| [TechBeme/open-higgsfield](https://github.com/TechBeme/open-higgsfield) | MIT | 47 | 2026-11-17 | Multi-provider generator and gallery | Freepik, Google, Vercel and others |
| [opencanvasai/OpenCanvas](https://github.com/opencanvasai/OpenCanvas) | MIT | 46 | 2026-07-22 | Desktop node editor, hackathon build | Google models |
| [jutsuhq/jutsu-studio](https://github.com/jutsuhq/jutsu-studio) | MIT | 34 | 2026-11-16 | Mac app for Higgsfield itself | Higgsfield (your account) |
| [jutsuhq/swapjutsu-seedance-character-swap](https://github.com/jutsuhq/swapjutsu-seedance-character-swap) | MIT | 11 | 2026-11-14 | Character swap, prepared on a Mac | Seedance 2.5 through Comfy's API |
| [jutsuhq/kawarimi-local-character-swap](https://github.com/jutsuhq/kawarimi-local-character-swap) | MIT | 4 | 2026-11-14 | Character swap for Windows and Linux | Your own NVIDIA GPU |

Five of these need a GPU Shard does not have (openjutsu, openfield, Body Double, Kawarimi, LTX Desktop). Their models are out of reach; their ideas are not.

## What Shard already does better

Worth knowing before borrowing anything.

- **Price before you pay.** HeliosGen, the other kie.ai app, shows only the account balance: no price per job and no cap. wide-trace and TechBeme show no cost at all. OpenStudio records what a run cost afterwards and shows only `$` to `$$$$` beforehand. Shard shows the estimate on the button, holds a per-job limit and a daily cap, and keeps a ledger. Only Swapjutsu and Jutsu Studio (same maker) do the same.
- **Camera and look pickers.** Open-Generative-AI's Cinema Studio turns a lens, focal length and aperture into prompt words through small lookup tables (`packages/studio/src/components/CinemaStudio.jsx`), for images only. Shard's director's menu does this for video, per model family.
- **A film, not just a clip.** Films, Scenes, Cast and the finish step have no equal in the table. The closest things are in the challenge list (below), not here.
- **Agents.** Shard's MCP server and CLI match what openfield (31 tools), BeatDesign (38 tools) and Swapjutsu offer.

## What to take

Grouped by how much work each is. "Idea" means design only. "Code" means the licence allows reuse with attribution.

### Small: the takes you already have

| Idea | From | What it is | Kind |
|---|---|---|---|
| Compare two takes | Jutsu Studio, OpenStudio | Two takes side by side, or one draggable divider between a before and an after | Idea |
| A failed take stays, with Retry | wide-trace | A refused or failed job remains as a tile saying why, and one click sends it again | Idea |
| Show the request that was sent | HeliosGen ("Native JSON prompt preview") | The exact body for a take, readable in the studio. Shard already prints it in `kie video --dry-run` | Idea |
| Select many takes | wide-trace, TechBeme | Shift-click a range, then download, favourite or delete together, with a few seconds to undo | Idea |
| "Auto" until set | Jutsu Studio (Cinema Studio 4.0) | An empty chip reads "Auto (the director picks)" instead of "+ Move", so leaving it empty is clearly a choice | Idea |
| The same-subject sentence | OpenStudio | Its reference prompt says "the SAME subject - identical face, hair, build and clothing". Compare with what Shard writes for a Library character | Idea |
| A picture on each pick | Open-Generative-AI | Every lens and camera option has a thumbnail. This is [improvement 5](../improvements.md) | Idea |
| Drop models that are gone | OpenStudio, Jutsu Studio | Read the provider's live model list so a withdrawn model disappears, with the built-in list as fallback. MiniMax H3 Max looks withdrawn from kie already | Idea |

Not checked: whether Shard's take viewer already has any of the first four. Check before building.

### Medium: new tools around a take

- **Next beat and Coverage (openfield).** Two one-click apps. *Next beat* continues a take from its last frame. *Coverage* makes nine different shots of the same moment. BeatDesign has the first as "tail-frame continuation". In Shard both fit Scenes: a button on a take that starts a new scene from its last frame, and a button that makes several scenes from one with different shot sizes and angles, which the new picks already describe.
- **Pay only for the part you need (Jutsu Studio).** Pick a 4 to 30 second range of a reference video; only that range is uploaded and billed. Shard now estimates a reference video on Seedance 2 Fast at the full 15 seconds because it cannot know the length. Trimming in the studio would make the estimate exact and the job cheaper.
- **A seam score for loops (openfield, Body Double).** A number for how well a clip's end meets its start, and a check on joins between chunks. This is [improvement 4](../improvements.md), which was going to be done by hand-comparing frames. Body Double's `qc.py` (Apache-2.0) is the file to read.
- **Long takes from chunks (Body Double).** One job per 81 frames with a 5-frame overlap, a quality check per join, and a re-roll of only the bad chunk; a crashed run resumes. Shard's Films already cut scenes together; the idea to take is the join check and re-rolling one scene instead of all.
- **A home screen of tools (LTX Desktop).** It opens on a gallery of ready-made tools grouped as Workflows, Post production, Styles, and Camera and motion. This is how Higgsfield's own apps page works, and it suits [improvement 9](../improvements.md) when after-the-take tools arrive.

### Large: character swap

Five of the projects in the table are clones of Higgsfield's Genjutsu (openjutsu, comfy-openjutsu, Body Double, Swapjutsu, Kawarimi), and the challenge list has more. Shard has nothing like it.

**What it does:** you give a video and a picture of a character. The person in the video becomes your character and keeps the performance, the camera and the timing.

**Why Swapjutsu is the one to study:** it renders through Seedance 2.5 and does all preparation on an Apple Silicon Mac, which is Shard's exact situation. Its pipeline (`docs/PIPELINE.md` in its repo):

1. Normalise the clip: 24 fps, longest side at most 960 px, 4 to 30 seconds.
2. Find the cuts.
3. Find and track each person, and match them across cuts.
4. Estimate depth for every frame.
5. Build a **control video**: the person to replace is painted as coloured depth, and every other pixel is the original frame. The face is always covered, because Seedance's public endpoint refuses real faces.
6. Send the control video as the reference video, then the character pictures as reference images, with a prompt in four parts: one line naming each image, a "Video edit." paragraph saying the coloured figure is the performer and gives pose not clothes, a numbered "replace" line per character, and a closing line to keep everything else.
7. Draft at 480p first ($1.19 for 7 seconds, by its README), then finalise at 1080p with the same motion.

**What is not known, and must be checked before promising this:**
- Whether **kie's** Seedance 2.5 accepts a reference video in this edit mode. Swapjutsu goes through Comfy's API, not kie. In Shard's catalog today, Seedance 2.5 takes no video reference; only Seedance 2 Fast and Kling 3.0 do.
- Whether kie applies the same face rule.
- How steps 3 to 5 would run in Shard. Swapjutsu uses Apple's Vision and Core ML from a Swift app; Shard is Node and a browser. This is the expensive part.

A cheaper first step, from Comfy's own openjutsu: redraw the **first frame** with the character using an image model, then use it as the first frame of a normal generation. Shard can do that today with what it has. It keeps the opening pose, not the whole performance.

Kling 3.0 Motion Control, which HeliosGen exposes on kie, is another route to the same result and is worth pricing.

### Large: editing in the browser

BeatDesign trims, splits, arranges, captions and exports MP4 with no ffmpeg on a server. Its exporter (`src/core/editor/media-export.ts`, Apache-2.0) decodes frames with WebCodecs, draws each frame with overlays and caption text onto a canvas, encodes H.264 and AAC, and builds the MP4 in memory, using the `mediabunny` library.

Why it matters here: Shard's cut, assemble and caption steps all need ffmpeg, and ffmpeg is broken on this Mac ([improvement 3](../improvements.md)). A browser export would make finishing work on any machine with Chrome.

Limits to know first: it needs a current Chrome; the MP4 is built in memory, so long films are a risk; BeatDesign itself has no transitions, speed changes or waveforms yet; and `mediabunny`'s own licence was not read. Lightricks moved LTX Desktop's timeline editor to "Legacy", a hint that editors are costly to keep.

Two of BeatDesign's design rules are worth taking whether or not the editor is: a timeline clip **pins one exact take** and never silently follows a newer one, and an agent's edits go through the same checked command path as the page's, so the two cannot overwrite each other.

### Not worth taking

- **A node canvas** (HeliosGen, OpenCanvas, BeatDesign, Open-Generative-AI's Workflow Studio). It is the most common feature in the list and the least useful for Shard: Films already give an order to the work, and a canvas is a second way to do the same thing.
- **More models for the count.** "600+ models" is a catalog dump. Shard's verified routes with real prices are worth more.
- **Local models.** They need an NVIDIA GPU, or a Mac with 32 to 48 GB for LTX.
- **Any code from wide-trace/open-higgsfield, HeliosGen or the Clabstream copy.** None has a licence.

## What Higgsfield itself offers now

Jutsu Studio is a client for Higgsfield, so its feature list (`docs/features.md`) is a current map of the product Shard is chasing:

- **Video modes:** Genjutsu (motion transfer, object swap, restyle), Seedance 2.5 (prompt and images, start and end frames, Edit, Extend), Kling 4.0 with a cheap Flash draft, Kling motion control, Wan 3.0, MiniMax H3, and a talking head from speech audio.
- **Cinema Studio 4.0 direction fields:** camera, lens, aperture, move, genre, era, lighting, pacing, palette. Shard now has move, speed, size, angle, lens and lighting. Still missing: **aperture, genre, era, pacing and palette**, as noted when the pickers were scoped.
- **After the take:** Upscale, Reframe, Remove Background, Dub, Change Voice.
- **Characters:** Create Character, with sheets saved as reusable elements. Shard's Library sheets cover this.

## The challenge list

The article links [a list of 113 entries](https://jutsustudio.com/open-source-higgsfield/) from ComfyUI's #OpenSourceHiggsfield challenge. It was read through a page summary, and no entry's repository was opened, so treat the names below as leads. Nearly all are ComfyUI workflows that need a GPU.

Closest to Shard, and worth reading next:
- **Haggs:** a film studio from script to screen with a cost per shot.
- **OpenKatana:** an agent-driven editor with a studio, a CLI and an MCP server, which is Shard's shape.
- **Imagination Studio** and **Sonder Editor:** plan, generate, edit and export; a timeline of scenes, prompts and takes.
- **Shot Board** (one scene to six shots) and **Picky** (one shot rendered ten ways): the Coverage idea again.
- **Storyboard Studio:** described as an open rebuild of Cinema Studio.

## Reuse and licences

| Reusable with attribution | Ideas only |
|---|---|
| Open-Generative-AI (MIT; some parts are submodules with their own licences) | wide-trace/open-higgsfield (no licence) |
| BeatDesign (Apache-2.0; `mediabunny` is separate) | HeliosGen (no licence) |
| Body Double (Apache-2.0) | ClabstreamTeam copy (says MIT, has no licence file) |
| openjutsu, comfy-openjutsu (MIT; the second bundles a GPL-3.0 node pack) | openfield (MIT text GitHub does not recognise; confirm first) |
| OpenStudio, TechBeme, OpenCanvas (MIT) | Jutsu Studio, Swapjutsu (MIT, but Swift: design reference only) |

## Suggested additions to the improvements list

In the order I would do them. None is added to [the list](../improvements.md) yet.

1. **Compare two takes, and keep failed takes with a Retry button.** Small, and it makes every other feature easier to judge.
2. **Next beat and Coverage in Scenes.** Uses the picks and scenes that already exist.
3. **Check whether kie's Seedance 2.5 or Kling Motion Control can do a character swap, and what it costs.** A reading task; it decides whether the large feature is possible at all. Done on 2026-11-18: see [Openjutsu's features on kie](2026-11-18-openjutsu-on-kie.md).
4. **First-frame swap** as the cheap version of character swap, if item 3 says the full version is far off.
5. **Trim a reference video before upload**, which also fixes the over-estimate added today.
6. **A browser export**, weighed against simply fixing ffmpeg.
