import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { png } from "./fixtures/images.mjs";
import { loadCatalog, resolveModel, buildInput } from "../cli/lib/models.mjs";
import { estimateUsd } from "../cli/lib/budget.mjs";
import { openLibrary } from "../cli/core/assets.mjs";
import { expandRefs } from "../cli/core/refs.mjs";
import { presetVoices, findVoice, voiceScript, cleanProfile, voiceInput, prepareVoice, VOICE_LIMITS } from "../cli/core/voice.mjs";
import { compileScene } from "../cli/director/scene.mjs";
import { speakerIds } from "../cli/director/mentions.mjs";
import { voicePrice, voiceSettings } from "../cli/director/voice-make.mjs";

const catalog = loadCatalog();
const dir = realpathSync(mkdtempSync(join(tmpdir(), "kie-voice-")));
const file = (name, buf) => {
  const p = join(dir, name);
  writeFileSync(p, buf);
  return p;
};
/** Header-only audio: enough for the content check; the length comes from the fake probe. */
const wav = () => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt "), Buffer.alloc(52)]);
const m4a = () => Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypM4A "), Buffer.alloc(52)]);
const probeOf = (durationS) => async () => ({ durationS });

let clock = Date.parse("2026-11-19T00:00:00Z");
const library = openLibrary(join(dir, "library"), { now: () => new Date(clock) });
library.save({ name: "nadia", kind: "character", description: "Nadia.", keep: "exact face", images: [{ path: file("sheet.png", png(1200, 900)), role: "sheet" }] });
library.save({ name: "mira", kind: "character", description: "Mira.", images: [{ path: file("mira.png", png(1200, 900)), role: "sheet" }] });
library.save({ name: "box", kind: "product", description: "A box.", images: [{ path: file("box.png", png(800, 800)), role: "sheet" }] });

describe("the voice script", () => {
  test("covers the sounds of English in every mood, short enough to read in under 30 seconds", () => {
    const s = voiceScript({ name: "Nadia" });
    assert.match(s, /^Hi, I'm Nadia\./);
    for (const tag of ["[excited]", "[curious]", "[whispers]", "[sad]", "[laughs]"]) assert.ok(s.includes(tag), tag);
    // th, sh, zh, ch, j, ng, oy, ow: the sounds a short line usually misses.
    for (const w of ["thick", "Shh", "measure", "chair", "judge", "thrilling", "voyage", "how"]) assert.ok(s.includes(w), w);
    const words = s.replace(/\[[^\]]+\]/g, "").split(/\s+/).filter(Boolean).length;
    assert.ok(words < 75, `${words} words`);
  });

  test("other languages have no built-in script", () => {
    assert.equal(voiceScript({ language: "ko" }), null);
    assert.ok(voiceScript({ language: "en-GB" }));
  });

  test("a character with no saved script gets the built-in one", () => {
    assert.match(voiceSettings(library.get("nadia")).script, /\[whispers\]/);
  });
});

describe("preset voices and profiles", () => {
  test("kie's voices each have a free preview", () => {
    const { voices } = presetVoices();
    assert.equal(voices.length, 67);
    assert.equal(findVoice("James").id, "EkK5I93UQWFDigLMpZcX");
    assert.match(voices[0].previewUrl, /^https:\/\/static\.aiquickdraw\.com\/elevenlabs\/voice\/EkK5I93UQWFDigLMpZcX\.mp3$/);
    assert.throws(() => findVoice("nobody"), /No preset voice/);
  });

  test("profiles keep known fields, name the voice and refuse an over-long script", () => {
    assert.deepEqual(cleanProfile({ accent: " Australian ", voiceId: "EkK5I93UQWFDigLMpZcX", junk: "x", tone: "" }), { accent: "Australian", voiceId: "EkK5I93UQWFDigLMpZcX", voiceName: "James" });
    assert.throws(() => cleanProfile({ script: "a".repeat(5001) }), /5,000/);
  });

  test("ElevenLabs v3's input is one speaker reading the script", () => {
    assert.deepEqual(voiceInput("Hello.", "James", "en"), { dialogue: [{ text: "Hello.", voice: "EkK5I93UQWFDigLMpZcX" }], language_code: "en" });
    assert.throws(() => voiceInput(" ", "James"), /script/);
    const route = resolveModel(catalog, "elevenlabs-v3", "audio").routes[0];
    const built = buildInput(route, voiceInput("Hello.", "James"));
    assert.deepEqual(built.problems, []);
    assert.equal(built.input.stability, 0.5);
  });

  test("a sample is priced by its script's characters", () => {
    const p = voicePrice(catalog, "a".repeat(500));
    assert.equal(p.usd, 0.035);
    assert.match(p.basis, /500 characters × \$0\.07 per 1,000/);
  });
});

describe("checking a recording", () => {
  test("2 to 30 seconds of WAV, MP3, AAC or OGG passes as it is", async () => {
    const v = await prepareVoice(file("ok.wav", wav()), { probe: probeOf(18.4) });
    assert.equal(v.type, "wav");
    assert.equal(v.durationS, 18.4);
  });

  test("too short or too long is refused, saying what to do", async () => {
    await assert.rejects(prepareVoice(file("short.wav", wav()), { probe: probeOf(1.2) }), /2 to 30 seconds; this one is 1\.2s\. Record a longer one/);
    await assert.rejects(prepareVoice(file("long.wav", wav()), { probe: probeOf(41) }), /Record a shorter one, or trim it/);
  });

  test("a phone's M4A becomes MP3 first, and needs ffmpeg for that", async () => {
    const memo = file("memo.m4a", m4a());
    let converted = null;
    const mp3 = file("converted.mp3", Buffer.concat([Buffer.from("ID3"), Buffer.alloc(61)]));
    const v = await prepareVoice(memo, { probe: probeOf(12), convert: async (p) => ((converted = p), mp3) });
    assert.equal(converted, memo);
    assert.equal(v.path, mp3);
    assert.equal(v.type, "mp3");
    await assert.rejects(prepareVoice(memo, { probe: probeOf(12) }), /needs ffmpeg/);
  });

  test("a picture is not a voice", async () => {
    await assert.rejects(prepareVoice(file("p.png", png(400, 400)), { probe: probeOf(5) }), /not an audio file/);
  });

  test("the limits are Seedance's", () => {
    assert.deepEqual(VOICE_LIMITS, { minS: 2, maxS: 30, maxBytes: 15_000_000 });
  });
});

describe("a character's voice in the Library", () => {
  test("is stored next to the sheet and listed", () => {
    const a = library.setVoice("nadia", { path: file("rec.wav", wav()), durationS: 14.2, origin: "recording", script: "Hi." });
    assert.equal(a.voice.file, "voice.wav");
    assert.equal(a.voice.durationS, 14.2);
    assert.equal(a.voice.origin, "recording");
    assert.ok(existsSync(a.voice.path));
    assert.equal(library.list().find((x) => x.name === "nadia").hasVoice, true);
    assert.equal(library.list().find((x) => x.name === "mira").hasVoice, false);
  });

  test("a new sheet keeps the voice", () => {
    clock += 60_000;
    library.save({ name: "nadia", kind: "character", description: "Nadia.", images: [{ path: file("sheet2.png", png(1200, 900)), role: "sheet" }], replace: true });
    const a = library.get("nadia");
    assert.equal(a.voice.durationS, 14.2);
    assert.ok(existsSync(a.voice.path));
  });

  test("a new voice moves the old one to history", () => {
    clock += 60_000;
    const a = library.setVoice("nadia", { path: file("eleven.mp3", Buffer.concat([Buffer.from("ID3"), Buffer.alloc(61)])), durationS: 19, origin: "elevenlabs", voiceId: "EkK5I93UQWFDigLMpZcX", voiceName: "James" });
    assert.equal(a.voice.file, "voice.mp3");
    assert.equal(a.voice.voiceName, "James");
    assert.ok(!existsSync(join(library.dir, "nadia", "voice.wav")));
    const kept = readdirSync(join(library.dir, "nadia", ".history")).some((d) => existsSync(join(library.dir, "nadia", ".history", d, "voice.wav")));
    assert.ok(kept);
  });

  test("only characters have a voice, and origins are checked", () => {
    assert.throws(() => library.setVoice("box", { path: file("b.wav", wav()), durationS: 5, origin: "recording" }), /Only characters/);
    assert.throws(() => library.setVoice("mira", { path: file("c.wav", wav()), durationS: 5, origin: "radio" }), /origin/);
    assert.throws(() => library.setVoiceProfile("box", { accent: "x" }), /Only characters/);
  });

  test("the profile is saved and cleared", () => {
    assert.equal(library.setVoiceProfile("mira", { accent: "Greek" }).voiceProfile.accent, "Greek");
    assert.equal(library.setVoiceProfile("mira", null).voiceProfile, null);
  });

  test("the upload is reused for the same bytes within 20 hours", async () => {
    let n = 0;
    const upload = async () => ({ url: `https://files.test/${library.get("nadia").voice.sha256.slice(0, 16)}-${++n}.mp3` });
    const first = await library.voiceUploadUrl("nadia", { upload });
    assert.equal(await library.voiceUploadUrl("nadia", { upload }), first);
    clock += 21 * 3_600_000;
    assert.notEqual(await library.voiceUploadUrl("nadia", { upload }), first);
    await assert.rejects(library.voiceUploadUrl("mira", { upload }), /has no voice/);
  });

  test("removing it keeps a copy in history", () => {
    library.setVoice("mira", { path: file("m.wav", wav()), durationS: 6, origin: "recording" });
    assert.equal(library.removeVoice("mira").voice, null);
    assert.throws(() => library.removeVoice("mira"), /has no voice/);
  });
});

describe("a voice as a reference", () => {
  const upload = async () => ({ url: "https://files.test/v.mp3" });
  test("name@voice expands to the character's recording, numbered as audio", async () => {
    const r = await expandRefs([{ source: "nadia#1", role: "identity" }, { source: "nadia@voice", role: "voice" }], { catalog, library, upload });
    assert.deepEqual(r.refMapping, ["@Image1 = nadia#1", "@Audio1 = nadia@voice"]);
    assert.equal(r.refs[1].kind, "audio");
    assert.equal(r.refs[1].file.durationS, 19);
  });

  test("the voice role takes only audio, and audio takes only the voice role", async () => {
    await assert.rejects(expandRefs([{ source: "nadia", role: "voice" }], { catalog, library, upload }), /not a picture/);
    await assert.rejects(expandRefs([{ source: "nadia@voice", role: "identity" }], { catalog, library, upload }), /role must be voice/);
    await assert.rejects(expandRefs([{ source: "mira@voice", role: "voice" }], { catalog, library, upload }), /has no voice/);
  });

  test("Seedance 2.5 on kie sends it as reference_audio_urls, never with a first frame", () => {
    const route = resolveModel(catalog, "seedance-2-5", "video").routes.find((r) => r.provider === "kie");
    const base = { prompt: "x", duration: 10, resolution: "480p", aspect_ratio: "1:1" };
    const ok = buildInput(route, { ...base, refs: [{ role: "identity", url: "https://a/1.png" }, { role: "voice", url: "https://a/v.mp3" }] });
    assert.deepEqual(ok.problems, []);
    assert.deepEqual(ok.input.reference_audio_urls, ["https://a/v.mp3"]);
    const bad = buildInput(route, { ...base, refs: [{ role: "first_frame", url: "https://a/f.png" }, { role: "voice", url: "https://a/v.mp3" }] });
    assert.match(bad.problems.join(" "), /cannot combine/);
  });
});

describe("pricing a scene with a voice", () => {
  const route = resolveModel(catalog, "seedance-2-5", "video").routes.find((r) => r.provider === "kie");
  const withVoice = { reference_audio_urls: ["v"] };
  test("quotes the higher of the plain rate and the with-video rate on voice plus output", () => {
    // 10s at 480p: plain 10 × 0.14 = 1.40; with video (10 + 19) × 0.085 = 2.465.
    const p = estimateUsd(route, { durationS: 10, resolution: "480p", input: withVoice, audioS: 19 });
    assert.equal(p.usd, 2.465);
    assert.match(p.basis, /19s of reference voice.*no rate for a reference voice/);
    // 15s at 720p with a 3s voice: plain 4.725 beats (15 + 3) × 0.19 = 3.42.
    const q = estimateUsd(route, { durationS: 15, resolution: "720p", input: withVoice, audioS: 3 });
    assert.equal(q.usd, 4.725);
    assert.match(q.basis, /with a voice/);
  });

  test("an unknown voice length is counted as the most Seedance takes", () => {
    assert.equal(estimateUsd(route, { durationS: 10, resolution: "480p", input: withVoice }).usd, 3.4);
  });

  test("without a voice the price is unchanged", () => {
    assert.equal(estimateUsd(route, { durationS: 10, resolution: "480p", input: {} }).usd, 1.4);
  });
});

describe("scenes send the voice of whoever speaks", () => {
  const scene = (action) => ({
    id: "s1", title: "Talk", durationS: 8, ratio: "16:9",
    refs: [{ id: "r1", source: "library:nadia" }, { id: "r2", source: "library:mira" }],
    cards: { goal: "Two friends on a roof.", scene: "", stages: [{ title: "Line", seconds: 8, camera: "Close.", action, end: "" }], style: "", audio: "" },
  });
  const audioLimits = { maxTotalS: 30 };

  test("a speaker with a voice gets it, numbered as audio, with the line telling the model to use it", () => {
    const c = compileScene(scene('@{r1} says "Made in Shard."'), { film: "f", library, audioLimits });
    assert.deepEqual(c.problems, []);
    assert.deepEqual(c.refs.at(-1), { source: "nadia@voice", role: "voice" });
    assert.deepEqual(c.voices, [{ name: "nadia", durationS: 19 }]);
    assert.equal(c.audioS, 19);
    assert.match(c.prompt, /\[Audio 1\] — nadia's voice\. Whenever \[Image 1\] speaks, use this exact voice/);
  });

  test("a character without a line, or without a voice, sends none", () => {
    assert.deepEqual(compileScene(scene("@{r1} waves."), { film: "f", library }).voices, []);
    assert.deepEqual(compileScene(scene('@{r2} says "Hi."'), { film: "f", library }).voices, []);
  });

  test("speakers are found by stored id or by Library name", () => {
    const s = scene('@library:mira whispers "now", then @{r1} shouts "go".');
    assert.deepEqual(speakerIds(s), ["r2", "r1"]);
  });

  test("voices longer than Seedance takes together are a problem before anything is spent", () => {
    library.setVoice("mira", { path: file("m2.wav", wav()), durationS: 15, origin: "recording" });
    const c = compileScene(scene('@{r1} says "a" and @{r2} says "b".'), { film: "f", library, audioLimits });
    assert.match(c.problems.join(" "), /34\.0s together; Seedance takes at most 30s/);
    assert.deepEqual(c.refs, []);
  });
});
