// Serves run outputs and library images to <video> and <img>. Only two roots,
// real paths only, no hidden segments: the same confinement the MCP tools use.
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { LIBRARY_DIR, RUNS_DIR, isInside } from "../../cli/lib/run.mjs";
import { confinePath } from "../../cli/core/inputs.mjs";
import { HttpError } from "./http.mjs";

const TYPES = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".srt": "text/plain; charset=utf-8",
};

const real = (p) => (existsSync(p) ? realpathSync(p) : p);
const roots = () => ({ runs: real(RUNS_DIR), library: real(LIBRARY_DIR) });

/** The URL for a file inside runs/ or library/, or null for anything else. */
export function mediaUrl(path) {
  if (!path) return null;
  const p = real(path);
  for (const [name, root] of Object.entries(roots())) {
    if (isInside(p, root)) return `/media/${name}/${relative(root, p).split(sep).map(encodeURIComponent).join("/")}`;
  }
  return null;
}

export async function serveMedia(req, res, pathname) {
  const m = pathname.match(/^\/media\/(runs|library)\/(.+)$/);
  if (!m) throw new HttpError(404, "Not found.");
  let rel;
  try {
    rel = decodeURIComponent(m[2]);
  } catch {
    throw new HttpError(400, "Bad path.");
  }
  const root = roots()[m[1]];
  const file = confinePath(join(root, rel), [root]); // code 3 outside the root, through a hidden segment, or missing
  const st = statSync(file);
  if (!st.isFile()) throw new HttpError(404, "Not found.");

  const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = (req.headers.range ?? "").match(/^bytes=(\d*)-(\d*)$/);
  if (!range) {
    res.writeHead(200, { "content-type": type, "content-length": st.size, "accept-ranges": "bytes", "cache-control": "no-cache" });
    return createReadStream(file).pipe(res);
  }
  const start = range[1] === "" ? st.size - Number(range[2]) : Number(range[1]);
  const end = Math.min(range[1] !== "" && range[2] !== "" ? Number(range[2]) : st.size - 1, st.size - 1);
  if (!(start >= 0) || start > end) {
    res.writeHead(416, { "content-range": `bytes */${st.size}` });
    return res.end();
  }
  res.writeHead(206, {
    "content-type": type,
    "content-length": end - start + 1,
    "content-range": `bytes ${start}-${end}/${st.size}`,
    "accept-ranges": "bytes",
    "cache-control": "no-cache",
  });
  return createReadStream(file, { start, end }).pipe(res);
}
