// VoiceStudio (github.com/debpalash/VoiceStudio): a free voice app that runs on
// the user's own computer. Shard only talks to it over HTTP on this machine;
// it never sends a script elsewhere and never holds a VoiceStudio key.
// API read from its docs on 2026-11-19: POST /v1/audio/speech
// { model: "tts-1", input, voice } returns WAV; GET /v1/audio/voices lists the
// saved voices. Loopback requests need no key (docs/api-auth.md).
import { usage, provider } from "../lib/errors.mjs";

export const VOICESTUDIO_URL = "http://127.0.0.1:3900";
export const VOICESTUDIO_DOWNLOAD = "https://github.com/debpalash/VoiceStudio#platforms";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
/** A 400-character script on a Mac without a GPU can take minutes; the first one also downloads a model. */
export const SPEAK_TIMEOUT_MS = 10 * 60_000;

/** The address to use: SHARD_VOICESTUDIO_URL or the default, and only ever this computer. */
export function voiceStudioUrl(env = process.env) {
  const raw = env.SHARD_VOICESTUDIO_URL?.trim() || VOICESTUDIO_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw usage(`SHARD_VOICESTUDIO_URL "${raw}" is not an address.`);
  }
  if (!/^https?:$/.test(url.protocol) || !LOOPBACK.has(url.hostname)) {
    throw usage(`SHARD_VOICESTUDIO_URL must point at this computer (127.0.0.1, localhost or [::1]), got "${raw}". Shard sends scripts only to a VoiceStudio running here.`);
  }
  return url.origin;
}

const notOpen = (url) => usage(`VoiceStudio isn't open at ${url}. Open the VoiceStudio app on this computer and try again. Get it free at ${VOICESTUDIO_DOWNLOAD}.`);
const refused = (e) => e?.cause?.code === "ECONNREFUSED" || e?.code === "ECONNREFUSED" || /ECONNREFUSED|fetch failed/i.test(String(e?.cause?.message ?? e?.message ?? ""));

/** VoiceStudio's voice list, whatever its exact shape: an array, or { voices | data: [...] }, of names or objects. */
export function readVoices(body) {
  const list = Array.isArray(body) ? body : (body?.voices ?? body?.data ?? body?.profiles ?? []);
  const out = [];
  for (const v of Array.isArray(list) ? list : []) {
    if (typeof v === "string") out.push({ id: v, name: v });
    else if (v && typeof v === "object") {
      // OpenAI names (alloy, ash, …) are all the engine's default voice under another name.
      if (v.type === "openai_alias") continue;
      const id = v.id ?? v.profile_id ?? v.voice_id ?? v.name;
      if (id == null) continue;
      out.push({ id: String(id), name: String(v.name ?? v.display_name ?? id) });
    }
  }
  return out;
}

/** Is VoiceStudio running here, and which voices has the user made in it? Never throws for "not running". */
export async function voiceStudioStatus({ env = process.env, fetch = globalThis.fetch, timeoutMs = 3000 } = {}) {
  const url = voiceStudioUrl(env);
  try {
    const r = await fetch(`${url}/v1/audio/voices`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return { running: true, url, voices: [], error: `VoiceStudio answered ${r.status} for its voice list.` };
    return { running: true, url, voices: readVoices(await r.json().catch(() => null)) };
  } catch (e) {
    return { running: false, url, voices: [], error: refused(e) || e?.name === "TimeoutError" ? null : String(e?.message ?? e) };
  }
}

/**
 * VoiceStudio reads aloud any bracket tag its engine doesn't know, so an
 * ElevenLabs script loses its mood tags here. [pause ...] works on every
 * engine and [laughter] on the default one; [laughs] becomes [laughter].
 */
export function plainForVoiceStudio(script) {
  return String(script ?? "")
    .replace(/\[laughs?\]/gi, "[laughter]")
    .replace(/\[(?!pause\b|laughter\])[^\]\n]*\]\s*/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** Free: VoiceStudio reads `text` in `voice` (a saved voice's id or name, or "default"). Returns the WAV bytes. */
export async function speak({ text, voice = "default", env = process.env, fetch = globalThis.fetch, timeoutMs = SPEAK_TIMEOUT_MS, signal } = {}) {
  const url = voiceStudioUrl(env);
  const input = plainForVoiceStudio(text);
  if (!input) throw usage("Write the voice script first.", { field: "script" });
  let r;
  try {
    r = await fetch(`${url}/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "tts-1", input, voice: voice || "default", response_format: "wav" }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e?.name === "TimeoutError") throw provider(`VoiceStudio took longer than ${Math.round(timeoutMs / 60_000)} minutes. The first voice downloads a model (about 2.3 GB); try again once that is done.`);
    if (e?.name === "AbortError") throw usage("Stopped.");
    if (refused(e)) throw notOpen(url);
    throw provider(`Could not reach VoiceStudio: ${e?.message ?? e}`);
  }
  if (!r.ok) {
    const said = (await r.text().catch(() => "")).slice(0, 400);
    let detail = said;
    try {
      const j = JSON.parse(said);
      detail = typeof j.detail === "string" ? j.detail : (j.error?.message ?? j.message ?? said);
    } catch {}
    const field = r.status === 404 || /voice|profile/i.test(detail) ? { field: "voice" } : {};
    throw provider(`VoiceStudio said ${r.status}${detail ? `: ${detail}` : ""}`, field);
  }
  const bytes = Buffer.from(await r.arrayBuffer());
  if (bytes.length < 44 || bytes.subarray(0, 4).toString("latin1") !== "RIFF") throw provider("VoiceStudio answered, but not with WAV audio.");
  return bytes;
}
