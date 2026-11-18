// Openjutsu: one character picture and one reference video in, one take out.
// Motion transfer makes the character perform the video's motion (Kling motion
// control); Swap puts the character into the video in place of its person
// (Wan 2.2 Animate Replace). Both bill the reference video's seconds, so the
// clip is probed when it is uploaded and every price is from that length.
//
// Uploads live in runs/jutsu/: clips/ for reference videos (each with a
// <file>.json of its probed length and size) and cast/ for pictures. The page
// names files by their name only; paths are built here, never taken from it.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JUTSU_RUN, runDir } from "../../../cli/lib/run.mjs";
import { probe as ffprobe } from "../../../cli/lib/ffmpeg.mjs";
import { mp4Meta } from "../../../cli/lib/mp4meta.mjs";
import { estimateUsd } from "../../../cli/lib/budget.mjs";
import { routesFor } from "../../../cli/lib/models.mjs";
import { checkLocalFile, MAX_BYTES } from "../../../cli/core/inputs.mjs";
import { freeName, safeStem } from "../../../cli/director/scene-make.mjs";
import { HttpError } from "../http.mjs";
import { context } from "../state.mjs";
import { dailyPosition } from "../../../cli/core/spend.mjs";
import { mediaUrl } from "../media.mjs";
import { createSubmitter } from "./generate.mjs";
import { label, saveBody } from "./library.mjs";
import * as f from "./fields.mjs";

export { JUTSU_RUN };
const FOLDERS = { video: "clips", image: "cast" };

const jutsuModels = (catalog) => catalog.list.filter((m) => m.capability === "jutsu" && m.jutsu);

function modelView(catalog, m) {
  const route = routesFor(catalog, m).find((r) => r.usable) ?? m.routes[0];
  const field = route.pricing?.resolutionField ?? "resolution";
  return {
    id: m.id,
    label: m.label ?? m.id,
    mode: m.jutsu.mode,
    tier: m.jutsu.tier,
    notes: m.notes ?? null,
    resolutions: route.input?.enums?.[field] ?? [],
    defaultResolution: route.input?.defaults?.[field] ?? null,
    usdPerSecond: route.pricing?.usdPerSecond ?? {},
    prompt: m.id.startsWith("kling"),
    orientations: m.jutsu.orientations ?? null,
    videoS: m.jutsu.videoS,
    imageOrientationMaxS: m.jutsu.imageOrientationMaxS ?? null,
    maxVideoBytes: m.jutsu.maxVideoBytes,
    maxImageBytes: m.jutsu.maxImageBytes,
    usable: routesFor(catalog, m).some((r) => r.usable),
  };
}

/** A file name from the page, as a name inside one of our folders: no path parts, and it must exist. */
function fileIn(kind, name, field) {
  if (typeof name !== "string" || !name || name !== name.split(/[\\/]/).pop() || name.startsWith(".")) {
    throw f.invalid(field, `Pick the ${kind === "video" ? "reference video" : "character picture"} again.`);
  }
  const dir = join(runDir(JUTSU_RUN), FOLDERS[kind]);
  const path = join(dir, name);
  if (!existsSync(path)) throw f.invalid(field, `${name} is no longer in ${JUTSU_RUN}/${FOLDERS[kind]}. Upload it again.`);
  return { name, path, source: `${JUTSU_RUN}/${FOLDERS[kind]}/${name}`, bytes: statSync(path).size };
}

/**
 * The character picture: a name in cast/ (an upload), or "@asset#n", one
 * picture of a Library item. The models take a single picture, so a Library
 * item is never expanded to all its images the way Create Video does.
 */
function imageIn(name) {
  if (typeof name === "string" && name.startsWith("gen:")) {
    let job = null;
    try {
      job = context().store.get(name.slice(4));
    } catch {}
    const path = job?.state === "succeeded" ? (job.artifacts ?? []).find((a) => IMAGE_FILE.test(a) && existsSync(a)) : null;
    if (!path) throw f.invalid("image", "That generated picture is no longer there. Pick another.");
    return { name, path, source: path, bytes: statSync(path).size };
  }
  if (typeof name === "string" && name.startsWith("@")) {
    const m = name.match(/^@([a-z0-9][a-z0-9-]{0,80})#(\d{1,2})$/);
    if (!m) throw f.invalid("image", "Pick the character again.");
    let record;
    try {
      record = context().library.get(m[1]);
    } catch {
      throw f.invalid("image", `${m[1]} is not in the Library any more.`);
    }
    const im = record.images.find((x) => x.n === Number(m[2]));
    if (!im || !existsSync(im.path)) throw f.invalid("image", `${m[1]} has no picture #${m[2]}.`);
    return { name, path: im.path, source: im.path, bytes: statSync(im.path).size };
  }
  return fileIn("image", name, "image");
}

const IMAGE_FILE = /\.(png|jpe?g|webp)$/i;

/** Pictures made in the studio, newest first, each file once (a later take may have replaced an earlier one's file). */
function generationsView(limit = 60) {
  const seen = new Set();
  const out = [];
  for (const j of context().store.list().reverse()) {
    if (j.capability !== "image" || j.state !== "succeeded") continue;
    const path = (j.artifacts ?? []).find((a) => IMAGE_FILE.test(a));
    if (!path || seen.has(path) || !existsSync(path)) continue;
    seen.add(path);
    out.push({ ref: `gen:${j.id}`, media: mediaUrl(path), model: j.model, run: j.run, createdAt: j.createdAt, prompt: typeof j.input?.prompt === "string" ? j.input.prompt.slice(0, 140) : null });
    if (out.length >= limit) break;
  }
  return out;
}

/** Library pictures to cast from, characters first, each identical picture once. */
function libraryView() {
  const { library } = context();
  const order = { character: 0, product: 1, location: 2, style: 3 };
  const out = [];
  for (const a of library.list().sort((x, y) => (order[x.kind] ?? 9) - (order[y.kind] ?? 9) || x.name.localeCompare(y.name))) {
    if (a.kind === "style" || a.kind === "location") continue;
    let record;
    try {
      record = library.get(a.name);
    } catch {
      continue;
    }
    const seen = new Set();
    for (const im of record.images) {
      const key = im.sha256 ?? im.file;
      if (seen.has(key) || !existsSync(im.path)) continue;
      seen.add(key);
      out.push({ ref: `@${a.name}#${im.n}`, asset: a.name, kind: a.kind, n: im.n, role: im.role, media: mediaUrl(im.path), width: im.width ?? null, height: im.height ?? null, influencer: a.persona ? (a.persona.displayName ?? a.name) : null });
    }
  }
  return out;
}

const sidecar = (path) => `${path}.json`;
/** Seconds as priced: up to the next tenth, so an estimate never undercounts. */
const billedS = (s) => Math.ceil(s * 10 - 1e-9) / 10;

/** Length and size from the file's own boxes; ffprobe only when they say nothing. */
async function realProbe(path) {
  const own = mp4Meta(path);
  if (own.durationS != null) return own;
  return ffprobe(path);
}

function clipInfo(path) {
  let info = {};
  try {
    info = JSON.parse(readFileSync(sidecar(path), "utf8"));
  } catch {}
  if (info.durationS == null) {
    // Uploaded before the length could be read: read it now and keep it.
    try {
      const own = mp4Meta(path);
      if (own.durationS != null) {
        info = { ...info, ...own };
        writeFileSync(sidecar(path), `${JSON.stringify(info, null, 2)}\n`);
      }
    } catch {}
  }
  return info;
}

/**
 * Everything wrong with this pairing for this model, in the user's words. Empty
 * means the provider's documented limits are met; nothing here is a guess.
 */
export function problemsFor(m, { clip, image, orientation }) {
  const j = m.jutsu;
  const out = [];
  const mb = (b) => `${Math.round(b / 1e6)} MB`;
  const s = clip?.durationS;
  if (clip) {
    if (s == null) out.push("The video's length could not be read, so it cannot be priced. Upload it again as an MP4 or MOV.");
    else {
      const [lo, hi] = j.videoS;
      if (s < lo || s > hi) out.push(`The video is ${s.toFixed(1)}s; ${m.label} takes ${lo} to ${hi} seconds. Trim it first.`);
      if (orientation === "image" && j.imageOrientationMaxS && s > j.imageOrientationMaxS) {
        out.push(`Facing "as in the picture" takes videos up to ${j.imageOrientationMaxS}s; this one is ${s.toFixed(1)}s. Pick "as in the video", or trim it.`);
      }
    }
    if (clip.bytes > j.maxVideoBytes) out.push(`The video is ${mb(clip.bytes)}; ${m.label} takes up to ${mb(j.maxVideoBytes)}.`);
    if (j.minSidePx && clip.width && clip.height && Math.min(clip.width, clip.height) <= j.minSidePx) {
      out.push(`The video is ${clip.width}×${clip.height}; each side must be over ${j.minSidePx}px.`);
    }
  }
  if (image && image.bytes > j.maxImageBytes) out.push(`The picture is ${mb(image.bytes)}; ${m.label} takes up to ${mb(j.maxImageBytes)}.`);
  return out;
}

export function registerJutsu(router, { catalog, deps = {}, follower }) {
  const submit = createSubmitter({ catalog, deps, follower });
  const probe = deps.probe ?? realProbe;

  function model(body) {
    const id = f.text(body, "model", { required: true });
    const m = jutsuModels(catalog).find((x) => x.id === id);
    if (!m) throw f.invalid("model", `Pick one of: ${jutsuModels(catalog).map((x) => x.id).join(", ")}.`);
    return m;
  }

  function resolutionFor(m, body) {
    const v = modelView(catalog, m);
    const r = f.text(body, "resolution") ?? v.defaultResolution;
    if (!v.resolutions.includes(r)) throw f.invalid("resolution", `${m.label} makes ${v.resolutions.join(", ")}.`);
    return r;
  }

  function orientationFor(m, body) {
    if (!m.jutsu.orientations) return null;
    const o = f.text(body, "orientation") ?? "video";
    if (!m.jutsu.orientations.includes(o)) throw f.invalid("orientation", "Facing is video or image.");
    return o;
  }

  /** The clip and picture this request names, with the clip's probed length. */
  function inputs(body) {
    const clipFile = fileIn("video", body.video, "video");
    const clip = { ...clipFile, ...clipInfo(clipFile.path), bytes: clipFile.bytes };
    const image = imageIn(body.image);
    return { clip, image };
  }

  function price(m, resolution, durationS) {
    const route = routesFor(catalog, m).find((r) => r.usable) ?? m.routes[0];
    const field = route.pricing?.resolutionField ?? "resolution";
    return estimateUsd(route, { durationS, resolution, input: { [field]: resolution } });
  }

  function clipsView() {
    const dir = join(runDir(JUTSU_RUN), FOLDERS.video);
    if (!existsSync(dir)) return [];
    // How many takes used each clip: the remix count, from the job records.
    const uses = new Map();
    for (const j of context().store.list()) {
      const name = j.jutsu?.video;
      if (j.run === JUTSU_RUN && name) uses.set(name, (uses.get(name) ?? 0) + 1);
    }
    return readdirSync(dir)
      .filter((n) => /\.(mp4|mov)$/i.test(n))
      .map((name) => {
        const path = join(dir, name);
        const info = clipInfo(path);
        return {
          name,
          media: mediaUrl(path),
          durationS: info.durationS ?? null,
          width: info.width ?? null,
          height: info.height ?? null,
          bytes: statSync(path).size,
          addedAt: info.addedAt ?? statSync(path).mtime.toISOString(),
          uses: uses.get(name) ?? 0,
        };
      })
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  function castView() {
    const dir = join(runDir(JUTSU_RUN), FOLDERS.image);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((n) => /\.(png|jpe?g|webp)$/i.test(n))
      .map((name) => ({ name, media: mediaUrl(join(dir, name)), addedAt: statSync(join(dir, name)).mtime.toISOString() }))
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  router.get("/api/jutsu", () => ({
    run: JUTSU_RUN,
    models: jutsuModels(catalog).map((m) => modelView(catalog, m)),
    clips: clipsView(),
    cast: castView(),
    library: libraryView(),
    generations: generationsView(),
  }));

  /** Upload a reference video (?kind=video) or a character picture (?kind=image). A video is probed for its length. */
  router.post(
    "/api/jutsu/upload",
    async ({ req, query }) => {
      const kind = query.get("kind") === "video" ? "video" : "image";
      const name = label(query.get("name") ?? req.headers["x-file-name"]);
      const limit = MAX_BYTES[kind];
      const dir = join(runDir(JUTSU_RUN), FOLDERS[kind]);
      mkdirSync(dir, { recursive: true });
      const root = realpathSync(dir);
      const part = join(root, `upload-${process.pid}-${Date.now()}.part`);
      let size;
      try {
        size = await saveBody(req, part, limit);
        if (size > limit) throw new HttpError(413, `${name} is over ${Math.round(limit / 1e6)} MB; nothing was saved.`);
        if (size === 0) throw f.invalid("file", `${name} is empty.`);
      } catch (err) {
        rmSync(part, { force: true });
        throw err;
      }
      let info;
      try {
        info = checkLocalFile(part, { roots: [root], kinds: [kind] });
      } catch (err) {
        rmSync(part, { force: true });
        err.message = err.message.replaceAll(part, name);
        err.field = "file";
        throw err;
      }
      const file = freeName(root, safeStem(name) || kind, info.ext);
      const path = join(root, file);
      renameSync(part, path);
      if (kind === "image") return { kind, name: file, media: mediaUrl(path) };
      let probed = {};
      try {
        const p = await probe(path);
        probed = { durationS: p.durationS, width: p.width, height: p.height };
      } catch {
        // ffprobe missing or the file unreadable: kept, and the page says it cannot be priced.
      }
      writeFileSync(sidecar(path), `${JSON.stringify({ ...probed, addedAt: new Date().toISOString() }, null, 2)}\n`);
      return { kind, name: file, media: mediaUrl(path), durationS: probed.durationS ?? null, width: probed.width ?? null, height: probed.height ?? null, bytes: size };
    },
    { raw: true },
  );

  /** Remove an uploaded clip or picture. Takes already made from it are kept. */
  router.delete("/api/jutsu/files/:kind/:name", ({ params }) => {
    const kind = params.kind === "video" ? "video" : params.kind === "image" ? "image" : null;
    if (!kind) throw new HttpError(404, "Files are video or image.");
    const file = fileIn(kind, params.name, "name");
    rmSync(file.path, { force: true });
    rmSync(sidecar(file.path), { force: true });
    return { removed: file.name };
  });

  /** Free: the price for this clip at this resolution on each model, and what would refuse it. */
  router.post("/api/jutsu/estimate", ({ body = {} }) => {
    const m = model(body);
    const resolution = resolutionFor(m, body);
    const orientation = orientationFor(m, body);
    const clipFile = body.video ? fileIn("video", body.video, "video") : null;
    const clip = clipFile ? { ...clipFile, ...clipInfo(clipFile.path), bytes: clipFile.bytes } : null;
    const image = body.image ? imageIn(body.image) : null;
    const problems = problemsFor(m, { clip, image, orientation });
    const est = clip?.durationS ? price(m, resolution, billedS(clip.durationS)) : null;
    const usd = est?.usd ?? null;
    const { store, limits } = context();
    const pos = dailyPosition(store, limits);
    const budgetUsd = catalog.defaultBudgetUsd?.jutsu ?? null;
    const perJobUsd = limits?.perJobUsd ?? null;
    return {
      usd,
      basis: est?.basis ?? null,
      durationS: clip?.durationS ?? null,
      problems,
      usable: modelView(catalog, m).usable,
      budgetUsd,
      perJobUsd,
      availableTodayUsd: pos.availableUsd,
      withinBudget: usd != null && (budgetUsd == null || usd <= budgetUsd),
      withinPerJob: usd != null && (perJobUsd == null || usd <= perJobUsd),
      withinDailyCap: usd != null && usd <= pos.availableUsd,
    };
  });

  /** Spends: one job through core, under the per-job limit and the daily cap. */
  router.post("/api/jutsu/generate", async ({ body = {} }) => {
    const m = model(body);
    const resolution = resolutionFor(m, body);
    const orientation = orientationFor(m, body);
    const { clip, image } = inputs(body);
    const problems = problemsFor(m, { clip, image, orientation });
    if (problems.length) throw f.invalid("video", `Refused before submitting, nothing was spent. ${problems.join(" ")}`);
    const kling = m.id.startsWith("kling");
    const prompt = kling ? (f.text(body, "prompt") ?? "") : "";
    if (prompt.length > 2500) throw f.invalid("prompt", "The prompt is over 2,500 characters.");
    const durationS = billedS(clip.durationS);
    const values = kling
      ? { ...(prompt ? { prompt } : {}), mode: resolution, character_orientation: orientation, _durationS: durationS }
      : { resolution, _durationS: durationS };
    const a = {
      run: JUTSU_RUN,
      prompt,
      refs: [
        { source: image.source, role: "identity" },
        { source: clip.source, role: "motion" },
      ],
      params: {},
      budget_usd: f.amount(body, "budget_usd"),
      provider: null,
    };
    const jutsu = { mode: m.jutsu.mode, video: clip.name, image: image.name };
    return submit("jutsu", m, a, values, {
      promptFile: "jutsu-prompt.txt",
      inputsFile: "jutsu-inputs.json",
      artifactBase: m.jutsu.mode === "swap" ? "swap" : "motion",
      useI2v: () => false,
      extra: { jutsu, durationS, resolution, orientation },
      jobRecord: { jutsu, durationS },
    });
  });
}
