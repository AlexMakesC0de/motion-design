// A Library character's voice from its popup: settings and a recording are
// free, a sample is priced and spends, and keeping it is a separate step.
import { KEY, RUNS, tmp, req, generateStubs } from "./helpers.mjs";
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { createApp } = await import("../server/app.mjs");
const { openJobs } = await import("../../cli/core/jobs.mjs");
const { openLibrary } = await import("../../cli/core/assets.mjs");

const { calls, deps } = generateStubs();
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.alloc(32)]);
const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt "), Buffer.alloc(52)]);
const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(61)]);
const LIMITS = process.env.KIE_LIMITS_FILE;
// No ffmpeg in these tests: every recording "lasts" what this says.
let length = 12.5;
const voice = { probe: async () => ({ durationS: length }), convert: async () => { throw new Error("no conversion in tests"); } };

// A fake VoiceStudio: its voice list, and speech that records what it was asked.
const spoken = [];
let studioOpen = true;
const studioFetch = async (url, init = {}) => {
  if (!studioOpen) throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
  if (url.endsWith("/v1/audio/voices")) return Response.json({ voices: [{ id: "p-1", name: "Gravel" }] });
  spoken.push(JSON.parse(init.body));
  return new Response(wav, { headers: { "content-type": "audio/wav" } });
};
const voiceStudio = { env: { SHARD_VOICESTUDIO_URL: "http://127.0.0.1:3900" }, fetch: studioFetch };

let app, port;
before(async () => {
  app = createApp({ key: KEY, deps: { ...deps, voice, voiceStudio }, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
  const photo = join(tmp, "vera.png");
  writeFileSync(photo, png);
  openLibrary().save({ name: "vera", kind: "character", description: "Vera.", images: [{ path: photo, role: "sheet" }] }, { roots: [tmp] });
  openLibrary().save({ name: "crate", kind: "product", description: "A crate.", images: [{ path: photo, role: "sheet" }] }, { roots: [tmp] });
});
after(() => app.closeAll());
beforeEach(() => rmSync(LIMITS, { force: true }));

const post = (path, body) => req(port, path, { method: "POST", body });
const patch = (path, body) => req(port, path, { method: "PATCH", body });
const sendFile = (path, buf, name) => req(port, path, { method: "POST", body: buf, headers: { "content-type": "application/octet-stream", "x-file-name": name } });

describe("a character's voice in the studio", () => {
  test("the preset voices and a character's built-in script and price come with it; a product has none", async () => {
    const v = await req(port, "/api/voices");
    assert.equal(v.json.voices.length, 67);
    const r = await req(port, "/api/library/vera");
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.voice, null);
    assert.match(r.json.voiceSettings.script, /\[whispers\]/);
    assert.ok(r.json.voicePrice.usd > 0 && r.json.voicePrice.usd < 0.1);
    assert.equal((await req(port, "/api/library/crate")).json.voiceSettings, null);
  });

  test("settings are saved field by field and checked", async () => {
    let r = await patch("/api/library/vera/voice-settings", { voiceId: "James", accent: "Australian" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.voiceSettings.voiceName, "James");
    r = await patch("/api/library/vera/voice-settings", { tone: "warm" });
    assert.equal(r.json.voiceSettings.accent, "Australian");
    assert.equal(r.json.voiceSettings.tone, "warm");
    r = await patch("/api/library/vera/voice-settings", { voiceId: "nobody" });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.field, "voiceId");
  });

  test("a recording becomes the voice; a picture or a 40-second one is refused and nothing is kept", async () => {
    let r = await sendFile("/api/library/vera/voice", wav, "me.wav");
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.voice.origin, "recording");
    assert.equal(r.json.voice.durationS, 12.5);
    assert.match(r.json.voice.url, /voice\.wav/);
    r = await sendFile("/api/library/vera/voice", png, "face.png");
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /face\.png is not an audio file/);
    length = 40;
    r = await sendFile("/api/library/vera/voice", wav, "long.wav");
    assert.match(r.json.error.message, /2 to 30 seconds; this one is 40\.0s/);
    length = 12.5;
    assert.equal(openLibrary().get("vera").voice.durationS, 12.5);
  });

  test("make-voice spends one ElevenLabs v3 job with the script and the picked voice", async () => {
    const before = calls.create.length;
    const r = await post("/api/library/vera/make-voice", {});
    assert.equal(r.status, 200, r.text);
    const made = calls.create.slice(before);
    assert.equal(made.length, 1);
    assert.equal(made[0].model, "elevenlabs/text-to-dialogue-v3");
    assert.equal(made[0].input.dialogue[0].voice, "EkK5I93UQWFDigLMpZcX");
    assert.match(made[0].input.dialogue[0].text, /\[whispers\]/);
    assert.equal(r.json.voiceJob.run, "voices");
    assert.equal(r.json.voiceJobKept, false);
  });

  test("keeping a finished sample makes it the voice; another character's job is refused", async () => {
    const store = openJobs(join(RUNS, ".jobs"));
    mkdirSync(join(RUNS, "voices"), { recursive: true });
    const finished = (voiceFor, file) => {
      const path = join(RUNS, "voices", file);
      writeFileSync(path, mp3);
      let job = store.create({ run: "voices", capability: "audio", model: "elevenlabs-v3", provider: "kie", estimateUsd: 0.03, input: { dialogue: [] }, stage: "voice", voiceFor, voiceId: "EkK5I93UQWFDigLMpZcX", script: "Hi." });
      for (const s of ["sending", "submitted"]) job = store.transition(job.id, s, s === "submitted" ? { upstreamTaskId: `t-${file}` } : {});
      return store.transition(job.id, "succeeded", { artifacts: [path], actualUsd: 0.03, costSource: "task-record" });
    };
    const job = finished("vera", "voice-vera.mp3");
    const r = await post("/api/library/vera/adopt-voice", { job: job.id });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.voice.origin, "elevenlabs");
    assert.equal(r.json.voice.voiceName, "James");
    const other = finished("someone", "voice-other.mp3");
    assert.equal((await post("/api/library/vera/adopt-voice", { job: other.id })).json.error.field, "job");
  });

  test("the voice can be taken away", async () => {
    const r = await req(port, "/api/library/vera/voice", { method: "DELETE" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.voice, null);
  });
});

describe("a voice from VoiceStudio, free and on this computer", () => {
  test("the panel learns whether VoiceStudio is open and which voices it has", async () => {
    let r = await req(port, "/api/voicestudio");
    assert.deepEqual(r.json.voices, [{ id: "p-1", name: "Gravel" }]);
    assert.equal(r.json.running, true);
    studioOpen = false;
    r = await req(port, "/api/voicestudio");
    assert.equal(r.json.running, false);
    studioOpen = true;
  });

  test("a take is made without spending, offered to keep, and kept as the voice", async () => {
    const before = calls.create.length;
    let r = await req(port, "/api/library/vera");
    assert.doesNotMatch(r.json.voiceStudioScript, /\[whispers\]/);
    r = await post("/api/library/vera/voicestudio", { voice: "p-1", script: "[excited] Big boat!" });
    assert.equal(r.status, 200, r.text);
    assert.equal(calls.create.length, before, "nothing was sent to kie");
    assert.deepEqual(spoken.at(-1), { model: "tts-1", input: "Big boat!", voice: "p-1", response_format: "wav" });
    const take = r.json.voiceStudioTake;
    assert.match(take.id, /^voicestudio-vera-/);
    assert.equal(take.durationS, 12.5);
    assert.match(take.url, /voices\/voicestudio-vera-.*\.wav$/);

    assert.equal((await post("/api/library/crate/keep-voicestudio", { take: take.id })).json.error.field, "take");
    r = await post("/api/library/vera/keep-voicestudio", { take: take.id });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.voice.origin, "voicestudio");
    assert.equal(r.json.voice.voiceName, "p-1");
    assert.equal(r.json.voiceStudioTake, null);
  });

  test("with VoiceStudio closed, making a take says how to open it", async () => {
    studioOpen = false;
    const r = await post("/api/library/vera/voicestudio", {});
    studioOpen = true;
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /VoiceStudio isn't open/);
  });
});
