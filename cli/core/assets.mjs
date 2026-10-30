import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { LIBRARY_DIR } from "../lib/run.mjs";
import { unknown } from "../lib/errors.mjs";
import { checkLocalFile } from "./inputs.mjs";

export const KINDS = ["character", "product", "location", "style"];
export const ASSET_NAME = /^[a-z0-9][a-z0-9-]{0,80}$/;
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
        return { name: r.name, kind: r.kind, description: r.description, imageCount: r.images.length, updatedAt: r.updatedAt };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The record, with each image's absolute `path` added (not stored). */
  function get(name) {
    if (!existsSync(recordPath(name))) {
      throw unknown(`No asset "${name}". Saved assets: ${list().map((a) => a.name).join(", ") || "none"}.`);
    }
    const r = read(name);
    return { ...r, images: r.images.map((im) => ({ ...im, path: join(assetDir(name), im.file) })) };
  }

  function save({ name, kind, description, images, replace = false }, { roots = null } = {}) {
    const target = assetDir(name);
    if (!KINDS.includes(kind)) throw unknown(`kind must be one of ${KINDS.join(", ")}, got "${kind}".`);
    if (!description?.trim()) throw unknown("An asset needs a description; it is reused word for word in prompts.");
    if (!Array.isArray(images) || images.length < 1 || images.length > 4) throw unknown("An asset holds 1 to 4 images.");

    // Check and read every source before touching the library, so a bad
    // image leaves nothing half-written, and replacing an asset with one of
    // its own images still works after the old files move to .history.
    const sources = images.map((p) => {
      const info = checkLocalFile(p, { roots, kinds: ["image"] });
      return { info, bytes: readFileSync(info.path) };
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
    const stored = sources.map(({ info, bytes }, i) => {
      const file = `${i + 1}${info.ext}`;
      writeFileSync(join(target, file), bytes);
      return {
        n: i + 1,
        file,
        sha256: sha256(bytes),
        bytes: info.bytes,
        width: info.width,
        height: info.height,
        mime: info.mime,
        upload: null,
      };
    });
    return write({ name, kind, description: description.trim(), images: stored, createdAt, updatedAt: at, usedIn });
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
    if (prior && prior.sha256 === image.sha256 && now() - Date.parse(prior.at) < REUSE_UPLOAD_MS) return prior.url;

    const { url } = await upload(join(assetDir(name), image.file), { mime: image.mime });
    image.upload = { url, at: now().toISOString(), sha256: image.sha256 };
    write(record);
    return url;
  }

  function recordUse(name, run) {
    const record = read(name);
    record.usedIn ??= [];
    if (!record.usedIn.includes(run)) {
      record.usedIn.push(run);
      write(record);
    }
  }

  return { dir, list, get, save, uploadUrl, recordUse };
}
