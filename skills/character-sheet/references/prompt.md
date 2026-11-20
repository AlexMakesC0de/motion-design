# The character sheet prompt

Generated from `sheetPrompt` in `cli/core/sheets.mjs`; `tests/skills-character-sheet.test.mjs` fails if this copy and the code ever differ. Change the code, then regenerate this file.

Replace `{CHARACTER}` with the character's Library description (one sentence: age, look, hair, anything distinctive) and `{OUTFIT}` with the outfit, or write `as described above.` when the description already says what they wear.

When the character has a height in the Library, add this line straight after the OUTFIT line (the code does the same): `HEIGHT: {CM} cm ({FT} ft {IN} in) tall, with the true proportions of an adult that height.`

## Without a reference photo

```text
A three-panel character reference sheet composed as one horizontal image, divided into three equal vertical panels side by side with thin clean separations. The same person in the same outfit in all three panels. No text, no labels, no numbering anywhere in the image.

CHARACTER: {CHARACTER}.

OUTFIT: {OUTFIT}.

LEFT PANEL — tight chest-up face close-up. Framed from just above the head down to the upper chest, the face filling the panel, looking straight at camera, neutral relaxed expression, lips closed. Maximum facial detail. This is the only panel that shows the face.

CENTER PANEL — full body front view. The figure stands squared to the camera, framed from above the head down to the shoes, arms relaxed at the sides, weight even on both feet. The full outfit is clearly readable. The face is completely covered by a flat, solid mid-grey oval with soft edges, so no facial features show; the hair around it stays visible.
RIGHT PANEL — full body back view. The complete figure from above the head down to the shoes, seen directly from behind, standing straight. Hair, back of the outfit and shoes are clearly readable.

Skin tone is identical in every panel, never darker or tanned on the back view.

The background is one flat 18% neutral gray field, identical in all three panels, with no gradient, no floor, no wall and no vignette. Flat shadowless frontal lighting, even on both sides of the face, no cast shadow under the feet and no shadow on the background. Realistic skin with fine soft pore texture and a matte finish, real hair strands, real fabric texture, never plastic, never CGI.
Even sharpness everywhere, no blur. Photographed on a 50mm prime, soft natural film grain. Photographed not generated.
```

## With reference photos of the face

Put this line first:

```text
Generate the final image based on my attached reference photo.
```

and this line straight after the opening paragraph:

```text
The face comes from the attached reference and must match it exactly in the close-up: same face shape, bone structure, eyes, brows, nose, lips, skin tone and hair.
```
