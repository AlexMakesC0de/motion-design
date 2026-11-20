---
name: character-sheet
description: Make, check or fix a character reference sheet for a person (a Library character, a film's cast member or an AI influencer). Use whenever a sheet, a character sheet, a reference sheet, casting a character or keeping a person consistent comes up, in the studio, the kie CLI, the MCP tools or a hand-written ChatGPT prompt.
---

# Character sheet

A character sheet is the one picture every later still, take and Openjutsu swap copies a person from. It always has the same layout, so a model given it has **exactly one face to copy**.

## The layout (always)

One horizontal 3:2 image, three equal panels side by side on a plain neutral grey background:

1. **Left: face close-up.** Chest up, looking at camera, neutral expression. The only panel where the face shows.
2. **Centre: full body, front.** Head to shoes, arms relaxed. The face is covered by a **flat, solid grey oval**; the hair around it stays visible.
3. **Right: full body, back.** Head to shoes, seen from behind.

Same person, same outfit and same skin tone in all three. No text or labels.

Why the oval: if the front view also shows the face, the model gets three slightly different faces and blends them. One face in, one face out.

Examples, on Alex's machine only (private, never in the repository): [Alex's original](assets/example-korean-girl-student.png) and [Mira, made by the studio](assets/example-mira.jpg). Without them, the three panels above are the layout.

## How to make one

Every path below already uses this layout. Don't write a different prompt.

- **Studio, AI Influencers page:** pick the chips, make 4 faces, pick one, name it, then **Save · make sheet**. When it finishes, **Keep sheet**, or **Make again** if it fails the check below.
- **Studio, Library:** open the character, use the sheet maker. It writes the ChatGPT prompt; make the image in ChatGPT and drop it back in. Free.
- **MCP:** `make_sheet` (spends kie credits; only when the user asked to cast), `wait_job`, show the result, then `adopt_sheet` only if it passes the check below and the user likes it.
- **kie CLI:** `kie cast <asset> --run <film>`, then `kie cast adopt <job id>`.
- **Anywhere else** (another image tool, a chat): use the exact text in [references/prompt.md](references/prompt.md). Attach the person's face photo when there is one and add the two reference lines it gives.

Sheets are made from the item's own photos (its face), never from a previous sheet: an old sheet would bring back its layout and a second copy of the face. The studio, MCP and CLI already do this.

## Height

A sheet is three panels on plain grey, with nothing to measure against, so a model given two sheets makes both people the same size, or the size of whoever they replace. Give every character its real height in whole centimetres: the **Height** field in the Library, `update_asset` with `heightCm` over MCP, or `kie asset height <name> <cm>`. It is said in the sheet prompt, on the character's line in a scene, and in every Openjutsu H3 swap. Never guess a real person's height; ask.

## Check before keeping

Look at the result and keep it only if all of these hold:

- The face shows **only** in the left close-up.
- The oval in the centre covers the whole face: no eyes, nose or mouth showing at its edges.
- The back view really is from behind (no face, the hair from behind).
- Same outfit, hair and skin tone across the panels; nothing added or missing (bags, hats, logos).
- Three panels, no labels or text, plain grey behind.

Small misses are fine to keep: a grey floor line, a slight smile. A face showing outside the close-up, a missing panel or a changed outfit is a **Make again**. Keeping a sheet replaces the old one, and the old version goes to the item's history in `library/<name>/.history/`.

## Prices

A sheet is one image job on nano-banana-2: about $0.06 at 2K, at the time of writing. The studio shows the live price on its button; the MCP and CLI report it before submitting. The ChatGPT path is free.
