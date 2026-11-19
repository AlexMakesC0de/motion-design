// A film's scenes: runs/<film>/scenes.json, written under the film lock.
// One scene is one Seedance 2.5 reference-to-video generation.
import { mkdirSync, rmSync } from "node:fs";
import { readFilmJson, withFilmLock, writeFilmJson } from "./files.mjs";
import { RUNS_DIR, runDir } from "../lib/run.mjs";
import { unknown, usage } from "../lib/errors.mjs";
import { MAX_REFS, emptyCards } from "./mentions.mjs";
import { RATIOS, DURATION } from "./scene-shape.mjs";
import { STAGE_PICKS, SCENE_PICKS } from "./picks.mjs";
import { cleanPicks } from "./video-picks.mjs";
export { emptyCards, parseDanPrompt } from "./mentions.mjs";
export { RATIOS, DURATION, emptyScene, stageTimes } from "./scene-shape.mjs";

const FILE = "scenes.json";
const SOURCE = /^(library:[a-z0-9][a-z0-9-]{0,80}|file:refs\/[A-Za-z0-9._-]+\.(png|jpe?g|webp))$/;

const bad = (field, message) => unknown(message, { field });
const text = (v, field) => {
  if (v == null) return "";
  if (typeof v !== "string") throw bad(field, `${field} must be text.`);
  return v;
};

export function readScenes(film) {
  return readFilmJson(film, FILE) ?? { version: 1, idea: null, scenes: [] };
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
    const stage = { title: text(s.title, "title").trim(), seconds: s.seconds, camera: text(s.camera, "camera"), action: text(s.action, "action"), end: text(s.end, "end") };
    const picks = cleanPicks(s.picks, STAGE_PICKS, `Stage ${i + 1}`);
    return picks ? { ...stage, picks } : stage;
  });
  const cards = { goal: text(c.goal, "goal"), scene: text(c.scene, "scene"), stages, style: text(c.style, "style"), audio: text(c.audio, "audio") };
  const scenePicks = cleanPicks(c.picks, SCENE_PICKS, "The scene");
  if (scenePicks) cards.picks = scenePicks;
  const durationS = stages.length ? stages.reduce((n, s) => n + s.seconds, 0) : input.durationS;
  if (!Number.isInteger(durationS) || durationS < DURATION.min || durationS > DURATION.max) {
    throw bad("durationS", `A Seedance scene lasts ${DURATION.min} to ${DURATION.max} seconds, got ${durationS}.`);
  }
  // How a speaking character's voice is sent: a voice card (a video, the default) or the bare voice file (cheaper).
  const voiceAs = input.voiceAs ?? "clip";
  if (!VOICE_AS.includes(voiceAs)) throw bad("voiceAs", `voiceAs is ${VOICE_AS.join(", ")}, got "${voiceAs}".`);
  return { title, durationS, ratio, refs: cleanRefs, cards, ...(voiceAs === "clip" ? {} : { voiceAs }) };
}

/** How a speaker's voice is sent: their talking clip when they have one, else their voice card (clip, the default); always the card; or the bare voice file. */
export const VOICE_AS = ["clip", "card", "file"];

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

const nextId = (data) => {
  let n = 1;
  while (data.scenes.some((x) => x.id === `s${n}`)) n += 1;
  return `s${n}`;
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
    const scene = { id: nextId(data), ...tidy, versions: [], chosen: null };
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

/**
 * A whole scene from elsewhere (Create's "Save into film"), versions and
 * chosen included. `make(id)` builds it once its new id is known, under the
 * film lock, so files it copies can carry that id.
 */
export function insertScene(film, make) {
  return update(film, (data) => {
    const id = nextId(data);
    const { versions = [], chosen = null, ...rest } = make(id);
    const scene = { id, ...clean(rest), versions, chosen: versions.some((v) => v.job === chosen) ? chosen : null };
    data.scenes.push(scene);
    return scene;
  });
}

/** Check an idea: its words, and the ratio and total length it aims for (either may be left out). */
function cleanIdea(idea) {
  if (!idea || typeof idea !== "object") throw bad("idea", "Send the idea as { text, ratio, lengthS }.");
  const t = text(idea.text, "text").trim();
  if (!t) throw bad("text", "Say what the film is about.");
  if (t.length > 4000) throw bad("text", "Keep the idea under 4000 characters; the scenes hold the detail.");
  const ratio = idea.ratio ?? null;
  if (ratio !== null && !RATIOS.includes(ratio)) throw bad("ratio", `ratio must be one of ${RATIOS.join(", ")}.`);
  const lengthS = idea.lengthS ?? null;
  if (lengthS !== null && (!Number.isInteger(lengthS) || lengthS < 1 || lengthS > 600)) throw bad("lengthS", "lengthS is whole seconds, 1 to 600.");
  return { text: t, ratio, lengthS };
}

/**
 * Save a film's idea, and optionally a scene list: an entry with an id renames
 * or re-times that scene (the length only when it has no stages), one without
 * adds a scene at the idea's ratio. Scenes not listed are left alone.
 * With `create`, runs/<film> must not exist yet (refused with `exists: true`).
 */
export function saveIdea(film, input, { scenes = null, create = false } = {}) {
  const idea = cleanIdea(input);
  if (scenes !== null && !Array.isArray(scenes)) throw bad("scenes", "scenes must be a list of { id?, title, durationS }.");
  if (create) {
    const dir = runDir(film, { create: false });
    mkdirSync(RUNS_DIR, { recursive: true });
    try {
      mkdirSync(dir); // not recursive: fails if anything is already at runs/<film>
    } catch (err) {
      if (err.code === "EEXIST") throw usage(`runs/${film} already exists; a new film needs a name of its own.`, { exists: true });
      throw err;
    }
  }
  try {
    return update(film, (data) => {
      data.idea = idea;
      for (const entry of scenes ?? []) {
        if (!entry || typeof entry !== "object") throw bad("scenes", "Each scene is { id?, title, durationS }.");
        if (entry.id) {
          const s = find(data, entry.id);
          const durationS = s.cards.stages.length ? s.durationS : (entry.durationS ?? s.durationS);
          Object.assign(s, clean({ ...s, title: entry.title ?? s.title, durationS }));
        } else {
          data.scenes.push({ id: nextId(data), ...clean({ title: entry.title, durationS: entry.durationS, ratio: idea.ratio ?? "16:9" }), versions: [], chosen: null });
        }
      }
      return data;
    });
  } catch (err) {
    if (create) rmSync(runDir(film, { create: false }), { recursive: true, force: true }); // the folder made just now, so the next try can have the name
    throw err;
  }
}
