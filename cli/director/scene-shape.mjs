// A scene's shape: ratios, length limits, stage times and a blank scene.
// Browser-safe like mentions.mjs: the studio page imports this file, and
// scenes.mjs (which reads files) re-exports it for the CLI and the server.
import { emptyCards } from "./mentions.mjs";

export const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
// Seedance 2.5 on kie makes 4 to 30 seconds per job (cli/models.json durationsS; a test keeps them equal).
export const DURATION = { min: 4, max: 30 };

export const emptyScene = () => ({ title: "", durationS: 8, ratio: "16:9", refs: [], cards: emptyCards() });

/** Each stage's start and end in seconds, from the stage lengths; contiguous by construction. */
export function stageTimes(scene) {
  let at = 0;
  return scene.cards.stages.map((s) => ({ fromS: at, toS: (at += s.seconds) }));
}
