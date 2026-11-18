// web/src/app/modelMeta.ts
// How the top bar's menus and the making pages name each model: a display
// name, one line on what it is good at, and an optional badge. Catalog ids
// with no entry fall back to the id itself.
import type { ModelInfo } from "../api/types";

const META: Record<string, { name: string; blurb: string; badge?: "Top" | "New" }> = {
  "seedance-2-5": { name: "Seedance 2.5", blurb: "Cinematic video from text and references", badge: "Top" },
  "seedance-2": { name: "Seedance 2", blurb: "Dependable all-round video" },
  "seedance-2-fast": { name: "Seedance 2 Fast", blurb: "The cheapest drafts, back quickly" },
  "kling-3-0": { name: "Kling 3.0", blurb: "Camera moves that follow the prompt closely" },
  "veo-3-1": { name: "Veo 3.1", blurb: "Dialogue and sound effects in the take" },
  "minimax-h3": { name: "MiniMax H3", blurb: "Bold motion for type and collage" },
  "minimax-h3-max": { name: "MiniMax H3 Max", blurb: "Footage overlays and denser scenes" },
  "wan-3-0": { name: "Wan 3.0", blurb: "Video from text, keyframes or references" },
  "wan-2-6": { name: "Wan 2.6", blurb: "Low-cost tests, reframe afterwards" },
  "gpt-image-2-5": { name: "GPT Image 2.5", blurb: "Top quality and precise edits" },
  "gpt-image-2": { name: "GPT Image 2", blurb: "Stays faithful to your references" },
  "nano-banana-2": { name: "Nano Banana 2", blurb: "Sharp, readable text inside the image" },
  "seedream-5-pro": { name: "Seedream 5 Pro", blurb: "Cheap style frames and moodboards" },
  "elevenlabs-tts": { name: "ElevenLabs", blurb: "Narration" },
  "suno-music": { name: "Suno", blurb: "Instrumental music beds" },
};

/** Badged and listed models first, in the order above; the rest after, by id. */
const ORDER = Object.keys(META);

export const modelName = (id: string) => META[id]?.name ?? id;
export const modelBadge = (id: string) => META[id]?.badge ?? null;

/** The menu line: what it is good at, plus the longest take for video. */
export function modelBlurb(m: ModelInfo) {
  const base = META[m.id]?.blurb ?? m.notes?.split(/(?<=\.)\s/)[0] ?? "";
  const longest = m.capability === "video" && m.durationsS.length ? Math.max(...m.durationsS) : null;
  return longest ? `${base}, up to ${longest}s` : base;
}

export function sortModels(models: ModelInfo[]) {
  const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);
  return [...models].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}
