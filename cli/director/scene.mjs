// One scene → the prompt Seedance 2.5 gets, in Dan Kieft's sections, plus its
// reference images in order. Image N in the prompt is refs[N-1].
import { join } from "node:path";
import { sheetOf } from "../core/assets.mjs";
import { IMAGE, LIBRARY, STORED, attachLibraryMentions, refLabel, MAX_REFS } from "./mentions.mjs";
import { stageTimes } from "./scenes.mjs";

export const DEFAULT_REF_TOKEN = "[Image {n}]";
const KIND_WORD = { character: "character", product: "prop", location: "location", style: "style" };

/** Why a picture of `width`×`height` would be refused, or null. `limits` is a route's refLimits.image. */
function sizeProblem(what, size, limits) {
  if (!limits || !size?.width || !size?.height) return null;
  const { width: w, height: h } = size;
  if (Math.min(w, h) < limits.minSide || Math.max(w, h) > limits.maxSide) {
    return `${what} is ${w}×${h}; Seedance needs ${limits.minSide} to ${limits.maxSide}px on each side. Use a ${Math.min(w, h) < limits.minSide ? "bigger" : "smaller"} picture.`;
  }
  const aspect = w / h;
  if (aspect > limits.maxAspect) return `${what} is ${aspect.toFixed(2)}:1 wide; Seedance takes ${limits.minAspect}:1 to ${limits.maxAspect}:1. Make ${what.startsWith("@") ? "the sheet" : "it"} less wide.`;
  if (aspect < limits.minAspect) return `${what} is ${aspect.toFixed(2)}:1 tall; Seedance takes ${limits.minAspect}:1 to ${limits.maxAspect}:1. Make ${what.startsWith("@") ? "the sheet" : "it"} less tall.`;
  return null;
}

/**
 * `limits` and `sizeOf(path)` are optional: with them, pictures the model
 * would refuse are named here, in the preview, rather than at submit.
 */
export function compileScene(input, { film, library, refToken = DEFAULT_REF_TOKEN, limits = null, sizeOf = () => null }) {
  const scene = attachLibraryMentions(input);
  const problems = [];
  const token = (i) => refToken.replace("{n}", String(i + 1));
  const item = (name) => {
    try {
      return library.get(name);
    } catch {
      return null;
    }
  };

  const resolved = scene.refs.map((r, i) => {
    if (!r.source) return problems.push(`image ${i + 1} is empty. Choose a picture or remove it.`) && null;
    if (r.source.startsWith("library:")) {
      const name = refLabel(r);
      const a = item(name);
      if (!a) return problems.push(`@library:${name} is not in the Library. Make it in the Library first.`) && null;
      const sheet = sheetOf(a);
      if (!sheet) return problems.push(`@library:${name} has no sheet yet. Make one in the Library.`) && null;
      const tooBig = sizeProblem(`@library:${name}'s sheet`, sheet, limits);
      if (tooBig) return problems.push(tooBig) && null;
      return {
        send: { source: `${name}#${sheet.n}`, role: "identity" },
        line: `${token(i)} — ${name}, ${KIND_WORD[a.kind] ?? a.kind}. Preserve ${r.keep ?? a.keep ?? a.description}${/[.!?]$/.test(r.keep ?? a.keep ?? a.description) ? "" : "."}`,
      };
    }
    const rel = r.source.slice("file:".length);
    const tooBig = sizeProblem(refLabel(r), sizeOf(join(film, rel)), limits);
    if (tooBig) return problems.push(tooBig) && null;
    return { send: { source: join(film, rel), role: "identity" }, line: `${token(i)} — ${refLabel(r)}.${r.keep ? ` Preserve ${r.keep}.` : ""}` };
  });
  if (scene.refs.length > MAX_REFS) problems.push(`A scene holds at most ${MAX_REFS} images.`);
  const says = [scene.cards.goal, scene.cards.scene, ...scene.cards.stages.flatMap((s) => [s.camera, s.action])].some((t) => t?.trim());
  if (!says) problems.push("Write the Goal, or what happens in a stage, first.");

  const render = (t) =>
    t
      .replace(STORED, (m, id) => {
        const i = scene.refs.findIndex((r) => r.id === id);
        return i < 0 ? m : token(i);
      })
      .replace(LIBRARY, (m, name) => {
        const i = scene.refs.findIndex((r) => r.source === `library:${name}`);
        return i < 0 ? m : token(i);
      })
      .replace(IMAGE, (m, n) => {
        problems.push(`${m}: there is no image ${n} in this scene.`);
        return m;
      })
      .trim();

  const c = scene.cards;
  const out = [];
  const section = (head, body) => {
    if (body) out.push(`[${head}]`, body, "");
  };
  section("GOAL", render(c.goal));
  if (resolved.length) {
    out.push("[REFERENCES]", ...resolved.filter(Boolean).map((r) => r.line), "Do not reproduce reference-sheet panels, grey studio backgrounds or labels.", "");
  }
  section("SCENE", render(c.scene));
  const times = stageTimes(scene);
  c.stages.forEach((s, i) => {
    const lines = [["Camera", s.camera], ["Action", s.action], ["End", s.end]].map(([k, v]) => [k, render(v)]).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    out.push(`[STAGE ${i + 1} | ${times[i].fromS}–${times[i].toS} SECONDS | ${(s.title || `Stage ${i + 1}`).toUpperCase()}]`, ...lines, "");
  });
  section("VISUAL STYLE", render(c.style));
  section("AUDIO", render(c.audio));
  out.push("[MAINTAIN CONSISTENCY]", "Keep every person, product and place exactly as in their reference images in every stage.");

  const unique = [...new Set(problems)];
  return { prompt: out.join("\n"), refs: unique.length ? [] : resolved.map((r) => r.send), problems: unique };
}
