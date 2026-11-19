// The asset library: list, one asset with the takes that used it, upload and
// save. Saving is core's openLibrary().save, which checks every image with
// checkLocalFile (type by content, size limit, allowed folders) before
// anything is written.
//
// Uploads arrive as the raw file body, one request per file, so a 30 MB image
// is streamed to disk instead of held in memory as base64. The file lands in
// library/.incoming/ under a name this server picks; the client's file name is
// only ever used as a label in messages. Core then checks it, and a refused
// file is deleted at once.
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash, randomBytes } from "node:crypto";
import { basename, isAbsolute, join } from "node:path";
import { LIBRARY_DIR, LIBRARY_RUN, RUNS_DIR } from "../../../cli/lib/run.mjs";
import { resolveModel, routesFor } from "../../../cli/lib/models.mjs";
import { estimateUsd } from "../../../cli/lib/budget.mjs";
import { uploadFile } from "../../../cli/lib/upload.mjs";
import { makeSheet, adoptSheet, sheetWording } from "../../../cli/director/still.mjs";
import { makeVoice, adoptVoice, saveRecordedVoice, saveVoiceProfile, voiceSettings, voicePrice, localScript, latestLocalTake, makeLocalVoice, keepLocalVoice, cardName, ensureVoiceCard, makeVoiceClip, adoptVoiceClip, voiceClipPrices, voiceClipProblems, CLIP_RESOLUTIONS } from "../../../cli/director/voice-make.mjs";
import { voiceStudioStatus } from "../../../cli/core/voicestudio.mjs";
import { presetVoices } from "../../../cli/core/voice.mjs";
import { voiceTools } from "../../../cli/lib/ffmpeg.mjs";
import { KINDS, sheetOf } from "../../../cli/core/assets.mjs";
import { sheetPrompt } from "../../../cli/core/sheets.mjs";
import { checkLocalFile, MAX_BYTES } from "../../../cli/core/inputs.mjs";
import { HttpError } from "../http.mjs";
import { context, jobView } from "../state.mjs";
import { mediaUrl } from "../media.mjs";
import * as f from "./fields.mjs";

const TOKEN = /^incoming:([0-9a-f]{32}\.(?:png|jpg|webp))$/;
const STALE_MS = 24 * 3_600_000;
/** The library takes images only, so nothing past core's image limit is worth streaming to disk. */
export const MAX_UPLOAD = MAX_BYTES.image;

export const incomingDir = () => {
  const dir = join(LIBRARY_DIR, ".incoming");
  mkdirSync(dir, { recursive: true });
  return realpathSync(dir);
};

/** Drops nobody saved: removed after a day. */
function sweepIncoming(dir, now = Date.now()) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    try {
      if (now - statSync(p).mtimeMs > STALE_MS) rmSync(p, { force: true });
    } catch {
      // gone already
    }
  }
}

/** A label for messages from the client's file name. Never used as a path. */
export function label(header) {
  let name = "";
  try {
    name = decodeURIComponent(String(header ?? ""));
  } catch {
    name = "";
  }
  name = basename(name.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120);
  return name || "The file";
}

/** Stream the request body to `path`, keeping at most `limit` bytes. Returns the full size sent. */
export async function saveBody(req, path, limit) {
  let size = 0;
  const cap = new Transform({
    transform(chunk, _enc, done) {
      size += chunk.length;
      // Past the limit, keep reading (so the client is not cut off mid-write) but stop storing.
      if (size <= limit) done(null, chunk);
      else done();
    },
  });
  await pipeline(req, cap, createWriteStream(path));
  return size;
}

/** "incoming:<file>" → its path in library/.incoming, refused unless it is a real waiting upload. */
function incomingPath(incoming, src, field) {
  const m = src.match(TOKEN);
  if (!m || !existsSync(join(incoming, m[1]))) throw f.invalid(field, `"${src}" is not an upload waiting to be saved. Drop the file again.`);
  return join(incoming, m[1]);
}

/** images: ["incoming:…" | "run/path.png" | { src, role }] → [{ path, role }], plus the uploads to clear after saving. */
function imageList(body, incoming) {
  const v = body?.images ?? [];
  if (!Array.isArray(v)) throw f.invalid("images", "images must be a list.");
  const uploads = [];
  const images = v.map((entry) => {
    const { src, role = "source" } = typeof entry === "string" ? { src: entry } : (entry ?? {});
    if (typeof src !== "string" || !src) throw f.invalid("images", "Each image needs a src: an upload token or a path inside runs/.");
    if (src.startsWith("incoming:")) {
      const path = incomingPath(incoming, src, "images");
      uploads.push(path);
      return { path, role };
    }
    // The MCP save_asset rule: relative means inside runs/.
    return { path: isAbsolute(src) ? src : join(RUNS_DIR, src), role };
  });
  return { images, uploads };
}

const sha = (path) => (path && existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null);

/** What making this item's sheet here costs, or null when its kind has no sheet (a style). */
export function sheetOffer(catalog, asset) {
  if (!catalog) return null;
  let wording;
  try {
    wording = sheetWording(asset);
  } catch {
    return null;
  }
  const model = resolveModel(catalog, wording.model, "image");
  const route = routesFor(catalog, model).find((r) => r.usable) ?? model.routes[0];
  return { model: model.id, usd: estimateUsd(route, {}).usd };
}

/** The newest VoiceStudio take not kept yet, for the page. */
function localTake(a) {
  const t = latestLocalTake(a);
  return t ? { id: t.id, voice: t.voice, durationS: t.durationS ?? null, madeAt: t.madeAt, url: mediaUrl(t.path) } : null;
}

/** A character's voice for the page: the recording, the settings a sample uses, its price and the latest sample job. */
function voiceDetail(a, jobs, following, catalog, { store, limits } = {}) {
  if (a.kind !== "character") return { voice: null, voiceSettings: null, voicePrice: null, voiceJob: null, voiceJobKept: false, voiceStudioScript: null, voiceStudioTake: null, voiceCardName: null, voiceCardWords: null, voiceClip: null };
  const v = a.voice;
  const settings = voiceSettings(a);
  const voiceJob = jobs.filter((j) => j.stage === "voice" && j.voiceFor === a.name).at(-1) ?? null;
  return {
    voice: v
      ? {
          durationS: v.durationS,
          origin: v.origin,
          voiceId: v.voiceId ?? null,
          voiceName: v.voiceName ?? null,
          script: v.script ?? null,
          savedAt: v.savedAt,
          url: mediaUrl(v.path),
          card: v.card && v.card.voiceSha256 === v.sha256 ? { url: mediaUrl(v.card.path), seconds: v.card.seconds, text: v.card.text } : null,
          clip: v.clip && v.clip.voiceSha256 === v.sha256 ? { url: mediaUrl(v.clip.path), seconds: v.clip.seconds, words: v.clip.words ?? "" } : null,
        }
      : null,
    voiceCardName: cardName(a),
    voiceSettings: settings,
    voicePrice: catalog ? voicePrice(catalog, settings.script) : null,
    voiceJob: voiceJob ? jobView(voiceJob, following) : null,
    voiceJobKept: Boolean(v?.job && voiceJob && v.job === voiceJob.id),
    voiceStudioScript: localScript(a),
    voiceStudioTake: localTake(a),
    voiceCardWords: a.voiceProfile?.cardWords ?? "",
    voiceClip: v ? clipOffer(a, jobs, following, catalog, { store, limits }) : null,
  };
}

/** The talking clip step: what stops it, what it costs, and the latest clip made for this voice. */
function clipOffer(a, jobs, following, catalog, { store, limits }) {
  const job = jobs.filter((j) => j.stage === "voiceclip" && j.voiceFor === a.name && j.voiceSha256 === a.voice.sha256).at(-1) ?? null;
  return {
    problems: voiceClipProblems(a),
    prices: catalog && store && limits ? voiceClipPrices(catalog, a, { store, limits }) : null,
    job: job ? jobView(job, following) : null,
    kept: Boolean(job && a.voice.clip?.job === job.id),
  };
}

export function assetDetail(name, following, catalog = null) {
  const { library, store } = context();
  const a = library.get(name);
  const jobs = store.list();
  // The latest sheet made for this item, from any page (here, AI Influencers, the CLI).
  const sheetJob = jobs.filter((j) => j.stage === "sheet" && j.sheetFor === a.name).at(-1) ?? null;
  const sheet = sheetOf(a);
  return {
    name: a.name,
    kind: a.kind,
    description: a.description,
    keep: a.keep,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    images: a.images.map((im) => ({ n: im.n, role: im.role, file: im.file, width: im.width ?? null, height: im.height ?? null, bytes: im.bytes, mime: im.mime ?? null, url: mediaUrl(im.path) })),
    // Runs come from the asset record; takes from job records, which keep the
    // assets each job's refs used (the CLI, MCP and this server all record them).
    usedIn: a.usedIn ?? [],
    makeSheet: sheetOffer(catalog, a),
    sheetJob: sheetJob ? jobView(sheetJob, following) : null,
    // Its picture is the sheet in the Library already: nothing new to keep.
    sheetJobKept: Boolean(sheet?.sha256 && sheetJob?.artifacts?.[0] && sha(sheetJob.artifacts[0]) === sheet.sha256),
    ...voiceDetail(a, jobs, following, catalog, { store, limits: context().limits }),
    takes: jobs
      .filter((j) => Array.isArray(j.assets) && j.assets.includes(a.name))
      .reverse()
      .map((j) => jobView(j, following)),
  };
}

export function registerLibrary(router, { catalog, deps = {}, follower = null, maxUploadBytes = MAX_UPLOAD, following } = {}) {
  const upload = deps.upload ?? ((path, opts) => uploadFile(catalog, path, opts));
  const detail = (name) => assetDetail(name, following, catalog);
  router.get("/api/vocab", () => ({ kinds: KINDS, roles: catalog.roles }));

  router.get("/api/library", () => {
    const { library } = context();
    return library.list().map((s) => {
      const a = library.get(s.name);
      return { ...s, keep: a.keep ?? "", cover: mediaUrl((sheetOf(a) ?? a.images[0])?.path), usedIn: a.usedIn ?? [] };
    });
  });

  router.get("/api/library/sheet-prompt", ({ query }) => {
    const photos = Number(query.get("photos") ?? 0);
    return {
      prompt: sheetPrompt({
        kind: query.get("kind") ?? "",
        description: query.get("description") ?? "",
        outfit: query.get("outfit") ?? "",
        view: query.get("view") ?? "",
        photos: Number.isInteger(photos) && photos > 0 ? photos : 0,
      }),
      // What making it here would cost, for a new item not saved yet.
      makeSheet: sheetOffer(catalog, { name: "new", kind: query.get("kind") ?? "character", description: "x" }),
    };
  });

  router.get("/api/library/:name", ({ params }) => detail(params.name));

  router.post(
    "/api/library/incoming",
    async ({ req }) => {
      const dir = incomingDir();
      sweepIncoming(dir);
      const id = randomBytes(16).toString("hex");
      const part = join(dir, `${id}.part`);
      const name = label(req.headers["x-file-name"]);
      let size;
      try {
        size = await saveBody(req, part, maxUploadBytes);
      } catch (err) {
        rmSync(part, { force: true });
        throw err;
      }
      if (size > maxUploadBytes) {
        rmSync(part, { force: true });
        throw new HttpError(413, `${name} is over ${Math.round(maxUploadBytes / 1e6)} MB; nothing was saved.`);
      }
      if (size === 0) {
        rmSync(part, { force: true });
        throw f.invalid("file", `${name} is empty.`);
      }
      let info;
      try {
        // The library holds images only; core decides what is one, and how big it may be.
        info = checkLocalFile(part, { roots: [dir], kinds: ["image"] });
      } catch (err) {
        rmSync(part, { force: true });
        err.message = err.message.replaceAll(part, name);
        err.field = "file";
        throw err;
      }
      const file = `${id}${info.ext}`;
      renameSync(part, join(dir, file));
      return { token: `incoming:${file}`, name, kind: info.kind, mime: info.mime, bytes: info.bytes, width: info.width, height: info.height };
    },
    { raw: true },
  );

  router.post("/api/library", ({ body = {} }) => {
    const name = f.text(body, "name", { required: true });
    const kind = f.text(body, "kind", { required: true });
    const description = f.text(body, "description", { required: true });
    const keep = f.text(body, "keep");
    const replace = f.flag(body, "replace");
    const { library, roots } = context();
    const incoming = incomingDir();
    const { images, uploads } = imageList(body, incoming);
    // incoming first: it sits inside library/ under a hidden name, which the library root would refuse.
    library.save({ name, kind, description, keep, images, replace }, { roots: [incoming, ...roots] });
    for (const p of uploads) rmSync(p, { force: true });
    return detail(name);
  });

  router.patch("/api/library/:name", ({ params, body = {} }) => {
    const { library } = context();
    const changes = {};
    for (const field of ["kind", "description", "keep"]) {
      const v = body[field];
      if (v === undefined) continue;
      if (typeof v !== "string") throw f.invalid(field, `${field} must be text.`);
      changes[field] = v;
    }
    library.update(params.name, changes);
    return detail(params.name);
  });

  /** Out of the Library: the folder moves to library/.trash/, so it can be moved back. */
  router.delete("/api/library/:name", ({ params }) => context().library.remove(params.name));

  router.post("/api/library/:name/sheet", ({ params, body = {} }) => {
    const src = f.text(body, "image", { required: true });
    const { library, roots } = context();
    const incoming = incomingDir();
    const path = incomingPath(incoming, src, "image");
    const current = library.get(params.name);
    const sources = current.images.filter((im) => im.role === "source").map((im) => ({ path: im.path, role: "source" }));
    library.save(
      { name: current.name, kind: current.kind, description: current.description, keep: current.keep, images: [{ path, role: "sheet" }, ...sources], replace: true },
      { roots: [incoming, ...roots] },
    );
    rmSync(path, { force: true });
    return detail(params.name);
  });

  /** Spends: make this item's sheet here, from its own photos and description. Keeping it is a separate, free step. */
  router.post("/api/library/:name/make-sheet", async ({ params, body = {} }) => {
    const outfit = f.text(body, "outfit") ?? "";
    const { library, store, limits, roots } = context();
    const r = await makeSheet(catalog, LIBRARY_RUN, params.name, { store, limits, library, roots, upload, deps: deps.generate, via: "studio", outfit });
    follower?.follow(r.job.id);
    return detail(params.name);
  });

  // A character's voice. Settings and recordings are free; a sample spends.
  const tools = deps.voice ?? voiceTools;
  router.get("/api/voices", () => presetVoices());

  router.patch("/api/library/:name/voice-settings", async ({ params, body = {} }) => {
    const { library } = context();
    const current = library.get(params.name).voiceProfile ?? {};
    const changes = {};
    for (const field of ["language", "accent", "age", "tone", "energy", "voiceId", "script", "cardName", "cardWords"]) {
      const v = body[field];
      if (v === undefined) continue;
      if (v !== null && typeof v !== "string") throw f.invalid(field, `${field} must be text.`);
      changes[field] = v ?? "";
    }
    saveVoiceProfile(library, params.name, { ...current, ...changes });
    // A new name on the card: make the card again now, so the panel shows it (free; skipped without ffmpeg).
    if ("cardName" in changes && library.get(params.name).voice && tools.card) await ensureVoiceCard(library, params.name, { card: tools.card }).catch(() => {});
    return detail(params.name);
  });

  /** Free: the user's own recording, streamed in like a picture, checked, and saved as the voice. */
  router.post(
    "/api/library/:name/voice",
    async ({ req, params }) => {
      const { library } = context();
      library.get(params.name);
      const dir = incomingDir();
      sweepIncoming(dir);
      const part = join(dir, `${randomBytes(16).toString("hex")}.part`);
      const name = label(req.headers["x-file-name"]);
      try {
        const size = await saveBody(req, part, MAX_BYTES.audio);
        if (size > MAX_BYTES.audio) throw new HttpError(413, `${name} is over ${Math.round(MAX_BYTES.audio / 1e6)} MB; nothing was saved.`);
        if (size === 0) throw f.invalid("file", `${name} is empty.`);
        const script = library.get(params.name).voiceProfile?.script ?? null;
        await saveRecordedVoice(library, params.name, part, { roots: [dir], ...tools, script });
      } catch (err) {
        if (typeof err.message === "string") err.message = err.message.replaceAll(part, name);
        err.field ??= "file";
        throw err;
      } finally {
        rmSync(part, { force: true });
      }
      return detail(params.name);
    },
    { raw: true },
  );

  router.delete("/api/library/:name/voice", ({ params }) => {
    context().library.removeVoice(params.name);
    return detail(params.name);
  });

  /** Spends: a sample of the script in the chosen preset voice. Keeping it is a separate, free step. */
  router.post("/api/library/:name/make-voice", async ({ params }) => {
    const { library, store, limits } = context();
    const r = await makeVoice(catalog, params.name, { store, limits, library, deps: deps.generate, via: "studio" });
    follower?.follow(r.job.id);
    return detail(params.name);
  });

  router.post("/api/library/:name/adopt-voice", async ({ params, body = {} }) => {
    const jobId = f.text(body, "job", { required: true });
    const { library, store } = context();
    let job;
    try {
      job = store.get(jobId);
    } catch {
      throw f.invalid("job", `No job ${jobId}.`);
    }
    if (job.stage !== "voice" || job.voiceFor !== params.name) throw f.invalid("job", `${jobId} is not ${params.name}'s voice sample.`);
    if (job.state !== "succeeded" || !job.artifacts?.length) throw f.invalid("job", "That voice sample has not finished.");
    await adoptVoice(library, store, jobId, tools);
    return detail(params.name);
  });

  /**
   * Spends: the talking clip, a short Seedance clip of the character saying
   * their card's words. `maxUsd` is the price the button showed; a higher
   * estimate is refused before anything is spent.
   */
  router.post("/api/library/:name/make-voice-clip", async ({ params, body = {} }) => {
    const { library, store, limits } = context();
    const resolution = f.text(body, "resolution") || "720p";
    if (!CLIP_RESOLUTIONS.includes(resolution)) throw f.invalid("resolution", `A talking clip is ${CLIP_RESOLUTIONS.join(" or ")}.`);
    const maxUsd = body.maxUsd;
    if (typeof maxUsd !== "number" || !(maxUsd > 0)) throw f.invalid("maxUsd", "Send the price you agreed to, as maxUsd.");
    const r = await makeVoiceClip(catalog, params.name, { store, limits, library, upload, deps: deps.generate, via: "studio", card: tools.card, resolution, maxUsd });
    follower?.follow(r.job.id);
    return detail(params.name);
  });

  router.post("/api/library/:name/adopt-voice-clip", async ({ params, body = {} }) => {
    const jobId = f.text(body, "job", { required: true });
    const { library, store } = context();
    let job;
    try {
      job = store.get(jobId);
    } catch {
      throw f.invalid("job", `No job ${jobId}.`);
    }
    if (job.stage !== "voiceclip" || job.voiceFor !== params.name) throw f.invalid("job", `${jobId} is not ${params.name}'s talking clip.`);
    await adoptVoiceClip(library, store, jobId, tools);
    return detail(params.name);
  });

  // VoiceStudio, a free voice app on this computer. Shard calls it only on loopback.
  const studioVoice = deps.voiceStudio ?? {};
  router.get("/api/voicestudio", () => voiceStudioStatus({ env: studioVoice.env, fetch: studioVoice.fetch }));

  /** Free: VoiceStudio reads the script in one of the user's VoiceStudio voices. The take waits to be kept. */
  router.post("/api/library/:name/voicestudio", async ({ params, body = {} }) => {
    const { library } = context();
    const voice = f.text(body, "voice") || "default";
    const script = typeof body.script === "string" ? body.script : null;
    await makeLocalVoice(library, params.name, { voice, script, probe: tools.probe, env: studioVoice.env, fetch: studioVoice.fetch });
    return detail(params.name);
  });

  router.post("/api/library/:name/keep-voicestudio", async ({ params, body = {} }) => {
    const take = f.text(body, "take", { required: true });
    if (!take.startsWith(`voicestudio-${params.name}-`)) throw f.invalid("take", `${take} is not ${params.name}'s VoiceStudio take.`);
    await keepLocalVoice(context().library, take, tools);
    return detail(params.name);
  });

  /** Free: a finished sheet becomes the item's sheet; the old one goes to its history. */
  router.post("/api/library/:name/adopt", ({ params, body = {} }) => {
    const jobId = f.text(body, "job", { required: true });
    const { library, store } = context();
    let job;
    try {
      job = store.get(jobId);
    } catch {
      throw f.invalid("job", `No job ${jobId}.`);
    }
    if (job.stage !== "sheet" || job.sheetFor !== params.name) throw f.invalid("job", `${jobId} is not ${params.name}'s sheet.`);
    if (job.state !== "succeeded" || !job.artifacts?.length) throw f.invalid("job", "That sheet has not finished.");
    adoptSheet(library, store, jobId);
    return detail(params.name);
  });
}
