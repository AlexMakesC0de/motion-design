// A Library character's voice sample: made with ElevenLabs v3 on kie and kept
// with Keep voice, or recorded by the user and saved as it is. Shared by the
// studio, the MCP server and the CLI, so all three make a voice the same way.
import { resolveModel } from "../lib/models.mjs";
import { estimateUsd } from "../lib/budget.mjs";
import { usage, unknown } from "../lib/errors.mjs";
import { submitJob } from "../core/generate.mjs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { RUNS_DIR } from "../lib/run.mjs";
import { VOICE_MODEL, voiceInput, voiceScript, cleanProfile, prepareVoice, findVoice } from "../core/voice.mjs";
import { speak, plainForVoiceStudio } from "../core/voicestudio.mjs";
import { CARD_MAX_S } from "../lib/ffmpeg.mjs";
import { sheetOf } from "../core/assets.mjs";
import { expandRefs } from "../core/refs.mjs";
import { estimate } from "../core/views.mjs";

/** The name on a character's voice card: the one set for it, else its display name, else its Library name in words. */
export function cardName(asset) {
  const set = asset.voiceProfile?.cardName?.trim();
  if (set) return set;
  if (asset.persona?.displayName?.trim()) return asset.persona.displayName.trim();
  return asset.name.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * How long a voice's card will be before it is made: the voice in whole
 * seconds, at most 15. A longer voice is cut at a pause, so its card may come
 * out a little shorter; once made, the card's own seconds count.
 */
export const cardSeconds = (durationS) => Math.min(CARD_MAX_S, Math.max(2, Math.ceil(durationS - 1e-9)));

/**
 * The character's voice card, made (free, with ffmpeg) when it has none or the
 * voice or the name changed since, or it was made longer than cards are now;
 * `again` makes it anew regardless.
 * `card` is lib/ffmpeg.mjs makeVoiceCard.
 * Returns the asset as it now stands.
 */
export async function ensureVoiceCard(library, name, { card, again = false } = {}) {
  const asset = library.get(name);
  if (!asset.voice) throw unknown(`"${asset.name}" has no voice. Add one in its Voice panel first.`);
  const wanted = cardName(asset);
  const c = asset.voice.card;
  if (!again && c && c.voiceSha256 === asset.voice.sha256 && c.wanted === wanted && c.seconds <= CARD_MAX_S && existsSync(c.path)) return asset;
  if (!card) throw unknown(`${asset.name}'s voice card needs ffmpeg to be made. Install ffmpeg, or send the voice as a file instead.`);
  const dir = mkdtempSync(join(tmpdir(), "shard-card-out-"));
  try {
    const made = await card({ audio: asset.voice.path, out: join(dir, "voice-card.mp4"), text: wanted, durationS: asset.voice.durationS });
    library.setVoiceCard(asset.name, { path: made.path, seconds: made.seconds, voiceS: made.voiceS, faded: Boolean(made.faded), text: made.text, wanted });
    return library.get(asset.name);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** After a new voice: make its card too, but never let a missing ffmpeg undo the voice itself. */
async function withCard(library, asset, card) {
  if (!card) return asset;
  try {
    return await ensureVoiceCard(library, asset.name, { card });
  } catch {
    return library.get(asset.name);
  }
}

/** Voice samples are filed under this run, like the influencers' sheets. */
export const VOICE_RUN = "voices";

const voiceRoute = (catalog) => {
  const model = resolveModel(catalog, VOICE_MODEL, "audio");
  return { model, route: model.routes.find((r) => r.provider === "kie") };
};

/** The settings a sample would be made from: the saved profile, with the script filled in when empty. */
export function voiceSettings(asset) {
  const profile = asset.voiceProfile ?? {};
  const script = profile.script ?? voiceScript({ name: asset.persona?.displayName, language: profile.language ?? "en" });
  return { ...profile, script: script ?? "" };
}

/** What a sample of `script` costs, without asking anyone. */
export function voicePrice(catalog, script) {
  const { route } = voiceRoute(catalog);
  const { usd, basis } = estimateUsd(route, { input: { dialogue: [{ text: script ?? "" }] } });
  return { usd, basis, chars: (script ?? "").length };
}

/** Save the voice settings (language, accent, age, tone, energy, voiceId, script). */
export function saveVoiceProfile(library, name, profile) {
  return library.setVoiceProfile(name, cleanProfile(profile));
}

/**
 * Spends kie credits: one ElevenLabs v3 job reading the character's script in
 * the chosen preset voice. Keep it with adoptVoice once it has finished.
 */
export async function makeVoice(catalog, assetName, ctx) {
  const { store, limits, library, deps, via = "cli", onEvent = () => {}, dryRun = false } = ctx;
  const asset = library.get(assetName);
  if (asset.kind !== "character") throw unknown(`Only characters have a voice; "${asset.name}" is a ${asset.kind}.`);
  const settings = voiceSettings(asset);
  if (!settings.voiceId) throw unknown(`Pick a voice for ${asset.name} first.`, { field: "voiceId" });
  const values = voiceInput(settings.script, settings.voiceId, settings.language);
  const { model } = voiceRoute(catalog);
  const sub = await submitJob(
    catalog,
    {
      capability: "audio",
      model,
      run: VOICE_RUN,
      artifactBase: `voice-${asset.name}`,
      dryRun,
      values,
      record: { stage: "voice", voiceFor: asset.name, voiceId: settings.voiceId, script: settings.script, via },
    },
    { store, limits, deps, onEvent },
  );
  return { ...sub, asset: asset.name, model: model.id, voiceId: settings.voiceId };
}

/** Keep a finished voice sample as the character's voice; the voice it replaces moves to history. */
export async function adoptVoice(library, store, jobId, { probe, convert, card }) {
  const job = store.get(jobId);
  if (job.stage !== "voice" || !job.voiceFor) throw usage(`Job ${jobId} is not a voice sample.`);
  if (job.state !== "succeeded" || !job.artifacts?.length) throw usage(`The voice job ${jobId} has not finished (${job.state}).`);
  const voice = await prepareVoice(job.artifacts[0], { probe, convert });
  const asset = library.setVoice(job.voiceFor, {
    path: voice.path,
    durationS: voice.durationS,
    origin: "elevenlabs",
    voiceId: job.voiceId ?? null,
    voiceName: job.voiceId ? findVoice(job.voiceId).name : null,
    script: job.script ?? null,
    job: jobId,
  });
  return withCard(library, asset, card);
}

/** Save the user's own recording as the character's voice. Free. */
export async function saveRecordedVoice(library, name, path, { roots = null, probe, convert, card, script = null }) {
  const voice = await prepareVoice(path, { roots, probe, convert });
  return withCard(library, library.setVoice(name, { path: voice.path, durationS: voice.durationS, origin: "recording", script }), card);
}

// --- VoiceStudio: free, on this computer ---------------------------------
// A take is a WAV in runs/voices plus a small JSON beside it saying whose it
// is, which VoiceStudio voice read it and what it read. Keeping it copies the
// WAV into the Library like any recording.

const voicesDir = () => join(RUNS_DIR, VOICE_RUN);
const TAKE_ID = /^voicestudio-([a-z0-9][a-z0-9-]{0,80})-(\d{8}T\d{6}Z)$/;
const takeFiles = (id) => ({ wav: join(voicesDir(), `${id}.wav`), json: join(voicesDir(), `${id}.json`) });

/** The script VoiceStudio reads: the saved one without ElevenLabs tags, or the built-in plain script. */
export function localScript(asset) {
  const profile = asset.voiceProfile ?? {};
  if (profile.script) return plainForVoiceStudio(profile.script);
  return voiceScript({ name: asset.persona?.displayName, language: profile.language ?? "en", style: "plain" }) ?? "";
}

function readTake(id) {
  if (!TAKE_ID.test(id ?? "")) throw usage(`"${id}" is not a VoiceStudio take.`, { field: "take" });
  const { wav, json } = takeFiles(id);
  if (!existsSync(wav) || !existsSync(json)) throw usage(`No VoiceStudio take "${id}" in runs/voices.`, { field: "take" });
  return { id, path: wav, ...JSON.parse(readFileSync(json, "utf8")) };
}

/**
 * Free: VoiceStudio, running on this computer, reads the character's script in
 * one of the user's VoiceStudio voices. The take waits in runs/voices until
 * keepLocalVoice; `script` overrides the saved one for this take only.
 */
export async function makeLocalVoice(library, assetName, { voice = "default", script = null, probe, env, fetch, signal, now = () => new Date() } = {}) {
  const asset = library.get(assetName);
  if (asset.kind !== "character") throw unknown(`Only characters have a voice; "${asset.name}" is a ${asset.kind}.`);
  const text = script?.trim() ? plainForVoiceStudio(script) : localScript(asset);
  if (!text) throw unknown(`Write a script for ${asset.name} first; only English has a built-in one.`, { field: "script" });
  const bytes = await speak({ text, voice, env, fetch, signal });
  const stamp = now().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const id = `voicestudio-${asset.name}-${stamp}`;
  mkdirSync(voicesDir(), { recursive: true });
  const { wav, json } = takeFiles(id);
  writeFileSync(wav, bytes);
  const durationS = probe ? Math.round((await probe(wav)).durationS * 100) / 100 : null;
  const take = { voiceFor: asset.name, voice: voice || "default", script: text, durationS, madeAt: now().toISOString() };
  writeFileSync(json, JSON.stringify(take, null, 2) + "\n");
  return { id, path: wav, ...take };
}

/** The newest VoiceStudio take for this character that is not its voice yet, or null. */
export function latestLocalTake(asset) {
  if (!existsSync(voicesDir())) return null;
  const ids = readdirSync(voicesDir())
    .filter((f) => f.endsWith(".json") && f.startsWith(`voicestudio-${asset.name}-`))
    .map((f) => basename(f, ".json"))
    .filter((id) => TAKE_ID.exec(id)?.[1] === asset.name)
    .sort();
  const id = ids.at(-1);
  if (!id || asset.voice?.take === id) return null;
  try {
    return readTake(id);
  } catch {
    return null;
  }
}

/** Keep a VoiceStudio take as the character's voice. Free; the old voice moves to history. */
export async function keepLocalVoice(library, takeId, { probe, convert, card }) {
  const take = readTake(takeId);
  const voice = await prepareVoice(take.path, { roots: [voicesDir()], probe, convert });
  const asset = library.setVoice(take.voiceFor, {
    path: voice.path,
    durationS: voice.durationS,
    origin: "voicestudio",
    voiceName: take.voice,
    script: take.script,
    take: take.id,
  });
  return withCard(library, asset, card);
}

// --- The talking clip -----------------------------------------------------
// One short Seedance clip of the character saying their voice card's words,
// lip-synced to the card, which is its only sound. Scenes then send this clip
// instead of the black card: one reference that carries the face, the voice
// and how the person reacts together. Joey's Voicesheet and Shotcaller guides
// describe the idea; the wording here is Shard's own.

export const CLIP_MODEL = "seedance-2-5";
export const CLIP_RESOLUTIONS = ["480p", "720p"];
/** Seedance 2.5 makes clips of 4 to 30 seconds; the clip lasts as long as the card. */
const CLIP_MIN_S = 4;
const NO_TEXT = "No on-screen text of any kind, at any point: no captions, subtitles, burned-in dialogue, karaoke text, titles, lower thirds, names, watermarks, logos or timecode.";

/** Why a talking clip cannot be made yet, or [] when it can. */
export function voiceClipProblems(asset) {
  const out = [];
  if (asset.kind !== "character") return [`Only characters have a talking clip; "${asset.name}" is a ${asset.kind}.`];
  if (!sheetOf(asset)) out.push(`${asset.name} has no sheet yet. Make one first; the clip copies the face and outfit from it.`);
  if (!asset.voice) return [...out, `${asset.name} has no voice yet. Add one first.`];
  const card = asset.voice.card;
  const cardS = card?.voiceSha256 === asset.voice.sha256 ? card.seconds : cardSeconds(asset.voice.durationS);
  if (cardS < CLIP_MIN_S) out.push(`The voice card is ${cardS}s; a talking clip needs at least ${CLIP_MIN_S}s. Use a longer voice.`);
  if (!asset.voiceProfile?.cardWords?.trim()) out.push("Write the exact words heard on the voice card first: the clip's lips follow them.");
  return out;
}

/** The prompt for a character's talking clip. `seconds` is the card's length. */
export function voiceClipPrompt(asset, seconds) {
  const words = asset.voiceProfile?.cardWords?.trim() ?? "";
  const manner = [asset.voiceProfile?.tone, asset.voiceProfile?.energy].map((x) => x?.trim()).filter(Boolean).join(", ");
  return [
    "[GOAL]",
    "A talking reference clip: [Image 1] speaks to camera in their own voice, so later scenes know exactly how this person looks, sounds and reacts.",
    "",
    "[REFERENCES]",
    `[Image 1] — character. Preserve the exact face, hair, skin tone and outfit. Do not reproduce the sheet's panels, grey background or layout.`,
    "[Video 1] — the soundtrack: this person's voice on a black screen. It is the only sound in this clip. Never show this black screen or its text.",
    NO_TEXT,
    "",
    "[SCRIPT]",
    `[Image 1] speaks out loud with the voice in [Video 1] for its full ${seconds} seconds, every syllable formed on their lips in time with it. They are the speaker of this recording, never miming along. The words, in order: "${words}"`,
    "Both lips press fully together on every b, p and m sound; open vowels are held open, the jaw working with the phrasing.",
    "",
    "[SCENE]",
    "A plain, evenly lit mid-grey background with no shadows. Nobody else is in the frame.",
    "",
    `[STAGE 1 | 0–${seconds} SECONDS | TALKING]`,
    "Camera: One continuous close-up from just above the head to the collarbones, locked off, a long lens with the background soft. No cuts.",
    `Action: Already drawing a breath at the first frame. [Image 1] speaks with the voice, turning their head slowly about fifteen to twenty degrees to each side of the lens and back, so the face is seen from several angles. Brows, eyes and mouth follow the feeling of each phrase${manner ? `, the way a ${manner} person does` : ""}. Eyes move past the lens, never into it. Nothing ever covers the mouth.`,
    "",
    "[VISUAL STYLE]",
    "Photoreal, real-time 24fps, natural skin texture with pores, no smoothing. Soft light from the front that travels across the brow, cheekbone and jaw as the head turns.",
    "",
    "[AUDIO]",
    "[Video 1] is the only sound: no other voice, no music, no room tone, no sound effects.",
  ].join("\n");
}

const clipRequest = (asset, seconds, resolution) => ({
  model: CLIP_MODEL,
  capability: "video",
  durationS: seconds,
  resolution,
  aspectRatio: "16:9",
  refs: [{ role: "identity" }, { role: "voicecard" }],
  inputS: seconds,
  params: { generate_audio: true, omni_reference_task_type: "reference", ...(resolution === "480p" ? { draft: true } : {}) },
});

/** The clip's seconds: its card's once made for this voice, else what the card will be. */
const clipSeconds = (asset) => {
  const card = asset.voice?.card;
  return card?.voiceSha256 === asset.voice?.sha256 ? card.seconds : cardSeconds(asset.voice?.durationS ?? 0);
};

/** What a talking clip costs at each resolution, without asking anyone. */
export function voiceClipPrices(catalog, asset, { store, limits }) {
  if (!asset.voice) return null;
  const seconds = clipSeconds(asset);
  const out = { seconds };
  for (const resolution of CLIP_RESOLUTIONS) {
    const r = estimate(catalog, clipRequest(asset, seconds, resolution), { store, limits });
    out[resolution] = { usd: r.estimateUsd ?? null, basis: r.basis ?? null };
  }
  return out;
}

/**
 * Spends kie credits: one Seedance 2.5 clip of the character saying their
 * card's words, with the sheet and the card as references. Keep it with
 * adoptVoiceClip once it has finished. `maxUsd` is the price the user agreed.
 */
export async function makeVoiceClip(catalog, assetName, ctx) {
  const { store, limits, library, upload, deps, via = "cli", card, resolution = "720p", maxUsd = null, dryRun = false, onEvent = () => {} } = ctx;
  if (!CLIP_RESOLUTIONS.includes(resolution)) throw unknown(`A talking clip is ${CLIP_RESOLUTIONS.join(" or ")}.`, { field: "resolution" });
  let asset = library.get(assetName);
  const problems = voiceClipProblems(asset);
  if (problems.length) throw unknown(`Refused before submitting, nothing was spent. ${problems.join(" ")}`, { problems });
  asset = await ensureVoiceCard(library, asset.name, { card });
  const seconds = asset.voice.card.seconds;
  const prompt = voiceClipPrompt(asset, seconds);
  const sheet = sheetOf(asset);
  const expanded = await expandRefs([{ source: `${asset.name}#${sheet.n}`, role: "identity" }, { source: `${asset.name}@voicecard`, role: "voicecard" }], { catalog, library, upload, dryRun });
  const req = clipRequest(asset, seconds, resolution);
  const model = resolveModel(catalog, CLIP_MODEL, "video");
  const sub = await submitJob(
    catalog,
    {
      capability: "video",
      model,
      run: VOICE_RUN,
      artifactBase: `voiceclip-${asset.name}`,
      budgetUsd: maxUsd,
      only: null,
      dryRun,
      values: { prompt, duration: seconds, aspect_ratio: req.aspectRatio, resolution, refs: expanded.refs, params: req.params, _useI2v: false, _inputS: seconds },
      record: { stage: "voiceclip", voiceFor: asset.name, voiceSha256: asset.voice.sha256, words: asset.voiceProfile.cardWords.trim(), refMapping: expanded.refMapping, assets: expanded.assets, via },
    },
    { store, limits, deps, onEvent },
  );
  return { ...sub, asset: asset.name, seconds, prompt };
}

/** Keep a finished talking clip. Refused when the voice changed since it was made. */
export async function adoptVoiceClip(library, store, jobId, { probe }) {
  const job = store.get(jobId);
  if (job.stage !== "voiceclip" || !job.voiceFor) throw usage(`Job ${jobId} is not a talking clip.`);
  if (job.state !== "succeeded" || !job.artifacts?.length) throw usage(`The talking clip ${jobId} has not finished (${job.state}).`);
  const asset = library.get(job.voiceFor);
  if (asset.voice?.sha256 !== job.voiceSha256) throw usage(`${asset.name}'s voice changed after this clip was made; it would speak in the old voice. Make a new clip.`);
  const info = await probe(job.artifacts[0]);
  return library.setVoiceClip(asset.name, { path: job.artifacts[0], seconds: Math.round(info.durationS ?? 0), width: info.width, height: info.height, words: job.words, job: jobId });
}
