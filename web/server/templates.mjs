// The render templates' props, for the text-card form. The templates are
// React components in render/src/templates/*.tsx, which the server cannot
// import, and core lists only their ids and one-line descriptions (TEMPLATES
// in cli/lib/render.mjs). Each field below names a prop of a template's Props
// type; tests/templates.test.mjs reads the .tsx sources and fails when one
// drifts. Field types: text, lines (a list, one per row), choice, image (a
// file inside runs/ or library/) and json (a list of objects).
import { TEMPLATES } from "../../cli/lib/render.mjs";

export const TEMPLATE_FIELDS = {
  "kinetic-type": {
    durationS: 6,
    fields: [
      { name: "lines", type: "lines", label: "Lines", required: true, hint: "One line of the headline per row." },
      { name: "kicker", type: "text", label: "Kicker" },
      { name: "footer", type: "text", label: "Footer" },
      { name: "granularity", type: "choice", label: "Builds by", choices: ["word", "line"] },
      { name: "align", type: "choice", label: "Align", choices: ["center", "left"] },
    ],
  },
  "logo-reveal": {
    durationS: 4,
    fields: [
      { name: "wordmark", type: "text", label: "Wordmark", required: true },
      { name: "tagline", type: "text", label: "Tagline" },
      { name: "logo", type: "image", label: "Logo file", hint: "A PNG, JPEG, WebP or SVG inside runs/ or library/, for example zed/logo.png." },
      { name: "background", type: "choice", label: "Background", choices: ["gradient", "solid"] },
    ],
  },
  "stat-reveal": {
    durationS: 7,
    fields: [
      { name: "title", type: "text", label: "Title" },
      {
        name: "stats",
        type: "json",
        label: "Stats",
        required: true,
        hint: "A list of { label, value, prefix?, suffix?, decimals?, bar? }; bar is 0 to 1.",
        example: [
          { label: "Hours saved weekly", value: 4.5, decimals: 1, suffix: "h", bar: 0.75 },
          { label: "Replies drafted", value: 128, bar: 0.55 },
        ],
      },
      { name: "footnote", type: "text", label: "Footnote" },
    ],
  },
  "lower-third": {
    durationS: 4,
    fields: [
      { name: "name", type: "text", label: "Name", required: true },
      { name: "title", type: "text", label: "Title" },
      { name: "side", type: "choice", label: "Side", choices: ["left", "right"] },
    ],
  },
  "ui-demo": {
    durationS: 9,
    fields: [
      { name: "title", type: "text", label: "Title" },
      {
        name: "steps",
        type: "json",
        label: "Steps",
        required: true,
        hint: "A list of { image, caption?, holdS? }; each image is a real screenshot inside runs/ or library/.",
        example: [{ image: "my-film/screen-1.png", caption: "Open the inbox" }],
      },
      { name: "frameStyle", type: "choice", label: "Frame", choices: ["browser", "phone", "none"] },
    ],
  },
};

/** Core's templates, each with its description, default length and fields. */
export const templateList = () =>
  Object.entries(TEMPLATES).map(([id, description]) => ({ id, description, durationS: TEMPLATE_FIELDS[id]?.durationS ?? null, fields: TEMPLATE_FIELDS[id]?.fields ?? [] }));
