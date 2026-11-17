import { resolveModel } from "../lib/models.mjs";
import { loadMenu, entry } from "./menu.mjs";
import { cameraWords, framingWords } from "./picks.mjs";

/** "the camera slowly pushes in" -> "The camera slowly pushes in." */
const sentence = (s) => {
  const t = String(s ?? "").trim().replace(/[.\s]+$/, "");
  return t ? `${t[0].toUpperCase()}${t.slice(1)}.` : "";
};
const cap = (s) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);

/**
 * One shot as its model reads best. The shot is animated from its still, so the
 * words carry the camera, the action and the light; the cast and look lines are
 * the Library descriptions and the film's look, word for word in every shot.
 * Returns the prompt, any provider params it needs (audio off) and its length
 * against the model's limit. Pure: the same plan always gives the same text.
 */
export function shotWording(catalog, plan, shot, { menu = loadMenu(), assets = [] } = {}) {
  const model = resolveModel(catalog, shot.model, "video");
  const profile = model.promptProfile ?? { family: "seedance", maxChars: null, audioOff: null };
  const look = plan.look ?? {};
  const pick = (group, id) => entry(menu, group, id);

  const move = pick("moves", shot.move.type);
  const camera = cameraWords(move, shot.move.type === "static" ? null : pick("speeds", shot.move.speed));
  const framing = framingWords([pick("sizes", shot.size), pick("angles", shot.angle), pick("lenses", shot.lens), pick("depths", shot.depth)]);
  const described = (shot.cast ?? []).map((name) => assets.find((a) => a.name === name)?.description).filter(Boolean);
  const subjectLine = described.length ? `Subject: ${described.map((d) => d.trim().replace(/[.\s]+$/, "")).join("; ")}.` : "";
  const keySide = shot.keyLightSide ?? look.keyLightSide;
  const lookLine = `Look: ${look.filmLook}, ${look.palette}, ${look.grade}, ${pick("lensLooks", look.lensFamily).words} lenses, key light from the ${keySide}.`;
  const direction = shot.screenDirection && shot.screenDirection !== "none" ? pick("screenDirections", shot.screenDirection).words : "";
  const action = sentence(direction ? `${shot.action.trim().replace(/[.\s]+$/, "")}, ${direction}` : shot.action);
  const light = sentence(pick("lights", shot.light).words);
  const noText = shot.copy?.length ? "No on-screen text." : "";
  const speaks = shot.job === "lip-sync";
  // The line follows the action in every family, so the mouth moves on it.
  const said = speaks && shot.line ? `${action}\nSpoken line: "${shot.line.trim()}"` : action;

  let lines;
  switch (profile.family) {
    case "hailuo":
      // The spec turns Hailuo's prompt optimizer off when a bracket command is
      // used. No MiniMax route in cli/models.json declares that field, and
      // buildInput refuses undeclared params, so it is not sent: capture it into
      // the routes' contracts first, then add it to params here.
      lines = [lookLine, `${move.hailuo ?? sentence(camera)} ${sentence(framing)}`, subjectLine, said, light, noText];
      break;
    case "kling":
      lines = [subjectLine, lookLine, `Shot: ${framing}; ${camera}.`, said, light, noText];
      break;
    case "wan":
      lines = ["One continuous shot.", `${cap(framing)}; ${camera}.`, subjectLine, said, light, lookLine, noText, speaks ? "" : "No dialogue. No background music."];
      break;
    case "veo":
      lines = [`${cap(framing)}, ${camera}.`, subjectLine, said, light, lookLine, noText];
      break;
    default:
      lines = [subjectLine, lookLine, `Shot 1: ${cap(camera)}, ${framing}.`, said, light, noText, "No subtitles, no logo or watermark."];
  }
  const prompt = lines.filter(Boolean).join("\n");
  const params = profile.audioOff && !speaks ? { [profile.audioOff.param]: profile.audioOff.value } : {};
  const problems =
    profile.maxChars && prompt.length > profile.maxChars
      ? [`The wording is ${prompt.length} characters; ${model.id} follows at most ${profile.maxChars}. Shorten the action or the descriptions.`]
      : [];
  return { shot: shot.id, model: model.id, family: profile.family, prompt, params, chars: prompt.length, maxChars: profile.maxChars ?? null, problems };
}
