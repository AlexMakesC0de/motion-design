// Films: one card per run folder, and one film's files for its page. Reads
// only; the finishing tools are in finish.mjs. Core's getRun checks the slug,
// refuses an unknown run (code 3) and lists the folder's files.
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { listRuns, getRun } from "../../../cli/core/views.mjs";
import { runDir } from "../../../cli/lib/run.mjs";
import { RATIOS } from "../../../cli/lib/ffmpeg.mjs";
import { TEMPLATES } from "../../../cli/lib/render.mjs";
import { context, jobView } from "../state.mjs";
import { mediaUrl } from "../media.mjs";

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

/** The newest video in the folder, else the newest image, for the film's card. Null for a folder core cannot name as a run. */
function cover(slug) {
  let dir;
  try {
    dir = runDir(slug, { create: false });
  } catch {
    return null; // "Old Stuff/" is listed, but is not a run slug the tools accept
  }
  const files = visible(dir).sort((a, b) => b.modified.localeCompare(a.modified));
  const pick = files.find((f) => f.kind === "video") ?? files.find((f) => f.kind === "image");
  return pick ? { kind: pick.kind, url: mediaUrl(join(dir, pick.name)) } : null;
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

export function registerFilms(router, { following } = {}) {
  router.get("/api/films", () => listRuns().map((r) => ({ ...r, cover: cover(r.run) })));
  router.get("/api/films/:slug", ({ params }) => filmDetail(params.slug, following));
}
