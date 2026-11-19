// A Library character's voice sample: made with ElevenLabs v3 on kie and kept
// with Keep voice, or recorded by the user and saved as it is. Shared by the
// studio, the MCP server and the CLI, so all three make a voice the same way.
import { resolveModel } from "../lib/models.mjs";
import { estimateUsd } from "../lib/budget.mjs";
import { usage, unknown } from "../lib/errors.mjs";
import { submitJob } from "../core/generate.mjs";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { RUNS_DIR } from "../lib/run.mjs";
import { VOICE_MODEL, voiceInput, voiceScript, cleanProfile, prepareVoice, findVoice } from "../core/voice.mjs";
import { speak, plainForVoiceStudio } from "../core/voicestudio.mjs";

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
export async function adoptVoice(library, store, jobId, { probe, convert }) {
  const job = store.get(jobId);
  if (job.stage !== "voice" || !job.voiceFor) throw usage(`Job ${jobId} is not a voice sample.`);
  if (job.state !== "succeeded" || !job.artifacts?.length) throw usage(`The voice job ${jobId} has not finished (${job.state}).`);
  const voice = await prepareVoice(job.artifacts[0], { probe, convert });
  return library.setVoice(job.voiceFor, {
    path: voice.path,
    durationS: voice.durationS,
    origin: "elevenlabs",
    voiceId: job.voiceId ?? null,
    voiceName: job.voiceId ? findVoice(job.voiceId).name : null,
    script: job.script ?? null,
    job: jobId,
  });
}

/** Save the user's own recording as the character's voice. Free. */
export async function saveRecordedVoice(library, name, path, { roots = null, probe, convert, script = null }) {
  const voice = await prepareVoice(path, { roots, probe, convert });
  return library.setVoice(name, { path: voice.path, durationS: voice.durationS, origin: "recording", script });
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
export async function keepLocalVoice(library, takeId, { probe, convert }) {
  const take = readTake(takeId);
  const voice = await prepareVoice(take.path, { roots: [voicesDir()], probe, convert });
  return library.setVoice(take.voiceFor, {
    path: voice.path,
    durationS: voice.durationS,
    origin: "voicestudio",
    voiceName: take.voice,
    script: take.script,
    take: take.id,
  });
}
