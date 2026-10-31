# Character animation: stylised or 3D characters acting a short story

Read this when a character, not a place or a product, carries the film: a mascot with a small story, a 3D creature, a cartoon. The vocabulary is in [craft](craft.md). If the character is a mascot inside a software ad, read [product-ui](product-ui.md) as well. For real-looking people read [live-action](live-action.md).

## Typical coverage

A character film is made of acting beats, not events. A beat is one thing the character feels or decides, and each beat gets its own shot.

- **Establish.** The character in its world, small enough that we see where it is and what is wrong.
- **Setup.** The character looks at the problem. A Medium close-up, with a slow move or none.
- **Reaction.** The beat that matters: a thought, a decision, a change of face. A Close-up.
- **Payoff.** The result, shown in the world, not on the face alone.

Four shots of 3 seconds each tell a small story. Resist cramming: a character that does three things in one shot does none of them well.

## Identity is held by the sheet and the still

A character stays itself because of two things in the pipeline, and neither is the prompt.

1. **The casting sheet.** The character is a Library asset with a reference sheet: front view and full body on neutral grey. Put it in `cast` for every shot it appears in.
2. **The still.** Each shot's still is made with the sheet attached, and the video animates the still. If the still is off, the shot is off, so approve the still before filming.

The character's description is copied word for word from the Library into every shot. Do not paraphrase it in `subject` or `action`. A second wording makes the model see a second character. Use the name in `subject`, and add a pass/fail check such as "matches its sheet".

Identity drifts most in wide shots, where the face is small, and in long chains of continuous shots. Keep the character large in the shots that matter. If it changes outfit, make a new Library version rather than describing the change in a shot.

## Staging

Staging is where the character stands in the frame and what that says.

- **Position.** A character alone at the edge of the frame with empty space ahead feels small or lonely. Centred and large feels in command.
- **Distance.** Two characters close together feel connected. A gap between a character and the thing it wants is a story. Plan that gap in the establishing shot.
- **Height.** Higher in frame or on a higher level feels powerful. Lower feels weak.
- **Readable pose.** A pose should read as a silhouette. If the shape tells you nothing, change the pose.
- **Profile and three-quarter.** A character in three-quarter or profile shows emotion more clearly than flat front-on.

Hold the sides. If the character looks toward frame right at the start of a scene, it keeps looking toward frame right in every shot of that scene, and if it moves across the frame, the screen direction stays the same (see Continuity in [craft](craft.md)).

## Acting beats

**One expression change per close-up.** A face can do one thing in a shot: relax into a smile, widen in surprise, tighten in worry. Two changes blur each other. If the story needs three feelings, use three shots.

Describe the physical, never the abstract. "Feels hopeful" gives a model nothing to draw. "Eyes widen and brighten, head tilts a little" does. For a non-human character, name the parts that move: eye lights, ears, antennae, shoulders.

Start from rest. The still shows the starting expression, and the action is the change. Leave a short stillness at the start, because the edit drops the first half second, and let the new expression hold at the end for a beat. A close-up wants 2 to 4 seconds.

Order the beats: setup, trigger, reaction, resolve. Cut to the reaction, not away from it.

## Camera and light for characters

Keep the camera quieter than the character. A Static frame or a slow Push in is best for a close-up. A Truck or a Follow suits a character who walks. Avoid Handheld unless the style is parody. Use the lens that flatters the face: 50mm or 85mm at close range.

A 14mm or 24mm lens on a face gets a warning, because it stretches features. In a comic style that is exactly the point. Accept the warning, and write the reason in `why`.

Light tells the feeling. Soft high key is friendly and safe. Overcast natural is quiet and low. Golden hour is hope and arrival. Low key with a Backlit rim is menace or mystery. Keep the key side fixed. A change of light is a story event, so tie it to one: a cloud parts, a door opens, a lamp turns on.

### A character who speaks

Use the lip sync job: one speaker per shot, a Medium close-up, a Static or slow Push in camera, and a short line, about 8 words for 3 seconds. The spoken line itself lives in the brief's `sound.voice`. Quoted words in `action` are rejected. A shot with a speaking face should not also ask for a camera move that fights the mouth.

## Worked example

A 12-second, 16:9 film. Takeaway: a small thing can bring something back to life. Library asset: `pip` (a small round robot with glowing eye lights). Look: soft storybook colour, light grain, spherical lenses, key light from the left. Pip faces toward frame right in every shot.

| Shot | Len | Size | Angle | Lens | Depth | Move | Light | Cut | Job |
|---|---|---|---|---|---|---|---|---|---|
| s1 | 3s | `wide` | `eye-level` | `35mm` | `deep` | `static` | `overcast` | `hard` | `animation` |
| s2 | 3s | `medium-close-up` | `eye-level` | `50mm` | `shallow` | `push-in` slow | `overcast` | `continuous` | `animation` |
| s3 | 3s | `close-up` | `eye-level` | `50mm` | `shallow` | `static` | `overcast` | `hard` | `animation` |
| s4 | 3s | `medium-wide` | `low` | `35mm` | `medium` | `tilt-up` slow | `golden-hour` | `hard` | `animation` |

- **s1, establish.** Action: Pip sits small at the left of a bare windowsill, facing a wilted plant at the right, and its head dips. Why: the gap between them is the story, and the static wide shows it.
- **s2, setup.** Action: Pip slumps and looks down at the plant. Why: the slow push in closes the distance as Pip's mood sinks. It ends close on Pip's face and cuts continuously into s3.
- **s3, reaction.** Action: Pip's eye lights widen and brighten and its head tilts. One expression change, an idea arriving. Why: continuous means this shot begins on the last frame of s2, so it keeps s2's lens, depth and light, and only the face changes.
- **s4, payoff.** Action: Pip tips a small watering can and the plant lifts, a bloom opening. Why: the low angle and the tilt up follow the stem rising. The light has become Golden hour, because the cut from s3 carries the change: the clouds have parted.

Every shot uses one move and one idea. The only light change is the story one, between s3 and s4, and it is the payoff. The continuous join needs a video model that can start from a given frame, and the checker refuses the plan if the next shot's model cannot.

## Common mistakes

- Two expression changes in one close-up.
- Abstract feelings in the action ("feels hopeful") instead of what moves.
- Describing the character in the plan a second way.
- Forgetting to put the character in `cast`, so there is no sheet for the still.
- A wide lens on a face without a comic reason.
- A character who does three things in one shot.
- Cutting away from a reaction before it lands.
- Light that changes with no story reason.
- A speaking character without the lip sync job, or with the line quoted in `action`.
- A long chain of continuous shots, where identity and light drift at each join.
