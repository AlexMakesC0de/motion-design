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
import { createWriteStream, existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomBytes } from "node:crypto";
import { basename, isAbsolute, join } from "node:path";
import { LIBRARY_DIR, RUNS_DIR } from "../../../cli/lib/run.mjs";
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

export function assetDetail(name, following) {
  const { library, store } = context();
  const a = library.get(name);
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
    takes: store
      .list()
      .filter((j) => Array.isArray(j.assets) && j.assets.includes(a.name))
      .reverse()
      .map((j) => jobView(j, following)),
  };
}

export function registerLibrary(router, { catalog, maxUploadBytes = MAX_UPLOAD, following } = {}) {
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
    };
  });

  router.get("/api/library/:name", ({ params }) => assetDetail(params.name, following));

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
    return assetDetail(name, following);
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
    return assetDetail(params.name, following);
  });

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
    return assetDetail(params.name, following);
  });
}
