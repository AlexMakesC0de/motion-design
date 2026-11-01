// One scene → the prompt Seedance 2.5 gets, in Dan Kieft's sections, plus its
// reference images in order. Image N in the prompt is refs[N-1].
import { join } from "node:path";
import { sheetOf } from "../core/assets.mjs";
import { IMAGE, LIBRARY, STORED, attachLibraryMentions, refLabel, MAX_REFS } from "./mentions.mjs";
import { stageTimes } from "./scenes.mjs";

export const DEFAULT_REF_TOKEN = "[Image {n}]";
const KIND_WORD = { character: "character", product: "prop", location: "location", style: "style" };

export function compileScene(input, { film, library, refToken = DEFAULT_REF_TOKEN }) {
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
      return {
        send: { source: `${name}#${sheet.n}`, role: "identity" },
        line: `${token(i)} — ${name}, ${KIND_WORD[a.kind] ?? a.kind}. Preserve ${r.keep ?? a.keep ?? a.description}${/[.!?]$/.test(r.keep ?? a.keep ?? a.description) ? "" : "."}`,
      };
    }
    const rel = r.source.slice("file:".length);
    return { send: { source: join(film, rel), role: "identity" }, line: `${token(i)} — ${refLabel(r)}.${r.keep ? ` Preserve ${r.keep}.` : ""}` };
  });
  if (scene.refs.length > MAX_REFS) problems.push(`A scene holds at most ${MAX_REFS} images.`);

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
