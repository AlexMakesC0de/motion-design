// VoiceStudio, a free voice app on the user's computer: Shard only talks to it
// on loopback, strips the tags it would read aloud, and keeps a take like a
// recording. A fake VoiceStudio on a local port stands in for the real one.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { png } from "./fixtures/images.mjs";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "kie-voicestudio-")));
process.env.KIE_RUNS_DIR = join(dir, "runs");
const { openLibrary } = await import("../cli/core/assets.mjs");
const { voiceScript } = await import("../cli/core/voice.mjs");
const { voiceStudioUrl, voiceStudioStatus, readVoices, plainForVoiceStudio, speak } = await import("../cli/core/voicestudio.mjs");
const { makeLocalVoice, keepLocalVoice, latestLocalTake, localScript } = await import("../cli/director/voice-make.mjs");

const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt "), Buffer.alloc(52)]);
const sheet = join(dir, "sheet.png");
writeFileSync(sheet, png(1200, 900));
let clock = Date.parse("2026-11-19T10:20:30Z");
const now = () => new Date(clock);
const library = openLibrary(join(dir, "library"), { now });
library.save({ name: "nadia", kind: "character", description: "Nadia.", images: [{ path: sheet, role: "sheet" }] });
library.save({ name: "box", kind: "product", description: "A box.", images: [{ path: sheet, role: "sheet" }] });

// The fake: a voice list, and speech that records what it was asked.
const asked = [];
let reply = { status: 200, body: wav, type: "audio/wav" };
let server, env, closed;
before(async () => {
  // A port nothing listens on: open one, note it, close it.
  const spare = createServer();
  await new Promise((r) => spare.listen(0, "127.0.0.1", r));
  closed = { SHARD_VOICESTUDIO_URL: `http://127.0.0.1:${spare.address().port}` };
  await new Promise((r) => spare.close(r));
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method === "GET" && req.url === "/v1/audio/voices") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ voices: [{ id: "p-1", name: "Gravel" }, "Narrator"] }));
      }
      if (req.method === "POST" && req.url === "/v1/audio/speech") {
        asked.push(JSON.parse(body));
        res.writeHead(reply.status, { "content-type": reply.type });
        return res.end(reply.body);
      }
      res.writeHead(404).end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  env = { SHARD_VOICESTUDIO_URL: `http://127.0.0.1:${server.address().port}` };
});
after(() => server.close());
const probe = async () => ({ durationS: 21.4 });

describe("talking to VoiceStudio", () => {
  test("only an address on this computer is used", () => {
    assert.equal(voiceStudioUrl({}), "http://127.0.0.1:3900");
    assert.equal(voiceStudioUrl({ SHARD_VOICESTUDIO_URL: "http://localhost:4000/" }), "http://localhost:4000");
    assert.throws(() => voiceStudioUrl({ SHARD_VOICESTUDIO_URL: "http://192.168.1.20:3900" }), /must point at this computer/);
    assert.throws(() => voiceStudioUrl({ SHARD_VOICESTUDIO_URL: "https://voices.example.com" }), /must point at this computer/);
  });

  test("its voice list is read whatever its shape", () => {
    assert.deepEqual(readVoices(["A"]), [{ id: "A", name: "A" }]);
    assert.deepEqual(readVoices({ data: [{ profile_id: 7, name: "B" }] }), [{ id: "7", name: "B" }]);
    assert.deepEqual(readVoices(null), []);
    // VoiceStudio 0.5.7's real reply: OpenAI aliases of the default voice, then the user's profiles.
    assert.deepEqual(readVoices({ voices: [{ voice_id: "alloy", name: "Alloy", type: "openai_alias", id: "alloy" }, { voice_id: "demo0001", name: "Demo Voice", type: "profile", id: "demo0001" }] }), [{ id: "demo0001", name: "Demo Voice" }]);
  });

  test("status says whether it is open, and lists the voices made in it", async () => {
    const s = await voiceStudioStatus({ env });
    assert.equal(s.running, true);
    assert.deepEqual(s.voices, [{ id: "p-1", name: "Gravel" }, { id: "Narrator", name: "Narrator" }]);
    const off = await voiceStudioStatus({ env: closed });
    assert.equal(off.running, false);
    assert.equal(off.error, null);
  });

  test("tags VoiceStudio would say aloud are dropped; [pause] and [laughter] stay", () => {
    assert.equal(plainForVoiceStudio("[excited] Look!\n[whispers] Shh. [pause 500ms] Ok.\n[laughs] Ha."), "Look!\nShh. [pause 500ms] Ok.\n[laughter] Ha.");
    const plain = voiceScript({ name: "Nadia", style: "plain" });
    assert.match(plain, /^Hi, I'm Nadia\./);
    assert.deepEqual([...new Set(plain.match(/\[[^\]]*\]/g))].sort(), ["[laughter]", "[pause]"]);
  });

  test("speech asks for WAV in the chosen voice; a closed app, an error or a non-WAV reply says so", async () => {
    const bytes = await speak({ text: "[sad] Hello there.", voice: "Gravel", env });
    assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
    assert.deepEqual(asked.at(-1), { model: "tts-1", input: "Hello there.", voice: "Gravel", response_format: "wav" });
    await assert.rejects(speak({ text: "Hi.", env: closed }), /VoiceStudio isn't open/);
    reply = { status: 404, body: JSON.stringify({ detail: "Voice profile not found" }), type: "application/json" };
    await assert.rejects(speak({ text: "Hi.", voice: "nobody", env }), (e) => /said 404: Voice profile not found/.test(e.message) && e.field === "voice");
    reply = { status: 200, body: "not audio", type: "text/plain" };
    await assert.rejects(speak({ text: "Hi.", env }), /not with WAV audio/);
    reply = { status: 200, body: wav, type: "audio/wav" };
    await assert.rejects(speak({ text: "[excited]", env }), /Write the voice script first/);
  });
});

describe("a VoiceStudio take becomes the voice", () => {
  test("the built-in script is the plain one; a saved script loses its ElevenLabs tags", () => {
    assert.doesNotMatch(localScript(library.get("nadia")), /\[(excited|whispers|sad)\]/);
    library.setVoiceProfile("nadia", { script: "[excited] Big boat!" });
    assert.equal(localScript(library.get("nadia")), "Big boat!");
    library.setVoiceProfile("nadia", null);
  });

  test("a take waits in runs/voices with what made it, then is kept with its VoiceStudio voice", async () => {
    const t = await makeLocalVoice(library, "nadia", { voice: "Gravel", probe, env, now });
    assert.equal(t.id, "voicestudio-nadia-20261119T102030Z");
    assert.ok(existsSync(t.path));
    assert.equal(t.durationS, 21.4);
    assert.equal(asked.at(-1).voice, "Gravel");
    assert.doesNotMatch(asked.at(-1).input, /\[excited\]/);
    assert.equal(latestLocalTake(library.get("nadia")).id, t.id);

    const a = await keepLocalVoice(library, t.id, { probe });
    assert.equal(a.voice.origin, "voicestudio");
    assert.equal(a.voice.voiceName, "Gravel");
    assert.equal(a.voice.take, t.id);
    assert.equal(a.voice.durationS, 21.4);
    assert.equal(latestLocalTake(a), null, "a kept take is not offered again");
  });

  test("a script for this take only is used as given; a product, a made-up take or a 40-second take is refused", async () => {
    clock += 1000;
    await makeLocalVoice(library, "nadia", { script: "Just this line.", probe, env, now });
    assert.equal(asked.at(-1).input, "Just this line.");
    assert.equal(asked.at(-1).voice, "default");
    await assert.rejects(makeLocalVoice(library, "box", { probe, env, now }), /Only characters have a voice/);
    await assert.rejects(keepLocalVoice(library, "../library/nadia/voice", { probe }), /not a VoiceStudio take/);
    await assert.rejects(keepLocalVoice(library, "voicestudio-nadia-20200101T000000Z", { probe }), /No VoiceStudio take/);
    clock += 1000;
    const long = await makeLocalVoice(library, "nadia", { probe: async () => ({ durationS: 40 }), env, now });
    await assert.rejects(keepLocalVoice(library, long.id, { probe: async () => ({ durationS: 40 }) }), /2 to 30 seconds; this one is 40\.0s/);
    assert.equal(library.get("nadia").voice.voiceName, "Gravel", "the voice kept before is still the voice");
  });
});
