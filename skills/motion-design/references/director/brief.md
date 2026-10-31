# Brief: from a vague idea to a shot plan

Read this first, when Alex describes an idea and there is no brief yet. After it, read the chapter for the film type: [product-ui](product-ui.md), [live-action](live-action.md), [character](character.md) or [product-hero](product-hero.md). The camera choices come from [craft](craft.md).

## What a brief holds

A brief is a short, saved description of the film. Fill every field you can, and leave out what is unknown rather than inventing it.

- **takeaway.** One sentence: what the viewer should understand, believe or do afterwards.
- **audience.** Who watches, and where.
- **durationS.** Whole seconds.
- **aspectRatio.** `16:9` for web, presentations and video sites. `9:16` for stories, reels and shorts. `1:1` for feeds (no video model makes 4:5 yet). `21:9` for a wide cinematic look.
- **tone.** A few plain words: calm, playful, urgent, warm.
- **mustShow.** The things that have to appear on screen.
- **copy.** The exact on-screen lines, as given. Never invent a claim, price or number. If there is none and the film needs a headline, propose one and mark it as a proposal for Alex to approve.
- **sound.** `{ music, voice, sfx }`, each a sentence or left out. Default to music and effects with no narration, unless Alex asks for speech or silence.
- **filmType.** `product-ui`, `live-action`, `character` or `product-hero`.

## Decide, or ask

Decide these yourself: the aspect ratio from where the film will run, the length from the idea, the tone from Alex's words, the sound defaults, the film type from what was described, and every camera choice. Alex hired a director for that.

Ask only when the answer changes the film and you cannot read it from what you have. That means the takeaway, the audience for an ad, which real assets appear (screens, a character, a product), exact copy and claims, whether anyone speaks, and hard limits such as length or platform.

Look before you ask. Check the Library for characters, products, screens and locations, and use what is there. Ask at most two questions at a time, and attach your suggested answer to each, so Alex can reply "yes".

## When Alex is unsure

Offer two or three directions. Write each in two or three sentences: the film type, the tone, what the viewer sees, how it ends. Make them differ in kind, such as a calm character story, a fast product demo and a quiet product hero, and not three versions of one idea. Say which you would pick and why. When Alex chooses, develop that one without asking again.

## Example

Alex says: "an ad where Zed helps a stressed founder, something about the inbox, calm at the end."

```json
{
  "takeaway": "The inbox sorts itself, so the day starts calm.",
  "audience": "Founders who live in email, on social video",
  "durationS": 15,
  "aspectRatio": "16:9",
  "tone": "warm, calm, a little funny",
  "mustShow": ["Zed", "the inbox sorting itself"],
  "copy": [],
  "sound": { "music": "soft acoustic, building to calm", "voice": null, "sfx": "paper rustle, one soft chime" },
  "filmType": "product-ui"
}
```

`copy` is empty because Alex gave no lines. Propose a headline and ask. The next questions would be whether the real inbox screenshot is in the Library and whether there is a product name and tagline for the end card.

## From brief to shot plan

1. **Count the shots from the length.** Shots run 2 to 6 seconds, about 3 to 4 on average. That gives 2 shots for 6 seconds, 3 for 10, 4 or 5 for 15, 7 or 8 for 30, and 12 to 15 for 60. Shorter shots are easier for a model to hold.
2. **Cover the film.** Establish, then detail, then payoff. Every shot has one purpose. If you cannot say what a shot is for, cut it.
3. **Check the cast.** Every character, product, screen and location is a Library asset, and `cast` can only name assets that exist. A missing or weak one needs a reference sheet before any still.
4. **Write the look once.** Palette, grade, film look, lens look, key light side and the cast, all in words, for the whole film. Every shot inherits it. See Lens look and Lighting in [craft](craft.md).
5. **Fill each shot.** Purpose, size, angle, lens, depth, one move with its speed, light, subject, action, screen direction, cast, job, cut, why, and one to three checks. The action says what changes from the still. Quoted text, prices and figures go in `copy`, not in the action.
6. **Pick the job** by what the shot needs.
7. **Add up the lengths.** The shots must total the brief's length within a second. The end card counts inside it.
8. **Set the cuts.** Each shot's `cut` is how it hands over to the next. The last shot gets `hard`, or `dissolve` into an end card. Use `continuous` only where the next shot truly starts on the last frame.
9. **Ask for a model.** Use the model picker for each shot and keep its reason. Do not write a provider name in your notes. Model choice lives in code.
10. **Run the check.** Fix every error. Read every warning, and keep one only with a reason in `why`, such as a comic wide lens on a face or a jump cut that is the style.
11. **Show the plan and the cost, then stop.** Film only when Alex asks.

### Jobs

| Job | Use it for |
|---|---|
| Motion graphics | Type, UI and abstract graphic motion |
| Cinematic | Live-action-looking scenes with people and places |
| Working from reference images | A Library character or product that must match its sheet |
| UGC-style footage | Phone-camera, creator-style footage |
| Lip sync | Someone speaks a line on camera |
| Animation | Stylised or 3D character animation |
| Product hero | Physical products on turntables, in macro and under light sweeps |

### Checks

A check is a short pass or fail sentence that someone can judge by looking at the frames: "Zed matches his sheet", "only the camera pushes in", "the dial is centred at the end". Write one to three per shot, before anything is filmed, so the review has something to test.
