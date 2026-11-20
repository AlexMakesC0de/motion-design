# Openjutsu swap experiments (archived)

On 2026-11-19 and 2026-11-20 we tried to bring Openjutsu's character swap closer to Higgsfield Genjutsu. All runs used the Red Square clip, MiniMax H3 on kie at 768P, and the Library characters alex-h and alex-formal.

## What worked

`runs/jutsu/swap-7.mp4` (4s, $0.32): the untouched clip with its sound, both character sheets in one job, and a prompt that says who replaces whom, keeps each character's own build ("never smaller or slimmer than the person replaced"), asks for lively, focused eyes with catchlights, and says nothing is carried over from the people replaced. This is now Openjutsu's default H3 swap. Library heights were added the same day and are said in every swap.

## What did not work

| Tried | Result | Why |
|---|---|---|
| Grey figures in the video sent to H3 (flat grey, clay, clay with a coloured edge; `swap-8`, `swap-9`, `swap-10`, $0.96) | Visible noise, smeared faces, the woman's hair left on alex-formal, different music | H3 copies faces and expressions from the real people; hiding them leaves it guessing. The audio had been stripped from the grey videos, so H3 made new music. On kie, H3 has no mask input, unlike OpenJutsu's local setup. |
| Pasting the original background back around H3's people (local, free) | Judged worse than swap-7 | Kept as an idea only; not part of the default. |
| Putting the original sound back on H3's video (local, free) | Judged worse than swap-7 | Kept as an idea only; not part of the default. |
| Kling 4.0 Reference To Video | Not run | Dropped before any spend once the H3 recipe was the one to keep. |

The full plan, its reviews and step 0 are in [the archived spec](2026-11-20-openjutsu-outlines-design.md).

## Lesson

Improve swaps through the prompt and the pictures on the real clip first. Judge takes at full resolution while they play, not from small frames.
