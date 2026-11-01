import { RUNS, KEY, deps, req, tmp } from "./helpers.mjs";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { createApp } = await import("../server/app.mjs");
const { openJobs } = await import("../../cli/core/jobs.mjs");

const film = join(RUNS, "film-demo");
mkdirSync(film, { recursive: true });
// Written oldest first; each gets its own modified time so the order is certain.
const files = ["out.mp4", "out-2.mp4", "music.mp3", "captions.srt", "prompt.txt", "film.mp4", "film-9x16.mp4", "captioned.mp4", "kinetic-type.mp4", "ref.png", ".film.mp4.ab12.part"];
files.forEach((name, i) => {
  writeFileSync(join(film, name), "x");
  const t = new Date(Date.UTC(2026, 9, 31, 10, 0, i));
  utimesSync(join(film, name), t, t);
});
writeFileSync(join(film, "assembly.json"), JSON.stringify({ shots: [{ path: join(film, "out-2.mp4") }, { path: join(film, "out.mp4") }, { path: join(film, "gone.mp4") }] }));

const store = openJobs(join(RUNS, ".jobs"));
const j = store.create({ run: "film-demo", capability: "video", model: "seedance-2-5", provider: "kie", estimateUsd: 0.56, input: { prompt: "A fox", duration: 4, aspect_ratio: "16:9" } });
store.transition(j.id, "sending");
store.transition(j.id, "submitted", { upstreamTaskId: "task-1" });
store.transition(j.id, "succeeded", { artifacts: [join(film, "out.mp4")], actualUsd: 0.5, costSource: "task-record" });

const revealed = [];
let app, port;
before(async () => {
  app = createApp({ key: KEY, deps: { ...deps, reveal: (dir) => revealed.push(dir) }, distDir: join(tmp, "nodist"), pollMs: 60_000 });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  port = app.address().port;
});
after(() => app.closeAll());

describe("GET /api/films", () => {
  test("one card per run folder, with its newest video as the cover", async () => {
    const r = await req(port, "/api/films");
    assert.equal(r.status, 200);
    const card = r.json.find((f) => f.run === "film-demo");
    assert.equal(card.takes, 8, "core's count of media files");
    assert.deepEqual(card.cover, { kind: "video", url: "/media/runs/film-demo/kinetic-type.mp4" });
  });

  test("a folder whose name is not a run slug is listed without a cover, and does not break the list", async () => {
    mkdirSync(join(RUNS, "Old Stuff"), { recursive: true });
    const r = await req(port, "/api/films");
    assert.equal(r.status, 200);
    assert.equal(r.json.find((f) => f.run === "Old Stuff").cover, null);
  });
});

describe("GET /api/films/:slug", () => {
  test("lists media and SRT files oldest first, each with its kind and where it came from", async () => {
    const r = await req(port, "/api/films/film-demo");
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(
      r.json.files.map((f) => [f.name, f.kind, f.origin]),
      [
        ["out.mp4", "video", "take"],
        ["out-2.mp4", "video", "take"],
        ["music.mp3", "audio", null],
        ["captions.srt", "srt", null],
        ["film.mp4", "video", "film"],
        ["film-9x16.mp4", "video", "variant"],
        ["captioned.mp4", "video", "captioned"],
        ["kinetic-type.mp4", "video", "card"],
        ["ref.png", "image", "take"],
      ],
    );
    const out = r.json.files[0];
    assert.equal(out.url, "/media/runs/film-demo/out.mp4");
    assert.equal(out.bytes, 1);
    assert.equal(out.job.id, j.id, "a take carries the job that made it");
    assert.equal(out.job.actualUsd, 0.5);
    // What the film page shows under a shot's name comes with the job, so there is no second request per shot.
    assert.deepEqual([out.job.model, out.job.durationS, out.job.aspectRatio, out.job.prompt], ["seedance-2-5", 4, "16:9", "A fox"]);
    assert.equal(r.json.files[1].job, null);
  });

  test("the shot order is the last assembly's, for the shots still in the folder", async () => {
    const r = await req(port, "/api/films/film-demo");
    assert.deepEqual(r.json.order, ["out-2.mp4", "out.mp4"]);
  });

  test("an unknown film is 400 with core's code 3; a bad slug is refused too", async () => {
    const r = await req(port, "/api/films/no-such-film");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 3);
    assert.match(r.json.error.message, /No run "no-such-film"/);
    assert.equal((await req(port, "/api/films/Bad%20Slug")).status, 400);
  });
});

describe("POST /api/films/:slug/audio", () => {
  const wav = Buffer.concat([Buffer.from("RIFF\x24\x00\x00\x00WAVEfmt ", "latin1"), Buffer.alloc(64)]);
  const upload = (film, body, name) => req(port, `/api/films/${film}/audio`, { method: "POST", body, headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name) } });

  test("streams music into the film under a plain name from the file's, never over a file already there", async () => {
    const r = await upload("film-demo", wav, "My Song (final).wav");
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { name: "my-song-final.wav", kind: "audio", url: "/media/runs/film-demo/my-song-final.wav", bytes: wav.length });
    assert.ok(existsSync(join(film, "my-song-final.wav")));
    const again = await upload("film-demo", wav, "My Song (final).wav");
    assert.equal(again.json.name, "my-song-final-2.wav");
  });

  test("a file that is not audio is refused by its content and nothing is kept", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.alloc(32)]);
    const r = await upload("film-demo", png, "song.mp3");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.field, "file");
    assert.match(r.json.error.message, /^song\.mp3 is not an audio file/);
    assert.ok(!existsSync(join(film, "song.mp3")));
    assert.deepEqual(readdirSync(join(RUNS, ".incoming")), []);
  });

  test("an empty upload and an unknown film are refused", async () => {
    assert.equal((await upload("film-demo", Buffer.alloc(0), "x.wav")).json.error.field, "file");
    const r = await upload("no-such-film", wav, "x.wav");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 3);
  });
});

describe("POST /api/films/:slug/srt", () => {
  const srt = "1\n00:00:00,000 --> 00:00:01,500\nHello\n\n2\n00:00:01,000 --> 00:00:03,000\nAgain\n";

  test("saves pasted captions as captions.srt in the film, numbering the next one, and reports core's problems", async () => {
    const r = await req(port, "/api/films/film-demo/srt", { method: "POST", body: { text: srt } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.name, "captions-2.srt", "captions.srt was already there");
    assert.equal(r.json.cues, 2);
    assert.deepEqual(r.json.problems, ["Cue 2 starts at 1s before cue 1 ends at 1.5s."]);
    assert.equal(readFileSync(join(film, "captions-2.srt"), "utf8"), srt);
  });

  test("text with no readable cue is refused on its field", async () => {
    const r = await req(port, "/api/films/film-demo/srt", { method: "POST", body: { text: "just words" } });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.field, "text");
    assert.match(r.json.error.message, /No readable cues/);
  });
});

describe("film progress", () => {
  test("GET /api/films gives each card its progress; a folder made before the studio is takes only", async () => {
    const r = await req(port, "/api/films");
    const demo = r.json.find((f) => f.run === "film-demo");
    assert.equal(demo.progress.legacy, true);
    assert.equal(demo.progress.step, "finish");
    assert.equal(demo.progress.steps.finish, "done", "film.mp4 is in the folder");
    assert.equal(demo.progress.spentUsd, 0.5);
    assert.equal(r.json.find((f) => f.run === "Old Stuff").progress, null);
  });

  test("a film with nothing in it yet is on Idea, with the next action in words", async () => {
    mkdirSync(join(RUNS, "fresh"), { recursive: true });
    writeFileSync(join(RUNS, "fresh", "brief.json"), JSON.stringify({ takeaway: "A boat", durationS: 8, aspectRatio: "16:9", filmType: "live-action" }));
    const r = await req(port, "/api/films/fresh/progress");
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.step, "idea");
    assert.deepEqual(r.json.next, { text: "Write the idea", step: "idea" });
    assert.equal(typeof r.json.updatedAt, "string");
  });

  test("progress for an unknown film is refused with core's code 3, like the film's own route", async () => {
    const r = await req(port, "/api/films/no-such-film/progress");
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 3);
    assert.match(r.json.error.message, /No run "no-such-film"/);
  });

  test("reveal opens the film's folder through the injected opener", async () => {
    const r = await req(port, "/api/films/film-demo/reveal", { method: "POST", body: {} });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(revealed, [join(RUNS, "film-demo")]);
  });

  test("reveal for an unknown film is refused and opens nothing", async () => {
    const before = revealed.length;
    const r = await req(port, "/api/films/no-such-film/reveal", { method: "POST", body: {} });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 3);
    assert.equal(revealed.length, before);
  });

  test("reveal refuses a runs/<slug> that is a link to a folder elsewhere, and opens nothing", async () => {
    const outside = join(tmp, "outside-folder");
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(RUNS, "linked-film"));
    const before = revealed.length;
    const r = await req(port, "/api/films/linked-film/reveal", { method: "POST", body: {} });
    assert.equal(r.status, 400, r.text);
    assert.match(r.json.error.message, /runs\/linked-film is a link/);
    assert.equal(revealed.length, before);
  });

  test("reveal refuses a plain file at runs/<slug>, and opens nothing", async () => {
    writeFileSync(join(RUNS, "plain-file"), "not a folder");
    const before = revealed.length;
    const r = await req(port, "/api/films/plain-file/reveal", { method: "POST", body: {} });
    assert.equal(r.status, 400, r.text);
    assert.match(r.json.error.message, /runs\/plain-file is not a folder/);
    assert.equal(revealed.length, before);
  });

  test("each card in the list has the same progress and cover as the film's own progress route", async () => {
    const list = await req(port, "/api/films");
    for (const slug of ["film-demo", "fresh"]) {
      const card = list.json.find((f) => f.run === slug);
      const own = await req(port, `/api/films/${slug}/progress`);
      assert.deepEqual(card.progress, own.json, slug);
      assert.deepEqual(card.cover, own.json.cover, slug);
    }
  });
});
