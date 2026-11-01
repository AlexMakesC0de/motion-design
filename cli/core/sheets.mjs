// The prompt Alex pastes into ChatGPT to make a Library sheet. Adapted from
// Dan Kieft's templates (start-making-ai-videos.vercel.app, read 2026-11-01):
// a character is a three-panel sheet on 18% grey, a location a view with no
// people, a prop a front and top-down view on mid-grey (white overexposes).
import { unknown } from "../lib/errors.mjs";
import { KINDS } from "./assets.mjs";

const lead = (photos) => (photos > 0 ? `Generate the final image based on my attached reference photo${photos === 1 ? "" : "s"}.\n\n` : "");
const end = (s) => s.trim().replace(/[.\s]+$/, "");

const character = ({ description, outfit, photos }) =>
  [
    "A three-panel character reference sheet composed as one horizontal image, divided into three equal vertical panels side by side with thin clean separations. The same person in the same outfit, rendered identically in all three panels. No text, no labels, no numbering anywhere in the image.",
    photos > 0
      ? "The face comes from the attached reference and must match it exactly in every panel: same face shape, bone structure, eyes, brows, nose, lips, skin tone and hair."
      : null,
    `CHARACTER: ${end(description)}.`,
    `OUTFIT: ${outfit?.trim() ? `${end(outfit)}.` : "as described above."}`,
    "LEFT PANEL — full body front view. The figure stands squared to the camera, framed from above the head down to the shoes, arms relaxed at the sides, weight even on both feet. The full outfit is clearly readable.\n" +
      "CENTER PANEL — full body back view. The complete figure from above the head down to the shoes, seen directly from behind, standing straight. Hair, back of the outfit and shoes are clearly readable.",
    "RIGHT PANEL — tight chest-up face close-up. Framed from just above the head down to the collarbones, the face filling the panel, looking straight at camera, neutral relaxed expression, lips closed. Maximum facial detail.",
    "Skin tone is identical in every panel, never darker or tanned on the back view.",
    "The background is one flat 18% neutral gray field, identical in all three panels, with no gradient, no floor, no wall and no vignette. Flat shadowless frontal lighting, even on both sides of the face, no cast shadow under the feet and no shadow on the background. Realistic skin with fine soft pore texture and a matte finish, real hair strands, real fabric texture, never plastic, never CGI.\n" +
      "Even sharpness everywhere, no blur. Photographed on a 50mm prime, soft natural film grain. Photographed not generated.",
  ]
    .filter(Boolean)
    .join("\n\n");

const location = ({ description, view }) => `${end(view?.trim() || "3/4 wide-angle")} view of ${end(description)}. No people. No text.`;

const product = ({ description, photos }) =>
  [
    "Two views of the same object: FRONT view on the left of the frame, and top-down view on the right. Both centered, same scale. Flat seamless mid-grey background.",
    `The object: ${end(description)}.${photos > 0 ? " It is the object in the attached reference." : ""} Every label, edge and colour exact. No text other than the object's own markings.`,
  ].join(" ");

const style = ({ description }) => `${end(description)}. No text.`;

const BUILD = { character, location, product, style };

/** { kind, description, outfit?, view?, photos? } → the prompt text. */
export function sheetPrompt({ kind, description, outfit = "", view = "", photos = 0 }) {
  if (!KINDS.includes(kind)) throw unknown(`kind must be one of ${KINDS.join(", ")}, got "${kind}".`, { field: "kind" });
  if (!description?.trim()) throw unknown("Say what it is (the description) first.", { field: "description" });
  return lead(photos) + BUILD[kind]({ description, outfit, view, photos });
}
