# Live-action look: real-looking people and places

Read this when the film should look like it was shot on location: people in a real place, natural light, ordinary behaviour. The vocabulary is in [craft](craft.md). For a stylised or 3D character read [character](character.md) instead, and for a physical product on a set read [product-hero](product-hero.md).

## Typical coverage

Coverage is the set of shots that lets an edit tell a scene. A short film does not need all of it, only the pieces the story needs.

- **Master.** A wide that shows the place and where everyone is. Plan it first. The checker warns when a live-action film has no Wide or Extreme wide (a Full shot shows a body, not a place), because the viewer should know where they are before the film goes close.
- **Singles.** One person at Medium, Medium close-up or Close-up, one shot per person who matters.
- **Cutaways.** Something in the scene that is not the main action: a clock, a steaming cup, a dog watching. A cutaway gives the film texture and a reason to change view. Motivate it by something a character looks at or something the place would hold.
- **Inserts.** A detail the story needs to see: a hand on a key, a message on a phone. Keep it short.
- **Reactions.** A face taking something in. Often the strongest shot in a scene.

A 15-second scene is usually a wide, one or two mediums or close-ups, an insert and a closing wide or payoff. Establish, then detail, then payoff.

## Establish with a wide

Open on a Wide or Extreme wide. Show the street, the room, the weather and the hour. It does a job faces cannot, because a model holds a place at distance but not a face. Faces drift at small scale, so use the wide for geography and put the shots that carry identity in medium close-ups and close-ups. In a wide, people are best seen from behind, in silhouette or very small.

## Eyelines and screen direction

Two people talking give you the cleanest picture of the rules. In the master, one person sits on frame left looking right, and the other on frame right looking left. Every later shot keeps those sides: the left person's single has them looking toward frame right, and the right person's single has them looking toward frame left. Cut between them in the same size, with the same lens and the same key side, and the conversation reads as two people looking at each other.

An Over the shoulder shot keeps the same shoulder it began with for the whole scene. A person looking at a screen or an object keeps the same side in every shot.

For travel, a person who walks left to right keeps walking left to right across cuts, so the viewer keeps their bearings. To flip it, put a head-on or tail-away shot between, and write why in `crossesLine`. See Continuity in [craft](craft.md).

## Motivated light

Choose the light from the place and the hour, then keep it.

- Outdoors, early or late: Golden hour. Under cloud: Overcast natural.
- Indoors at night: Night with practicals, with lamps and screens visible in frame.
- Indoors by day: a window is the source. Use Soft high key or Overcast natural and put the subject where a window can plausibly be.
- Nightlife and street scenes: Neon, with the signs in frame.

Hold one key side for the film (`look.keyLightSide`). The sun, the window or the lamp that lights the wide lights every shot in the scene from the same direction. Rembrandt is for a face in a close-up when you want depth, as long as the source it implies exists in the room. Avoid decorative light with no source: a rim light in a kitchen has no reason to exist.

## Lens, depth and motion for realism

Real footage is mostly 35mm and 50mm, with 85mm for faces and 24mm for establishing. Shallow depth belongs to close-ups; wides want Deep (f/8-11) or Medium (f/4). Keep the camera quiet: Static, a slow Push in, a Follow behind someone walking. Use Handheld only when the film is meant to feel caught, as in creator or documentary footage. Keep subject action small and single: people do one thing per shot, and a model that is asked for three things does all of them badly.

Real places are not tidy. Put texture in the look line and the light rather than in the action: a worn counter, a window with a smudge, soft grain.

Avoid readable signs and labels in the background. A model invents the letters. Frame them out, soften them with depth, or accept them as texture.

### Creator footage and lip sync

Creator-style footage uses the UGC job: Handheld, Medium close-up or Close-up, a 24mm or 35mm lens, Eye level, Overcast natural or Soft high key. Jump cuts are part of the style here. If someone speaks on camera, use the lip sync job with one speaker per shot, a Medium close-up, a Static or slow Push in camera and a short line. The words go in the shot's `line`, which the wording places after the action; the checker warns when a line has more words than the shot can hold. Quoted words in `action` are rejected.

## Worked example

A 15-second, 16:9 film. Takeaway: someone is up before you, and the bakery is about to open. Library assets: `mara` (a baker) and `bakery` (the street). Look: warm, soft grade, light grain, spherical lenses, key light from the left.

| Shot | Len | Size | Angle | Lens | Depth | Move | Light | Cut | Job |
|---|---|---|---|---|---|---|---|---|---|
| s1 | 4s | `extreme-wide` | `high` | `24mm` | `deep` | `crane-down` slow | `golden-hour` | `hard` | `cinematic` |
| s2 | 3s | `medium-wide` | `eye-level` | `35mm` | `medium` | `follow` slow | `golden-hour` | `on-action` | `cinematic` |
| s3 | 2s | `insert` | `eye-level` | `50mm` | `shallow` | `static` | `golden-hour` | `hard` | `cinematic` |
| s4 | 3s | `close-up` | `eye-level` | `85mm` | `shallow` | `push-in` slow | `golden-hour` | `hard` | `cinematic` |
| s5 | 3s | `wide` | `eye-level` | `35mm` | `deep` | `static` | `golden-hour` | `hard` | `cinematic` |

- **s1, establish.** Action: early light spreads along a quiet street and a small shopfront glows at the end of it. Why: the crane down hands us from the whole street to the shop, and the extreme wide tells us how small and quiet it is.
- **s2, subject.** Action: Mara walks left to right along the shopfront and reaches for the shutter handle. Screen direction: left to right. Why: the follow keeps her in frame and the cut on action ends on the reaching hand.
- **s3, detail.** Action: her hand grips the handle and pulls the shutter up, light spilling through the gap. Why: the insert starts mid-motion, so the cut from s2 hides itself.
- **s4, reaction.** Action: warm light reaches her face; she breathes in and smiles. Why: one expression change, on an 85mm close-up, with a slow push in.
- **s5, payoff.** Action: the shop window glows and a first customer crosses the street toward the door. Screen direction: right to left, a new subject, so it does not flip Mara. Why: a second wide closes the film on the place we opened on.

The light stays Golden hour with the key on the left in every shot, so the sun is the same in the wide and the close-up. Sizes change at each cut, so nothing reads as a jump cut.

## Common mistakes

- No wide, so the viewer never learns where they are.
- Every shot at one size, or three Mediums in a row.
- Light that changes side or kind between shots of the same scene.
- Reverse shots with both people looking the same way.
- Crossing the line without a reason.
- Relying on faces in wide shots to carry identity.
- Handheld everywhere to "feel real". It reads as shaky, not real.
- Readable background signs that turn into nonsense.
- Asking one shot for three actions.
- A 14mm or 24mm lens on a face.
- Over-polished light with no source in the room.
