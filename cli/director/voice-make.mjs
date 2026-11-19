// A Library character's voice sample: made with ElevenLabs v3 on kie and kept
// with Keep voice, or recorded by the user and saved as it is. Shared by the
// studio, the MCP server and the CLI, so all three make a voice the same way.
import { resolveModel } from "../lib/models.mjs";
import { estimateUsd } from "../lib/budget.mjs";
import { usage, unknown } from "../lib/errors.mjs";
import { submitJob } from "../core/generate.mjs";
import { VOICE_MODEL, voiceInput, voiceScript, cleanProfile, prepareVoice, findVoice } from "../core/voice.mjs";

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
