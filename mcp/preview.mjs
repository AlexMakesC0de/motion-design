import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpeg } from "../cli/lib/ffmpeg.mjs";
import { extractFrames } from "../cli/lib/frames.mjs";

const IMAGE = /\.(png|jpe?g|webp)$/i;
const VIDEO = /\.(mp4|mov|webm)$/i;

/** A small JPEG of an image file as MCP image content, or null when ffmpeg cannot make one. */
export async function imagePreview(path, { width = 768 } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "kie-preview-"));
  try {
    const out = join(tmp, "preview.jpg");
    await ffmpeg(["-i", path, "-vf", `scale='min(${width},iw)':-2`, "-frames:v", "1", "-q:v", "4", out]);
    return { type: "image", data: readFileSync(out).toString("base64"), mimeType: "image/jpeg" };
  } catch {
    return null;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The preview for a finished take: the image itself, or the 8-frame contact sheet of a video. */
export async function artifactPreview(path) {
  if (IMAGE.test(path)) return imagePreview(path);
  if (!VIDEO.test(path)) return null;
  try {
    const frames = await extractFrames(path);
    return imagePreview(frames.sheet, { width: 1024 });
  } catch {
    return null;
  }
}
