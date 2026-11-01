import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { LIBRARY_DIR } from "../lib/run.mjs";
import { unknown } from "../lib/errors.mjs";
import { checkLocalFile } from "./inputs.mjs";

export const KINDS = ["character", "product", "location", "style"];
export const ASSET_NAME = /^[a-z0-9][a-z0-9-]{0,80}$/;
export const IMAGE_ROLES = ["sheet", "source"];
/** Images saved before roles existed are source photos. */
const roleOf = (im) => (im.role === "sheet" ? "sheet" : "source");
/** The asset's sheet image (the one scenes use), or null. */
export const sheetOf = (record) => record.images.find((im) => roleOf(im) === "sheet") ?? null;

function checkKind(kind) {
  if (!KINDS.includes(kind)) throw unknown(`kind must be one of ${KINDS.join(", ")}, got "${kind}".`);
}
function checkDescription(description) {
  if (!description?.trim()) throw unknown("An asset needs a description; it is reused word for word in prompts.");
}
const cleanKeep = (keep) => (typeof keep === "string" && keep.trim() ? keep.trim() : null);
// kie deletes uploads after 24 hours (docs.kie.ai file-upload quickstart, read
// 2026-10-30). Reusing one for 20 leaves a margin for a long job.
const REUSE_UPLOAD_MS = 20 * 3_600_000;

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * library/<name>/asset.json plus the original images, copied in and never
 * modified. A replaced version moves to .history/<timestamp>/.
 */
export function openLibrary(dir = LIBRARY_DIR, { now = () => new Date() } = {}) {
  const assetDir = (name) => {
    if (!ASSET_NAME.test(name ?? "")) throw unknown(`Asset names are lowercase letters, digits and hyphens, got "${name}".`);
    return join(dir, name);
  };
  const recordPath = (name) => join(assetDir(name), "asset.json");
  const read = (name) => JSON.parse(readFileSync(recordPath(name), "utf8"));
  const write = (record) => {
    const path = recordPath(record.name);
    writeFileSync(`${path}.tmp`, JSON.stringify(record, null, 2) + "\n");
    renameSync(`${path}.tmp`, path);
    return record;
  };

  function list() {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((n) => ASSET_NAME.test(n) && existsSync(join(dir, n, "asset.json")))
      .map((n) => {
        const r = read(n);
        return { name: r.name, kind: r.kind, description: r.description, imageCount: r.images.length, hasSheet: r.images.some((im) => roleOf(im) === "sheet"), updatedAt: r.updatedAt };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The record, with each image's absolute `path` added (not stored). */
  function get(name) {
    if (!existsSync(recordPath(name))) {
      throw unknown(`No asset "${name}". Saved assets: ${list().map((a) => a.name).join(", ") || "none"}.`);
    }
    const r = read(name);
    return { ...r, keep: r.keep ?? null, images: r.images.map((im) => ({ ...im, role: roleOf(im), path: join(assetDir(name), im.file) })) };
  }

  function save({ name, kind, description, keep, images, replace = false }, { roots = null } = {}) {
    const target = assetDir(name);
    checkKind(kind);
    checkDescription(description);
    if (!Array.isArray(images) || images.length < 1 || images.length > 4) throw unknown("An asset holds 1 to 4 images.");
    const wanted = images.map((im) => (typeof im === "string" ? { path: im, role: "source" } : { path: im?.path, role: im?.role ?? "source" }));
    for (const w of wanted) if (!IMAGE_ROLES.includes(w.role)) throw unknown(`An image's role must be sheet or source, got "${w.role}".`);
    if (wanted.filter((w) => w.role === "sheet").length > 1) throw unknown("An asset has at most one sheet.");

    // Check and read every source before touching the library, so a bad
    // image leaves nothing half-written, and replacing an asset with one of
    // its own images still works after the old files move to .history.
    const sources = wanted.map(({ path, role }) => {
      const info = checkLocalFile(path, { roots, kinds: ["image"] });
      return { info, role, bytes: readFileSync(info.path) };
    });

    const exists = existsSync(join(target, "asset.json"));
    if (exists && !replace) {
      throw unknown(`Asset "${name}" already exists. Pass replace (--replace) to replace it; the old version is kept in .history/.`);
    }

    const at = now().toISOString();
    let createdAt = at;
    let usedIn = [];
    if (exists) {
      const prev = read(name);
      createdAt = prev.createdAt;
      usedIn = prev.usedIn ?? [];
      const history = join(target, ".history", at.replace(/[:.]/g, "-"));
      mkdirSync(history, { recursive: true });
      renameSync(join(target, "asset.json"), join(history, "asset.json"));
      for (const im of prev.images) {
        if (existsSync(join(target, im.file))) renameSync(join(target, im.file), join(history, im.file));
      }
    }

    mkdirSync(target, { recursive: true });
    const stored = sources.map(({ info, role, bytes }, i) => {
      const file = `${i + 1}${info.ext}`;
      writeFileSync(join(target, file), bytes);
      return {
        n: i + 1,
        role,
        file,
        sha256: sha256(bytes),
        bytes: info.bytes,
        width: info.width,
        height: info.height,
        mime: info.mime,
        upload: null,
      };
    });
    return write({ name, kind, description: description.trim(), keep: cleanKeep(keep), images: stored, createdAt, updatedAt: at, usedIn });
  }

  /**
   * A provider URL for image n, uploading only when there is no recent upload
   * of these exact bytes. `upload(path, { mime })` returns `{ url }`.
   */
  async function uploadUrl(name, n, { upload }) {
    const record = read(name);
    const image = record.images.find((im) => im.n === n);
    if (!image) throw unknown(`${name} has images 1-${record.images.length}; there is no #${n}.`);
    const prior = image.upload;
    // Uploads are named by a hash of their bytes (lib/upload.mjs); a link without
    // this picture's hash predates that and may hold another picture.
    const named = Boolean(image.sha256) && Boolean(prior?.url?.includes(image.sha256.slice(0, 16)));
    if (prior && named && prior.sha256 === image.sha256 && now() - Date.parse(prior.at) < REUSE_UPLOAD_MS) return prior.url;

    const { url } = await upload(join(assetDir(name), image.file), { mime: image.mime });
    image.upload = { url, at: now().toISOString(), sha256: image.sha256 };
    write(record);
    return url;
  }

  /** Change an asset's kind, description or keep. Images are untouched. */
  function update(name, { kind, description, keep } = {}) {
    if (!existsSync(recordPath(name))) throw unknown(`No asset "${name}".`);
    const record = read(name);
    if (kind !== undefined) {
      checkKind(kind);
      record.kind = kind;
    }
    if (description !== undefined) {
      checkDescription(description);
      record.description = description.trim();
    }
    if (keep !== undefined) record.keep = cleanKeep(keep);
    record.updatedAt = now().toISOString();
    write(record);
    return get(name);
  }

  /**
   * Take an asset out of the Library. Its folder (images, record, .history)
   * moves to .trash/<name>-<UTC stamp>, so moving it back undoes this.
   */
  function remove(name) {
    if (!existsSync(recordPath(name))) throw unknown(`No asset "${name}".`);
    const trash = join(dir, ".trash");
    mkdirSync(trash, { recursive: true });
    const stamp = now().toISOString().replace(/[-:]|\.\d+/g, "");
    let to = `${name}-${stamp}`;
    for (let i = 2; existsSync(join(trash, to)); i++) to = `${name}-${stamp}-${i}`;
    renameSync(assetDir(name), join(trash, to));
    return { name, trashed: `.trash/${to}` };
  }

  function recordUse(name, run) {
    const record = read(name);
    record.usedIn ??= [];
    if (!record.usedIn.includes(run)) {
      record.usedIn.push(run);
      write(record);
    }
  }

  return { dir, list, get, save, update, remove, uploadUrl, recordUse };
}
