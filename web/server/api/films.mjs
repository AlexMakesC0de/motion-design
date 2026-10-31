// Films: one card per run folder, one film's files for its page, and the two
// ways files get into a film from the page: music or voice-over uploaded as a
// raw body, and captions pasted as SRT text. The finishing tools are in
// finish.mjs. Core's getRun checks the slug, refuses an unknown run (code 3)
// and lists the folder's files.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { basename, extname, join } from "node:path";
import { listRuns, getRun } from "../../../cli/core/views.mjs";
import { checkLocalFile } from "../../../cli/core/inputs.mjs";
import { RUNS_DIR, isInside, runDir, claimArtifact, landArtifact } from "../../../cli/lib/run.mjs";
import { unknown } from "../../../cli/lib/errors.mjs";
import { parseSrt } from "../../../cli/lib/caption.mjs";
import { board } from "../../../cli/director/board.mjs";
import { loadMenu } from "../../../cli/director/menu.mjs";
import { countedUsd } from "../../../cli/core/jobs.mjs";
import { RATIOS } from "../../../cli/lib/ffmpeg.mjs";
import { TEMPLATES } from "../../../cli/lib/render.mjs";
import { context, jobView } from "../state.mjs";
import { mediaUrl } from "../media.mjs";
import { progressOf } from "../progress.mjs";
import { HttpError } from "../http.mjs";
import { label, saveBody } from "./library.mjs";
import { filmDir } from "./finish.mjs";
import * as f from "./fields.mjs";

/** Music beds run long and are never sent to a provider, so the ceiling is core's largest (video), not its 30 MB audio limit. */
export const MAX_AUDIO_UPLOAD = 200_000_000;

const KINDS = [
  [/\.(mp4|mov|webm)$/i, "video"],
  [/\.(png|jpe?g|webp)$/i, "image"],
  [/\.(mp3|wav|m4a|aac|ogg)$/i, "audio"],
  [/\.srt$/i, "srt"],
];

/** video, image, audio or srt from the name; null for records and anything else. */
export const fileKind = (name) => KINDS.find(([re]) => re.test(name))?.[1] ?? null;

// The studio never names an output, so each finishing tool's default name says what made it.
const n = "(?:-\\d+)?";
const ORIGINS = [
  [new RegExp(`-(?:${Object.keys(RATIOS).map((r) => r.replace(":", "x")).join("|")})\\.mp4$`), "variant"],
  [new RegExp(`^film${n}\\.mp4$`), "film"],
  [new RegExp(`^captioned${n}\\.mp4$`), "captioned"],
  [new RegExp(`^(?:${Object.keys(TEMPLATES).join("|")})${n}\\.(?:mp4|mov)$`), "card"],
];

/** For a video or image: film, captioned, variant, card or take. Null for audio and SRT. */
export function fileOrigin(name, kind) {
  if (kind === "image") return "take";
  if (kind !== "video") return null;
  return ORIGINS.find(([re]) => re.test(name))?.[1] ?? "take";
}

const visible = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith(".") && fileKind(d.name))
    .map((d) => ({ name: d.name, kind: fileKind(d.name), modified: statSync(join(dir, d.name)).mtime.toISOString() }));

/** The newest video in the folder, else the newest image, for the film's card. `files` is visible(dir). */
function pickCover(dir, files) {
  const sorted = [...files].sort((a, b) => b.modified.localeCompare(a.modified));
  const pick = sorted.find((f) => f.kind === "video") ?? sorted.find((f) => f.kind === "image");
  return pick ? { kind: pick.kind, url: mediaUrl(join(dir, pick.name)) } : null;
}

/** The film's cover on its own. Null for a folder core cannot name as a run. */
function cover(slug) {
  let dir;
  try {
    dir = runDir(slug, { create: false });
  } catch {
    return null; // "Old Stuff/" is listed, but is not a run slug the tools accept
  }
  return pickCover(dir, visible(dir));
}

/** The shot order of the film's last assembly (core's assembly.json), for the shots still in the folder. */
function lastOrder(dir, names) {
  let record;
  try {
    record = JSON.parse(readFileSync(join(dir, "assembly.json"), "utf8"));
  } catch {
    return [];
  }
  const real = realpathSync(dir);
  return (record?.shots ?? [])
    .map((s) => String(s?.path ?? ""))
    .filter((p) => names.some((name) => join(real, name) === p))
    .map((p) => p.slice(real.length + 1));
}

export function filmDetail(slug, following) {
  const { store } = context();
  const run = getRun(slug, { store }); // code 3 for a bad slug or an unknown run
  const dir = runDir(slug, { create: false });
  const jobs = store.list().filter((j) => j.run === slug).map((j) => jobView(j, following));
  const byUrl = new Map(jobs.flatMap((j) => j.media.map((u) => [u, j])));
  const sizes = new Map(run.files.map((f) => [f.name, f.bytes]));
  const files = visible(dir)
    .sort((a, b) => a.modified.localeCompare(b.modified) || a.name.localeCompare(b.name))
    .map((f) => {
      const url = mediaUrl(join(dir, f.name));
      return { ...f, origin: fileOrigin(f.name, f.kind), url, bytes: sizes.get(f.name) ?? 0, job: byUrl.get(url) ?? null };
    });
  const videos = files.filter((f) => f.kind === "video").map((f) => f.name);
  return { run: run.run, prompt: run.prompt, files, order: lastOrder(dir, videos) };
}

const r2 = (n) => Math.round(n * 100) / 100;
const OUTPUTS = new Set(["film", "captioned", "variant", "card"]);

/**
 * Where a film is (progress.mjs), from its board, its folder and what its jobs
 * cost. Throws core's code 3 for an unknown run. The films list passes what it
 * read once for every film: `jobs` (this run's jobs) and `assets` (the library).
 */
export function filmProgress(slug, { menu = loadMenu(), jobs, assets } = {}) {
  const dir = runDir(slug, { create: false });
  if (!jobs || !assets || !existsSync(dir)) {
    const { store, library } = context();
    if (!existsSync(dir)) getRun(slug, { store }); // throws the "No run" error with the recent list
    jobs ??= store.list().filter((j) => j.run === slug);
    assets ??= library.list();
  }
  // board() reads jobs only through store.list(), so this run's jobs stand in for the store.
  const b = board({ list: () => jobs }, slug, { assets, menu });
  const files = visible(dir);
  const outputs = files.filter((f) => OUTPUTS.has(fileOrigin(f.name, f.kind))).length;
  const hasFilm = files.some((f) => fileOrigin(f.name, f.kind) === "film");
  const legacy = !b.brief && !b.plan && files.length > 0;
  const spentUsd = r2(jobs.reduce((t, j) => t + countedUsd(j), 0));
  return {
    ...progressOf(b, { outputs, hasFilm, spentUsd, legacy }),
    updatedAt: statSync(dir).mtime.toISOString(),
    cover: pickCover(dir, files),
  };
}

/** The films list: the job store and the library are read once for every card. */
function filmsList(menu) {
  const { store, library } = context();
  const assets = library.list();
  const byRun = new Map();
  for (const j of store.list()) {
    if (!byRun.has(j.run)) byRun.set(j.run, []);
    byRun.get(j.run).push(j);
  }
  return listRuns().map((r) => {
    let progress = null;
    try {
      progress = filmProgress(r.run, { menu, jobs: byRun.get(r.run) ?? [], assets });
    } catch {
      // a folder the tools cannot name as a run, or one whose files do not read
    }
    return { ...r, cover: progress ? progress.cover : cover(r.run), progress };
  });
}

const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
const revealDir = (dir) => {
  const child = spawn(opener, [dir], { detached: true, stdio: "ignore" });
  child.on("error", () => {}); // no opener on this machine: nothing to show, and the server stays up
  child.unref();
};

/**
 * runs/<slug> for Finder: a real folder inside runs/, never a link or a file
 * (refused like the director refuses a linked film, code 3). Unknown is core's "No run".
 */
function revealable(slug) {
  const dir = runDir(slug, { create: false });
  const st = lstatSync(dir, { throwIfNoEntry: false });
  if (!st) getRun(slug, { store: context().store });
  if (st.isSymbolicLink()) throw unknown(`runs/${slug} is a link; the studio only opens a real film folder inside runs/.`);
  if (!st.isDirectory()) throw unknown(`runs/${slug} is not a folder; the studio only opens a real film folder inside runs/.`);
  if (!isInside(realpathSync(dir), realpathSync(RUNS_DIR))) throw unknown(`runs/${slug} is a link; the studio only opens a real film folder inside runs/.`);
  return dir;
}

/** "My Song (final).mp3" -> "my-song-final": a plain file stem, or `fallback`. */
export function plainStem(name, fallback) {
  const stem = basename(name, extname(name))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return stem || fallback;
}

export function registerFilms(router, { following, maxAudioBytes = MAX_AUDIO_UPLOAD, deps = {} } = {}) {
  const menu = loadMenu();
  router.get("/api/films", () => filmsList(menu));
  router.get("/api/films/:slug/progress", ({ params }) => filmProgress(params.slug, { menu }));
  router.post("/api/films/:slug/reveal", ({ params }) => {
    (deps.reveal ?? revealDir)(revealable(params.slug));
    return { revealed: params.slug };
  });
  router.get("/api/films/:slug", ({ params }) => filmDetail(params.slug, following));

  /**
   * Music or voice-over for Assemble, as the raw file body. It is streamed to
   * runs/.incoming/, checked by core as audio, then moved into the film under
   * a plain name from the client's (claimArtifact never replaces a file).
   */
  router.post(
    "/api/films/:slug/audio",
    async ({ params, req }) => {
      const dir = filmDir(params.slug);
      const incoming = join(RUNS_DIR, ".incoming");
      mkdirSync(incoming, { recursive: true });
      const root = realpathSync(incoming);
      const part = join(root, `${randomBytes(16).toString("hex")}.part`);
      const name = label(req.headers["x-file-name"]);
      const drop = () => rmSync(part, { force: true });
      let size;
      try {
        size = await saveBody(req, part, maxAudioBytes);
      } catch (err) {
        drop();
        throw err;
      }
      if (size > maxAudioBytes) {
        drop();
        throw new HttpError(413, `${name} is over ${Math.round(maxAudioBytes / 1e6)} MB; nothing was saved.`);
      }
      if (size === 0) {
        drop();
        throw f.invalid("file", `${name} is empty.`);
      }
      let info;
      try {
        info = checkLocalFile(part, { roots: [root], kinds: ["audio"], maxBytes: { audio: maxAudioBytes } });
      } catch (err) {
        drop();
        err.message = err.message.replaceAll(part, name);
        err.field = "file";
        throw err;
      }
      const { path } = claimArtifact(part, dir, plainStem(name, "audio"), info.ext);
      return { name: basename(path), kind: "audio", url: mediaUrl(path), bytes: info.bytes };
    },
    { raw: true },
  );

  /**
   * Captions arrive as SRT text (pasted, or read from a file by the page): an
   * SRT has no signature to check by content, and core's parser says at once
   * whether its cues read. Saved as captions.srt, or the next free number.
   */
  router.post("/api/films/:slug/srt", async ({ params, body = {} }) => {
    const dir = filmDir(params.slug);
    const text = f.text(body, "text", { required: true });
    const parsed = parseSrt(text);
    if (!parsed.cues.length) {
      throw f.invalid("text", "No readable cues. Each cue is a number, a line like 00:00:01,000 --> 00:00:03,500, then its text, with a blank line between cues.");
    }
    const { path } = await landArtifact(dir, "captions", ".srt", (p) => writeFile(p, text));
    return { name: basename(path), url: mediaUrl(path), cues: parsed.cues.length, problems: parsed.problems, lastEndS: parsed.lastEnd };
  });
}
