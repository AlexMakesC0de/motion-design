// A Library character's voice: the script it reads, the preset voices it can be
// made with, and the checks an audio file passes before Seedance gets it.
// No ffmpeg here: callers pass `probe` and `convert` (lib/ffmpeg.mjs), so the
// rules are testable without it.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unknown } from "../lib/errors.mjs";
import { checkLocalFile } from "./inputs.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** What Seedance 2.5 on kie takes as reference audio (docs.kie.ai, read 2026-11-19). */
export const VOICE_LIMITS = { minS: 2, maxS: 30, maxBytes: 15_000_000 };
/** Formats kie accepts as they are. Anything else ffmpeg turns into MP3 first. */
const SENDABLE = new Set(["wav", "mp3", "aac", "ogg"]);
export const VOICE_MODEL = "elevenlabs-v3";
export const PROFILE_FIELDS = ["language", "accent", "age", "tone", "energy"];

let voices = null;
/** kie's ElevenLabs preset voices: { previewUrl, voices: [{ id, name, description, previewUrl }] }. */
export function presetVoices() {
  if (!voices) {
    const raw = JSON.parse(readFileSync(join(HERE, "..", "voices.json"), "utf8"));
    voices = {
      captured: raw.captured,
      voices: raw.voices.map((v) => ({ ...v, previewUrl: raw.previewUrl.replace("{id}", v.id) })),
    };
  }
  return voices;
}

export function findVoice(id) {
  const v = presetVoices().voices.find((x) => x.id === id || x.name.toLowerCase() === String(id ?? "").toLowerCase());
  if (!v) throw unknown(`No preset voice "${id}". List them with kie voice list, or in the studio's Voice panel.`, { field: "voiceId" });
  return v;
}

/**
 * The lines a voice sample reads: every sound of English at least once, across
 * the moods a film asks for, in about 20 seconds. The tags in brackets are
 * ElevenLabs v3 directions; reading it yourself, treat them as stage directions.
 * Only English is built in; other languages need a script written for them.
 */
export function voiceScript({ name, language = "en" } = {}) {
  if (language && !/^en\b/i.test(language)) return null;
  const who = name?.trim() ? `Hi, I'm ${name.trim()}.` : "Hi there.";
  return [
    `${who} Thanks for joining me; this is how I usually sound.`,
    "[excited] Look at that huge orange boat! Isn't it thrilling?",
    "[curious] Would you measure the beige chair with a cheap ruler?",
    "[sarcastic] Oh sure, the zoo's thick fog spoiled our whole July voyage.",
    "[whispers] Shh... the judge is pouring hot soup.",
    "[sad] I heard her first word, and it was goodbye.",
    "[laughs] Ha! Okay, that's genuinely funny.",
  ].join("\n");
}

/** A profile with only the known fields, trimmed; empty strings dropped. */
export function cleanProfile(p = {}) {
  const out = {};
  for (const k of [...PROFILE_FIELDS, "voiceId", "script"]) {
    const v = p[k];
    if (typeof v === "string" && v.trim()) out[k] = k === "script" ? v.replace(/\r\n/g, "\n").trim() : v.trim();
  }
  if (out.voiceId) out.voiceName = findVoice(out.voiceId).name;
  if (out.script && out.script.length > 5000) throw unknown("A voice script is at most 5,000 characters (ElevenLabs' limit).", { field: "script" });
  return out;
}

/** ElevenLabs v3's input for one speaker reading `script`. */
export function voiceInput(script, voiceId, language) {
  if (!script?.trim()) throw unknown("Write or generate the voice script first.", { field: "script" });
  const input = { dialogue: [{ text: script.trim(), voice: findVoice(voiceId).id }] };
  if (language && /^[a-z]{2,3}$/i.test(language)) input.language_code = language.toLowerCase();
  return input;
}

/**
 * Check an audio file as a character's voice. `probe(path)` returns
 * { durationS }; `convert(path)` writes an MP3 and returns its path, for formats
 * kie does not take as they are (a phone's M4A). Returns { path, durationS, type }.
 */
export async function prepareVoice(path, { roots = null, probe, convert }) {
  const info = checkLocalFile(path, { roots, kinds: ["audio"] });
  let file = info.path;
  let type = info.type;
  if (!SENDABLE.has(type)) {
    if (!convert) throw unknown(`${type.toUpperCase()} audio needs ffmpeg to become MP3 first. Install ffmpeg, or upload WAV, MP3, AAC or OGG.`);
    file = await convert(file);
    type = "mp3";
  }
  const { durationS } = await probe(file);
  if (!Number.isFinite(durationS)) throw unknown("Could not read how long that recording is.");
  if (durationS < VOICE_LIMITS.minS || durationS > VOICE_LIMITS.maxS + 0.05) {
    throw unknown(
      `A voice recording must be ${VOICE_LIMITS.minS} to ${VOICE_LIMITS.maxS} seconds; this one is ${durationS.toFixed(1)}s. ` +
        (durationS > VOICE_LIMITS.maxS ? "Record a shorter one, or trim it." : "Record a longer one."),
    );
  }
  const checked = checkLocalFile(file, { kinds: ["audio"], maxBytes: { audio: VOICE_LIMITS.maxBytes } });
  return { path: checked.path, durationS: Math.round(durationS * 100) / 100, type, mime: checked.mime };
}
