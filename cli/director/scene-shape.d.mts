import type { Cards, Ref } from "./mentions.mjs";
export const RATIOS: string[];
export const DURATION: { min: number; max: number };
export function emptyScene(): { title: string; durationS: number; ratio: string; refs: Ref[]; cards: Cards };
export function stageTimes(scene: { cards: Pick<Cards, "stages"> }): { fromS: number; toS: number }[];
