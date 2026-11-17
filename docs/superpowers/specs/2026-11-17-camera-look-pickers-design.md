# Camera and look pickers

Approved in conversation on 2026-11-17. No mockup files; the sketch is in [What you see](#what-you-see).

This adds to [scenes, Library sheets and a new look](2026-11-01-shard-scenes-design.md). It changes nothing that spec decided. It brings back, for scenes, the director's menu that [the director design](2026-10-31-director-design.md) built for shot plans.

## Why

Alex asked on 2026-11-17 what would bring Shard closer to Higgsfield, and chose this gap first.

Higgsfield's Cinema Studio is a panel of dropdowns: camera move, lens, aperture, lighting, genre, tempo, colour palette. Shard already holds most of that vocabulary in `cli/director/menu.json`: 23 moves, 4 speeds, 10 shot sizes, 8 angles, 7 lenses and 12 lighting setups, each with the words a prompt uses and a line on when to choose it. Only the terminal's shot plans (`kie plan`) use it. The studio's storyboard screen is no longer routed, and a scene's Camera, Scene and Style fields are free text. Someone who does not know the word "rack focus" has nothing to pick from.

## Decisions

| Question | Decision |
|---|---|
| What a pick does | It is remembered as a chip beside the text box. Shard writes its words when it builds the prompt. The text box stays. |
| What can be picked | What the menu already has. Per stage: move, speed, shot size, angle. Per scene: lens, lighting. |
| What an option shows | Its name and the menu's "when to use it" line. No pictures or clips in this version. |
| How a pick is stored | As a menu id in a small `picks` field on the stage and on the scene's cards. |
| Where it is built | Scenes first, then the Create Video page, in that order. |
| Who can set picks | The studio, and agents through the MCP server. `kie video` gets the same option for Create Video. |

Two other ways to store a pick were turned down:

- **Tokens inside the text**, like the `@library:` mentions. This reuses existing code, but it clutters the box and cannot hold a stage to one move.
- **Turning scenes into the terminal's shot plans.** Plans are already fully structured, but this is a rewrite and drops free text.

## What you see

### In a stage

A row of chips sits above the Camera box:

```
Stage 2 · 4–8s
[ Push in · slow × ]  [ Close-up × ]  [ + Angle ]
Camera   on her hands as she opens the box
Action   …
Ends on  …
```

- Three chips: **Move**, **Shot size**, **Angle**. An empty chip reads "+ Move"; a filled one shows the option's name.
- Clicking a chip opens a list of that group's options. Each row is the name and the "when" line, for example "Push in: move toward the subject to build attention or a realisation."
- The Move list has the four speeds as a row of toggles at the top. Speed is optional. It is hidden for Static and cleared when Static is picked.
- One pick per chip. Clicking a filled chip opens the list again to swap it. The × removes the pick.

### On the scene

- **Lighting** is a chip on the Scene card. **Lens** is a chip on the Style card.
- Those two cards are hidden today until they hold words or are opened with "+ Scene" or "+ Style". A card with a pick counts as holding something, so it stays shown.

### On Create Video

The same chip row sits under the prompt box, with all five chips in one row: Move, Shot size, Angle, Lens, Lighting. The picks belong to the draft, like the prompt and the references, and stay until the draft is cleared.

### Keyboard and names

- Each chip is a button that opens a listbox. Arrow keys move, Enter picks, Escape closes and returns focus to the chip.
- A chip's accessible name is written in full in `aria-label`, for example "Stage 2 move: Push in · slow. Change" (it contains the chip's visible text). The remove button is "Remove stage 2 move".

## Data

### Stage and cards

Two optional fields, both holding menu ids:

```jsonc
// a stage
{ "title": "Unboxing", "seconds": 4, "camera": "on her hands", "action": "…", "end": "…",
  "picks": { "move": "push-in", "speed": "slow", "size": "close-up", "angle": "low" } }

// the scene's cards
{ "goal": "…", "scene": "…", "stages": [ … ], "style": "…", "audio": "…",
  "picks": { "lens": "85mm", "light": "golden-hour" } }
```

- Every key is optional. A `picks` with no keys is not saved, so a scene with no picks is stored exactly as it is today. No migration.
- `cli/director/scenes.mjs` checks each id against the menu when a scene is saved. An unknown id is refused with the menu's own message, which lists the valid ones.
- `speed` is refused without a `move`, and with `move: "static"`.
- The types in `mentions.d.mts` and the page's `Stage` and `Cards` gain the fields.

### How the page gets the menu

The page imports `cli/director/menu.json` directly, as it already imports `scene-shape.mjs`. No new server route. The page uses `label` and `when`; the words stay on the server side.

## Prompt sent to the model

### The words

A new file, `cli/director/picks.mjs`, turns picks into words. `wording.mjs` uses it too, so a scene and a shot plan say a move the same way. `wording.mjs` must produce the same text as before; its tests guard that.

- **Framing:** the size's words, then the angle's, joined by a comma. "close-up, low angle".
- **Camera:** "the camera holds still" for Static. Otherwise "the camera", the speed's words when one is picked, then the move's words. "the camera slowly pushes in".
- **Stage line:** framing and camera joined by a semicolon, as one sentence. Either half may be missing.

### In a scene

`compileScene` writes the picks first, then the typed words:

```
[SCENE]
Warm, low golden-hour sunlight. A small kitchen, morning.

[STAGE 2 | 4–8 SECONDS | UNBOXING]
Camera: Close-up, low angle; the camera slowly pushes in. on her hands as she opens the box

[VISUAL STYLE]
85mm portrait lens. Warm grade, fine grain.
```

- A stage with picks and an empty Camera box still gets its `Camera:` line.
- A scene with a lighting pick and an empty Scene box still gets its `[SCENE]` section. The same holds for lens and `[VISUAL STYLE]`.
- A stage with picks counts as "says something", so the "Write the Goal, or what happens in a stage, first" problem does not fire for it.
- Scenes are Seedance 2.5 only, so there is one wording.

The prompt preview in the Scenes screen and the MCP `get_scene_prompt` tool already show this text before anything is paid for.

### On Create Video

The picks travel with the generate request. The server adds one block after the typed prompt, worded for the chosen model's family from its `promptProfile` in `cli/models.json`:

- **Hailuo:** the move's bracket command where the menu has one (`[Push in]`), then the framing, lens and light as sentences.
- **Every other family:** `Camera:` with the stage line above, then the lens and the light as sentences.

The block is added before the length check, so a prompt that the picks push past the model's limit is refused with today's message. The job's record keeps the picks beside the prompt, so a take's settings can be read back later.

## Agents and the terminal

- MCP `save_scene`: the `Stage` schema and `cards` gain `picks`. Its description says to choose ids from `get_menu`. When changing a scene, `cards.picks` merges by key like the other cards.
- MCP `generate_video` and `kie video` gain the picks for Create Video: `--pick move=push-in --pick light=golden-hour`.
- `copy_scene` and Save into film need no change: picks are part of the scene.

## Edges

- **Pasting a whole prompt** into a card replaces the cards, as today. The pasted prompt is the whole direction, so the scene's picks are cleared with it.
- **Typed words that disagree with a chip** ("pull out" typed under a Push in chip) are sent as written. No warning in this version.
- **A menu id removed later:** saving the scene is refused with the menu's message; the chip shows the raw id so it can be swapped or removed.
- **A look (preset) chosen on Create Video** keeps working. Picks are added after its prompt in the same way.

## Order of work

1. `picks.mjs` and the `wording.mjs` change, with tests. No behaviour change.
2. Scene data: validation in `scenes.mjs`, types, `compileScene`.
3. The chip row component (`web/src/scene/PickChips.tsx`) and its place in `SceneCards.tsx`.
4. MCP `save_scene`.
5. Create Video: the request, the server block, `kie video --pick`, MCP `generate_video`, then the chip row on the page.

Steps 1 to 4 are usable on their own.

## Testing

- `tests/director-wording.test.mjs`: unchanged and passing after step 1.
- A new `tests/director-picks.test.mjs`: framing only, camera only, both, Static, speed with and without a move.
- `tests/scene-compile.test.mjs`: each pick's place in the prompt; picks with empty boxes; a scene with no picks compiles to the same text as before.
- `tests/scenes.test.mjs`: an unknown id refused; speed without a move refused; an empty `picks` not saved.
- `PickChips.test.tsx`: pick, swap, remove, speed hidden for Static, arrow keys and Escape, the accessible names.
- `SceneScreen.test.tsx`: a picked chip is saved and survives a reload; a pick keeps the Scene card shown.
- `mcp/tests`: `save_scene` accepts picks and refuses an unknown id.
- Create Video: the block for a Hailuo model and for a Seedance model; the length check counts it; `kie video --pick` refuses an unknown group.

## Out of scope

- Preview clips or stills for each option.
- Genre, era, tempo, colour palette and camera body, which the menu does not have.
- The menu's other groups: depth, lens look, cuts, screen direction, key light side.
- Warning when typed words contradict a chip.
- Picks on the Image page.
