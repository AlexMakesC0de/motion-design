# Shard: scenes, Library sheets and a new look

Approved in conversation on 2026-11-01. The mockups are in `.superpowers/brainstorm/76381-1793497460/content/`, which is not committed:
- `scene-a-v2.html`: the Scene screen.
- `library-v2.html`: the Library and sheet maker.

This replaces stages 2 to 4 of [studio v2 layout](2026-10-31-studio-v2-layout-design.md), from the Shots step onwards. It supersedes [references-first](2026-10-31-references-first-design.md), which was never built. Stage 1 of the layout (the rail, top bar, chat drawer, Home and Projects) stays and gets the new look.

## Why

Alex, on 2026-11-01: "right now i am confused on how to use it properly. references dont really work i think. i should be able to reference things from my library."

What was found:

- **The prompt never names the references.** The studio uploads Library images to the model, but the text never says which image is what. Dan Kieft's prompts always do, for example `<<<image_1>>> — Dan. Preserve his exact face…`. Without that line, the model treats references as loose inspiration. The `refMapping` lines in `cli/core/refs.mjs` are printed and recorded, but never sent.
- **A film's video model cannot take a face.** Each shot made a still, then animated it with Minimax H3. Minimax accepts only first and last frames. The face lived only in the still, and drifted once it moved. The skydive test (`runs/skydive`, about $0.30) showed this.
- **Seedance 2.5 has two separate modes.** One animates a start frame; the other works from reference images. They cannot be combined.
- **The screens hide the references.**
  - "+ @asset" is a small chip.
  - Its roles ("identity", "first_frame") are jargon.
  - `@` cannot be typed in the prompt.
  - Create stays locked until a film is picked.
  - The Library cannot help make a character, location or prop sheet.

The new design follows the workflow in Dan Kieft's video (the `transcript` file) and on his site (start-making-ai-videos.vercel.app):

1. Make reference sheets first. Images are cheap, so make many and keep the best.
2. Write the video prompt with an LLM, in labelled sections and timed stages.
3. Generate from the references, as a draft first, then the final.

## Decisions

| Question | Decision |
|---|---|
| Main way to make video | Dan's way: one Seedance 2.5 reference-to-video generation per scene. |
| What a film holds | Scenes. Each scene is one generation (4–30s, several cuts inside). Finish joins the chosen version of each scene. |
| Steps of a film | Idea → References → Scenes → Finish. |
| Who writes the prompt | Chat drafts it; you edit it. The prompt is a set of cards: Goal, Scene, one card per timed stage, Style, Audio. |
| Library item | One sheet image used in scenes, plus up to 3 source photos used only to make the sheet. |
| Who makes images | Alex, in his ChatGPT subscription. Shard writes the prompt ("Copy prompt for ChatGPT"); he drops the image back in. kie credits go to video only. |
| Mentions | `@library:name` attaches a Library item. `@imageN` points at the Nth attached image. |
| Approval gate | None. The References step shows what is missing; generation refuses only a mention with no image. |
| Draft and final | Draft is Seedance draft mode at 480p. Final finalizes the chosen draft at 1080p when that route works, otherwise re-runs at the chosen resolution. |
| Chat and spending | Chat reads and writes scenes. It never generates. Every paid action is a button Alex presses. |
| Name and look | Shard. Alex's logo. Neon green accent `#84F80A`. Two fonts. |

## Look

These changes update `DESIGN.md` and the tokens in `web/src/theme/`.

- **Name:** Shard. It shows in the browser tab, the rail and the top bar.
- **Logo:** Alex's neon-lime play shape with the split-off piece. He copies `Neon Lime Play Logo.png` into the project as `web/public/logo.png`; macOS blocks agents from reading `~/Downloads`. Once it is there, it is traced to `web/public/logo.svg` and used for the favicon and the rail.
- **Accent:** `accent` becomes `#84F80A`, with `accent-ink` `#0B1400` for text on it. The accent is used only for money figures and the one main button on each screen, as amber was.
- **State colour:** the `ok` green is dropped, so "done" cannot be confused with the accent. Done states show a check mark with `text` colour. Warning and error hues stay.
- **Fonts:** two, each with one job.
  - IBM Plex Sans is used for everything you read: the prompt, headings, buttons and labels.
  - IBM Plex Mono is used for exact things: `@library:name`, `@imageN`, seconds, resolutions and prices.
  - No serif.
- **Type scale:**

  | Role | Size and weight | Colour |
  |---|---|---|
  | Page or scene title | 22px, 600 | text |
  | Prompt text | 16px, 400, line height 1.6 | text |
  | Card heading | 15px, 600 | text |
  | Interface (buttons, menus, inputs) | 14px, 400 to 500 | text or text-2 |
  | Fine print (hints, times, kinds) | 13px | text-3 |
  | Section label (uppercase, 0.07em tracking) | 12px, 600 | text-3 |
  | Data (Mono) | 13px, or 14px inline in a prompt | text-2 |

  Nothing is smaller than 12px. The 11px `label` and `data` sizes go.
- **Text colour:** three steps.
  - `text` (bright) is what you read and edit.
  - `text-2` (mid) supports it, for example "Keep exact face, beard and glasses".
  - `text-3` (dim) is labels, hints and times.

## Library

### Data

`library/<name>/asset.json` changes in four ways:

- **Each image gets a `role`:** either `"sheet"` or `"source"`. An asset has at most one sheet and up to 4 images in total.
- **Old images become sources.** Images saved before this change have no role and are read as `source`. `alexandros` keeps its 3 photos as sources and has no sheet until Alex adds one.
- **A new `keep` field:** text that goes into the reference line when a scene uses the item, for example "his exact face, dark curly hair, full beard and black rectangular glasses". When it is empty, the line uses `description`.
- **`product` shows as "Prop".** The stored kind stays `product`, so no stored rows change. The UI shows Character, Location, Prop and Style.

`library.save` accepts images as paths or `{ path, role }`. Replacing the sheet moves the old one to `.history/`, as every replace already does.

### Sheet prompts

`sheetPrompt({ kind, description, hasSourcePhotos })` in a new `cli/core/sheets.mjs` returns the text to paste into ChatGPT. It follows Dan's templates, adapted:

- **Character:**
  - The three-panel sheet as one horizontal image: full-body front on the left, full-body back in the centre, chest-up face close-up on the right.
  - The same person and outfit in every panel, with identical skin tone.
  - A flat 18% neutral grey background, flat shadowless frontal light and a 50mm look.
  - No text, labels or numbering.
  - The CHARACTER line is filled from the description, and the OUTFIT line from the outfit field.
- **Location:**
  - "3/4 wide-angle view of {description}. No people."
  - The camera view is a field, defaulting to 3/4 wide.
- **Prop (product):** "Two views of the same object: FRONT view on the left of the frame, and top-down view on the right. Both centered, same scale. Flat seamless mid-grey background." This is followed by the description.
- **Style:** the description alone, as a mood image.
- **Source photos:** when there are any, the prompt starts with "Generate the final image based on my attached reference photo(s)." The face line becomes "The face comes from the attached reference and must match it exactly."

### Screen

The screen follows `library-v2.html`.

- **Tabs:** All, Characters, Locations, Props and Styles, each with a count.
- **Grid:** "+ New sheet" is the first card. Each item card shows its sheet, or "no sheet yet", plus `@library:name` in Mono, the kind and "in N scenes".
- **Sheet maker:** this side panel opens from "+ New sheet" or by clicking a card.
  - **Fields:** a kind switch, a name (shown as `@library:name`), "What it is", an outfit field for characters, a camera view for locations, source photos, and "When a scene uses it, keep".
  - **Step 1:** the filled prompt and **Copy prompt for ChatGPT**, the screen's one green button. "Edit prompt" allows a one-off change and is not saved.
  - **Step 2:** "Paste it into ChatGPT. Attach your photos there too."
  - **Step 3:** drop, paste (⌘V) or choose the image. It is saved as the sheet.
- **Cost:** the panel never spends. There is no kie image button here.

## Scenes

### Data

`runs/<film>/scenes.json` is written through `writeFilmJson` under the film lock:

```json
{
  "version": 1,
  "idea": { "text": "me skydiving over the Alps", "ratio": "9:16", "lengthS": 20 },
  "scenes": [
    {
      "id": "s1",
      "title": "Freefall",
      "durationS": 8,
      "model": "seedance-2-5",
      "refs": [
        { "id": "r1", "source": "library:alexandros" },
        { "id": "r2", "source": "file:refs/door-view.png", "keep": "the cabin and door frame" }
      ],
      "cards": {
        "goal": "…",
        "scene": "…",
        "stages": [
          { "title": "Exit", "fromS": 0, "toS": 4, "camera": "…", "action": "…", "end": "Hard cut." }
        ],
        "style": "…",
        "audio": "…"
      },
      "versions": [
        { "job": "j-…", "kind": "draft", "resolution": "480p", "file": "s1-draft-1.mp4", "providerTaskId": "…", "createdAt": "…" }
      ],
      "chosen": "j-…"
    }
  ]
}
```

- **The attached list:** `refs` is the scene's attached images, in order. Image N is `refs[N-1]`.
- **Ref sources:**
  - `library:<name>` uses that item's sheet.
  - `file:<path>` is an image uploaded into this scene, stored under `runs/<film>/refs/`.
- **Item `keep`:** a scene ref may override the item's `keep` for this scene.
- **Mentions in stored text:**
  - `@library:<name>` is stored as typed.
  - `@imageN` is stored as `@{r2}`, a token bound to the ref's id. The editor shows it as `@imageN` from the ref's current position.
  - So removing or reordering refs renumbers every mention, and nothing points at the wrong picture.
- **Adding refs by mention:** typing `@library:<name>` attaches the item when it is not attached yet.
- **Removing refs:** removing a ref that is still mentioned asks first, and then turns its mentions into plain text.
- **Stage times:** they must run from 0 to `durationS` with no gaps or overlaps. The editor keeps them that way when a stage is added, removed or resized.

### Prompt sent to the model

`compileScene(scene, { library })` in a new `cli/director/scene.mjs` returns `{ prompt, refs }`. The prompt is built in Dan's section order:

```
[GOAL]
{goal}

[REFERENCES]
{token 1} — {item or file name}. Preserve {keep}.
{token 2} — …
Do not reproduce reference-sheet panels, grey studio backgrounds or labels.

[SCENE]
{scene}

[STAGE 1 | 0–4 SECONDS | EXIT]
Camera: {camera}
Action: {action}
End: {end}
…

[VISUAL STYLE]
{style}

[AUDIO]
{audio}

[MAINTAIN CONSISTENCY]
Keep every person, product and place exactly as in their reference images in every stage.
```

- **Mentions:** every mention becomes the model's reference token. `{token N}` comes from `promptProfile.refToken` in `cli/models.json`. Seedance 2.5 uses Dan's `@Image N` form until a free check of kie's Seedance 2.5 docs says otherwise. That check is part of the build.
- **Ref lines:** the `[REFERENCES]` section lists every attached ref, mentioned or not, in order.
- **Ref role:** refs go to the provider in order as role `identity`, which maps to `reference_image_urls`. The model's limits in `refLimits` are checked before anything is reserved: at most 9 images in the UI, sizes and aspect ratios.
- **Refusals:** each one names the item and what to do.
  - A mention or ref of a Library item with no sheet: "@library:alexandros has no sheet yet. Make one in the Library."
  - A mention of an image number that is not attached.
  - Stages that don't add up to the length.
- **Prompt preview:** "Prompt sent" on each version shows the exact compiled text. The text is kept next to the file as `s1-draft-1-prompt.txt`.

### Generating

Both buttons go through the existing reserve and submit path in `cli/core/generate.mjs`, with the spend limits as today.

- **New draft (price):** `durationS` at 480p with `--param draft=true`, the film's ratio and audio on. A new version is added with `kind: "draft"`.
- **Make final (price):**
  - **When the finalize route works:** it uses the chosen draft and the `draftFinalize` route (`bytedance/seedance-2-5-draft`, `draft_task_id`, 1080p). That keeps the draft's exact motion.
  - **Before that button is built:** check the finalize route's price and input on kie.ai, which is free. Record the price in `models.json`.
  - **When finalize is unusable:** the price is not readable, the draft is older than 7 days, or the route is refused. Then the button becomes "Make final at 720p / 1080p", which re-runs the same compiled prompt and refs. The button says that the motion will differ.
- **Prices on buttons:** prices come from `models.json` pricing per second, as today, and each button shows its price. They are re-read on kie.ai before the first paid test.

### Chat

New MCP tools in `mcp/director.mjs`, both writing through the same functions the studio uses:

- `get_scenes { run }`: the idea and every scene, mentions shown as `@imageN`.
- `save_scene { run, scene }`: creates or replaces one scene's title, length, refs and cards. It is checked like an edit in the studio. A save never generates.
- `save_idea { run, idea, scenes? }`: the idea plus an optional scene list (titles and lengths only).

The existing `list_assets` lets chat find `@library:` names. The tool descriptions say:
- write prompts in Dan's section layout;
- use `@library:` and `@imageN` mentions;
- never invent Library items;
- never generate.

The drawer's starters for the Scenes step are:
- "Write this scene"
- "Make stage 2 slower"
- "What will a draft cost?"

## Screens

### Film → Idea

- **Box:** "What are we making?", with chips for ratio and total length.
- **Main action:** "Plan scenes with chat". It opens the drawer with the request filled in. Chat answers through `save_idea` with a scene list.
- **Scene list:** rows of title and seconds, which you can edit, reorder and delete, with the total against the target length.
- **Next action:** "Next: References →".

### Film → References

- **Rows:** one row per item the scenes mention or attach. Each row shows the sheet thumbnail, or "no sheet yet" with **Make sheet**, which opens the Library's sheet maker for that name. It also shows the scenes that use the item.
- **Files:** scene-only files are listed under their scene.
- **No approval:** nothing here gates generation.
- **Done:** the step counts as done when every mentioned Library item has a sheet.

### Film → Scenes

The screen follows `scene-a-v2.html`.

- **Scene tabs:** across the top of the left column, with "+".
- **Left column, "In this scene":** each attached image with its `imageN` label, `@library:name` or file name, and its keep line. Below them, "+ Add from Library · Upload". You can drag to reorder, which renumbers the mentions.
- **Centre:**
  - The scene title with Mono data: length, ratio and model.
  - The stage bar, sized by seconds.
  - Then the cards: Goal, Scene, one card per stage (Camera, Action, End), Style and Audio.
  - Typing `@` opens a menu: attached images first, then `@library:` with a search over the Library.
  - Audio follows Dan's markers: music in `()`, sound effects in `<>`, dialogue in `{}`.
  - Under the cards, "Ask chat to change something…" (⌘K) opens the drawer scoped to this scene.
- **Right column:**
  - The player for the selected version.
  - The list of versions, each with its kind, resolution and age, and one marked chosen.
  - **New draft** (quiet) and **Make final**, the one green button, each with its price.
  - A one-line note on what the final does.
- **Saving:** edits save as you go, through `PUT /api/films/:slug/scenes/:id`.

### Film → Finish

- **Timeline:** the chosen version of each scene, in scene order, joined with `assemble` and the transitions and add-on cards from today's Finish.
- **Unchosen scenes:** a scene with no chosen version is listed as missing, and the Export button says which.
- **Main action:** "Export film.mp4".

### Create

The same scene editor with no project, for one-off tries. Its scene is kept in `runs/_create/scenes.json`.
- **Save into film:** copies the scene and its versions into a film of your choice.
- **No film needed:** Create no longer asks for a film first.
- **Feed:** the old feed of takes stays below, for older work.

### Projects and Home

These stay as built in stage 1, with the new look.
- **Step markers:** film cards show the four new steps.
- **Old films:** a run folder with no `scenes.json`, such as rainy-coffee, ctlt-test or skydive, opens on Finish with "Made before Shard: takes only", as pre-director films do today.

## Server

New endpoints, behind the session key:

- `GET /api/films/:slug/scenes`
- `PUT /api/films/:slug/idea`
- `PUT /api/films/:slug/scenes/:id`
- `DELETE /api/films/:slug/scenes/:id`
- `PUT /api/films/:slug/scenes/order`
- `GET /api/films/:slug/scenes/:id/prompt`: the compiled prompt and refs, a dry run with no upload.
- `POST /api/films/:slug/scenes/:id/draft`
- `POST /api/films/:slug/scenes/:id/final`
- `POST /api/films/:slug/scenes/:id/choose`
- `POST /api/films/:slug/refs`: an upload into `runs/<film>/refs/`.
- `POST /api/library/:name/sheet`: upload the sheet image.
- `GET /api/library/sheet-prompt?kind=…`: the ChatGPT prompt.

**Film progress:** `filmProgress` moves to the steps idea, references, scenes and finish:
- **Idea** is done when `scenes.json` has at least one scene.
- **References** is done when every mentioned Library item has a sheet. It is skipped when none are mentioned.
- **Scenes** is done when every scene has a chosen version.
- **Finish** is done when `film.mp4` exists.

**Routes:**
- `#/films/:slug/idea`, `/references`, `/scenes` and `/finish`.
- The old `/brief` redirects to `/idea`, and `/shots` to `/scenes`.

## What leaves the studio

- **Leaving the studio:** the Brief and Shots screens, the storyboard, still-per-shot and the Minimax take path.
- **The CLI and director:** `kie still`, `kie shot`, `kie film` and the plan files stay, so the terminal and the motion-design skill keep working. The studio just stops showing them.
- **Removed code:** web components no longer mounted anywhere are removed in the last phase.

## Order of work

Each phase leaves a working studio:

1. **Look and name:**
   - the tokens, fonts and type scale;
   - the green accent, the "done" check and Shard;
   - the logo, once Alex has copied it in;
   - `DESIGN.md` updated.
2. **Library sheets:**
   - the image roles, `keep` and the "Prop" label;
   - `sheetPrompt`;
   - the sheet maker and the sheet upload endpoint.
3. **Scenes in Create:**
   - `scenes.json`, `compileScene` and the mention editor;
   - draft and final, after the free check of the ref token and the finalize price;
   - the versions list.
4. **Film steps:**
   - Idea, References and Scenes in the film workspace;
   - `filmProgress` and the routes;
   - the chat tools and starters.
5. **Finish joins scenes**, and the unused screens are removed.

## Testing

- **Library:**
  - roles saved and read;
  - old images read as sources;
  - one sheet at most;
  - replacing a sheet keeps history;
  - `keep` falls back to `description`.
- **sheetPrompt:** each kind's template, with and without source photos.
- **compileScene:**
  - section order;
  - every mention becomes the model's token, numbered by position;
  - `@library:` attaches;
  - reordering refs renumbers the output;
  - missing sheets and bad image numbers are refused with the item named;
  - stage times are checked.
- **Mention editor:**
  - typing `@` opens the menu;
  - choosing inserts a token;
  - removing a mentioned ref asks first;
  - the stage bar keeps times contiguous.
- **Generate:**
  - with a fake submit, a draft sends `draft=true` and 480p plus the refs in order;
  - final uses `draft_task_id` when available, otherwise re-runs;
  - spend limits refuse as today.
- **filmProgress:** each step state, and an old run with no `scenes.json`.
- **MCP:** `get_scenes`, `save_scene` and `save_idea` are listed, and no scene tool generates.
- **Accessibility:**
  - the `@` menu is a labelled listbox that works from the keyboard;
  - mentions are announced as "image 2, alexandros";
  - the stage bar's handles are usable from the keyboard.
- **In the browser:**
  - screenshots at 1440×900 and 1280×800 of Library, Idea, References, Scenes and Finish, compared against the mockups;
  - text sizes checked: none under 12px.
- **No paid calls** during the build. The paid check after a kie top-up is one 4s 480p draft of a scene with one `@library:` character (about $0.56 at the 2026-10-30 price, re-read first). It is run only on Alex's go.

## Out of scope

- Voice references (Dan's black-screen MP4s, `@Video N`).
- Motion transfer from your own footage.
- Making sheets through kie inside Shard.
- Models other than Seedance 2.5 in the scene editor.
- Renaming the repository or the CLI.
