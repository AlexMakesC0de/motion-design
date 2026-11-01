// A film's scenes: runs/<film>/scenes.json, written under the film lock.
// One scene is one Seedance 2.5 reference-to-video generation.
import { readFilmJson, withFilmLock, writeFilmJson } from "./files.mjs";
import { unknown } from "../lib/errors.mjs";
import { MAX_REFS, emptyCards } from "./mentions.mjs";
export { emptyCards, parseDanPrompt } from "./mentions.mjs";

const FILE = "scenes.json";
export const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
export const DURATION = { min: 4, max: 30 };
const SOURCE = /^(library:[a-z0-9][a-z0-9-]{0,80}|file:refs\/[A-Za-z0-9._-]+\.(png|jpe?g|webp))$/;

export const emptyScene = () => ({ title: "", durationS: 8, ratio: "16:9", refs: [], cards: emptyCards() });

const bad = (field, message) => unknown(message, { field });
const text = (v, field) => {
  if (v == null) return "";
  if (typeof v !== "string") throw bad(field, `${field} must be text.`);
  return v;
};

export function readScenes(film) {
  return readFilmJson(film, FILE) ?? { version: 1, idea: null, scenes: [] };
}

export function stageTimes(scene) {
  let at = 0;
  return scene.cards.stages.map((s) => ({ fromS: at, toS: (at += s.seconds) }));
}

/** Check and tidy what a caller sent. Versions and chosen are never taken from the caller. */
function clean(input) {
  const title = text(input.title, "title").trim();
  const ratio = input.ratio ?? "16:9";
  if (!RATIOS.includes(ratio)) throw bad("ratio", `ratio must be one of ${RATIOS.join(", ")}.`);
  const refs = input.refs ?? [];
  if (!Array.isArray(refs) || refs.length > MAX_REFS) throw bad("refs", `A scene holds at most ${MAX_REFS} images.`);
  const ids = new Set();
  const cleanRefs = refs.map((r) => {
    if (!/^r\d+$/.test(r?.id ?? "") || ids.has(r.id)) throw bad("refs", "Each image needs its own id, r1, r2…");
    ids.add(r.id);
    if (r.source !== null && !SOURCE.test(r.source ?? "")) throw bad("refs", `An image's source is library:<name> or file:refs/<file>, got "${r.source}".`);
    const keep = text(r.keep, "keep").trim();
    return keep ? { id: r.id, source: r.source, keep } : { id: r.id, source: r.source };
  });
  const c = input.cards ?? emptyCards();
  const stages = (c.stages ?? []).map((s, i) => {
    if (!Number.isInteger(s.seconds) || s.seconds < 1) throw bad("stages", `Stage ${i + 1} must last at least 1 second.`);
    return { title: text(s.title, "title").trim(), seconds: s.seconds, camera: text(s.camera, "camera"), action: text(s.action, "action"), end: text(s.end, "end") };
  });
  const cards = { goal: text(c.goal, "goal"), scene: text(c.scene, "scene"), stages, style: text(c.style, "style"), audio: text(c.audio, "audio") };
  const durationS = stages.length ? stages.reduce((n, s) => n + s.seconds, 0) : input.durationS;
  if (!Number.isInteger(durationS) || durationS < DURATION.min || durationS > DURATION.max) {
    throw bad("durationS", `A Seedance scene lasts ${DURATION.min} to ${DURATION.max} seconds, got ${durationS}.`);
  }
  return { title, durationS, ratio, refs: cleanRefs, cards };
}

function update(film, fn) {
  return withFilmLock(film, () => {
    const data = readScenes(film);
    const result = fn(data);
    writeFilmJson(film, FILE, data);
    return result;
  });
}

const find = (data, id) => {
  const s = data.scenes.find((x) => x.id === id);
  if (!s) throw unknown(`No scene "${id}".`, { field: "id" });
  return s;
};

export function saveScene(film, input) {
  const tidy = clean(input);
  return update(film, (data) => {
    if (input.id) {
      const i = data.scenes.findIndex((x) => x.id === input.id);
      if (i < 0) throw unknown(`No scene "${input.id}".`, { field: "id" });
      data.scenes[i] = { id: input.id, ...tidy, versions: data.scenes[i].versions, chosen: data.scenes[i].chosen };
      return data.scenes[i];
    }
    let n = 1;
    while (data.scenes.some((x) => x.id === `s${n}`)) n += 1;
    const scene = { id: `s${n}`, ...tidy, versions: [], chosen: null };
    data.scenes.push(scene);
    return scene;
  });
}

export function deleteScene(film, id) {
  update(film, (data) => {
    find(data, id);
    data.scenes = data.scenes.filter((x) => x.id !== id);
  });
}

export function orderScenes(film, ids) {
  update(film, (data) => {
    const have = data.scenes.map((x) => x.id).sort().join();
    if ([...ids].sort().join() !== have) throw unknown("Send every scene once to reorder.", { field: "ids" });
    data.scenes = ids.map((id) => find(data, id));
  });
}

export function addVersion(film, id, version) {
  return update(film, (data) => {
    const s = find(data, id);
    s.versions.push(version);
    return s;
  });
}

export function chooseVersion(film, id, job) {
  return update(film, (data) => {
    const s = find(data, id);
    if (!s.versions.some((v) => v.job === job)) throw unknown(`"${job}" is not a version of ${id}.`, { field: "job" });
    s.chosen = job;
    return s;
  });
}
