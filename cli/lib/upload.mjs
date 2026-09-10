import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname } from "node:path";
import { redact } from "./redact.mjs";
import { getProvider, providerKey } from "./providers.mjs";
import { provider, usage } from "./errors.mjs";

const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
};

const MAX_BYTES = 64 * 1024 * 1024;

/**
 * Turns a local path into a remote URL, which is the ONLY way an asset may
 * reach a generation. SKILL.md and production.md both state that a local path
 * is not a remote attachment; `--ref` enforces it by refusing paths outright,
 * and this is the sanctioned way across.
 */
export async function uploadFile(catalog, path, { providerName = "kie" } = {}) {
  const prov = getProvider(catalog, providerName);
  if (!prov.upload) {
    throw usage(
      `${prov.label} has no file-upload endpoint. Upload to a provider that does ` +
        `(kie) and pass the URL it prints -- a remote URL works with every provider.`,
    );
  }
  const key = providerKey(prov);
  if (!existsSync(path)) throw usage(`No such file: ${path}`);

  const { size } = await stat(path);
  if (size > MAX_BYTES) {
    throw usage(
      `${basename(path)} is ${(size / 1e6).toFixed(1)}MB, over the ${MAX_BYTES / 1e6}MB upload cap.`,
    );
  }

  const ext = extname(path).toLowerCase();
  const mime = MIME[ext];
  if (!mime) {
    throw usage(
      `Unsupported file type "${ext || "(none)"}". Supported: ${Object.keys(MIME).join(", ")}`,
    );
  }

  const url = (prov.upload.host ?? prov.baseUrl) + prov.upload.base64;
  const bytes = await readFile(path);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      base64Data: `data:${mime};base64,${bytes.toString("base64")}`,
      uploadPath: "motion-design",
      fileName: basename(path),
    }),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* keep text for the error */
  }

  if (!res.ok) {
    throw provider(`Upload failed (${res.status}): ${redact(json?.msg ?? text ?? "")}`);
  }

  const fileUrl =
    json?.data?.downloadUrl ??
    json?.data?.fileUrl ??
    json?.data?.url ??
    json?.downloadUrl ??
    json?.url ??
    null;

  if (!fileUrl) {
    throw provider(
      `Upload returned no URL. Response: ${redact((text ?? "").slice(0, 400))}`,
    );
  }
  return { url: fileUrl, bytes: size, mime };
}
