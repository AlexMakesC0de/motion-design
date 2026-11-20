# Camera move prompts: the Studio's preview clips

Written 2026-11-20 for the Camera popup's tiles ([CameraPopup.tsx](../../web/src/home/CameraPopup.tsx)): one short clip per move and one still per Setup option, all of one character, `@korean-girl-student`, in one location. Builds on [prompting and eval](2026-10-30-prompting-and-eval.md) and [the Higgsfield pipeline](2026-10-30-higgsfield-pipeline.md). The moves and their prompt words are the director's menu ([menu.json](../../cli/director/menu.json)); the craft is [craft.md](../../skills/motion-design/references/director/craft.md).

Sources are tagged **[V]** vendor or official, **[T]** third party, **[F]** our inference with no source. Nothing here was A/B tested on Seedance; no source anywhere did that for single moves. The test batch below is that test.

## What the research says

### Rules that hold for every clip

- **The move comes first**, in the first 8-10 words, with a speed word: "Slow dolly in…" [V Runway, BytePlus; T Kling guide]. Motion words buried mid-prompt run less reliably.
- **One move per clip.** Stacking push, pull, pan and tilt "increases image instability" [V Runway, BytePlus].
- **Never write "tripod" (or any gear) when the frame could show it.** Pan left opened on empty room with "fixed on a tripod" and Seedance drew a tripod in shot (2026-11-20). Say "stays fixed in one spot and only rotates" instead [T].
- **Rule out the look-alike.** "no zoom" on a dolly, "no travel" on a zoom, "no pan, no rotation" on a truck, "no tilt" on a pedestal [V Higgsfield camera-control article].
- **Say what holds still**, on its own line apart from the camera: "She stands still, breathing softly." With a first frame, describe only what moves and state what stays [T]. Tiny life (breath, blink, hair in the wind) keeps it from reading as a frozen photo [F].
- **No cuts:** end with "Single continuous shot, no cuts." Higgsfield: Seedance "will default to cutting between angles" if not told what the camera is not doing [V]. At 4-5 s the risk is low, but it costs nothing.
- **Speed words, not seconds.** Timings like "0-3 s" are unstable [V BytePlus, Runway]. Use slow, smooth, steady; "fast" is the keyword where warping starts [V Runway; T Apiyi]. Only whip pan and crash zoom get it.
- **Name the end frame** for travelling moves ("…to a medium close-up of her face") or the distance lands anywhere [T seedance.tv; V Higgsfield].
- **Length:** 25-60 words for a single-shot image-to-video clip. Don't re-describe what the first frame already shows [T; the "60-100 words official" figure in one write-up could not be found in the official guide].
- **Strip the sound** with `ffmpeg -an`: Seedance 2.5 adds audio even when told not to (our own finding). Send `generate_audio=false` on 2.5 anyway.

### What the starting picture must contain

A move only reads if the first frame gives it something to work with [T shoty, seedance.tv; mostly F]:

| Moves | The first frame needs |
|---|---|
| Pan, truck, slider, side tracking, orbit | Three depth layers: something near the lens (tall grass), her in the middle, a distinct background |
| Rack focus | A wall or pillar edge close to the lens on the left, her on the right, dancing mildly; she starts sharp (or no picture: sheet and room as references) |
| Tilt up | Below her waist height, pointing at the carpet, her feet just at the top edge (or no picture: sheet and room as references) |
| Pull out, crane up, aerial pullback | A frame wide enough to reveal from (Higgsfield: "needs a wide keyframe" [V]) |
| Push in, crash zoom | Headroom and a clear landing point: her face |
| Dolly zoom | Strong lines in the background (a path, a wall edge, a horizon) or the warp is invisible |
| Bullet time | Something hanging in the air: hair blown sideways, dust, petals |
| Robot arm | S10: close, at the level of her feet, from her side, her trainers and the carpet sharp in front of the lens (Alex) |
| Snorricam | Her from the waist up, mid-step, walking toward the camera, centred (Alex, after Higgsfield's tile) |
| Aerial, drone orbit, helicopter | A high view; an eye-level frame gives the model nothing to fly over |

### The known failures, by move

- **Orbit:** the subject rotates instead of the camera; it rebuilds the far side of the face. Keep it under 45° and write "she stays still and does not turn; only the camera moves" [T; V Higgsfield "constant radius, one direction"].
- **Zoom vs push in:** rendered as each other unless the other is ruled out [V Higgsfield; T Kling: a zoom compresses, a dolly keeps perspective].
- **Pan vs truck:** confused; say "stays fixed in one spot and only rotates" for a pan (not "tripod": it gets drawn), "slides sideways, no rotation" for a truck [V Higgsfield; F].
- **Pedestal:** comes out as a tilt; say "level horizon, no tilt" [F].
- **Handheld:** without "subtle" it goes chaotic [T]; describe the operator, not the shake [V Higgsfield].
- **Dolly zoom:** naming only "vertigo effect" leaves it to the model; name both halves, "dollies backward while zooming in" [T shoty]. Highest risk of the set.
- **Follow, side tracking, snorricam:** need the subject to move. A still subject gives the rig nothing to follow, so these three clips let her walk or turn [F].
- **Whip pan:** needs somewhere to land, or it blurs back to the same frame [F].
- **Robot arm, slider, helicopter, drone orbit:** no source has a tested prompt. Higgsfield's preset list has the names only [V]. Our wording below is inferred [F].

### Setup looks

Higgsfield Cinema Studio 4.0's presets [V, blog/cinema-studio-4-0-complete-guide]: bodies Modern, 35mm Film, 8mm Film, DV Camcorder; lenses Clean Sharp, Anamorphic, Vintage Anamorphic, Warm Vintage, Halation Vintage; apertures f/1.4, f/4, f/11. Their descriptions [V, blog/ai-video-camera-control]: anamorphic is "horizontal oval bokeh, horizontal flare, and slight barrel distortion"; vintage anamorphic adds lower contrast and chromatic aberration; warm vintage is diffusion, warmth and slightly blooming highlights; halation is "the glowing red-tinged halo around bright highlights".

- "Cinematic" alone does nothing; two or three specific look words do [T].
- An f-number works as a style cue, not an optic: always pair it with its effect, "f/1.4, shallow depth of field, background melts into soft bokeh" [T].
- Focal lengths are learned looks: 14mm on a close face stretches it, so keep her full body small on wide lenses [T].
- At 480p square, aperture and focal length differ subtly. Lights or texture in the background make bokeh size show [F].
- Higgsfield: depth of field drifts mid-move unless it is tied to an aperture [V]. Not an issue for stills.

## The plan

1. **Location** (Alex is making it): one wide, eye-level, empty image, square, soft even light, with tall grass close to the lens on one side, open ground in the middle, a readable background with a few strong lines, and open sky above.
2. **Starting stills** (image model, `@korean-girl-student` as identity + the location as style): the eight below. Every clip starts from one, so the grid matches like Higgsfield's.
3. **Clips** (image-to-video, first frame only; Seedance 2.5 can't take a first frame together with reference images): 4 s, 1:1, 480p, sound stripped.
4. **Setup tiles**: stills, edited from S1 or reshot, never clips.
5. **Test batch first**: orbit left, snorricam, rack focus, dolly zoom on Seedance 2 Fast and Seedance 2.5. Pick the model, fix the prompts that failed, then run the rest.

`[location]` below is replaced by a one-line description of the location once it exists. `[foreground]` is its near element (tall grass, until we see the image).

### Starting stills

Each prompt also gets: "The woman is @korean-girl-student: a Korean woman in her early 20s, long dark hair with bangs, black blazer, white shirt, black tie, black pleated skirt, black knee-high socks, black loafers. Use the sheet for her face and outfit only, not its layout or grey background. Photoreal, natural skin, soft even daylight. Square frame."

| Still | Prompt | Used by |
|---|---|---|
| **S1 full** | Full-body shot at eye level of the woman standing still in the middle ground of [location], facing the camera, arms relaxed. [foreground] close to the lens on the left edge of the frame, the background clearly visible behind her, open sky above her head with room to tilt up. | Most moves |
| **S2 close** | Medium close-up of the woman, chest up, centred, facing the camera, at eye level in [location]; the background softly out of focus. | Pull out, tilt down, zoom out, dolly zoom, snorricam, handheld |
| **S3 near-sharp** | Eye level in [location]: [foreground] very close to the lens, sharp and filling the lower left third; the woman standing in the middle ground behind it, out of focus. Very shallow depth of field. | Rack focus |
| **S4 far-sharp** | The same framing as S3, but the woman is sharp and [foreground] in front of her is a soft blur. | Rack focus to foreground |
| **S5 high** | High aerial view looking down at about 45 degrees over [location], the woman a small figure standing in the middle of it. | Aerial, drone orbit, helicopter, crane down |
| **S6 POV** | First-person point of view looking down at her own black loafers and knee-high socks standing on the ground of [location], her hands just visible at the bottom edges. | POV |
| **S7 profile** | Full-body side view of the woman in profile, mid-step, walking to the right through [location]; [foreground] near the lens. | Side tracking |
| **S8 wind** | Full-body shot like S1, but a strong gust blows her hair and skirt sideways and dust and grass seeds hang in the air around her. | Bullet time |

### Move clips

Every prompt ends with "Single continuous shot, no cuts." It is left out below to save space. Words are counted without it.

| Move | Start | Prompt |
|---|---|---|
| Static shot `static-shot` | S1 | Fixed camera, locked off at eye level, no camera movement. The woman stands still, breathing softly and blinking; her hair and the grass stir in a light breeze. No zoom. |
| Dolly in `dolly-in` | S1 | Slow dolly in toward the woman, from a full-body shot to a medium close-up of her face, no zoom. The grass in the foreground slides out of frame. She stands still, breathing softly. |
| Dolly out `dolly-out` | S2 | Slow dolly out from a medium close-up of the woman to a full-body wide shot that reveals the location around her, no zoom. She stands still, breathing softly, hair stirring. |
| Pan left `pan-left` | sheet + room | Slow pan left. The camera stands still in one place and only turns. It starts facing the empty room to the right of the woman, so she is not in the frame. Then it turns slowly to the left until she is in the centre of the frame, and stops. She stands still, looking at the camera. No zoom. (Agreed 2026-11-20: a short, plain prompt worked where longer ones slid sideways or drew a tripod.) |
| Pan right `pan-right` | sheet + room | Slow pan right. The camera stands still in one place and only turns. It starts facing the empty room to the left of the woman, so she is not in the frame. Then it turns slowly to the right until she is in the centre of the frame, and stops. She stands still, looking at the camera. No zoom. (Agreed 2026-11-20: a short, plain prompt worked where longer ones slid sideways or drew a tripod.) |
| Tilt up `tilt-up` | sheet + room | The camera sits below her waist height, pointing down at the carpet in front of her, her feet just visible at the top edge of the frame. Keeping that height, with no rising and no travel, it tilts slowly up her legs and body to her face, revealing her from below. She stands still, breathing softly. No zoom. |
| Tilt down `tilt-down` | sheet + room | The camera sits a little above her head height, a few steps in front of her, pointing up at the ceiling lights; only the top of her hair is just visible at the bottom edge. Keeping that height, with no lowering and no travel, it tilts slowly down past her face and body to her trainers on the carpet, revealing her from above. She stands still, breathing softly. No zoom. |
| Truck left `truck-left` | sheet + room | Truck left. The woman stands centred, facing the camera. She turns to her side and starts walking slowly to the left while the camera holds still, so she drifts toward the left edge of the frame. Then the camera starts sliding sideways after her, slowly catching up until she is back in the centre. The pillars pass between her and the camera. Steady, no zoom. |
| Truck right `truck-right` | sheet + room | Truck right. The woman stands centred, facing the camera. She turns to her side and starts walking slowly to the right while the camera holds still, so she drifts toward the right edge of the frame. Then the camera starts sliding sideways after her, slowly catching up until she is back in the centre. The pillars pass between her and the camera. Steady, no zoom. |
| Pedestal up `pedestal-up` | S1 | Slow pedestal up: the camera rises straight up, level horizon, no tilt. The woman sinks lower in the frame as the camera looks over her toward the far background. She stands still. No zoom. |
| Pedestal down `pedestal-down` | S1 | Slow pedestal down: the camera lowers straight down to knee height, level horizon, no tilt. The grass in the foreground rises to fill the bottom of the frame. She stands still. No zoom. |
| Tracking `tracking` | S1 | Smooth tracking shot: the camera moves backward at walking speed, leading the woman as she walks slowly toward it, keeping her the same size in frame. The location streams past behind her. Steady, no shake, no zoom. |
| Arc left `arc-left` | S1 | Slow arc left: the camera travels about 40 degrees around the woman to the left at a constant radius, keeping her centred while the background slides behind her. She stays still and does not turn; only the camera moves. No zoom. |
| Arc right `arc-right` | S1 | Slow arc right: the camera travels about 40 degrees around the woman to the right at a constant radius, keeping her centred while the background slides behind her. She stays still and does not turn; only the camera moves. No zoom. |
| Crane up `crane-up` | first frame: her centred at eye level; last frame: the high atrium view | Crane up. The shot opens at her level, a few steps in front of her, her full body in the centre of the frame. The camera rises steadily upward and moves back along a smooth curve, tilting down to keep her in the centre. It keeps rising the whole time, up past the balconies, and ends high above, looking steeply down at her standing small in the middle of the floor. She stands still. No zoom. 5 s. (Agreed shape 2026-11-20: first and last frame pin both ends; a prompt alone stopped halfway.) |
| Crane down `crane-down` | Crane up played backwards | The same two frames swapped (or the Crane up clip reversed): from high above, looking steeply down, the camera descends and moves forward along a curve until it is at her level, her full body centred. 5 s. |
| Handheld `handheld` | S2 | Subtle handheld camera at eye level, held by an operator standing in front of her, a gentle natural sway with each breath. The woman stands still, looking into the lens, hair stirring. No zoom. |
| Slow zoom in `slow-zoom-in` | S1 | Slow optical zoom in on the woman's face; the camera stays locked in one spot with no travel, so the background stays flat with no parallax. She stands still, breathing softly. |
| Slow zoom out `slow-zoom-out` | S2 | Slow optical zoom out from the woman's face to her full figure; the camera stays locked in one spot with no travel, no parallax. She stands still, breathing softly. |
| Dolly zoom `dolly-zoom` | S2 | Dolly zoom: the camera dollies backward while zooming in at the same time, so the woman stays exactly the same size in frame while the background stretches and looms closer behind her. She stands still, staring into the lens. |
| Aerial `aerial` | S5 | Slow aerial drone flyover: the camera glides forward high above the location, looking down at about 45 degrees, passing over the woman standing small below. Level, steady flight, no zoom. |
| Rack focus `rack-focus` | sheet + room | Locked-off camera. On the left, very close to the lens, the edge of a pillar in the same yellow wallpaper; on the right, a few metres back, the woman dancing mildly on the spot. She starts sharp and the pillar is a soft blur; then the focus slowly pulls to the pillar, which turns sharp as she melts into blur. Shallow depth of field. No camera movement, no zoom. |
| Rack focus to foreground `rack-focus-near` | S4 | Locked-off camera, no movement. Rack focus: the focus pulls from the woman to the grass in the foreground, which becomes sharp as she softens into blur. Shallow depth of field. She stands still. No zoom. |
| Side tracking `side-tracking` | S7 | Smooth lateral tracking shot, strict side view: the camera moves alongside the woman at her walking speed and a constant distance as she walks slowly to the right in profile; the grass in the foreground streams past. Steady, no zoom. |
| Slider left `slider-left` | sheet + room | The camera starts on the woman, centred, full body, and glides smoothly sideways to the left at eye level, never turning; the near pillars pass in front with clear parallax and she slides out of frame on the right. She stands still. No zoom. (Made 2026-11-20 by reversing a clip that slid onto her.) |
| Slider right `slider-right` | sheet + room | The camera starts on the woman, centred, full body, and glides smoothly sideways to the right at eye level, never turning; the near pillars pass in front with clear parallax and she slides out of frame on the left. She stands still. No zoom. (Made 2026-11-20 by reversing a clip that slid onto her.) |
| Snorricam `snorricam` | S9 | Snorricam: the camera is strapped to the woman's waist, pointing up at her face, framing her from the waist up as she walks forward. It is fixed to her body, so it jolts and shakes with every step. When she turns to look left, her body twists and the camera swings left with it, then right when she looks right; she stays pinned in the middle of the frame while the room lurches and swings behind her. No zoom. |
| Robot arm `robot-arm` | S10 | Robotic motion-control camera, close to the woman the whole time, 6 s. It starts at her feet, then swirls up and around her in one smooth, precise move at a steady, unhurried pace, easing back a little as it goes, until it faces her from the front, and holds dead still. Then it pivots up and over her, ending high above, looking straight down on the top of her head, and holds dead still. She stands perfectly still. No shake, no zoom. |
| POV `pov` | sheet + room | First-person POV: the camera is the woman's own eyes. She looks down at her trainers and the hems of her sweatpants as she walks slowly forward over the carpet, her hands in her sleeves just visible at the bottom edges, then lifts her gaze to the pillars and ceiling lights ahead. Natural, gentle head movement with each step. No zoom. |
| Whip pan `whip-pan` | S1 | Whip pan: the camera holds on the woman, then whips fast to the right in a blurred pan, the camera fixed in one spot, and settles on a new view of the location beside her. No zoom. |
| Crash zoom `crash-zoom` | Alex's wide picture | Crash zoom. The camera stays in one place. It zooms in fast from her full body toward her face, slowing down near the end, and stops on a tight close-up with her eyes exactly in the centre of the frame, then holds still. She stands still, staring into the lens. |
| Bullet time `bullet-time` | sheet + room | Bullet time. The camera faces her straight on, close, full body in frame. She jumps, knees bending so her legs fold to about 90 degrees, her hair flying up around her. At the top of the jump, time stops: she hangs frozen in mid-air, hair and clothes suspended. Hold still for a full second, then the camera circles slowly around her, staying close, while she and her hair stay frozen. No zoom. 6 s. |
| Drone orbit `drone-orbit` | S5 | Slow drone orbit: the camera circles the woman from high above at a constant radius, looking down at about 45 degrees, keeping her small and centred while the location turns beneath. Steady, no zoom. |
| Helicopter shot `helicopter` | S5 | Helicopter shot: the camera flies high over the location in a smooth, sweeping forward arc, the woman a tiny figure far below. Steady flight, level horizon, no zoom. |
| Aerial pullback `aerial-pullback` | S1 | Aerial pullback: the camera pulls back and rises steadily into the sky, the woman shrinking to a small figure in the middle of the wide location below. Smooth, no shake, no zoom. |

### Setup tiles (stills)

Looks are edits of S1 with S1 as the reference: "The same photo, the same woman, pose, framing and location. Change only how it was filmed: …". Framing and lenses can't be edited in, so they are new stills from the same prompt base, with the line below in place of S1's framing.

| Option | Line |
|---|---|
| **Camera: DV camcorder** | Recorded on a 2000s handheld DV camcorder: soft video detail, digital noise, slightly blown highlights, a little cool, imperfect framing. |
| **Camera: 8mm film** | Shot on Super 8 film: heavy grain, faded warm colour, soft focus, light leaks at the edge, a slight vignette. |
| **Camera: 35mm film** | Shot on 35mm film: fine authentic grain, rich natural colour, a gentle halation bloom on the highlights. |
| **Camera: Modern** | Shot on a modern digital cinema camera: clean, sharp, low noise, neutral colour. |
| **Lens: Clean sharp** | A clean modern lens: maximum detail, no aberration, round soft bokeh. |
| **Lens: Anamorphic** | An anamorphic lens: horizontal oval bokeh, a horizontal blue flare streak across the brightest highlight, slight barrel distortion. |
| **Lens: Vintage anamorphic** | A vintage anamorphic lens: lower contrast, chromatic aberration at the edges, streaking flares, oval bokeh. |
| **Lens: Warm vintage** | A warm vintage lens: soft diffusion, warm tones, gently blooming highlights, forgiving skin. |
| **Lens: Halation vintage** | Halation: a glowing red-tinged halo around every bright highlight and along the edge of the sky. |
| **Aperture: f/1.4** | f/1.4 wide open: very shallow depth of field, she is sharp and the background melts into creamy bokeh. |
| **Aperture: f/4** | f/4: she is sharp, the background softly out of focus but still recognisable. |
| **Aperture: f/8-11** | f/11 deep focus: everything sharp, from the grass near the lens to the far background. |
| **Focal 14mm** | Shot close on a 14mm ultra-wide lens: a very wide view of the location, strong perspective lines, her full figure small in the centre so her face is not stretched. |
| **Focal 24mm** | A 24mm wide lens: her full figure in a wide view of the location, the background deep. |
| **Focal 35mm** | A 35mm lens: her full figure with the location around her, natural perspective. |
| **Focal 50mm** | A 50mm lens: knees up, natural perspective, the background a little softer. |
| **Focal 85mm** | An 85mm portrait lens: chest up, the background compressed and softly blurred. |
| **Focal 135mm** | A 135mm telephoto from far away: head and shoulders, the background flattened and pulled close behind her. |
| **Focal 100mm macro** | A 100mm macro lens: an extreme close detail of her eye and lashes, razor-thin depth of field. |
| **Size: Extreme wide** … **Insert** | Ten framings from "a tiny figure in the whole location" to "an insert of her hand straightening her tie". Same base, one line each. |
| **Angle: Eye level** … **Point of view** | Eight angles: eye level; high, looking down; low, looking up; overhead, straight down; worm's eye from the ground; Dutch, tilted about 15 degrees; over the shoulder of an unseen person blurred in the foreground; her first-person view (S6). |

## Agreed clips: the exact prompts

Every clip Alex agreed for the Camera popup on 2026-11-20, with the prompt sent word for word. All Seedance 2.5 on kie, 480p, 16:9, sound off (`generate_audio=false`, then `ffmpeg -an`). "Sheet + room" means references `beige-sweats-girl#1` (identity) and `yellow-rooms` (style), no first frame. The clips themselves live in `runs/camera-moves/<move id>.mp4` (git-ignored: they show a personal character).

### Arc left `orbit-left`

4s · first frame: Alex's wide picture: her full body, centred, eye level, in the yellow room · job j-20261120-0bfa7d · $0.56

> Slow arc left: the camera travels about 40 degrees around the woman to the left at a constant radius and eye height, keeping her centred while the yellow pillars and the rows of ceiling lights slide behind her with clear parallax. She stays still and does not turn; only the camera moves. She breathes softly and blinks, her hair barely stirring. The flat fluorescent light stays even. No zoom. Single continuous shot, no cuts.

### Arc right `orbit-right`

4s · first frame: Alex's wide picture: her full body, centred, eye level, in the yellow room · job j-20261120-0bfa7d · free, made from that job's clip: Arc left flipped left-to-right (ffmpeg hflip)

> Slow arc left: the camera travels about 40 degrees around the woman to the left at a constant radius and eye height, keeping her centred while the yellow pillars and the rows of ceiling lights slide behind her with clear parallax. She stays still and does not turn; only the camera moves. She breathes softly and blinks, her hair barely stirring. The flat fluorescent light stays even. No zoom. Single continuous shot, no cuts.

### Dolly in `push-in`

4s · first frame: Alex's wide picture: her full body, centred, eye level, in the yellow room · job j-20261120-74d862 · $0.56

> Slow dolly in: the camera travels straight forward across the carpet toward the woman at eye height, from a wide full-body shot to a medium close-up of her face, no zoom. The pillars on both sides slide out past the edges of the frame and the ceiling lights pass overhead. She stands still, staring into the lens, breathing softly, her hair barely stirring. The flat fluorescent light stays even. Single continuous shot, no cuts.

### Dolly out `pull-out`

4s · first frame: Alex's wide picture: her full body, centred, eye level, in the yellow room · job j-20261120-74d862 · free, made from that job's clip: Dolly in played backwards (ffmpeg reverse)

> Slow dolly in: the camera travels straight forward across the carpet toward the woman at eye height, from a wide full-body shot to a medium close-up of her face, no zoom. The pillars on both sides slide out past the edges of the frame and the ceiling lights pass overhead. She stands still, staring into the lens, breathing softly, her hair barely stirring. The flat fluorescent light stays even. Single continuous shot, no cuts.

### Static shot `static`

4s · first frame: Alex's wide picture: her full body, centred, eye level, in the yellow room · job j-20261120-943937 · $0.56

> Static shot. The camera does not move at all. The woman stands in the centre of the frame, lifts her right hand and gives a small, friendly wave at the camera, then lowers it. No zoom. One continuous shot.

### Snorricam `snorricam`

4s · first frame: Alex's waist-up picture of her in the yellow room · job j-20261120-a6444b · $0.56

> Snorricam: the camera is strapped to the woman's waist, pointing up at her face, framing her from the waist up as she walks forward. It is fixed to her body, so it jolts and shakes with every step. When she turns to look left, her body twists and the camera swings left with it, then right when she looks right; she stays pinned in the middle of the frame while the room lurches and swings behind her. No zoom. Single continuous shot, no cuts.

### Robot arm `robot-arm`

6s · sheet + room · job j-20261120-5b6240 · $0.84

> The woman is @Image1: use the sheet for her face, hair and outfit only, not its layout, grey background or the grey oval over the face. She stands still in the room of @Image2: an endless empty office floor with damp yellow wallpaper on square pillars, worn mustard carpet and a drop ceiling with bright flat fluorescent panels.
> >
> > Robotic motion-control camera, close to her the whole time. It starts at the level of her feet, low beside her off-white trainers on the carpet. Then it swirls up and around her in one smooth, precise move at a steady, unhurried pace, easing back a little as it goes, until it faces her from the front at eye level, and holds dead still. Then it pivots up and over her, ending high above, looking straight down on the top of her head, and holds dead still. She stands perfectly still, arms by her sides. No shake, no zoom. Photoreal, flat even fluorescent light. Single continuous shot, no cuts.

### Tilt up `tilt-up`

4s · sheet + room · job j-20261120-4f4029 · $0.56

> The woman is @Image1: use the sheet for her face, hair and outfit only, not its layout, grey background or the grey oval over the face. She stands still in the room of @Image2: an endless empty office floor with damp yellow wallpaper on square pillars, worn mustard carpet and a drop ceiling with bright flat fluorescent panels.
> >
> > The shot opens with the camera low, below her waist height, a few steps in front of her, pointing down at the worn carpet; only the toes of her off-white trainers are just visible at the very top edge of the frame. Keeping exactly that height, with no rising and no travel, the camera slowly tilts up on the spot, past her trainers, wide sweatpants and oversized sweatshirt, to her face, revealing her from below against the ceiling lights. She stands perfectly still, arms by her sides, staring into the lens. No zoom. Photoreal, flat even fluorescent light. Single continuous shot, no cuts.

### Tilt down `tilt-down`

4s · sheet + room · job j-20261120-b824e7 · $0.56

> The woman is @Image1: use the sheet for her face, hair and outfit only, not its layout, grey background or the grey oval over the face. She stands still in the room of @Image2: an endless empty office floor with damp yellow wallpaper on square pillars, worn mustard carpet and a drop ceiling with bright flat fluorescent panels.
> >
> > The shot opens with the camera a little above her head height, a few steps in front of her, pointing up at the grid of ceiling tiles and fluorescent panels; only the top of her dark hair is just visible at the very bottom edge of the frame. Keeping exactly that height, with no lowering and no travel, the camera slowly tilts down on the spot, past her face, oversized sweatshirt and wide sweatpants, to her off-white trainers on the carpet, revealing her from above. She stands perfectly still, arms by her sides, breathing softly. No zoom. Photoreal, flat even fluorescent light. Single continuous shot, no cuts.

### Rack focus `rack-focus`

4s · sheet + room · job j-20261120-bd15fb · $0.56

> The woman is @Image1: use the sheet for her face, hair and outfit only, not its layout, grey background or the grey oval over the face. She is in the room of @Image2: an endless empty office floor with damp yellow wallpaper on square pillars, worn mustard carpet and a drop ceiling with bright flat fluorescent panels.
> >
> > Locked-off camera at chest height, no movement. On the left third of the frame, very close to the lens, stands the edge of a square pillar covered in the same damp yellow patterned wallpaper. On the right, a few metres back, the woman dances mildly on the spot, swaying her hips and shoulders, her arms loose, her hair moving. At first she is sharp and the pillar in front is a soft creamy blur. Then the focus slowly pulls to the pillar: its wallpaper texture turns crisp and sharp while she melts into a soft blur, still swaying. Very shallow depth of field, rack focus. No camera movement, no zoom. Photoreal, flat even fluorescent light. Single continuous shot, no cuts.

### POV `pov`

4s · sheet + room · job j-20261120-13646d · $0.56

> The person is @Image1: use the sheet for her outfit only (the oversized beige sweatshirt, wide beige sweatpants and off-white trainers), not its layout or grey background; her face is never seen. The place is the room of @Image2: an endless empty office floor with damp yellow wallpaper on square pillars, worn mustard carpet and a drop ceiling with bright flat fluorescent panels.
> >
> > First-person POV: the camera is the woman's own eyes. She looks down at her off-white trainers and the hems of her wide beige sweatpants as she walks slowly forward over the worn mustard carpet, her hands in the oversized beige sleeves just visible at the bottom edges of the frame. Then she lifts her gaze to the endless yellow pillars and ceiling lights ahead. Natural, gentle head movement with each step. No zoom. Photoreal, flat even fluorescent light. Single continuous shot, no cuts.

### Pan left `pan-left`

4s · sheet + room · job j-20261120-16eb6e · $0.56

> The woman is @Image1, in the room of @Image2. Use the sheet only for her face, hair and outfit.
> >
> > Slow pan left. The camera stands still in one place and only turns. It starts facing the empty room to the right of the woman, so she is not in the frame. Then it turns slowly to the left until she is in the centre of the frame, and stops. She stands still, looking at the camera. No zoom. One continuous shot.

### Pan right `pan-right`

4s · sheet + room · job j-20261120-ec31ee · $0.56

> The woman is @Image1, in the room of @Image2. Use the sheet only for her face, hair and outfit.
> >
> > Slow pan right. The camera stands still in one place and only turns. It starts facing the empty room to the left of the woman, so she is not in the frame. Then it turns slowly to the right until she is in the centre of the frame, and stops. She stands still, looking at the camera. No zoom. One continuous shot.

### Slider right `slider-right`

4s · sheet + room · job j-20261120-2013cb · free, made from that job's clip: played backwards (ffmpeg reverse): the clip slid onto her, reversed it slides away

> The woman is @Image1: use the sheet for her face, hair and outfit only, not its layout, grey background or the grey oval over the face. She stands still in the room of @Image2: an endless empty office floor with damp yellow wallpaper on square pillars, worn mustard carpet and a drop ceiling with bright flat fluorescent panels. She is the only thing in the room.
> >
> > Slow pan left. The camera stays fixed in one spot at eye level, a few metres in front of her, and only rotates; it never travels. The shot opens pointed at the empty room off to the right of her, as the camera sees it: only yellow pillars, carpet and ceiling lights, nobody in frame. The camera then slowly rotates to the left, the pillars sliding across the frame, the woman entering from the left edge, until she stands exactly in the centre of the frame, full body, and the camera stops and holds on her. She stands perfectly still, arms by her sides, looking into the lens. No zoom. Photoreal, flat even fluorescent light. Single continuous shot, no cuts.

### Crane up `crane-up`

5s · first frame: Alex's wide picture: her full body, centred, eye level, in the yellow room; last frame: Alex's high view down into the atrium · job j-20261120-4f2cfb · $0.7

> Crane up. The shot opens at her level, a few steps in front of her, her full body in the centre of the frame. The camera rises steadily upward and moves back along a smooth curve, tilting down to keep her in the centre. It keeps rising the whole time, up past the balconies, and ends high above, looking steeply down at her standing small in the middle of the floor. She stands still. No zoom. One continuous shot.

### Crane down `crane-down`

5s · first frame: Alex's wide picture: her full body, centred, eye level, in the yellow room; last frame: Alex's high view down into the atrium · job j-20261120-4f2cfb · free, made from that job's clip: Crane up played backwards (ffmpeg reverse)

> Crane up. The shot opens at her level, a few steps in front of her, her full body in the centre of the frame. The camera rises steadily upward and moves back along a smooth curve, tilting down to keep her in the centre. It keeps rising the whole time, up past the balconies, and ends high above, looking steeply down at her standing small in the middle of the floor. She stands still. No zoom. One continuous shot.

### Side tracking `side-tracking`

4s · sheet + room · job j-20261120-c221b3 · $0.56

> The woman is @Image1, in the room of @Image2. Use the sheet only for her face, hair and outfit.
> >
> > Side tracking shot. We see the woman from the side, in profile, walking slowly to the right across the room. The camera moves sideways alongside her at the same speed, staying the same distance from her, so she stays in the centre of the frame while the yellow pillars pass between her and the camera and slide by behind her. Steady, no zoom. One continuous shot.

### Pedestal up `pedestal-up`

4s · sheet + room · job j-20261120-0e4a4d · $0.56

> The woman is @Image1, in the room of @Image2. Use the sheet only for her face, hair and outfit.
> >
> > Pedestal up. The camera faces her straight on, a few steps in front of her, and starts low at the height of her knees. It rises straight up at a steady pace, staying level and never tilting, until it is at the height of her eyes. She stands still, looking ahead. No zoom. One continuous shot.

### Pedestal down `pedestal-down`

4s · sheet + room · job j-20261120-0e4a4d · free, made from that job's clip: Pedestal up played backwards (ffmpeg reverse)

> The woman is @Image1, in the room of @Image2. Use the sheet only for her face, hair and outfit.
> >
> > Pedestal up. The camera faces her straight on, a few steps in front of her, and starts low at the height of her knees. It rises straight up at a steady pace, staying level and never tilting, until it is at the height of her eyes. She stands still, looking ahead. No zoom. One continuous shot.

### Slow zoom in `zoom-in`

5s · first frame: Alex's wide picture: her full body, centred, eye level, in the yellow room · job j-20261120-25f871 · $0.7

> Slow zoom in. The camera stays in one place and slowly zooms in from her full body toward her face. As it gets close to her face, the image stretches slightly, like a wide lens, just a little, to feel immersive. It ends on a close-up of her face and holds still for the last second. She stands still, looking into the lens. One continuous shot.

### Slow zoom out `zoom-out`

5s · first frame: Alex's wide picture: her full body, centred, eye level, in the yellow room · job j-20261120-25f871 · free, made from that job's clip: Slow zoom in played backwards (ffmpeg reverse)

> Slow zoom in. The camera stays in one place and slowly zooms in from her full body toward her face. As it gets close to her face, the image stretches slightly, like a wide lens, just a little, to feel immersive. It ends on a close-up of her face and holds still for the last second. She stands still, looking into the lens. One continuous shot.


### Truck left `truck-left`

4s · sheet + room · job j-20261120-b19cff · $0.56

> The woman is @Image1, in the room of @Image2. Use the sheet only for her face, hair and outfit.
>
> Truck left. The woman stands in the centre, facing the camera. She turns to her side and starts walking slowly to the left while the camera holds still, so she drifts toward the left edge of the frame. Then the camera starts sliding sideways after her, slowly catching up until she is back in the centre. The pillars pass between her and the camera. Steady, no zoom. One continuous shot.

### Truck right `truck-right`

4s · sheet + room · job j-20261120-925634 · $0.56

> The woman is @Image1, in the room of @Image2. Use the sheet only for her face, hair and outfit.
>
> Truck right. The woman stands in the centre, facing the camera. She turns to her side and starts walking slowly to the right while the camera holds still, so she drifts toward the right edge of the frame. Then the camera starts sliding sideways after her, slowly catching up until she is back in the centre. The pillars pass between her and the camera. Steady, no zoom. One continuous shot.

### Crash zoom `crash-zoom`

4s · first frame: Alex's wide picture: her full body, centred, eye level, in the yellow room · job j-20261120-44f270 · $0.56

> Crash zoom. The camera stays in one place. It starts on her full body from a little far away, then zooms in fast toward her face, slowing down near the end, and stops on a tight close-up with her eyes exactly in the centre of the frame, then holds still. She stands still, staring into the lens. One continuous shot.

### Bullet time `bullet-time`

6s · sheet + room · job j-20261120-6f952d · $0.84 · last 1.4 s cut off (it went wrong), 4.6 s kept

> The woman is @Image1, in the room of @Image2. Use the sheet only for her face, hair and outfit.
>
> Bullet time. The camera faces her straight on, close, her full body in frame. She jumps, her knees bending so her legs fold to about 90 degrees, her hair flying up around her. At the top of the jump, time stops: she hangs frozen in mid-air, her hair and clothes suspended exactly where they were. Everything holds completely still for a full second. Then the camera circles slowly around her, staying close, while she, her hair and her clothes stay frozen in the air. No zoom. One continuous shot.

### Dolly zoom `dolly-zoom`

5s · sheet + room · job j-20261120-3a8720 · $0.70 · Alex's wording, with its opening "A single continuous dolly zoom shot of…" sentence removed; the effect is subtle but real

> The woman is @Image1, in the room of @Image2. Use the sheet only for her face, hair and outfit.
>
> The camera slowly dollies inward while simultaneously zooming outward, maintaining the subject at nearly the same size in the frame throughout the shot. The result should create a strong cinematic perspective distortion where the background compresses and expands unnaturally, emphasizing depth and spatial tension, while the subject remains visually stable and prominent. Keep the shot smooth, cinematic, and realistic, with no cuts, no sudden shakes, and no major change in the subject's pose.

### Drone orbit `drone-orbit`

5s · sheet + room · job j-20261120-6e34d7 · $0.70 · about half a circle (back → side → three-quarter front), framed to the knees. The first try ("She does not move or turn") had her spinning like a turntable while the room stayed put; pinning her to "always facing the same wall" and saying the room slides past fixed it.

> The woman is @Image1, in the room of @Image2. Use the sheet only for her face, hair and outfit.
>
> The woman stands frozen in place, feet planted, always facing the same wall. Her body never turns. The camera travels sideways around her in a full circle at the height of her waist, so we see her front, then her side, then her back, then her other side. The pillars and walls behind her slide past as the camera moves. She stays in the centre of the frame. No zoom. One continuous shot.

### Slider left `slider-left`

4s · sheet + room · job j-20261120-5a21d5 · $0.56 · not right: the camera travels left but keeps her centred, so it reads as tracking rather than sliding past her. Alex kept it as the preview anyway.

> The woman is @Image1, in the room of @Image2. Use the sheet only for her face, hair and outfit.
>
> She stands still in the centre of the frame, full body, at eye level, looking into the lens. The camera travels slowly sideways to the left in a straight line, never rotating, always pointing the same direction. As it moves, she drifts toward the right edge of the frame and the pillars slide past. She does not move. No zoom. One continuous shot.

## Follow-up: the menu's own words

The `#move` tags and the picks write each move's `words` from the menu into real prompts. The research says several should say what they are not. Worth changing after the test batch confirms the wording works:

- `push-in` "pushes in" → "dollies in, no zoom"; `pull-out` likewise.
- `zoom-in` "zooms in" → "zooms in optically without moving, no parallax".
- `pan-left` "pans left" → "pans left, turning in place without travelling".
- `truck-left` "trucks left" → "slides sideways to the left without turning".
- `pedestal-up` "rises straight up" → "rises straight up, level, without tilting".
- `orbit-left` → add "while the subject stays still".
- `dolly-zoom` already names both halves.

## Sources

BytePlus official Seedance 2.0 prompt guide (ai.byteplus.com/ark/…/seedance-2-0-prompt-guide); Runway's Seedance guide (runway.com/resources/seedance-2-0-prompt-guide); Higgsfield's Seedance guides (higgsfield.ai/blog/seedance-prompting-guide, /seedance-2-5-prompting-guide), camera presets (higgsfield.ai/camera-controls), camera-control article (higgsfield.ai/blog/ai-video-camera-control) and Cinema Studio 4.0 guide (higgsfield.ai/blog/cinema-studio-4-0-complete-guide); aliteq.com/higgsfield-camera-moves; help.apiyi.com (a write-up of the official guide); shoty.ai, seedance.tv and seedance-2.app camera-movement guides; stevenvideo.com and atlabs.ai Kling 3 guides; pippit.ai on unwanted camera movement. Reddit searches found nothing.
