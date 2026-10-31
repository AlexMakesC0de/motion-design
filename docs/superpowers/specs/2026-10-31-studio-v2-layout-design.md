# Studio v2 layout: design

Approved in conversation 2026-10-31 from the low-fidelity frames in [studio-v2-wireframes.html](../../design/studio-v2-wireframes.html). This changes where things are and how you move between them. Colours, type and the amber-accent rules stay as in [DESIGN.md](../../../DESIGN.md). The References step is specified in [references-first](2026-10-31-references-first-design.md).

## Why

Alex: the studio "looks like ass, and it is not intuitive". Seen on 2026-10-31 at 1440×900:

- One film is split over four places: Studio → Storyboard, Studio → Takes, Films → film page, and Finish. Nothing says which step the film is on or what to do next.
- The film you are working on is chosen in a small "Working in" dropdown.
- The shot inspector shows 14 dropdowns at once.
- The chat panel takes a quarter of the width on the Studio page, even when empty.
- Finish is one long form of selects.
- An empty Library is a dashed strip and a sentence.

## Decisions

| Question | Decision |
|---|---|
| Navigation | A left icon rail. Top part: Home, Projects, Create, Library, Presets. Bottom part: Chat, Spend, Settings. |
| A film | One workspace with a step bar: Brief → References → Shots → Finish. |
| All films | A Projects page. A project is one film (one run folder). |
| Quick takes | A Create page: the settings panel on the left, a feed grouped by prompt on the right. |
| Chat | A drawer from the right, opened from the rail, scoped to the current film and shot. |
| Look | DESIGN.md tokens unchanged. The one filled amber button per screen is that screen's main action, with its price inside. |
| Data | No new stored data, except what references-first adds. Step and next action are computed from what is on disk. |

## Routes

| Hash | Screen |
|---|---|
| `#/` | Home |
| `#/projects` | Projects |
| `#/films/:slug` | Redirects to the film's current step |
| `#/films/:slug/brief`, `/references`, `/shots`, `/finish` | Film workspace |
| `#/create` | Create |
| `#/library` | Library |
| `#/presets` | Presets |
| `#/spend` | Spend |
| `#/settings` | Settings |

Old hashes redirect, so bookmarks and links in docs still work:
- `#/studio` goes to `#/create`.
- `#/films` goes to `#/projects`.
- A bare `#/films/:slug` goes to the film's current step.

Chat is not a route. Its open/closed state is kept in `localStorage`.

## Film step and next action

`filmProgress(slug)` is a server view, built from the brief, plan, board and references state:

```
{ step: "brief" | "references" | "shots" | "finish",
  steps: { brief, references, shots, finish }: "done" | "current" | "todo" | "locked",
  next: { text, step },                       // e.g. "Approve 1 reference", "Film s2 and s3"
  counts: { shots, stills, takes, outputs },
  spentUsd, updatedAt, cover }
```

How the steps are judged:
- **Brief** is done when a brief and a saved plan exist.
- **References** is done when every gated item is approved. It is skipped (done) when the plan uses none.
- **Shots** is done when every shot has a chosen take.
- **Finish** is current once Shots is done, and done when a `film.mp4` exists.
- **Locked** means an earlier step is not done. The lock's reason is `next.text`.

A run folder with no brief, made before the director, has step `finish` with `next.text` "Made before the studio: takes only". It still opens on Finish, so the old films show up.

The view is served as `GET /api/films/:slug/progress`. `GET /api/films` gains `progress` for each film, so Home and Projects make one request.

## Screens

### Shell

- **Rail:** 76px wide, icons with labels underneath.
- **Active item:** Projects stays lit while you are inside a film.
- **Top bar:** where you are (a breadcrumb or the film name and step bar), a "N jobs running" pill and the spend meter. Today's top tabs are removed.

### Home

- **New film box:** a "What are we making?" composer with chips for ratio, length and film type, plus "Start from a preset". Start film saves the brief through `PUT /api/films/:slug/brief`, using a slug made from the first words and made unique. It then opens the film on Brief.
- **Recent films:** the four most recently changed films as cards, with "See all projects →".

### Projects

- **Filters:** All, In progress, Finished, each with a count. Search by name. Sort by last edited, name or spent.
- **Grid or list** view.
- **Cards** show the cover, the four step markers, counts, money spent, when it was changed, and `next.text` as a link to that step.
- **⋯ menu:** Show in Finder only. Rename, Duplicate and Delete are out of scope: a run folder's name is in its job records and ledger lines, and renaming it safely is a separate job.
- **Empty state:** the New film box.

### Film → Brief

The brief as an editable card (takeaway, format, length, film type, audience), and the plan as a list of shots in one line each.

When there is no plan yet, the main action is "Plan the shots with chat". It opens the drawer with that request filled in. When a plan exists, it is "Next: References →".

### Film → References

As specified in references-first: one row per item with angle slots, Upload, "Make missing (price)", Redo, and the approval state. The "Feel of the film" panel has mood, temperature, capture style and palette. "Approve references →" is the main action.

### Film → Shots

- **Left panel, the selected shot:**
  - A Framing / Directing tab pair. Framing holds size, angle, lens and depth. Directing holds move, speed, light, screen direction and cut.
  - The shot shown as a sentence. Each menu choice is an underlined word that opens a small popover of the menu's options. The action is plain text you edit in place.
  - Cast chips with "+ @".
  - Model pills for still and take, and the length.
  - Two buttons with prices. The main one follows the shot's state: Make still → Film shot → Redo take.
  - The technical fields (job, checks, why) go under a "More" disclosure.
- **Centre:** a large preview with Still / Take N tabs, the shot's checks as chips with keep/redo, plus Prompt sent and Download.
- **Bottom strip:**
  - The shots in order, each with its status in words.
  - "+ New shot".
  - Total length against the brief's length.
  - Drag to reorder, which saves the reordered `shots` through `savePlan` (`PUT /api/films/:slug/plan`).
- **Top bar:** "Film all · $X". When it is locked, the reason shows on hover and focus.
- **Replaces:** the Storyboard, the Inspector, and the Takes view of today's Studio page.

### Film → Finish

- **Player:** a large player for the latest output.
- **Timeline:** chosen takes in order, with a transition marker between clips (cut or fade, with its length). Reordering here is the same order as Shots.
- **Add-ons:** a right-hand column of closed cards: Music, Voice-over, Captions, Title card, Other sizes. Each card holds today's matching form (AssembleForm, CaptionsForm, CardForm, VariantsForm).
- **Outputs:** listed under the add-ons.
- **Main action:** "Export film.mp4" (Assemble).

### Create

- **Left panel:** model, references (start frame, end frame, + @), prompt, setting pills, and Generate with its price.
- **Right side:** the feed, grouped by prompt, with tags for model, length, ratio and price, and filters for All, Videos and Images.
- **"Save into film"** files a take under a film. It replaces "Working in".
- **Built from:** today's PromptBar, TakeTile and TakeViewer, rearranged.

### Library

- **Tabs:** All, Characters, Products, Locations, Styles.
- **Grid:** "+ New" is the first card. Each card shows its image, @name, kind, angle count and "used in N films". Clicking a card opens today's AssetPanel as a side sheet.

### Chat drawer

- **Size and scope:** 420px wide, over the page. It shows its scope (film · shot) and changes scope as you move between films and shots.
- **Starters:** questions for the current step, such as "What will this cost?" or "Why is Film all locked?".
- **Contents:** everything in today's ChatPanel and ConnectionForm moves in unchanged.

## Order of work

Each phase leaves a working studio.

1. **Shell and navigation:**
   - the rail, top bar, routes, redirects and chat drawer;
   - the `filmProgress` view;
   - Home and Projects.

   The existing screens are mounted inside the new shell unchanged.
2. **Film workspace, Shots and Finish:**
   - the step bar;
   - the Shots layout (sentence and popovers, preview, strip);
   - Finish (timeline and cards);
   - the Brief step.
3. **References:** the [references-first](2026-10-31-references-first-design.md) spec, both its back end and its screen.
4. **Create and Library** in their new layouts. Old components that are no longer used are removed.

## Testing

- **Unit:**
  - `filmProgress` for each step state and for an old run folder with no brief;
  - route parsing and redirects.
- **Page tests, extending the existing Vitest and Testing Library suites:**
  - the rail and the Projects-lit state;
  - Projects filters and counts;
  - the step bar's locks and reasons;
  - the sentence words open their popover and save through `updateShot`;
  - the Shots main button follows the shot's state;
  - the Finish cards open and close;
  - the chat drawer opens, closes and keeps its scope.
- **Accessibility:**
  - the rail is a `nav` with `aria-current`;
  - the step bar is an ordered list;
  - each popover is a labelled listbox that can be used from the keyboard;
  - the drawer is a dialog that returns focus when it closes.
- **In the browser:** screenshots of every screen at 1440×900 and 1280×800, using the real `runs/` (rainy-coffee, boat, ctlt-test), compared against the wireframes before each phase is called done. No paid calls.
