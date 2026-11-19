// A voice card: the character's voice on a black 720p frame with their name,
// cut to whole seconds. Scenes send it to Seedance 2.5 as a reference video.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { png } from "./fixtures/images.mjs";
import { loadCatalog, resolveModel, buildInput } from "../cli/lib/models.mjs";
import { openLibrary } from "../cli/core/assets.mjs";
import { expandRefs } from "../cli/core/refs.mjs";
import { cardCut, cardText, makeVoiceCard, parsePauses, probe } from "../cli/lib/ffmpeg.mjs";
import { cardName, cardSeconds, ensureVoiceCard } from "../cli/director/voice-make.mjs";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
const catalog = loadCatalog();
const dir = realpathSync(mkdtempSync(join(tmpdir(), "kie-voicecard-")));
const file = (name, buf) => {
  const p = join(dir, name);
  writeFileSync(p, buf);
  return p;
};
const wav = () => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt "), Buffer.alloc(52)]);
const mp4 = () => Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom"), Buffer.alloc(52)]);
let clock = Date.parse("2026-11-19T00:00:00Z");
const library = openLibrary(join(dir, "library"), { now: () => new Date((clock += 1000)) });
library.save({ name: "nadia-formal", kind: "character", description: "Nadia.", images: [{ path: file("sheet.png", png(1200, 900)), role: "sheet" }] });

// Stands in for ffmpeg: writes a tiny MP4 and records what it was asked.
const made = [];
const fakeCard = async (opts) => {
  made.push(opts);
  writeFileSync(opts.out, mp4());
  const { seconds, voiceS } = cardCut(opts.durationS);
  return { path: opts.out, seconds, voiceS, text: opts.text };
};

describe("the card's shape", () => {
  test("whole seconds, rounded up, at most 15 (kie bills every second of it)", () => {
    assert.equal(cardSeconds(9.2), 10);
    assert.equal(cardSeconds(27.55), 15);
    assert.equal(cardSeconds(1.2), 2);
    assert.equal(cardSeconds(15), 15);
  });

  test("a longer voice is cut in its last pause before 15s, never mid-word when there is one", () => {
    assert.deepEqual(cardCut(9.2), { voiceS: 9.2, seconds: 10, fade: false });
    const p = [{ start: 0, end: 0.4 }, { start: 3.1, end: 3.6 }, { start: 8.4, end: 9.1 }, { start: 12.6, end: 13.4 }, { start: 16, end: 17 }];
    assert.deepEqual(cardCut(27.55, p), { voiceS: 12.85, seconds: 13, fade: false }, "the last pause starting from 5s to 15s");
    assert.deepEqual(cardCut(27.55, [{ start: 3, end: 3.5 }]), { voiceS: 15, seconds: 15, fade: true }, "no pause in reach: cut at 15s and fade");
    assert.deepEqual(cardCut(27.55, [{ start: 14.9, end: 15.6 }]), { voiceS: 15, seconds: 15, fade: false });
  });

  test("pauses are read off ffmpeg's silencedetect", () => {
    const err = "[silencedetect @ 0x1] silence_start: -0.01\n[silencedetect @ 0x1] silence_end: 0.42 | silence_duration: 0.43\n[silencedetect @ 0x1] silence_start: 6.02\n[silencedetect @ 0x1] silence_end: 6.9 | silence_duration: 0.88\nsilence_start: 19.5\n";
    assert.deepEqual(parsePauses(err), [{ start: 0, end: 0.42 }, { start: 6.02, end: 6.9 }, { start: 19.5, end: null }]);
  });

  test("the name: the one set for it, else the display name, else the Library name in words; one short line", () => {
    const a = library.get("nadia-formal");
    assert.equal(cardName(a), "Nadia Formal");
    assert.equal(cardName({ ...a, persona: { displayName: "Nadia K" } }), "Nadia K");
    assert.equal(cardName({ ...a, voiceProfile: { cardName: "Nadia" } }), "Nadia");
    assert.equal(cardText("Nadia\n  K\u0007"), "Nadia K");
    assert.equal(cardText("x".repeat(60)).length, 40);
  });
});

describe("keeping the card in step with the voice", () => {
  test("made with the voice, again when the voice or the name changes, and not otherwise", async () => {
    library.setVoice("nadia-formal", { path: file("v1.wav", wav()), durationS: 27.55, origin: "recording" });
    let a = await ensureVoiceCard(library, "nadia-formal", { card: fakeCard });
    assert.equal(made.length, 1);
    assert.deepEqual({ text: made[0].text, durationS: made[0].durationS }, { text: "Nadia Formal", durationS: 27.55 });
    assert.deepEqual([a.voice.card.seconds, a.voice.card.voiceS], [15, 15]);
    assert.ok(existsSync(a.voice.card.path));
    assert.equal(a.voice.card.voiceSha256, a.voice.sha256);

    await ensureVoiceCard(library, "nadia-formal", { card: fakeCard });
    assert.equal(made.length, 1, "an up-to-date card is not made again");

    library.setVoiceProfile("nadia-formal", { cardName: "Nadia" });
    a = await ensureVoiceCard(library, "nadia-formal", { card: fakeCard });
    assert.equal(made.at(-1).text, "Nadia");
    assert.equal(a.voice.card.wanted, "Nadia");

    library.setVoice("nadia-formal", { path: file("v2.wav", Buffer.concat([wav(), Buffer.from("x")])), durationS: 12, origin: "recording" });
    assert.equal(library.get("nadia-formal").voice.card, undefined, "a new voice drops the old card");
    const history = readdirSync(join(library.dir, "nadia-formal", ".history"));
    assert.ok(history.some((d) => existsSync(join(library.dir, "nadia-formal", ".history", d, "voice-card.mp4"))), "the old card goes to history with its voice");
    a = await ensureVoiceCard(library, "nadia-formal", { card: fakeCard });
    assert.equal(made.at(-1).durationS, 12);
  });

  test("without ffmpeg the card cannot be made, and says how else to send the voice", async () => {
    library.setVoice("nadia-formal", { path: file("v3.wav", Buffer.concat([wav(), Buffer.from("y")])), durationS: 9, origin: "recording" });
    await assert.rejects(ensureVoiceCard(library, "nadia-formal", {}), /needs ffmpeg.*send the voice as a file/);
  });
});

describe("sending the card", () => {
  const route = resolveModel(catalog, "seedance-2-5", "video").routes.find((r) => r.provider === "kie");

  test("name@voicecard becomes a reference video, uploaded once and reused", async () => {
    await ensureVoiceCard(library, "nadia-formal", { card: fakeCard });
    let uploads = 0;
    const upload = async () => ({ url: `https://files.test/card-${++uploads}.mp4` });
    const r = await expandRefs([{ source: "nadia-formal#1", role: "identity" }, { source: "nadia-formal@voicecard", role: "voicecard" }], { catalog, library, upload });
    assert.deepEqual(r.refMapping, ["@Image1 = nadia-formal#1", "@Video1 = nadia-formal@voicecard"]);
    assert.equal(r.refs[1].kind, "video");
    await expandRefs([{ source: "nadia-formal@voicecard", role: "voicecard" }], { catalog, library, upload });
    assert.equal(uploads, 2, "the sheet once and the card once");
    await assert.rejects(expandRefs([{ source: "nadia-formal@voicecard", role: "voice" }], { catalog, library, upload }), /role must be voicecard/);
    await assert.rejects(expandRefs([{ source: "nadia-formal", role: "voicecard" }], { catalog, library, upload }), /not a picture/);
  });

  test("a card older than the voice is refused rather than sent", async () => {
    library.setVoice("nadia-formal", { path: file("v4.wav", Buffer.concat([wav(), Buffer.from("z")])), durationS: 9, origin: "recording" });
    await assert.rejects(expandRefs([{ source: "nadia-formal@voicecard", role: "voicecard" }], { catalog, library, upload: async () => ({ url: "https://x/y.mp4" }) }), /voice card is missing or older/);
  });

  test("it goes in reference_video_urls, with the sheet, never with a first frame", () => {
    const base = { prompt: "x", duration: 10, resolution: "480p", aspect_ratio: "16:9" };
    const ok = buildInput(route, { ...base, refs: [{ role: "identity", url: "https://a/1.png" }, { role: "voicecard", url: "https://a/c.mp4" }], params: { omni_reference_task_type: "reference" } });
    assert.deepEqual(ok.problems, []);
    assert.deepEqual(ok.input.reference_video_urls, ["https://a/c.mp4"]);
    assert.equal(ok.input.omni_reference_task_type, "reference");
    const bad = buildInput(route, { ...base, refs: [{ role: "first_frame", url: "https://a/f.png" }, { role: "voicecard", url: "https://a/c.mp4" }] });
    assert.match(bad.problems.join(" "), /cannot combine/);
  });
});

describe("a real card", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  test("720p, 24 fps, whole seconds, with the voice", async () => {
    const audio = join(dir, "tone.wav");
    spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=3.4", audio]);
    const out = join(dir, "card.mp4");
    const r = await makeVoiceCard({ audio, out, text: "Nadia" });
    const p = await probe(out);
    assert.equal(r.seconds, 4);
    assert.deepEqual([p.width, p.height, p.fps, p.hasAudio], [1280, 720, 24, true]);
    assert.ok(Math.abs(p.durationS - 4) < 0.1, `lasts ${p.durationS}s`);
    assert.ok(p.width * p.height <= 927408, "within Seedance's pixel limit for a reference video");
  });

  test("a 20s voice becomes a 13s card, cut in its pause at 12.5s", async () => {
    const audio = join(dir, "talk.wav");
    spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "aevalsrc='if(between(t,6,7)+between(t,12.5,13.2),0,0.5*sin(2*PI*220*t))':d=20", audio]);
    const out = join(dir, "card20.mp4");
    const r = await makeVoiceCard({ audio, out, text: "Nadia" });
    assert.equal(r.seconds, 13);
    assert.ok(r.voiceS > 12.5 && r.voiceS <= 13.2, `cut at ${r.voiceS}s`);
    const p = await probe(out);
    assert.ok(Math.abs(p.durationS - 13) < 0.1, `lasts ${p.durationS}s`);
  });
});

describe("the talking clip", () => {
  test("needs a sheet, a voice of at least 4s and the card's words; its prompt follows the card and names nobody", async () => {
    const { voiceClipProblems, voiceClipPrompt } = await import("../cli/director/voice-make.mjs");
    library.setVoice("nadia-formal", { path: file("v5.wav", Buffer.concat([wav(), Buffer.from("v5")])), durationS: 3.2, origin: "recording" });
    let a = await ensureVoiceCard(library, "nadia-formal", { card: fakeCard });
    assert.match(voiceClipProblems(a).join(" "), /voice card is 4s|exact words/);
    library.setVoice("nadia-formal", { path: file("v6.wav", Buffer.concat([wav(), Buffer.from("v6")])), durationS: 11.3, origin: "recording" });
    library.setVoiceProfile("nadia-formal", { cardName: "Nadia", cardWords: "Hi, I'm Nadia. This is how I sound.", tone: "dry" });
    a = await ensureVoiceCard(library, "nadia-formal", { card: fakeCard });
    assert.deepEqual(voiceClipProblems(a), []);
    const p = voiceClipPrompt(a, a.voice.card.seconds);
    assert.match(p, /for its full 12 seconds/);
    assert.match(p, /The words, in order: "Hi, I'm Nadia\. This is how I sound\."/);
    assert.match(p, /the way a dry person does/);
    assert.match(p, /\[Video 1\] is the only sound/);
    assert.doesNotMatch(p, /nadia-formal|Nadia Formal/);
  });

  test("a clip made for an older voice is not kept", async () => {
    const { adoptVoiceClip } = await import("../cli/director/voice-make.mjs");
    const clip = file("clip.mp4", mp4());
    const store = { get: () => ({ stage: "voiceclip", voiceFor: "nadia-formal", voiceSha256: "old", state: "succeeded", artifacts: [clip], words: "Hi." }) };
    await assert.rejects(adoptVoiceClip(library, store, "j1", { probe: async () => ({ durationS: 12, width: 1280, height: 720 }) }), /voice changed after this clip was made/);
    const now = library.get("nadia-formal").voice.sha256;
    const ok = { get: () => ({ stage: "voiceclip", voiceFor: "nadia-formal", voiceSha256: now, state: "succeeded", artifacts: [clip], words: "Hi." }) };
    const a = await adoptVoiceClip(library, ok, "j2", { probe: async () => ({ durationS: 12, width: 1280, height: 720 }) });
    assert.deepEqual([a.voice.clip.seconds, a.voice.clip.width, a.voice.clip.words, a.voice.clip.job], [12, 1280, "Hi.", "j2"]);
  });
});
