import { closeSync, existsSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { LIBRARY_DIR, RUNS_DIR, isInside } from "../lib/run.mjs";
import { unknown } from "../lib/errors.mjs";
import { limitsPath } from "./spend.mjs";

export const MAX_BYTES = { image: 30_000_000, video: 200_000_000, audio: 30_000_000 };
const FORMATS = { image: ["PNG", "JPEG", "WebP"], video: ["MP4", "MOV"], audio: ["WAV", "MP3", "AAC", "OGG"] };

/** "an image", "a video or audio": the kinds a refusal names, with their article. */
function kindPhrase(kinds) {
  const [first, ...rest] = kinds;
  const names = rest.length ? `${[first, ...rest.slice(0, -1)].join(", ")} or ${rest.at(-1)}` : first;
  return `${/^[aeiou]/.test(first) ? "an" : "a"} ${names}`;
}

/** What a file is, from its first bytes. Null when it is none of the accepted types. */
export function sniff(buf) {
  const ascii = (a, b) => buf.toString("latin1", a, b);
  const t = (kind, type, mime, ext) => ({ kind, type, mime, ext });
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return t("image", "png", "image/png", ".png");
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return t("image", "jpeg", "image/jpeg", ".jpg");
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return t("image", "webp", "image/webp", ".webp");
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return t("audio", "wav", "audio/wav", ".wav");
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand.startsWith("M4A")) return t("audio", "m4a", "audio/mp4", ".m4a");
    if (brand === "qt  ") return t("video", "mov", "video/quicktime", ".mov");
    return t("video", "mp4", "video/mp4", ".mp4");
  }
  if (ascii(0, 4) === "OggS") return t("audio", "ogg", "audio/ogg", ".ogg");
  if (ascii(0, 3) === "ID3") return t("audio", "mp3", "audio/mpeg", ".mp3");
  if (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return t("audio", "aac", "audio/aac", ".aac");
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0 && (buf[1] & 0x06) !== 0) return t("audio", "mp3", "audio/mpeg", ".mp3");
  return null;
}

/** Width and height from an image header. Null when the header does not say. */
export function imageSize(buf, type) {
  if (type === "png" && buf.length >= 24) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (type === "webp" && buf.length >= 30) {
    const chunk = buf.toString("latin1", 12, 16);
    if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  if (type === "jpeg") {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isFrame) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

/** runs/, library/ and any folders the user listed under allowRoots, as real paths. */
export function allowedRoots(limits) {
  return [RUNS_DIR, LIBRARY_DIR, ...(limits.allowRoots ?? [])]
    .filter((p) => existsSync(p))
    .map((p) => realpathSync(p));
}

/**
 * The real path of `path` (symlinks followed), refused unless it sits inside
 * one of `roots` with no hidden segment on the way. For every file an MCP
 * client names, media or not: a subtitle file or a shot list leaves the
 * machine as surely as an image once it is burned into a video and uploaded.
 */
export function confinePath(path, roots) {
  let real;
  try {
    real = realpathSync(resolve(path));
  } catch {
    throw unknown(`No such file: ${path}`);
  }
  const root = roots.find((r) => isInside(real, r));
  if (!root) {
    throw unknown(
      `${path} is outside the folders files may be read from. Allowed: ${roots.join(", ")}. ` +
        `To allow another folder, the user adds it under "allowRoots" in ${limitsPath()}.`,
    );
  }
  const hidden = relative(root, real).split(sep).find((s) => s.startsWith("."));
  if (hidden) throw unknown(`${path} is or sits in a hidden folder ("${hidden}"); such files are never read.`);
  return real;
}

const IMAGE_PATH = /\.(png|jpe?g|webp|gif|svg)$/i;
// A prop name that holds a picture or address, in any template (logo, image, src, brand.logo, thumbnailUrl ...).
const IMAGE_KEY = /image|img|logo|src|icon|photo|picture|poster|avatar|thumb|background|url|href|uri|path|file/i;
// A scheme with something after the colon: "ftp://host/x", "blob:https://h/1". "NEW:" or "Note: read this" is text.
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\S/i;
const REMOTE =
  "render props may only name local files in the allowed folders; remote URLs would be fetched from this machine.";

/**
 * Whether the headless browser could turn `text` into a request to somewhere
 * else. Browsers drop tabs and newlines inside a URL and leading control
 * characters and spaces, read a backslash as a slash, and treat `//host` as
 * "same scheme, other host", so the text is normalised that way first.
 *
 * No template says which props are images (core does not know the templates),
 * so: a protocol-relative start is remote in any prop; a URL scheme is remote
 * in a prop named like an image or address, and in any prop whose value is a
 * single word with no spaces ("ftp://host/x"); data: is inline and never
 * fetched. Ordinary copy ("Breaking: the launch is on", "NEW:", "4:30 pm",
 * "// a comment") has a space after the colon, or no scheme, and passes.
 */
function isRemote(text, key) {
  const probe = text.replace(/[\t\n\r]/g, "").replace(/^[\x00-\x20]+/, "");
  if (/^[\\/]{2}\S/.test(probe.replace(/\\/g, "/"))) return true;
  if (!URL_SCHEME.test(probe) || /^data:/i.test(probe)) return false;
  return IMAGE_KEY.test(key) || !/\s/.test(text.trim());
}

/**
 * Render template props, confined like any other file a client names. The
 * renderer turns every image path in props into a file:// URL for a headless
 * browser, so each such path must sit in an allowed root (relative means
 * inside runs/), and file: or http(s) URLs are refused outright: a remote URL
 * would be fetched from this machine, and so would a protocol-relative one
 * (isRemote). `key` is the name of the prop the value sits under, for arrays and
 * nested objects too. Returns the props with real paths.
 */
export function confineProps(value, roots, key = "") {
  if (typeof value === "string") {
    if (/^file:/i.test(value)) {
      throw unknown(`props may not contain file: URLs ("${value}"); name a file inside runs/ or library/ instead.`);
    }
    if (/^\s*https?:/i.test(value) || isRemote(value, key)) throw unknown(REMOTE);
    if (!IMAGE_PATH.test(value) || /^data:/i.test(value)) return value;
    return confinePath(isAbsolute(value) ? value : join(RUNS_DIR, value), roots);
  }
  if (Array.isArray(value)) return value.map((v) => confineProps(v, roots, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, confineProps(v, roots, k)]));
  }
  return value;
}

/**
 * Everything a local file must pass before it may be sent to a provider.
 * `roots` is set when an MCP client is asking: the file's real path (symlinks
 * followed) must then sit inside one of them, with no hidden segment on the
 * way. A human at the CLI passes no roots; the shell's approval prompt is the
 * guard there.
 */
export function checkLocalFile(path, { roots = null, kinds = ["image", "video", "audio"], maxBytes = MAX_BYTES } = {}) {
  let real;
  if (roots) {
    real = confinePath(path, roots);
  } else {
    try {
      real = realpathSync(resolve(path));
    } catch {
      throw unknown(`No such file: ${path}`);
    }
  }
  const stat = statSync(real);
  if (!stat.isFile()) throw unknown(`${path} is not a file.`);

  const head = Buffer.alloc(64);
  const fd = openSync(real, "r");
  try {
    readSync(fd, head, 0, 64, 0);
  } finally {
    closeSync(fd);
  }
  const type = sniff(head);
  if (!type || !kinds.includes(type.kind)) {
    const accepted = kinds.flatMap((k) => FORMATS[k] ?? []).join(", ");
    throw unknown(`${path} is not ${kindPhrase(kinds)} file (checked by its content, not its name). Accepted: ${accepted}.`);
  }
  const limit = maxBytes[type.kind] ?? MAX_BYTES[type.kind];
  if (stat.size > limit) {
    throw unknown(`${path} is ${(stat.size / 1e6).toFixed(1)}MB, over the ${(limit / 1e6).toFixed(1)}MB limit for ${type.kind}.`);
  }

  const info = { path: real, ...type, bytes: stat.size, width: null, height: null };
  if (type.kind === "image") Object.assign(info, imageSize(readFileSync(real), type.type) ?? {});
  return info;
}

/** https only. The URL is handed to the provider, never fetched from this machine. */
export function checkHttpsUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw unknown(`"${url}" is not a URL.`);
  }
  if (parsed.protocol !== "https:") throw unknown(`Only https:// URLs are accepted, got "${url}".`);
  return parsed.href;
}
