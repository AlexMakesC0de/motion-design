# The director: a film crew for the studio

Agreed with Alex on 2026-10-31. The studio should work like a film crew: Alex explains an idea, a director develops it into a brief, plans the shots with a cinematographer's choices (size, angle, lens, depth, move, light, cut), suggests the best model for each shot, writes each shot in its model's own wording, and films it shot by shot.

This replaces two positions in the [quality plan](../../quality-plan.md):

- "What we deliberately do not copy: camera-body and lens pickers ... a chat director UI." Alex wants both: the cinematography vocabulary and a director in the chat.
- Phase 2 waiting on the ~$15 Phase 1 comparison. Alex chose to build it without running the comparison. Phases 2 and 3 of that plan are what this spec builds, extended.

Background: [Higgsfield pipeline research](../../research/2026-10-30-higgsfield-pipeline.md), [model prompting rules](../../research/2026-10-30-prompting-and-eval.md), the [model ratings Alex read](../../../skills/motion-design/references/tool-routing.md#which-model-for-which-job).

## Decisions

| Question | Choice |
|---|---|
| How involved is Alex before money is spent? | **Storyboard, then go.** The director plans and makes cheap stills; Alex sees a storyboard with the total, edits anything, and presses one button to film. |
| Which films? | All four: product ads with UI, live-action look, character animation, product hero shots. |
| Drafts? | **Stills, then final.** No 480p video drafts. A bad shot is redone on its own. |
| Who directs? | **The agent, with the rules in code.** The studio chat, Claude Code and Codex plan through the same tools; code holds the menu, checks the plan, picks models and writes the wording. |
| Storyboard layout | **A: strip plus shot inspector** (mockup in `.superpowers/brainstorm/41273-1793416631/content/storyboard-layout.html`). |
| Professional extras | Casting sheets, consistent stills, chained joins, a checker, a per-model translator, film-wide sound, an editor pass, review after each shot. |
| Left out | Trained face models (Soul ID), an emotion wheel, video drafts, upscaling, Kling 4.0 until the catalog has a verified route. |

## How it feels to use

1. **Explain.** Alex writes the idea however it comes: "an ad where Zed helps a stressed founder, something about the inbox, calm at the end."
2. **Brief.** The director writes it back as a brief: takeaway, audience, length, format, tone, must-show items, exact copy, sound. If something material is missing it asks one or two questions. If Alex is unsure it offers two or three short directions and develops the chosen one.
3. **Casting.** For every character, product and location the film needs, the director checks the Library. Missing or weak references get a reference sheet (a few cents each) before any still.
4. **Shot plan.** Shots with size, angle, lens, depth, one move, light, screen direction, cut, model, a one-line reason, and two or three pass/fail checks. The checker must pass before stills.
5. **Stills.** One still per shot, consistent in light, colour and grain. Alex can change a shot and remake its still.
6. **Go.** **Film all · $X** films every shot at final quality.
7. **Review and edit.** Each shot gets a contact sheet and a pass/redo verdict. The editor pass trims, cuts, adds music and the code-drawn text, and delivers the film.

## The director's knowledge

### The handbook (prose, read by the agent)

`skills/motion-design/references/director/`:

- `craft.md`: shot sizes and what each tells the viewer; angles and what they do to a subject; lenses (perspective, compression, faces); depth of field; every move on the menu and when it earns its place; lighting setups; composition (thirds, headroom, lead room, negative space); cuts (on action, match, whip, dissolve, hard); continuity (the 180° line, screen direction, eyelines, light direction, 30° rule); pacing (shot length against action; establish, then detail, then payoff).
- One chapter per film type, each with typical coverage, a worked 3–5 shot example and common mistakes:
  - `product-ui.md`: virtual camera over screens, macro on details, graphic match cuts, kinetic type, end card. Exact text and real screenshots are code renders or stills from real assets, never AI-drawn.
  - `live-action.md`: master, singles, cutaways, inserts; eyeline and screen direction; motivated light.
  - `character.md`: staging, acting beats (one expression change per close-up), identity held by the casting sheet.
  - `product-hero.md`: turntable, light sweeps, macro texture, slow precise moves, studio lighting.
- `brief.md`: how to develop an idea into a brief, when to ask, and how to offer directions.

Written from established cinematography teaching (shot grammar, coverage, continuity, lighting), checked against the model prompting research. Each entry says what it is, when to use it, and what to avoid. The handbook is guidance; anything code must enforce lives in the menu and the checker.

### The menu (data, enforced by code)

`cli/director/menu.json`. Every entry has an id, a plain label, a one-line "use it when", and wording fragments per prompt family (see the translator).

| Group | Entries |
|---|---|
| Size (9) | extreme wide, wide, full, medium wide, medium, medium close-up, close-up, extreme close-up, insert |
| Angle (8) | eye level, high, low, overhead, worm's eye, dutch, over the shoulder, point of view |
| Lens (7) | 14mm, 24mm, 35mm, 50mm, 85mm, 135mm, 100mm macro; look: clean spherical or anamorphic |
| Depth (3) | shallow (f/1.4–2), medium (f/4), deep (f/8–11) |
| Move (15) | static, push in, pull out, pan left/right, tilt up/down, truck left/right, pedestal up/down, follow, orbit (≤45°), crane up/down, handheld, zoom in/out, rack focus; speed: slow, medium, fast |
| Light (9) | soft high key, low key, Rembrandt, backlit rim, golden hour, night with practicals, studio product (softbox plus rim), neon, overcast natural |
| Cut (5) | hard cut, cut on action, match cut, whip, dissolve; plus **continuous** (the next shot starts on this shot's last frame) |
| Job (7) | motion graphics, cinematic, reference-driven, UGC, lip sync, animation, product hero; this drives the model picker |

## What gets saved

Each film's folder `runs/<film>/` gains:

- `brief.json`: `{ takeaway, audience, durationS, aspectRatio, tone, mustShow[], copy[], sound: { music, voice, sfx }, filmType }`.
- `shots.json`:

```json
{
  "version": 3,
  "look": {
    "palette": "warm amber and ink", "grade": "soft contrast, lifted blacks",
    "filmLook": "35mm film", "lensFamily": "spherical", "keyLightSide": "left",
    "cast": [{ "asset": "zed", "role": "character" }, { "asset": "zethus-inbox", "role": "screen" }],
    "styleStill": "shots/s1/still-2.png"
  },
  "shots": [{
    "id": "s2", "durationS": 4, "purpose": "Zed arrives to help",
    "size": "medium-close-up", "angle": "low", "lens": "50mm", "depth": "shallow",
    "move": { "type": "truck-right", "speed": "slow" }, "light": "soft-high-key",
    "subject": "Zed", "action": "Zed steps in from frame left and leans toward the laptop",
    "screenDirection": "left-to-right", "cast": ["zed"],
    "job": "reference-driven", "model": "seedance-2-5", "modelReason": "S tier for reference images",
    "cut": "continuous", "why": "Low angle makes Zed the hero arriving.",
    "checks": ["Zed matches his sheet", "only the camera trucks right"],
    "copy": [], "still": "shots/s2/still-1.png", "take": null, "status": "still-approved"
  }]
}
```

- Every write is atomic, and the replaced version moves to `runs/<film>/.history/<timestamp>/`, as the Library does.
- Stills, takes and reviews live in `runs/<film>/shots/<id>/`. Every still and take is an ordinary job (`prompt.txt`, `inputs.json`, `job.json`, `cost.json`) tagged with its shot id, so the Takes feed, Spend and job recovery keep working unchanged.

## The checker (script supervisor)

`cli/director/check.mjs` returns `{ errors[], warnings[] }`, each with the shot id and a plain sentence. Errors block stills and filming. Warnings show on the storyboard and never block.

**Errors**

- A value is not on the menu, or a shot has more than one move.
- The chosen model cannot take the shot: its generated length (below) is outside the model's durations, the aspect ratio is not offered, or it has no `first_frame` input.
- A cut is `continuous` but the next shot's model has no `first_frame`.
- Quoted text or numbers sit in `action` (AI would draw them). They belong in `copy`, which the editor pass renders in code.
- `cast` or `look.cast` names an asset that is not in the Library.
- The shots add up to more than one second away from `brief.durationS`.
- Screen direction flips between consecutive shots of the same subject without a `crossesLine` reason (180° rule).

**Warnings**

- Three shots in a row share a size.
- A jump cut: the same subject at the same size with less than a 30° angle change.
- A 14mm or 24mm lens on a close-up of a face.
- A fast move on a shot of four seconds or less.
- The key light changes side between shots without a reason.
- A shot over 8 seconds on Seedance (its own help says problems appear around 5–8s).
- A live-action film with no wide or extreme-wide shot.
- An orbit on Wan, where arcs over 45° break.

## The model picker

- Alex's ratings move from the table in `tool-routing.md` into `models.json` as `goodFor: { "<job>": "S" | "A" }`. A test keeps the table and the data in step.
- For each shot: take the models rated S for its job, then A. Drop any that cannot take the shot (length, ratio, `first_frame`, refs). Pick the first one left, and report it with its tier, the reason it was chosen and the live price from `preflight`.
- When an S-tier model was dropped, the reason names what ruled it out, for example "Wan 3.0 takes 5–10s; this shot is 3s".
- An explicit choice from Alex always wins. The checker still refuses a model that cannot take the shot.
- Stills get a model the same way:
  - GPT Image 2.5 when a screen or product must look exact;
  - Nano Banana 2 for photoreal people and places;
  - Seedream 5 Pro for a stylised look.

## The translator

- `cli/director/wording.mjs` turns one shot plus the film's look into the prompt for its model.
- Each model gets a `promptProfile` in `models.json`: family, maximum length, shot syntax, camera syntax, the audio-off switch, a closing line, and whether it has a negative field. This follows the repo rule that provider knowledge stays out of prose.

| Family | Shape (one shot per job, animated from its still) |
|---|---|
| Seedance | `Shot 1:` label; camera first, then framing, lens and depth; then the action; the light line; then "No subtitles, no logo or watermark." Audio off via `generate_audio=false`. |
| Hailuo (MiniMax) | Style line, then a bracket command (`[Push in]`, `[Truck right]`), then one action; prompt optimizer off when brackets are used. |
| Kling | The subject in identical words every shot; framing and move; the action; a short negative list where the route has the field. |
| Wan | "One continuous shot."; size and angle, the move, the action; "No dialogue. No background music." |
| Veo | `[Cinematography] + [Subject] + [Action] + [Context] + [Style]`; sound in separate `SFX:` / `Ambient:` sentences when wanted. |

- Starting from a still means the prompt describes what changes, not what the still already shows. Character, product and look descriptions are copied word for word from the Library and `look`, so the model never sees two versions of Zed.
- Each family has golden tests: a fixed shot must produce exactly the expected text.

## Making the film

### Casting

`kie cast` / `make_sheet` makes a reference sheet for a Library item that has no usable one:

- characters: front and full body on neutral grey;
- products: three-quarter and front on a seamless background;
- locations: a 16:9 wide establishing frame.

The sheet is saved into the item as a new version, and the old one is kept in its history. Each sheet is one image job.

### Stills

`kie still --shot s2` / `make_still`:

- The prompt is built from the look, the shot's size, angle, lens, depth and light, and the cast descriptions. The cast sheets are attached as references, and once `look.styleStill` is set it is attached as a style reference.
- The first still Alex approves becomes `styleStill` unless Alex picks another.
- Two candidates per shot (`--n 2`) are allowed; the default is one.

### Filming

`kie shot --shot s2` / `film_shot` submits image-to-video with the approved still as `first_frame`.

- **Length.** The generated length is the smallest supported duration of at least the planned length plus one second, so the editor can drop the sluggish start. The cost shown everywhere uses that generated length.
- **Continuous cuts.** For a `continuous` cut, the next shot waits for this one and uses its real last frame as `first_frame`: `return_last_frame` where the route supports it, `kie frames` otherwise. That shot's still was a preview, and the storyboard says so.
- **Film all.** `kie film` / **Film all** films the shots in order. Each goes through `reserve()`, so the per-job limit and daily cap apply to every shot. A refusal stops the queue and says which shot and why. A code-5 ambiguity stops the queue and offers `kie job <id>`, never a resubmit.
- **Sound.** Shots are silent unless the brief's sound plan gives a shot dialogue or lip sync.

### The editor pass

`kie cut` / `cut_film` extends `assemble`:

- each take is trimmed to its planned length (by default dropping the first 0.5s, or keeping the window the review marked best);
- shots join with the plan's cuts (`hard`, `dissolve`, `whip` as a fast xfade; `continuous` and `on action` as hard cuts);
- the brief's music bed and effects go on, and `copy` is drawn by `kie render` and composited with `--alpha`;
- the end card closes the film.

Output: `runs/<film>/film.mp4` plus `cut.json` recording what was used.

### Review

`kie review --shot s2` / `review_shot` builds the contact sheet and first and last frames (`kie frames`). The agent then looks at them, judges each of the shot's checks, and records `{ verdict: "pass" | "redo", checks: [{ check, ok, note }], bestWindow? }` in `shots/<id>/review.json`.

- The storyboard shows the verdict.
- Redo is Alex's decision unless auto-redo is switched on for the film. Auto-redo is capped at 2 tries per shot and at the film's total on the Film button.

## Where it runs

- **Shared core** in `cli/director/`: `menu.json`, `plan.mjs` (read, write, history), `check.mjs`, `pick.mjs`, `wording.mjs`, `cost.mjs`. It reuses `cli/core` for generation, spending, jobs and the Library.
- **CLI:**

| Command | What it does |
|---|---|
| `kie brief` | Show or set the brief |
| `kie plan` | Show the plan, check it and print the cost per shot and in total (free) |
| `kie cast` | Make reference sheets |
| `kie still` | Make a shot's still |
| `kie shot` | Film one shot |
| `kie film` | Film every shot in order |
| `kie review` | Contact sheet and verdict for a shot |
| `kie cut` | The editor pass |

- **MCP tools** for Claude Code, Codex and the studio chat:

| Tool | What it does |
|---|---|
| `get_brief`, `save_brief` | Read and write the brief |
| `get_plan`, `save_plan`, `update_shot` | Read and write the shot list; a plan that fails the checker is refused with the reasons |
| `check_plan` | Run the checker |
| `suggest_model` | The model picker for one shot |
| `shot_wording` | The translator for one shot |
| `make_sheet`, `make_still` | Casting sheets and stills |
| `film_shot`, `film_all` | Film one shot or the whole plan |
| `review_shot` | Contact sheet and verdict |
| `cut_film` | The editor pass |

- **Money.** The agent may make sheets and stills without asking, since they cost cents and limits still apply. `film_shot` and `film_all` say in their descriptions that they run only when Alex has asked to film. The studio's Film button is the main path.
- **Studio:**
  - A **Storyboard | Takes** switch on Studio for each film; a film with `shots.json` opens on Storyboard.
  - Storyboard (layout A):
    - the brief card and a timeline bar with shots sized by length;
    - the still strip, each still with its model, price and reason;
    - the inspector, where every menu field is a select, plus the model, checks and the checker's messages;
    - **Film all · $X**.
  - A "Plan this" box sends the idea to the chat.
  - API: `GET/PUT /api/films/:run/brief`, `GET/PUT /api/films/:run/plan`, `POST …/plan/check`, `POST …/shots/:id/still`, `POST …/film`, `POST …/shots/:id/review`, `POST …/cut`. Progress uses the existing event stream.
- **Skill.** `SKILL.md` and `production.md` change their default from "one complete film request" to brief, casting, plan, stills, film, review, cut. A single multi-shot job stays an explicit choice where one continuous camera is the point (the hero loop). The handbook chapters are linked from the Production mode.

## Testing

All tests run without spending:

- the checker gets one test per rule, failing and passing;
- the picker is tested against a fixture catalog;
- the translator has golden tests per family;
- plan storage tests history and atomic writes, and refuses symlinked film folders like the chat transcript does;
- the filming queue is tested against stub `generate` deps, covering order, continuous chaining, refusal stops and code-5 stops;
- the studio has page tests for the storyboard and inspector.

The first paid run is Alex's first real film, made when Alex chooses.

## Build order

Each step ships, works on its own, and gets its own plan.

1. **Director brain:**
   - What it adds: the menu, brief and plan storage, the checker, the picker with `goodFor`, the translator with `promptProfile`, `kie brief` and `kie plan` with cost, the MCP planning tools, the handbook, and the skill rewrite.
   - Done when: Claude Code can turn an idea into a checked, priced plan with model-specific wording, spending nothing.
2. **Casting and stills:**
   - What it adds: `make_sheet`, `make_still`, the style still and still model picking.
   - Done when: a plan can get consistent stills, at a few cents each.
3. **Filming and the editor pass:**
   - What it adds: `film_shot`, `film_all` with length padding and continuous chaining, silent shots, and `kie cut`.
   - Done when: an approved storyboard becomes a delivered film.
4. **Studio storyboard:**
   - What it adds: layout A, the inspector, Film all, the chat's new tools, and "Plan this".
5. **Review:**
   - What it adds: `review_shot`, verdicts on the storyboard, and optional auto-redo capped at 2.

## Risks

- **Menu words are words.** No model guarantees that "85mm, shallow" reads as 85mm. The still is where Alex sees whether the camera language landed, before video is paid for.
- **Seedance 2.5 cannot mix a first frame with reference images.** Shots on Seedance carry identity through the still, which is why casting and consistent stills come first.
- **Ratings are third-party opinions.** The picker records why it chose each model, so ledger pass rates can replace the ratings later (quality plan, Phase 4).
