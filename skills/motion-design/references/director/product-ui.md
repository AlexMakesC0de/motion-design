# Product ad with UI: screens, a mascot, kinetic type, an end card

Read this when the film sells software: app screens, a mascot or character, headline type and a closing card. The camera vocabulary is in [craft](craft.md); this chapter is how to use it around screens and text.

## The rule that decides everything

A video model draws a picture of text. It invents letterforms, misspells quietly, and bends a real interface into a plausible fake. So ask of every element: does it have to be correct, or only plausible?

- **Correct:** headlines, prices, numbers, labels, a logo, a real screenshot. These are code renders (`kie render`) or stills made from real Library assets. See [graphic-motion](../graphic-motion.md) for the templates.
- **Plausible:** a room, a hand, a glow on a face, a mascot's expression, the feel of a desk at night. These are generated.

Quoted copy goes in a shot's `copy`, never in `action`. The checker rejects quoted text or a figure in `action`, because the model would draw it. The edit draws `copy` in code over the footage. The same goes for prices and percentages.

A screen has two routes:

1. **Legible screen.** If the rows, numbers or labels must read exactly, render the screen with `kie render` (the UI demo template) from the real screenshot and have the edit cut it in. The generated shots then show the world around the screen.
2. **Atmospheric screen.** If the screen is shown for its look, make the still from the real Library screenshot (put it in `cast`) and give it a gentle move. Add a check such as "the screen matches the asset", and compare the frames with the original. Models subtly change screen content when the camera moves, so keep the move slow and short.

## Typical coverage

A 15-second spot usually runs five shots:

1. **Hook.** The problem the product removes, shown as a person or mascot in a moment the audience knows.
2. **Product.** The interface, introduced through a person or a virtual camera.
3. **Detail.** One feature, one close look: a button, a toggle, a notification.
4. **Payoff.** The result as a feeling: calm, relief, done.
5. **End card.** Logo and line, held long enough to read.

One idea per shot, and three features at most. A product ad that shows everything shows nothing.

## Virtual camera over screens

Treat a screen as a surface and the camera as something that moves over it. Keep the screen square to the lens so text does not skew: use Eye level or Overhead, a 50mm or longer lens, and Deep (f/8-11) or Medium (f/4) so the whole screen is sharp. A 14mm or 24mm lens near a screen bends its edges.

Good moves are a slow Push in or Zoom in toward the part that matters, a Truck along a row of items, and a Pedestal down onto a detail. On a flat screen a Zoom in and a Push in look almost the same, and Zoom in is the more deliberate. Avoid Handheld over UI. It makes a precise product look careless. Avoid Fast moves over text; the viewer cannot read what flies past.

An Over the shoulder shot is the best way to bring a screen into a story: a person in the foreground, the interface beyond, and a slow Push in that carries the viewer from the person to the screen.

## Macro on details

Use an Insert or an Extreme close-up with the 100mm macro for the one thing the viewer must see: a round button, a toggle sliding, a notification dot, the grain of glass. Hold it for 2 to 3 seconds. Put a single light event in the action, such as a press or a glow, and nothing else. A macro that is also busy reads as noise.

## Graphic match cuts

The cleanest cut in a product ad is a Match cut. A circle in one shot becomes a circle in the next. A card sliding right ends one shot and a panel sliding right begins the next. Put the matching shape at the same place and size in both stills, and the cut does the work that the model cannot do reliably inside a shot. Match one thing per cut.

## The mascot

The mascot is a Library character. Put it in `cast` and the still gets its casting sheet, and its description arrives word for word. Never describe it a second way. Keep it at Medium wide to Close-up, give it one clear action per shot, and aim at a single expression change in a close-up (see [character](character.md)). The mascot reacts and points. It does not speak copy; the words are `copy`, drawn in code.

## Kinetic type

The type is a code render, so the shot behind it is about space. Plan a quiet area in the still where the words will sit, keep the camera Static or very slow, and avoid busy texture there. Give each line time: about 3 words a second plus a beat. One idea per card, and keep the line short enough to read at delivery size.

## The end card

The end card is a code render of the logo and a line. Count its seconds inside the film's length: put the end-card lines in the `copy` of the last shot, and give that shot 3 seconds so the card holds long enough to read. Make the last generated shot calm and mostly empty, with the mascot or product off to one side and room for the lines. The last shot's cut is the handover to the card: `hard` for a punchy film, `dissolve` for a calm one.

## Worked example

A 15-second, 16:9 spot for an email app. Takeaway: the inbox sorts itself and the day starts calm. Library assets: `zed` (the mascot) and `inbox-screen` (a real screenshot). Look: warm paper white and ink blue, spherical lenses, key light from the left.

| Shot | Len | Size | Angle | Lens | Depth | Move | Light | Cut | Job |
|---|---|---|---|---|---|---|---|---|---|
| s1 | 3s | `medium-wide` | `high` | `35mm` | `medium` | `static` | `soft-high-key` | `hard` | `reference-images` |
| s2 | 3s | `medium` | `over-the-shoulder` | `50mm` | `medium` | `push-in` slow | `soft-high-key` | `match` | `reference-images` |
| s3 | 3s | `insert` | `eye-level` | `100mm-macro` | `medium` | `static` | `soft-high-key` | `hard` | `motion-graphics` |
| s4 | 3s | `medium-close-up` | `low` | `85mm` | `shallow` | `push-in` slow | `soft-high-key` | `dissolve` | `reference-images` |
| s5 | 3s | `wide` | `eye-level` | `24mm` | `deep` | `static` | `soft-high-key` | `hard` | `reference-images` |

- **s1, hook.** Action: envelopes drift down around Zed, who stares up with sinking shoulders. Copy: a short line about too much mail. Why: the high angle makes Zed small and overwhelmed, and the static camera leaves the top of the frame clear for the type.
- **s2, product.** Action: Zed leans toward the laptop and the cluttered rows begin to sort into neat groups. Cast: `zed`, `inbox-screen`. Why: the over-the-shoulder frame carries us from the character to the screen, and the push in ends with the round sort button at the centre.
- **s3, detail.** Action: a thumb presses the round button and a ring of light spreads across the glass. Why: the button is centred in both stills, so the match cut from s2 reads as the same object getting closer. Static keeps the screen square.
- **s4, payoff.** Action: Zed breathes out and his shoulders drop; the envelopes are gone behind him. Why: the low angle and 85mm make him the calm hero. One expression change.
- **s5, end card.** Action: Zed waves once from the right of a clean, empty space. Copy: the product name and the closing line. Why: the wide, deep frame leaves the left open for the card.

If the rows in s2 must read word for word, replace the screen content with a `kie render` of the real screenshot and keep the generated shot for Zed and the desk.

## Common mistakes

- Putting quoted copy, a price or a percentage in `action`. It belongs in `copy`.
- Letting a model draw a screen that has to be correct.
- A wide lens close to a screen, so the edges bend.
- Handheld or a fast whip over UI the viewer is meant to read.
- Showing five features in 15 seconds.
- Kinetic type over a busy background.
- An end card that gets 1 second.
- The mascot described differently in two shots. Use the Library description and the sheet.
- A mascot that "says" the tagline. Draw the tagline in code.
- No quiet frame for the type, so the words fight the picture.
- An end card counted outside the film's length, so the shots overshoot the brief.
