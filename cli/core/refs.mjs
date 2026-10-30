import { basename, isAbsolute, join } from "node:path";
import { unknown } from "../lib/errors.mjs";
import { checkHttpsUrl, checkLocalFile } from "./inputs.mjs";

const ASSET_REF = /^([a-z0-9][a-z0-9-]{0,80})(?:#(\d+))?$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SINGLE = new Set(["first_frame", "last_frame"]);
const LABEL = { image: "Image", video: "Video", audio: "Audio" };

const kindFromUrl = (url) =>
  /\.(mp4|mov|webm)(\?|$)/i.test(url) ? "video" : /\.(mp3|wav|m4a|aac|ogg)(\?|$)/i.test(url) ? "audio" : "image";

/**
 * Turn `{ source, role }` references into provider URLs, in order:
 *   zed       every image of asset zed, in stored order
 *   zed#2     image 2 of zed
 *   https://  passed through, never fetched here
 *   a path    checked (and confined to `roots` when set), then uploaded
 * Returns the refs for buildInput plus `refMapping` ("@Image1 = zed#1"),
 * numbered per type in the order the provider will see them.
 * `baseDir` resolves relative local paths (the MCP server passes runs/).
 */
export async function expandRefs(refs, { catalog, library, upload, roots = null, baseDir = null, dryRun = false }) {
  const out = [];
  for (const { source, role } of refs) {
    if (!catalog.roles.includes(role)) {
      throw unknown(`Unknown reference role "${role}". Roles: ${catalog.roles.join(", ")}.`);
    }

    if (SCHEME.test(source ?? "")) {
      const url = checkHttpsUrl(source);
      out.push({ url, role, label: url, kind: kindFromUrl(url) });
      continue;
    }

    const m = (source ?? "").match(ASSET_REF);
    if (m) {
      const asset = library.get(m[1]);
      let images = asset.images;
      if (m[2]) {
        const n = Number(m[2]);
        const image = images.find((im) => im.n === n);
        if (!image) throw unknown(`${asset.name} has images 1-${images.length}; there is no #${n}.`);
        images = [image];
      } else if (SINGLE.has(role) && images.length > 1) {
        throw unknown(
          `${role} takes one image, and asset "${asset.name}" has ${images.length}. ` +
            `Pick one: ${images.map((im) => `${asset.name}#${im.n}`).join(", ")}.`,
        );
      }
      for (const im of images) {
        const url = dryRun ? `pending-upload:${asset.name}#${im.n}` : await library.uploadUrl(asset.name, im.n, { upload });
        out.push({
          url,
          role,
          label: `${asset.name}#${im.n}`,
          kind: "image",
          asset: asset.name,
          file: { mime: im.mime, bytes: im.bytes, width: im.width, height: im.height },
        });
      }
      continue;
    }

    const f = checkLocalFile(baseDir && !isAbsolute(source) ? join(baseDir, source) : source, { roots });
    const url = dryRun ? `pending-upload:${basename(f.path)}` : (await upload(f.path, { mime: f.mime })).url;
    out.push({
      url,
      role,
      label: basename(f.path),
      kind: f.kind,
      file: { mime: f.mime, bytes: f.bytes, width: f.width, height: f.height },
    });
  }

  for (const role of SINGLE) {
    const given = out.filter((r) => r.role === role);
    if (given.length > 1) throw unknown(`${role} takes exactly one image; ${given.length} were given.`);
    if (given[0] && given[0].kind !== "image") throw unknown(`${role} must be an image, got ${given[0].kind}.`);
  }

  const counters = {};
  const refMapping = out.map((r) => {
    counters[r.kind] = (counters[r.kind] ?? 0) + 1;
    return `@${LABEL[r.kind]}${counters[r.kind]} = ${r.label}`;
  });
  return { refs: out, refMapping, assets: [...new Set(out.filter((r) => r.asset).map((r) => r.asset))] };
}
