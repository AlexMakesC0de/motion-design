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
  test("a voice file adds nothing: kie bills reference audio at the plain rate", () => {
    assert.equal(estimateUsd(route, { durationS: 10, resolution: "480p", input: { reference_audio_urls: ["v"] } }).usd, 1.4);
    assert.equal(estimateUsd(route, { durationS: 10, resolution: "480p", input: {} }).usd, 1.4);
  });

  test("a voice card is billed on its seconds plus the clip's, at the with-video rate", () => {
    // 10s at 480p with a 28s card: (10 + 28) × 0.085 = 3.23.
    const p = estimateUsd(route, { durationS: 10, resolution: "480p", input: { reference_video_urls: ["c"] }, inputS: 28 });
    assert.equal(p.usd, 3.23);
    assert.match(p.basis, /28s of reference video/);
    // Unknown length: the most Seedance takes, 30s.
    assert.equal(estimateUsd(route, { durationS: 10, resolution: "720p", input: { reference_video_urls: ["c"] } }).usd, 7.6);
  });
});

describe("scenes send the voice of whoever speaks", () => {
  const scene = (action) => ({
    id: "s1", title: "Talk", durationS: 8, ratio: "16:9",
    refs: [{ id: "r1", source: "library:nadia" }, { id: "r2", source: "library:mira" }],
    cards: { goal: "Two friends on a roof.", scene: "", stages: [{ title: "Line", seconds: 8, camera: "Close.", action, end: "" }], style: "", audio: "" },
  });
  const audioLimits = { maxTotalS: 30 };

  test("a speaker with a voice gets their voice card by default, numbered as video, with the rules that keep it off screen", () => {
    const c = compileScene(scene('@{r1} says "Made in Shard."'), { film: "f", library, audioLimits, videoLimits: { maxTotalS: 30 } });
    assert.deepEqual(c.problems, []);
    assert.deepEqual(c.refs.at(-1), { source: "nadia@voicecard", role: "voicecard" });
    assert.deepEqual(c.voices, [{ name: "nadia", durationS: 19, cardS: 15, sends: "card", videoS: 15 }], "a card runs at most 15s; a longer voice is cut at a pause");
    assert.equal(c.voiceAs, "clip", "the default: the talking clip once there is one, the card until then");
    assert.equal(c.videoS, 15);
    assert.match(c.prompt, /\[Video 1\] — the voice of \[Image 1\]: a black screen with a name, and this person's voice\. Whenever \[Image 1\] speaks, use exactly this voice.*Never show this black screen or its text\./);
    assert.match(c.prompt, /\[Image 1\] — character\. .* Voice: exactly the voice in \[Video 1\]\./);
    assert.match(c.prompt, /No on-screen text of any kind/);
    assert.match(c.prompt, /\[SCRIPT\]\nThese are the only words spoken in this video(.*\n)+1\. \[Image 1\], 0–8s: "Made in Shard\."\n/);
    assert.match(c.prompt, /\[AUDIO\]\nLine 1 — \[Image 1\], 0–8s, in the voice from \[Video 1\]: "Made in Shard\."\nThese are the only words spoken\. No music, no score/);
    assert.doesNotMatch(c.prompt, /— nadia|nadia.s voice/i, "Shard adds no names to the prompt");
  });

  test("voiceAs file sends the bare voice instead, numbered as audio", () => {
    const c = compileScene({ ...scene('@{r1} says "Made in Shard."'), voiceAs: "file" }, { film: "f", library, audioLimits });
    assert.deepEqual(c.refs.at(-1), { source: "nadia@voice", role: "voice" });
    assert.equal(c.videoS, 0);
    assert.match(c.prompt, /\[Audio 1\] — the voice of \[Image 1\]\. Whenever \[Image 1\] speaks/);
    assert.match(c.prompt, /Line 1 — \[Image 1\], 0–8s, in the voice from \[Audio 1\]: "Made in Shard\."/);
  });

  test("a character with a talking clip sends the clip instead of the card; voiceAs card still sends the card", () => {
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom"), Buffer.alloc(52)]);
    library.setVoiceClip("nadia", { path: file("clip.mp4", mp4), seconds: 13, width: 1280, height: 720, words: "Hi there.", job: "j1" });
    const line = scene('@{r1} says "Made in Shard."');
    const c = compileScene(line, { film: "f", library, videoLimits: { maxTotalS: 30 } });
    assert.deepEqual(c.refs.at(-1), { source: "nadia@voiceclip", role: "voiceclip" });
    assert.equal(c.videoS, 13);
    assert.match(c.prompt, /\[Video 1\] — \[Image 1\] talking: the single source for this person's face, hair, outfit, voice and the way they react\..*Never reproduce its grey background, framing or words\./);
    const card = compileScene({ ...line, voiceAs: "card" }, { film: "f", library });
    assert.deepEqual(card.refs.at(-1), { source: "nadia@voicecard", role: "voicecard" });
    library.setVoice("nadia", { path: file("n3.wav", Buffer.concat([wav(), Buffer.from("n3")])), durationS: 19, origin: "recording" });
    assert.equal(library.get("nadia").voice.clip, undefined, "a new voice drops the clip, which spoke in the old one");
    assert.deepEqual(compileScene(line, { film: "f", library }).refs.at(-1), { source: "nadia@voicecard", role: "voicecard" });
  });

  test("lines without a voice still get the script, and the profile says how they sound", () => {
    library.setVoiceProfile("mira", { accent: "Scottish", tone: "dry", energy: "quick when annoyed" });
    const c = compileScene(scene('@{r2} turns to @{r1} and says "You told her." @{r1} says "She asked."'), { film: "f", library });
    assert.match(c.prompt, /\[SCRIPT\]\n(.*\n)+1\. \[Image 2\], 0–8s: "You told her\."\n2\. \[Image 1\], 0–8s: "She asked\."\n/);
    assert.match(c.prompt, /\[Image 2\] — character\. .* Voice: Scottish accent, dry, quick when annoyed\./);
    assert.match(c.prompt, /Line 1 — \[Image 2\], 0–8s: "You told her\."/);
  });

  test("the no-music line gives way when the Audio card asks for music", () => {
    const s = scene('@{r1} says "Go."');
    s.cards.audio = "Soft piano music under the line.";
    const c = compileScene(s, { film: "f", library });
    assert.match(c.prompt, /\[AUDIO\]\nSoft piano music under the line\.\nLine 1 — .*\nThese are the only words spoken\.\n/);
    assert.doesNotMatch(c.prompt, /No music/);
  });

  test("a scene without a voice keeps its prompt as before", () => {
    const c = compileScene(scene("@{r1} waves."), { film: "f", library });
    assert.doesNotMatch(c.prompt, /on-screen text|background music/);
  });

  test("a character without a line, or without a voice, sends none", () => {
    assert.deepEqual(compileScene(scene("@{r1} waves."), { film: "f", library }).voices, []);
    assert.deepEqual(compileScene(scene('@{r2} says "Hi."'), { film: "f", library }).voices, []);
  });

  test("the speaker is found when the line comes later in the sentence", () => {
    const said = (action) => speakerIds(scene(action));
    assert.deepEqual(said('@{r1} looks into the lens and says "Hi."'), ["r1"]);
    assert.deepEqual(said('@{r1} turns to @library:mira and whispers: "now".'), ["r1"], "the sentence is about r1, not who r1 turns to");
    assert.deepEqual(said('@{r2} nods at @{r1}, who says "go."'), ["r1"], "after who, the one just named");
    assert.deepEqual(said('@{r1} says "Run." @{r2} looks back and shouts "Where?"'), ["r1", "r2"]);
    assert.deepEqual(said('@{r1} says "Look!" and @{r2} laughs.'), ["r1"]);
    assert.deepEqual(said("@{r1} waves. Then says \u201chi\u201d."), [], "a new sentence with nobody named");
  });

  test("speakers are found by stored id or by Library name", () => {
    const s = scene('@library:mira whispers "now", then @{r1} shouts "go".');
    assert.deepEqual(speakerIds(s), ["r2", "r1"]);
  });

  test("voices longer than Seedance takes together are a problem before anything is spent", () => {
    library.setVoice("mira", { path: file("m2.wav", wav()), durationS: 15, origin: "recording" });
    const two = scene('@{r1} says "a" and @{r2} says "b".');
    const cards = compileScene(two, { film: "f", library, audioLimits, videoLimits: { maxTotalS: 30 } });
    assert.deepEqual(cards.problems, [], "two cards of at most 15s fit");
    assert.equal(cards.videoS, 30);
    assert.match(compileScene(two, { film: "f", library, audioLimits, videoLimits: { maxTotalS: 20 } }).problems.join(" "), /voice cards last 30s together; Seedance takes at most 20s of reference video/);
    const files = compileScene({ ...two, voiceAs: "file" }, { film: "f", library, audioLimits });
    assert.match(files.problems.join(" "), /34\.0s together; Seedance takes at most 30s/);
  });
});
