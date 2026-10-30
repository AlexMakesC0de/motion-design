// The preset gallery. listPresets is core's view; this adds the still's URL
// and, for one preset, the source prompt text that "Use this" puts in the
// prompt bar. The absolute prompt path stays on the server.
import { existsSync, readFileSync } from "node:fs";
import { listPresets } from "../../../cli/core/views.mjs";
import { unknown } from "../../../cli/lib/errors.mjs";
import { presetStills, stillUrl } from "../stills.mjs";

const card = (p, stills) => {
  const { sourcePromptPath, guide: _guide, ...rest } = p;
  return { ...rest, hasPrompt: Boolean(sourcePromptPath && existsSync(sourcePromptPath)), still: stillUrl(p.id, stills) };
};

export function registerPresets(router, { catalog }) {
  router.get("/api/presets", () => {
    const stills = presetStills();
    return listPresets(catalog).map((p) => card(p, stills));
  });

  router.get("/api/presets/:id", ({ params }) => {
    const all = listPresets(catalog);
    const p = all.find((x) => x.id === params.id);
    if (!p) throw unknown(`No preset "${params.id}". Presets: ${all.map((x) => x.id).join(", ")}.`);
    const prompt = p.sourcePromptPath && existsSync(p.sourcePromptPath) ? readFileSync(p.sourcePromptPath, "utf8") : null;
    return { ...card(p, presetStills()), prompt };
  });
}
