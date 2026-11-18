// AI influencers: one made-up person, kept the same in every picture and
// video. An influencer is a Library character with a persona: the traits it
// was built from (chips in the builder) and any extra words. The traits are
// turned into the character's description here, so the words a film or
// Openjutsu reuses are the same words the face was made from.
import { unknown } from "../lib/errors.mjs";

/** Each trait is one row of chips; `words` is what goes into the description. */
export const TRAITS = [
  {
    id: "gender",
    label: "Gender",
    options: [
      { id: "woman", label: "Woman", words: "woman" },
      { id: "man", label: "Man", words: "man" },
      { id: "androgynous", label: "Androgynous", words: "androgynous person" },
    ],
  },
  {
    id: "age",
    label: "Age",
    options: [
      { id: "early-20s", label: "Early 20s", words: "22-year-old" },
      { id: "late-20s", label: "Late 20s", words: "28-year-old" },
      { id: "30s", label: "30s", words: "35-year-old" },
      { id: "40s", label: "40s", words: "45-year-old" },
      { id: "50s", label: "50s+", words: "58-year-old" },
    ],
  },
  {
    id: "skin",
    label: "Skin",
    options: [
      { id: "fair", label: "Fair", words: "fair skin" },
      { id: "light", label: "Light", words: "light skin" },
      { id: "olive", label: "Olive", words: "olive skin" },
      { id: "tan", label: "Tan", words: "tan skin" },
      { id: "brown", label: "Brown", words: "brown skin" },
      { id: "deep", label: "Deep", words: "deep brown skin" },
    ],
  },
  {
    id: "hairLength",
    label: "Hair",
    options: [
      { id: "buzzed", label: "Buzzed", words: "buzzed" },
      { id: "short", label: "Short", words: "short" },
      { id: "shoulder", label: "Shoulder", words: "shoulder-length" },
      { id: "long", label: "Long", words: "long" },
    ],
  },
  {
    id: "hairTexture",
    label: "Texture",
    options: [
      { id: "straight", label: "Straight", words: "straight" },
      { id: "wavy", label: "Wavy", words: "wavy" },
      { id: "curly", label: "Curly", words: "curly" },
      { id: "coily", label: "Coily", words: "coily" },
    ],
  },
  {
    id: "hairColour",
    label: "Colour",
    options: [
      { id: "black", label: "Black", words: "black" },
      { id: "dark-brown", label: "Dark brown", words: "dark brown" },
      { id: "light-brown", label: "Light brown", words: "light brown" },
      { id: "blonde", label: "Blonde", words: "blonde" },
      { id: "red", label: "Red", words: "copper red" },
      { id: "grey", label: "Grey", words: "silver grey" },
      { id: "pastel", label: "Pastel", words: "pastel pink" },
    ],
  },
  {
    id: "style",
    label: "Style",
    options: [
      { id: "streetwear", label: "Streetwear", words: "relaxed streetwear" },
      { id: "minimal", label: "Minimal", words: "clean minimal neutrals" },
      { id: "sporty", label: "Sporty", words: "athletic sportswear" },
      { id: "glam", label: "Glam", words: "polished glam evening wear" },
      { id: "business", label: "Business", words: "sharp tailored business wear" },
      { id: "boho", label: "Boho", words: "flowing bohemian layers" },
    ],
  },
];

export const MAX_EXTRA = 300;
const end = (s) => s.trim().replace(/[.\s]+$/, "");

/** Checked traits: every key a known trait, every value one of its options. Missing traits are fine. */
export function checkTraits(traits = {}) {
  if (typeof traits !== "object" || traits === null || Array.isArray(traits)) throw unknown("traits must be an object.", { field: "traits" });
  const out = {};
  for (const [key, value] of Object.entries(traits)) {
    if (value == null || value === "") continue;
    const trait = TRAITS.find((t) => t.id === key);
    if (!trait) throw unknown(`Unknown trait "${key}".`, { field: "traits" });
    if (!trait.options.some((o) => o.id === value)) throw unknown(`${trait.label} must be one of ${trait.options.map((o) => o.label).join(", ")}.`, { field: "traits" });
    out[key] = value;
  }
  return out;
}

const words = (traits, id) => TRAITS.find((t) => t.id === id).options.find((o) => o.id === traits[id])?.words ?? null;

/**
 * The character's description, reused word for word in every prompt:
 * "a 28-year-old woman with olive skin and long wavy dark brown hair, freckles, dressed in relaxed streetwear".
 */
export function describe(traits = {}, extra = "") {
  const t = checkTraits(traits);
  const who = [words(t, "age"), words(t, "gender") ?? "person"].filter(Boolean).join(" ");
  const hairWords = [words(t, "hairLength"), words(t, "hairTexture"), words(t, "hairColour")].filter(Boolean);
  const hair = hairWords.length ? `${hairWords.join(" ")} hair` : null;
  const looks = [words(t, "skin"), hair].filter(Boolean);
  const extraText = typeof extra === "string" && extra.trim() ? end(extra) : null;
  if (extraText && extraText.length > MAX_EXTRA) throw unknown(`Keep the extra words under ${MAX_EXTRA} characters.`, { field: "extra" });
  const style = words(t, "style");
  return [`${/^[aeiou]/i.test(who) ? "an" : "a"} ${who}${looks.length ? ` with ${looks.join(" and ")}` : ""}`, extraText, style ? `dressed in ${style}` : null].filter(Boolean).join(", ");
}

/** One face option: a plain, even portrait, so the face is what you judge and what the sheet copies. */
export function facePrompt(description) {
  return [
    `A photorealistic head-and-shoulders portrait of ${end(description)}.`,
    "Looking straight at the camera with a relaxed, natural expression. Soft even daylight, plain light grey background.",
    "Real skin with fine pores, real hair strands, 85mm lens. Photographed, not generated. No text, no watermark.",
  ].join(" ");
}

/** "Mira Lopez" → "mira-lopez", the Library name; null when nothing usable is left. */
export function influencerSlug(displayName) {
  const slug = String(displayName ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || null;
}
