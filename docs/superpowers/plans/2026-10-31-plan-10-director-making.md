# Director, making the film (steps 2, 3 and 5)

> Steps 2 (casting and stills), 3 (filming and the editor pass) and 5 (review) of the [director spec](../specs/2026-10-31-director-design.md). Step 4, the studio storyboard, has its own plan because it needs these functions first. Built test-first in this session; nothing here spends money in tests (every provider call is a stub).

**Goal:** an approved shot plan becomes stills, then takes, then a delivered `film.mp4`, through one shared core that the CLI, the MCP tools and the studio all call.

## Decisions made while planning

| Question | Choice | Why |
|---|---|---|
| Where stills and takes live | Flat in `runs/<film>/`: `s2-still.png`, `s2-still-2.png`, `s2-take.mp4`, `s2-take-2.mp4` | `waitJob` lands every artifact in the run folder with `artifactBase`, so per-shot folders would mean changing the download path every job shares. The shot id prefix keeps them grouped and the Takes feed shows them unchanged. |
| How a still or take knows its shot | The job record carries `shot` and `stage` (`still`, `take`, `sheet`) | The job store already holds every attempt, its state and its cost; the storyboard reads it rather than a second copy. |
| Which still or take a shot uses | `shot.still` / `shot.take` when somebody chose one (a file name), else the newest succeeded one | Choosing is `update_shot { still: "s2-still-2.png" }`, already free and checked. |
| Style still | `look.styleStill` when set, else the newest still of the first shot that has one; never the shot's own | Spec: the first approved still sets the look. Reported in every still result so it is never silent. |
| References on stills | Shot cast as `identity`, the style still as `style`, only when the still model's route takes references | GPT Image 2.5 and (since dbe170f) Nano Banana 2 take them; Seedream 5 Pro does not, and the result says the still went without them. |
| A still made before the shot changed | Marked stale: the job records a hash of the still wording; the view compares it with the shot's current wording | Alex edits a shot in the inspector; the storyboard must show which stills no longer match. |
| Continuous cuts | The next shot waits for this take, then uses its real last frame (`kie frames`' `last.png`) as `first_frame` | Works on every route; `return_last_frame` is Seedance-draft only. |
| Film all | `filmReady` submits every shot that is ready and returns at once; calling it again moves the queue on | An MCP tool cannot block for minutes. The CLI loops it with `waitJob`; the studio's follower calls it again when a take settles. |
| Failures in Film all | A failed take is never refilmed automatically; a limit refusal (code 2) or an ambiguous create (code 5) stops the queue and names the shot | Spending stays Alex's decision. Redo is `film_shot`. |
| A spending guard | `film_all` takes `max_usd`; it refuses when what it would submit costs more | The agent states the total and passes it; a plan that grew in the meantime cannot overspend. |
| Editor pass joins | `dissolve` → 0.5 s cross-fade, `whip` → 0.25 s slide, `fade-out` → fade to black at the end, everything else a hard cut | Matches the menu; `continuous`, `on-action`, `match` and `jump` are all hard cuts in the edit. |
| Trim | Each take keeps `durationS` seconds from 0.5 s in (the padding), or from `review.bestWindow.startS` | Spec. |
| Sound in the cut | Takes are silent except lip-sync shots, which keep their audio; `music` and `vo` files are mixed through `assemble` (ducking, -16 LUFS) | Reuses the tested mix. |
| On-screen copy | Not composited in this step. `cut_film` lists the shots with `copy` and an end card can be passed as a rendered file (`kie render`) to close the film | Compositing alpha renders per shot needs Remotion; it is the next piece once a real film shows how copy should sit. |
| Review | `review_shot` builds the contact sheet, first and last frames; the agent judges and records `{ verdict, checks[], bestWindow? }` with `save_review` | Spec. Auto-redo is left out; redo stays Alex's call. |

## Modules (all in `cli/director/`)

- `media.mjs`: `shotMedia(store, film, plan)` → per shot `{ stills[], takes[], still, take, sheet }` from the job store; each item `{ jobId, state, file, createdAt, stale }`. `stillFile` / `takeFile` resolve what a shot uses.
- `still.mjs`: `stillWording(plan, shot, { menu, assets, brief })` (pure, golden-tested); `makeStill(catalog, film, shotId, ctx)`; `sheetWording(asset)` and `makeSheet(catalog, assetName, ctx)`.
- `film.mjs`: `filmShot(catalog, film, shotId, ctx)`; `filmReady(catalog, film, ctx)`.
- `cut.mjs`: `cutPlan(plan, media, reviews)` (pure: windows and joins); `cutFilm(film, { music, vo, endCard, out, signal, onLine })`.
- `review.mjs`: `reviewShot(film, shotId)` (frames); `saveReview`, `readReview`.

`ctx` is `{ store, limits, library, roots, upload, deps, via, onEvent }`, the same pieces the three front ends already build.

## Front ends

- CLI: `kie still`, `kie shot`, `kie film`, `kie review`, `kie cut`, `kie cast`; each spending command takes `--dry-run`.
- MCP: `make_sheet`, `make_still`, `film_shot`, `film_all`, `review_shot`, `save_review`, `cut_film`, `get_shots` (media view). Spending tools say in their descriptions that filming runs only when Alex asked.
- Studio (step 4): the same functions behind `/api/films/:run/...`.

## Tests (no spending)

- `tests/director-still.test.mjs`: golden still wording; references chosen; stale marking; refusals (plan with errors, unknown shot); a stubbed submit records `shot`, `stage`, the hash and the artifact base.
- `tests/director-film.test.mjs`: generated length and audio-off params reach the request; no still refuses; continuous waits then uses the last frame; Film all order, refusal stop, code-5 stop, never refilming a failed take, `max_usd`.
- `tests/director-cut.test.mjs`: `cutPlan` windows and joins; a real two-take cut with ffmpeg on generated test clips; review records.
- MCP and CLI tests for the new tools and commands.
