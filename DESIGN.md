---
name: Studio
description: A local projection room for one person making short AI films, with the engine left showing.
colors:
  bg: "#0e0d0c"
  surface-1: "#161412"
  surface-2: "#1b1917"
  surface-3: "#2a2724"
  line: "#2c2926"
  text: "#ece7df"
  text-2: "#b9b0a3"
  text-3: "#988f83"
  accent: "#e8a33d"
  accent-ink: "#1a1206"
  ok: "#8fc79a"
  warn: "#ef8a47"
  bad: "#e2725b"
  bad-surface: "#2b1a14"
  bad-ink: "#f3c8b8"
typography:
  headline:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
  title:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 500
  title-sm:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  body-sm:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  label:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.06em"
  data:
    fontFamily: "IBM Plex Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 400
    fontFeature: "tnum"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
components:
  button:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
    typography: "{typography.body-sm}"
  button-hover:
    backgroundColor: "{colors.surface-3}"
  button-quiet:
    textColor: "{colors.text-2}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  button-quiet-hover:
    textColor: "{colors.text}"
  button-generate:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-generate-disabled:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-3}"
  chip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    padding: "3px 8px"
    typography: "{typography.body-sm}"
  filter-pill:
    textColor: "{colors.text-2}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
  filter-pill-active:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text}"
  input:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "5px 8px"
  prompt-bar:
    backgroundColor: "{colors.surface-1}"
    rounded: "{rounded.lg}"
    padding: "12px"
  card:
    backgroundColor: "{colors.surface-1}"
    rounded: "{rounded.md}"
    padding: "16px"
  take-frame:
    backgroundColor: "{colors.surface-1}"
    rounded: "{rounded.md}"
  nav-link:
    textColor: "{colors.text-2}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  nav-link-active:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text}"
---

# Design System: Studio

## Overview

**Creative North Star: "The Projection Room, engine showing."**

Studio is a warm near-black room where the footage is the brightest thing on screen. Every surface steps up from the floor (`bg`) by a few points of warm lightness, so chrome recedes and takes, stills and the preview player carry the light. Nothing in the chrome glows, floats or blurs; depth comes from tone and a single hairline.

The machinery stays visible. Each take carries its real model id, duration, resolution and cost under the frame; the viewer lists cost, route, ratio, state and job id in a mono spec list; the chat rail prints every tool step with its arguments and result. This is a tool to Operate: one person, one machine, short AI films. It is familiar and dense where the work is (feed, jobs table, finish tools) and quiet everywhere else.

One amber voice marks money and the one act that spends it. Everything else is warm neutral, with orange, coral and green kept for state.

The prompt bar and feed draw on Higgsfield, Artlist, Krea, Leonardo, Magnific and Runway; cost on every result on fal; the library on Frame.io; spend on Gumloop and LangChain. These are references, not things to copy.

**Key Characteristics:**
- Warm near-black, tonal layering, 1px hairlines, no shadows.
- Footage is the brightest element; chrome sits two or three steps below it.
- IBM Plex Sans for interface, IBM Plex Mono with tabular figures for every number, id, file name and tool step.
- One amber accent, only on Generate, the spend meter and costs.
- Justified take rows that keep each take's real aspect ratio.
- Quiet text buttons for secondary actions; one filled primary.

## Colors

A warm brown-black neutral ramp with one amber accent and three state hues tuned to read apart from it.

### Primary
- **Projector Amber** (`accent`): the Generate button (with its price inside), the spend meter fill in the top bar and on the Spend page, the 14-day spend bars, and every cost figure (take tiles, viewer, shot rows, jobs table, asset panel). `accent-ink` is the near-black text set on an amber fill.

### Neutral
- **Booth Black** (`bg`): the room. Page floor, the viewer scrim (mixed 86% over the page), and the letterbox behind video players.
- **Lamp-off Brown** (`surface-1`): first lift. Top bar, cards, prompt bar, viewer panel, take frames while empty, text inputs inside forms.
- **Seat Brown** (`surface-2`): second lift. Buttons, chips, selects and inputs on a card, hovered nav links, chat bubbles from the user.
- **Aisle Brown** (`surface-3`): third lift. Active nav tab, pressed filter pill, button hover, disabled Generate, meter track, shimmer highlight.
- **Hairline** (`line`): every 1px border and table rule.
- **Screen White** (`text`): primary text, values, the selected state.
- **Dim Paper** (`text-2`): secondary text, labels, take specs, inactive nav.
- **Faint Paper** (`text-3`): hints, table headers, section labels, chip labels, disabled text. Held at 4.5:1 or better on every surface including `surface-3`.

### State
- **Signal Orange** (`warn`): approaching the cap, uncertain jobs (dashed border on the take frame), missing setup, unconfirmed failures. Deliberately orange so it never reads as the amber accent.
- **Coral** (`bad`): failed take frame border, meter over the cap. `bad-surface` and `bad-ink` pair for error banners and failure messages; long error text uses `bad-ink`, not `bad`.
- **Sage** (`ok`): done tool steps, a configured provider key, passing doctor checks.

### Named Rules
**The One Amber Rule.** Amber appears only on Generate, the spend meter and costs. Never on decoration, never on an inactive or hover state, never on headings or links. If a screen has no money on it (Settings, chat), it has no amber.

**The Footage Is Brightest Rule.** No chrome surface goes above `surface-3`. Light belongs to the media.

**The State Is Not Amber Rule.** Warnings use `warn` orange, failures use the `bad` family. A state colour that drifts toward amber breaks the money signal.

Current build exception, not a pattern: the global focus ring (2px outline) and text selection (`accent` at 32%) are amber. Both conflict with the One Amber Rule; do not extend them to new surfaces.

## Typography

**Body Font:** IBM Plex Sans (with system-ui, sans-serif), weights 400, 500, 600.
**Label/Mono Font:** IBM Plex Mono (with ui-monospace, SF Mono, Menlo), weights 400, 500, always with tabular figures.

**Character:** One engineered family in two voices. Sans carries the interface; Mono carries the engine, so the eye learns that anything monospaced is a real value from the machine.

### Hierarchy
- **Headline** (600, 20px): page titles (Library, Films, Spend, Presets, Settings) and film names.
- **Title** (500, 16px): panel titles (Finish panel, asset panel).
- **Title Small** (600, 14px): chat title, Settings section titles, preset names. The viewer title is 500 at 14px in Mono.
- **Body** (400, 14px, 1.45): default text, nav links, prompt text (1.5), Generate.
- **Body Small** (400, 12px): buttons, form controls, chat rail, notes, jobs table.
- **Label** (500, 11px, 0.06em, uppercase, `text-3`): the heading of a section inside a card or page region (Today, Last 14 days, Jobs, Shots, Outputs, finishing tools, asset panel parts). It is the section's only heading, never a line set above another heading.
- **Data** (Mono 400, 11px to 12px, tabular): model ids, durations, resolutions, prices, job ids, routes, file and asset names, tool steps, axis labels.

### Named Rules
**The Mono Means Machine Rule.** Every number, model id, job id, route, file name and tool step is set in Plex Mono with tabular figures. Prose is never set in Mono.

**The 11px Floor Rule.** Functional text never goes below 11px (`text-xs`). Body is 14px.

**The No Display Face Rule.** The scale tops out at 20px for page titles. There is no display face and no hero type.

## Layout

The app is a full-height column: a top bar (brand, tabs, spend meter pushed right) on `surface-1` with a hairline under it, then a scrolling main area padded 32px top and 16px sides. Spacing runs on a 4px base (4, 8, 12, 16, 24, 32); 16px is the default gap between cards and tiles, 8px inside groups, 24px between page regions.

The Studio does not scroll as a page. It is a grid of the feed (which scrolls itself), the prompt bar pinned at the bottom of that column, and a 340px chat rail on the right behind a hairline. The feed is a justified-row layout: each take starts as wide as its ratio makes a 200px-tall frame, rows grow to fill, and a tile is capped at 1.5 times its natural width so a short last row never stretches.

Other pages use auto-fill grids: film cards at 240px minimum, presets and outputs at 260px, assets at 180px. Detail panels (asset panel 340px, finish panel 380px) sit beside the main column.

Breakpoints: at 760px the top bar wraps (brand and meter share a row, tabs scroll on their own), the chat folds under the feed behind Show chat, the feed row height drops to 140px, the prompt bar stacks with a full-width Generate, and the viewer becomes one column. Spend's top row stacks at 900px; the film page's finish panel drops below at 1100px.

## Elevation & Depth

Flat. There is no `box-shadow` anywhere in the build. Depth is tonal: `bg` to `surface-1` to `surface-2` to `surface-3`, each container outlined by a 1px `line` hairline. The only overlay, the take viewer, sits on a scrim of `bg` mixed 86% with transparency (no blur) and lifts by tone alone.

### Named Rules
**The Tone Not Shadow Rule.** A surface that needs to sit above another takes the next surface step and a hairline. No shadows, no glass, no backdrop blur.

**The Hairline Rule.** Borders are 1px `line`. Hover may lighten a card's border to `text-3`; selection lightens it to `text-2`. Borders change state by tone, not by weight.

## Shapes

Gently rounded rectangles in three steps: 6px for controls, nav tabs, shot rows and thumbnails; 10px for cards, take frames, Generate and chat bubbles; 14px for the two large containers, the prompt bar and the viewer panel. Chips, filter pills and the reference picker are full pills (999px). Media is clipped to its frame (`overflow: hidden`, `object-fit: cover`) at its own aspect ratio. Dashed borders mean something: a drop zone, or an uncertain take.

## Components

### Buttons
Quiet, small and textual; one filled primary per screen.
- **Shape:** gently rounded (6px), 1px hairline.
- **Default:** `surface-2` fill, `text`, 12px, padding 6px by 12px. Hover steps to `surface-3`. Disabled drops text to `text-3`.
- **Quiet:** no fill, no visible border, `text-2`; hover to `text`. Used for secondary actions such as Hide chat, Close, Up and Down, Check again.
- **Generate (primary):** amber fill, `accent-ink` text, 600 weight, 14px, 10px radius, padding 8px by 16px, with the estimated price in Mono inside the label. Hover brightens by 8% (`filter: brightness(1.08)`). Disabled goes to `surface-3` with `text-3`, so amber never sits on an inactive control.
- **Inline link buttons:** underlined `text`, no chrome (Check again in a tile, choose files, Use the last prompt).

### Chips
- **Style:** pill, `surface-2`, hairline, 11px. A chip pairs a `text-3` label with a borderless select in `text` (Model, Duration, Aspect ratio, Resolution).
- **Variants:** add chip (`+ @asset`, `text-2`, hover to `surface-3`), reference chip (Mono `@name · role` with a remove control), quiet chip (transparent).
- **Filter pills (Library):** transparent pill in `text-2`; pressed state fills `surface-3` with `text`.

### Cards / Containers
- **Corner Style:** 10px.
- **Background:** `surface-1` on `bg`.
- **Shadow Strategy:** none; see Elevation & Depth.
- **Border:** 1px `line`.
- **Internal Padding:** 12px to 16px. Media cards (film, preset, output, asset) put the cover edge to edge at the top and pad only the text below.

### Inputs / Fields
- **Style:** `surface-2` fill (or `surface-1` inside a `surface-2` form), hairline, 6px radius, padding 5px by 8px, 12px text.
- **Prompt field:** borderless and transparent inside the prompt bar; the bar's border lifts to `surface-3` on focus-within instead of an outline.
- **Error / Disabled:** errors appear as `bad-ink` text or a `bad-surface` block below the field; disabled controls drop to `text-3`.

### Navigation
Text tabs in the top bar: 14px, `text-2`, 6px radius, padding 6px by 12px. Hover fills `surface-2`; the current page fills `surface-3` in `text` at 500 weight. Under 760px the tabs move to their own horizontally scrolling row. The spend meter sits at the far right: `Today $x / $cap` in Mono beside an 80px amber bar (48px on narrow windows) that turns `warn` when high and `bad` when over.

### Take Tile (signature)
A frame at the take's real aspect ratio (10px radius, hairline, `surface-1`, zoom-in cursor), with the spec line under it in Mono 11px: model, duration, resolution, then the cost in amber, a `~` prefix marking an estimate. Running takes show a slow warm shimmer between `surface-2` and `surface-3` (1.6s, linear); failed takes get a `bad` border and `bad-surface` fill; uncertain takes get a dashed `warn` border.

### Take Viewer (signature)
A modal dialog: `surface-1` panel, 14px radius, media on the left on a `bg` letterbox, a 340px side column on the right. The side column holds the spec title in Mono, a two-column Mono spec list (cost in amber with its source in `text-3`, route, ratio, state, job), the prompt in `text-2`, and quiet actions (Reuse, Frames). Close is a quiet text button bound to Escape.

### Tool Step (chat)
One line per tool call in 11px Mono: a state mark, the tool name in `text`, its arguments and result in `text-2`. Done marks are `ok`; failed marks and results are `bad-ink`.

### Spend Chart
Fourteen day columns on hairline gridlines with Mono axis labels in `text-3`; bars are amber with a 4px top radius, the hovered or pressed day sits on `surface-2` or `surface-3`, and a tooltip in `surface-3` gives the exact figure. A details toggle shows the same data as a table.

## Do's and Don'ts

### Do:
- **Do** put amber only on Generate, the spend meter (and spend bars) and cost figures.
- **Do** show the engine: model id, duration, resolution and cost on every take; route, state and job id in the viewer; every tool step in the chat.
- **Do** set every number, id, route, file name and tool step in IBM Plex Mono with tabular figures.
- **Do** build depth from `surface-1`, `surface-2`, `surface-3` and 1px `line` hairlines.
- **Do** keep each take at its real aspect ratio in justified rows.
- **Do** make secondary actions quiet text buttons, and keep one filled primary.
- **Do** use `warn` orange for caution so it reads apart from the amber.
- **Do** keep text tokens at 4.5:1 or better on every surface.

### Don't:
- **Don't** use amber anywhere except action, meter and cost: not for decoration, hover, active tabs, headings or links.
- **Don't** use gradient text.
- **Don't** use glass or backdrop blur.
- **Don't** add decorative shadows; depth is tonal.
- **Don't** introduce a display face or type above the 20px headline.
- **Don't** let icon glyphs (×, ✓, ✕, arrows) stand in for icons.
- **Don't** set functional text below 11px.
- **Don't** hide the engine: model, route and cost must stay visible.
- **Don't** set an uppercase label above another heading; the label style is only ever a section's own heading.
