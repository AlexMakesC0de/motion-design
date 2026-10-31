import { loadMenu, ids } from "./menu.mjs";
import { shotFit, stillFit } from "./fit.mjs";
import { shotWording } from "./wording.mjs";

const SHOT_ID = /^[a-z0-9][a-z0-9-]{0,19}$/;
const SHOT_TEXT = ["purpose", "subject", "action", "why"];
const LOOK_TEXT = ["palette", "grade", "filmLook"];
const CLOSE = new Set(["medium-close-up", "close-up", "extreme-close-up"]);
const WIDE_LENS = new Set(["14mm", "24mm"]);
const WIDE_SIZES = new Set(["extreme-wide", "wide", "full"]);
const NOT_FACES = new Set(["motion-graphics", "product-hero"]);
// Words a model would draw as a picture of text: quoted copy, prices, percentages.
const QUOTED = /["“”][^"“”]{2,}["“”]/;
const FIGURE = /[$€£]\s?\d|\d+(?:[.,]\d+)?\s?%/;
const OPPOSITE = { "left-to-right": "right-to-left", "right-to-left": "left-to-right" };

const text = (v) => typeof v === "string" && v.trim() !== "";
const same = (a, b) => text(a) && text(b) && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The script supervisor. Errors block the plan from being saved, stills and
 * filming; warnings are craft notes that never block. Each finding names its
 * shot (null for the whole film), a rule id and one plain sentence.
 */
export function checkPlan(plan, { catalog, brief = null, assets = [], menu = loadMenu() }) {
  const errors = [];
  const warnings = [];
  const err = (shot, rule, message) => errors.push({ shot, rule, message });
  const warn = (shot, rule, message) => warnings.push({ shot, rule, message });
  const inMenu = (group, v) => ids(menu, group).includes(v);
  const oneOf = (group) => ids(menu, group).join(", ");
  const library = new Set(assets.map((a) => a.name));

  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    err(null, "shape", "The plan must be an object with look and shots.");
    return { errors, warnings };
  }
  const look = plan.look && typeof plan.look === "object" ? plan.look : {};
  for (const k of LOOK_TEXT) if (!text(look[k])) err(null, "shape", `look.${k} is missing; say it in words.`);
  if (!inMenu("lensLooks", look.lensFamily)) err(null, "menu", `look.lensFamily must be one of: ${oneOf("lensLooks")}.`);
  if (!inMenu("keyLightSides", look.keyLightSide)) err(null, "menu", `look.keyLightSide must be one of: ${oneOf("keyLightSides")}.`);
  for (const c of Array.isArray(look.cast) ? look.cast : []) {
    if (!library.has(c?.asset)) err(null, "unknown-cast", `look.cast names "${c?.asset}", which is not in the Library. Save it first or remove it.`);
  }

  const lookOk = errors.length === 0;
  const shots = Array.isArray(plan.shots) ? plan.shots : [];
  if (!shots.length) err(null, "shape", "The plan has no shots.");
  const seen = new Set();
  const valid = new Set();

  for (const s of shots) {
    const before = errors.length;
    const id = s?.id;
    if (!SHOT_ID.test(id ?? "")) err(id ?? null, "shape", `Shot id "${id}" must be short lowercase letters, digits and hyphens, like s1.`);
    else if (seen.has(id)) err(id, "shape", `Two shots are called ${id}.`);
    seen.add(id);
    if (!(typeof s?.durationS === "number" && s.durationS > 0)) err(id, "shape", `${id}: durationS must be a number of seconds above 0.`);
    for (const k of SHOT_TEXT) if (!text(s?.[k])) err(id, "shape", `${id}: ${k} is missing.`);
    for (const [k, group] of [["size", "sizes"], ["angle", "angles"], ["lens", "lenses"], ["depth", "depths"], ["light", "lights"], ["cut", "cuts"], ["job", "jobs"], ["screenDirection", "screenDirections"]]) {
      if (!inMenu(group, s?.[k])) err(id, "menu", `${id}: ${k} "${s?.[k]}" is not on the menu. Choose one of: ${oneOf(group)}.`);
    }
    if (s?.keyLightSide != null && !inMenu("keyLightSides", s.keyLightSide)) err(id, "menu", `${id}: keyLightSide must be one of: ${oneOf("keyLightSides")}.`);
    if (Array.isArray(s?.move) || !s?.move || typeof s.move !== "object") {
      err(id, "one-move", `${id}: one camera move per shot, written as { type, speed }. Give a second move its own shot.`);
    } else {
      if (!inMenu("moves", s.move.type)) err(id, "menu", `${id}: move "${s.move.type}" is not on the menu. Choose one of: ${oneOf("moves")}.`);
      if (s.move.type !== "static" && !inMenu("speeds", s.move.speed)) err(id, "menu", `${id}: move speed must be one of: ${oneOf("speeds")}.`);
    }
    const checks = s?.checks;
    if (!Array.isArray(checks) || checks.length < 1 || checks.length > 3 || !checks.every(text)) {
      err(id, "shape", `${id}: checks must be 1 to 3 short pass/fail sentences.`);
    }
    if (s?.copy != null && !(Array.isArray(s.copy) && s.copy.every(text))) err(id, "shape", `${id}: copy must be a list of exact text lines.`);
    for (const name of Array.isArray(s?.cast) ? s.cast : []) {
      if (!library.has(name)) err(id, "unknown-cast", `${id}: cast names "${name}", which is not in the Library. Save it first or remove it.`);
    }
    if (text(s?.action) && (QUOTED.test(s.action) || FIGURE.test(s.action))) {
      err(id, "text-in-action", `${id}: the action contains quoted text or a figure, which a model would draw wrongly. Move it to copy; the edit renders it in code.`);
    }
    if (!text(s?.model)) {
      err(id, "model-fit", `${id}: no model fits this shot.`);
    } else if (typeof s?.durationS === "number" && s.durationS > 0) {
      for (const p of shotFit(catalog, s.model, { plannedS: s.durationS, aspectRatio: brief?.aspectRatio }).problems) err(id, "model-fit", `${id}: ${p}`);
    }
    if (s?.stillModel != null) {
      for (const p of stillFit(catalog, s.stillModel, { aspectRatio: brief?.aspectRatio }).problems) err(id, "model-fit", `${id}: still: ${p}`);
    }
    if (errors.length === before) valid.add(s);

    if (WIDE_LENS.has(s?.lens) && CLOSE.has(s?.size) && !NOT_FACES.has(s?.job)) {
      warn(id, "wide-lens-close", `${id}: a ${s.lens} lens this close distorts a face. An 85mm flatters it.`);
    }
    if (s?.move?.speed === "fast" && s?.move?.type !== "static" && s?.durationS <= 4) {
      warn(id, "fast-move-short", `${id}: a fast move in ${s.durationS}s rarely reads. Slow it or lengthen the shot.`);
    }
    if (typeof s?.model === "string" && s.model.startsWith("seedance") && s?.durationS > 8) {
      warn(id, "seedance-long", `${id}: Seedance shots past 8s tend to drift. Split it into two shots.`);
    }
    if (typeof s?.model === "string" && s.model.startsWith("wan") && String(s?.move?.type).startsWith("orbit")) {
      warn(id, "wan-orbit", `${id}: Wan breaks orbits wider than 45 degrees. Keep the arc small or choose a truck.`);
    }
    if (s?.keyLightSide != null && s.keyLightSide !== look.keyLightSide && !text(s?.lightReason)) {
      warn(id, "light-side", `${id}: the key light moves from ${look.keyLightSide} to ${s.keyLightSide}. Say why in lightReason, or keep it on one side.`);
    }
  }

  for (let i = 1; i < shots.length; i += 1) {
    const a = shots[i - 1];
    const b = shots[i];
    if (same(a?.subject, b?.subject) && OPPOSITE[a?.screenDirection] === b?.screenDirection && !text(b?.crossesLine)) {
      err(b?.id ?? null, "screen-direction", `${b?.id}: ${b.subject} travels ${b.screenDirection.replace(/-/g, " ")} after ${a.screenDirection.replace(/-/g, " ")} in ${a.id}, which crosses the line. Keep the direction, or say why in crossesLine.`);
    }
    if (same(a?.subject, b?.subject) && a?.size === b?.size && a?.angle === b?.angle && a?.cut !== "continuous") {
      warn(b?.id ?? null, "jump-cut", `${b?.id}: same subject, size and angle as ${a?.id}, which reads as a jump cut. Change the size or the angle.`);
    }
    if (i >= 2 && shots[i - 2]?.size === a?.size && a?.size === b?.size) {
      warn(b?.id ?? null, "same-size-run", `${b?.id}: three ${b.size} shots in a row. Vary the size to give the cut somewhere to go.`);
    }
  }
  if (shots.length && shots.at(-1)?.cut === "continuous") {
    err(shots.at(-1)?.id ?? null, "last-continuous", `${shots.at(-1)?.id}: the last shot cannot continue into a next shot. Use another cut.`);
  }
  if (brief && shots.length && shots.every((s) => typeof s?.durationS === "number")) {
    const total = shots.reduce((t, s) => t + s.durationS, 0);
    if (Math.abs(total - brief.durationS) > 1) err(null, "total-length", `The shots add up to ${total}s; the brief asks for ${brief.durationS}s.`);
  }
  if (brief?.filmType === "live-action" && shots.length && !shots.some((s) => WIDE_SIZES.has(s?.size))) {
    warn(null, "no-wide", "No wide shot: a live-action film usually establishes the place before going close.");
  }

  // Wording is only built when the look and the shot are otherwise sound.
  for (const s of lookOk ? valid : []) {
    const w = shotWording(catalog, plan, s, { menu, assets });
    for (const p of w.problems) err(s.id, "wording-length", `${s.id}: ${p}`);
  }
  return { errors, warnings };
}
