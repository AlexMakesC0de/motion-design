# Camera and look pickers on Create Video: implementation plan

Part 2 of [the pickers spec](../specs/2026-11-17-camera-look-pickers-design.md#on-create-video). Part 1 (Scenes) is [here](2026-11-17-camera-look-pickers-scenes.md) and is merged.

**Goal:** five chips under the Create Video prompt box (Move with speed, Shot size, Angle, Lens, Lighting). The picks travel with the generate request, and the words are added after the typed prompt in the wording the chosen model reads best. `kie video --pick` and MCP `generate_video` take the same picks.

**What already exists:** `cli/director/picks.mjs` (`STAGE_PICKS`, `SCENE_PICKS`, `stageWords`, `pickSentence`, `cameraWords`, `framingWords`, `setPick`), `cli/director/menu.mjs` (`loadMenu`, `entry`), `web/src/scene/PickChips.tsx` (`PickChip`), and each video model's `promptProfile` (`family`, `maxChars`) in `cli/models.json`.

## Decided while planning

- **One flat object.** `picks: { move, speed, size, angle, lens, light }`, every key optional, values are menu ids.
- **The length check is new and only fires with picks.** Today no free-text prompt is checked against `promptProfile.maxChars`. A prompt that goes over the limit only because of the added block is refused before anything is spent. A typed prompt with no picks is sent as before.
- **Reuse restores the chips.** A job keeps what was typed (`typedPrompt`) and its `picks` beside the full prompt it sent. Reuse on a take puts the typed words and the chips back, so the block is not duplicated.
- **A look keeps the chips.** Choosing a look replaces the prompt but leaves the picks.
- **Hailuo and speed.** When a move has a bracket command (`[Push in]`) the bracket is used and a picked speed is written as its own short sentence after it.

## Task 1: the block, shared by every caller

Create `cli/director/video-picks.mjs` and `tests/director-video-picks.test.mjs`.

```js
export const VIDEO_PICKS = { ...STAGE_PICKS, ...SCENE_PICKS };

/** Checked picks, or null when nothing is picked. Throws a usage-style error with field "picks". */
export function cleanVideoPicks(input, { menu = loadMenu() } = {})

/** The lines added after the typed prompt, for a model family ("hailuo" or anything else). "" when no picks. */
export function picksBlock(picks, family, { menu = loadMenu() } = {})

/** { prompt, picks, typedPrompt } to send. Throws (nothing spent) when the block pushes the prompt past maxChars. */
export function applyVideoPicks(prompt, input, model, { menu = loadMenu() } = {})
```

- `cleanVideoPicks`: same rules and messages as `cleanPicks` in `cli/director/scenes.mjs` with `where = "The video"` (unknown key lists the six keys; unknown id is the menu's own message; `speed` needs a `move` other than `static`). Export `cleanPicks` from `scenes.mjs` or move it into `video-picks.mjs` and import it back, whichever leaves one copy.
- `picksBlock`, every family except hailuo: `Camera: <stageWords(...)>` when any of move/size/angle is picked, then `pickSentence(lens)`, then `pickSentence(light)`, one per line.
- `picksBlock`, hailuo: the move's `hailuo` bracket when the menu entry has one (then the speed's words as a sentence, e.g. `Slowly.`), otherwise the camera sentence; then the framing sentence; then lens and light sentences.
- `applyVideoPicks`: returns the typed prompt unchanged with `picks: null` when nothing is picked. Otherwise `prompt = typed.trimEnd() + "\n\n" + block`. When `model.promptProfile?.maxChars` is set and the result is longer: throw `unknown("Refused before submitting, nothing was spent. With the picks the prompt is N characters; <model> follows at most M. Shorten the prompt or remove a pick.", { field: "prompt" })`.

Tests: each key's words for a Seedance model; the Hailuo bracket with and without one on the menu; unknown key, unknown id, speed without move; over-limit refusal; no picks returns the prompt untouched.

## Task 2: the three callers

- `web/server/api/generate.mjs`, `/api/generate/video`: read `body.picks` (object or absent), call `applyVideoPicks(a.prompt, body.picks, model)` after the model is resolved and the request validated, send its `prompt`. Put `picks` and `typedPrompt` into the inputs record (`extra`) and into the job record (`record` passed to `submitJob`) only when there are picks.
- `web/server/state.mjs` `jobView`: expose `picks` (object or null) and `typedPrompt` (string or null). Add both to `JobView` in `web/src/api/types.ts`.
- `mcp/server.mjs` `generate_video`: `picks` in the input schema (six optional strings, each described with its `get_menu` group), same call, same record. Description gains: "picks adds a camera move, shot size, angle, lens and light from get_menu after your prompt, worded for the model."
- `cli/kie.mjs` `video`: `--pick key=id`, repeatable (`pick: { type: "string", multiple: true, default: [] }`). A value without `=` is a usage error naming the six keys. Same call; `inputs.json` gains `picks` and `typedPrompt`; `prompt.txt` holds what was sent. Add the flag to the help text and to `cli/README.md`.

Tests: `web/tests` (the route appends the block, records the picks, refuses an unknown id with nothing spent), `mcp/tests` (accepts picks, refuses an unknown id), `tests/cli.test.mjs` (`--pick` with `--dry-run` shows the block; a bad `--pick` is refused).

## Task 3: the chips on the page

- `web/src/studio/promptStore.ts`: `Draft.picks: VideoPicks` (`{}` when empty), in `EMPTY_DRAFT`; `generateBody` sends `picks` for video when it has keys; `reuseJob` sets `prompt: job.typedPrompt ?? job.prompt ?? ""` and `picks: job.picks ?? {}`; `applyPreset` leaves `picks` alone; `estimateBody` unchanged (picks do not change the price).
- `web/src/studio/VideoScreen.tsx`: under the textarea, inside `.prompt-card`, a `div.pick-row role="group" aria-label="Camera and look picks"` with five `PickChip`s: Move (with speeds), Shot size, Angle, Lens, Lighting. Scope names are the same words. Use `setPick` from `picks.mjs` so removing a move, or picking Static, clears the speed.
- Tests in `VideoScreen.test.tsx` and `promptStore.test.ts`: picking sends `picks` in the generate body; no picks sends none; Reuse restores typed prompt and chips; picking Static clears the speed.

## Task 4: check and docs

- `npm test`, `npm run test:mcp`, `npm run test:web`, `web/node_modules/.bin/tsc -p web/tsconfig.json`.
- In the running studio: pick, see the chips, read the dry-run prompt with `kie video --dry-run`.
- `web/README.md` and `mcp/README.md`: one paragraph each. Tick item 1 in [the improvements list](../../improvements.md).
