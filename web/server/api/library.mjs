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
import { KINDS } from "../../../cli/core/assets.mjs";
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

export function assetDetail(name, following) {
  const { library, store } = context();
  const a = library.get(name);
  return {
    name: a.name,
    kind: a.kind,
    description: a.description,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    images: a.images.map((im) => ({ n: im.n, file: im.file, width: im.width ?? null, height: im.height ?? null, bytes: im.bytes, mime: im.mime ?? null, url: mediaUrl(im.path) })),
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
      return { ...s, cover: mediaUrl(a.images[0]?.path), usedIn: a.usedIn ?? [] };
    });
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
    const images = f.strings(body, "images");
    const replace = f.flag(body, "replace");
    const { library, roots } = context();
    const incoming = incomingDir();
    const uploads = [];
    const paths = images.map((src) => {
      if (src.startsWith("incoming:")) {
        const m = src.match(TOKEN);
        if (!m || !existsSync(join(incoming, m[1]))) throw f.invalid("images", `"${src}" is not an upload waiting to be saved. Drop the file again.`);
        uploads.push(join(incoming, m[1]));
        return join(incoming, m[1]);
      }
      // The MCP save_asset rule: relative means inside runs/.
      return isAbsolute(src) ? src : join(RUNS_DIR, src);
    });
    // incoming first: it sits inside library/ under a hidden name, which the library root would refuse.
    library.save({ name, kind, description, images: paths, replace }, { roots: [incoming, ...roots] });
    for (const p of uploads) rmSync(p, { force: true });
    return assetDetail(name, following);
  });
}
