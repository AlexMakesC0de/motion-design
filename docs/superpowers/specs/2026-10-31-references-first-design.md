# References first: design

> **Superseded on 2026-11-01** by [Shard: scenes, Library sheets and a new look](2026-11-01-shard-scenes-design.md), before any of it was built. Kept as history.

Approved in conversation 2026-10-31. Extends the [director](2026-10-31-director-design.md) and the [studio](2026-10-30-studio-web-app-design.md).

## Why

Two paid films (`runs/rainy-coffee`, `runs/ctlt-test`) showed the same problems:

- The same cup, person or room changed between shots, because each still was drawn from words, plus the first still as a "style" reference.
- That style reference made the second still copy the first one's framing. nano-banana-2 treats any reference image as a picture to edit, and rewording the prompt did not stop it.
- The CTLT stills came out warm and the earlier ones cool. Alex read the cool set as cold and lonely. Colour temperature and mood carry emotion, so they must be a deliberate choice, not whatever the model lands on.

Alex's rule: before any video, each film has reference images of its characters, products and locations from several angles. **The user provides them or explicitly asks for them; the director never makes them on its own.** Only then do stills and filming start.

## Decisions

| Question | Decision |
|---|---|
| Who makes references | The user: by uploading, or by explicitly asking (a button, a command, or a chat request). Never automatic. |
| How angles are made | One image per angle. The front comes first. Every other angle uses the front as its identity reference, so the face does not drift. |
| Angles per kind | Character and product: front, three-quarter, side, back. Location: wide, reverse, detail. |
| Gate | Strict. Stills and takes are refused until every Library item the plan uses has images and the user has approved them for this film. |
| Approval and changes | Approval records each image's sha256. A changed image drops that item's approval. |
| Who approves | Studio button or `kie refs approve`. There is no MCP tool, so neither chat can approve (same rule as the spending limits). |
| Mood | `look.mood` (words) and `look.temperature` (warm, neutral, cool). Both are required when a plan is saved. Older saved plans only get a warning. |
| Capture style | Optional `look.capture`, one of the CTLT capture styles, for the whole film. |
| Prompt order | Stills are worded Camera, then Tone, then Lighting, then Texture. Palette, mood and temperature go in every shot. |
| Style still | No automatic style reference. Identity comes from the approved references; the look comes from the words. A `look.styleStill` the user chose still applies. |
| `kie cast` | Replaced by `kie refs`. |

## Data

### Library images carry an angle

Each image record in `library/<name>/asset.json` gets an optional `angle`. The angle sets by kind:

```js
export const ANGLES = {
  character: ["front", "three-quarter", "side", "back"],
  product: ["front", "three-quarter", "side", "back"],
  location: ["wide", "reverse", "detail"],
};
```

`save()` accepts `images` as paths (as today) or as `{ path, angle }`. An angle must belong to the asset's kind and appear at most once.

An image without an angle is read as filling the first free angle in order. A single uploaded photo of a person therefore counts as their front view. The 1-4 image limit stays; every set above fits in it.

`style` assets have no angles and are never gated.

### Approval per film

`runs/<film>/references.json`, written through `writeFilmJson` under the film lock:

```json
{ "approved": { "maya": { "images": ["<sha256>", "<sha256>"], "at": "2026-10-31T21:40:00.000Z" } } }
```

An item counts as approved for the film when its entry exists and its `images` list equals the asset's current image hashes, in order.

### The items a film needs

The items a film needs are the union of every `shot.cast` and `look.cast[].asset` in the plan, keeping only character, product and location assets.

`referenceState(film, { library })` returns one entry per item:

```
{ name, kind, angles: [{ angle, image|null }], approved: "yes" | "changed" | "no" }
```

`changed` means the item was approved once but its images are different now.

## Making references

`makeReferences(catalog, film, assetName, ctx)` with `ctx.angles` (default: every angle the asset is missing):

1. If the front (character, product) or wide (location) view is missing and wanted, make it first and wait for it. It is worded from the description and uses any images the asset already has as identity references.
2. Make each other wanted angle with the front/wide image as its identity reference. These jobs can run at the same time.
3. Save each finished image into the asset at its angle slot through `library.save(..., { replace: true })`. The old version moves to `.history/`, as every replace does.

Each image is its own job, budgeted and reserved through `reserve()` like any other. The jobs use `stage: "reference"`, `referenceFor: <asset>`, `angle`, and run `film`.

The estimate for the whole set is shown before anything is spent:
- CLI: `--dry-run`.
- Studio: the price on the button.
- Chat: the tool's estimate.

A failed angle leaves the others saved and is reported by name.

Redoing one angle is `angles: ["side"]`. It replaces only that slot.

Models are the kind's current sheet model: nano-banana-2 for characters and locations, gpt-image-2-5 for products. A `--model` override is allowed.

Wording, one sentence per angle, on a plain grey background for characters and products:

- **Character:**
  - front: "Full-body front view of {description}, standing straight, facing the camera, arms relaxed. Plain neutral grey background, even soft studio light. No props, no text."
  - three-quarter: the same, "turned three-quarters to the left".
  - side: "in left profile".
  - back: "seen from behind".
  - Every angle except the front adds: "The same person as in the reference image: same face, hair, body and clothes."
- **Product:** the same four views. Instead of the character lines, each says "Every label, edge and colour exact" and "the same product as in the reference image".
- **Location:**
  - wide: "Wide establishing view of {description}, at eye level. No people, no text."
  - reverse: "The same place seen from the opposite direction, as in the reference image."
  - detail: "A close detail of a characteristic surface or object in this place."

## The gate

`soundShot` (stills) and the take path call `assertReferencesApproved(film, plan, { library })` after the checker. It throws a usage error (exit 1) that names each item and what is wrong. For example:

```
References first. Not ready for this film:
- maya: no images yet. Upload some, or make them: kie refs make maya --run rainy-coffee
- cup: changed since you approved it. Look again, then: kie refs approve --run rainy-coffee
```

A plan that uses no gated items passes. `--dry-run` is gated too, so a planned cost never hides a refusal.

The gate checks only that images exist and are approved; whether they are enough is the user's call. The panel shows missing angles as guidance, not as errors.

## Mood, temperature and capture style

`menu.json` gains two groups, each entry `{ id, words }`:

- `temperatures`:
  - warm: "warm colour temperature, amber and golden tones"
  - neutral: "neutral colour temperature, true whites"
  - cool: "cool colour temperature, blue and teal tones"
- `captureStyles`: the CTLT camera sentences, without lens or viewpoint, so they never clash with the shot's own lens and angle:
  - close-skate: "candid film photograph with a fisheye look, curved edges and a crooked horizon"
  - phone-snapshot: "quick phone snapshot, slightly tilted and loosely framed, a little motion blur"
  - documentary: "close handheld documentary photograph on 35mm film, slightly uneven crop"
  - photo-dump: "badly shaken handheld snapshot with diagonal camera-shake blur"
  - curbside: "candid photograph from curb level with the ground filling the foreground"
  - disposable-flash: "disposable point-and-shoot camera photo with harsh direct flash"
  - telephoto: "concealed long-lens telephoto photograph from a distance, compressed background"
  - night-fisheye-flash: "night fisheye photograph with a hard on-camera flash and dark falloff"

The checker:
- `look.mood` is text and `look.temperature` is a menu id.
- On save (`savePlan`) a missing one is an error; when checking an already-saved plan it is a warning.
- `look.capture`, when present, must be a menu id.
- A shot may add an optional `texture` (2-3 physical details).

### Still wording, CTLT order

```
Camera:   A frame from {film type} shot on {filmLook}{, capture words}: {size}, {angle}, {lens}, {depth}.
Tone:     {mood}. {cast descriptions}. The start of this action: {action}.
Lighting: {light words}, key light from the {side}; {temperature words}, {palette}, {grade}.
Texture:  {shot.texture, else nothing}{, grain words from filmLook}.
[refs line when references are passed]
No text, captions, logos or watermarks.
```

- The line labels ("Camera:", etc.) are not sent to the model; they are shown here only for reading.
- The refs line becomes: "Keep every person, product and place exactly as in the reference images."
- `sha` still covers every line except the refs line.

### Take wording

Take wording keeps its per-model layouts. Its `lookLine` gains `{mood}, {temperature words}` after `filmLook`, so a take carries the same feeling as its still.

## Where it shows up

### CLI

- `kie refs --run SLUG`: the table from `referenceState`, with the next command for each item.
- `kie refs make <asset> --run SLUG [--angle A ...] [--model M] [--dry-run] [--no-wait]`
- `kie refs approve --run SLUG [<asset> ...]`: approves the named items, or every item that has images. Refuses an item with no images.

`kie cast` and `kie cast adopt` are removed. The help text points to `kie refs`.

### MCP

- `list_references { run }`
- `make_references { run, asset, angles?, model?, dry_run? }`

Both tool descriptions say: make references only when the user asked for them.

`make_sheet` and `adopt_sheet` are removed. There is no approve tool.

### Studio

- **References panel** on the storyboard, between the brief card and the shots. One card per item shows:
  - its angle slots: a thumbnail, or "missing";
  - Upload, which goes to the Library upload with the angle set;
  - "Make missing angles ($X.XX)";
  - Redo on each made angle;
  - its approval state.

  One "Approve references" button covers all items. While anything is unapproved, Make still and Film all are disabled, with a reason that says which items.
- **Look card:** mood (text), temperature (warm, neutral, cool) and capture style (none or one of eight). Edits go through a new `updateLook(catalog, film, changes)` that saves through `savePlan`, like `updateShot`.
- **Endpoints**, all behind the session key:
  - `GET /api/director/:film/references`
  - `POST /api/director/:film/references/make`, which runs as a task and pushes events
  - `POST /api/director/:film/references/approve`
  - `PATCH /api/director/:film/look`

### Skill docs

The motion-design skill (`SKILL.md`, `references/production.md`) changes in two ways:
- The order becomes: brief, plan, references, then stills and film.
- The agent may list references and make them when asked. It never approves them. It runs `kie refs approve` only when the user says those words.

The planner notes add three rules:
- Choose mood and temperature with the user.
- Keep camera, lens family, light side and tone stable across the film.
- Don't invent subjects or props.

## Out of scope

- Turnaround sheets in one image.
- Automatic judging of whether references match.
- Gating `style` assets.
- Migrating old `stage: "sheet"` job records. They stay in the store and show as plain image jobs.

## Testing

- **Library:**
  - angle labels are saved and read;
  - a wrong angle for the kind is refused;
  - unlabelled images fill the first free angles.
- **references.json:**
  - approve, then change an image: the item reads `changed`;
  - approving an item with no images is refused.
- **Gate:**
  - `makeStill` and the take path refuse with every item named, `--dry-run` included;
  - a plan with no cast passes.
- **makeReferences**, with a fake submit:
  - the front is made first, the others use it as their identity reference;
  - only the missing angles are made;
  - a redo replaces one slot;
  - a failed angle leaves the rest.
- **Checker:**
  - missing mood or temperature is an error on save and a warning on a saved plan;
  - a bad capture id is an error.
- **Wording:**
  - the CTLT line order;
  - palette, mood and temperature appear in every still;
  - mood and temperature appear in take look lines;
  - no automatic style reference.
- **MCP:** there is no approve tool; the two new tools are listed.
- **Studio:**
  - the References panel states;
  - the disabled Film all with its reason;
  - the Look card edits.
- **Paid check** (after a kie top-up, about $0.30): one character's four angles, then one still that uses them. Without a top-up, the same flow runs on uploaded images, which costs nothing.
