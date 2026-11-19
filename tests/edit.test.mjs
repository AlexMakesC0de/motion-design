import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "kie-edit-"));
process.env.KIE_RUNS_DIR = join(tmp, "runs");
mkdirSync(process.env.KIE_RUNS_DIR);
const { defaultEdit, cleanEdit, readEdit, saveEdit, resolveEdit, exportArgs, exportSize, atempoChain, takeOf, exportEdit } = await import("../cli/director/edit.mjs");
const { probe, ffmpeg } = await import("../cli/lib/ffmpeg.mjs");

const v = (job, file, state = "succeeded") => ({ job, kind: "draft", resolution: "480p", prompt: "", createdAt: "t", file, state, media: null, estimateUsd: 0.56, actualUsd: 0.56 });
const scene = (id, versions, chosen = null) => ({ id, title: `Scene ${id}`, durationS: 4, ratio: "16:9", refs: [], cards: { goal: "", scene: "", stages: [], style: "", audio: "" }, versions, chosen });

function film(name, scenes) {
  const dir = join(process.env.KIE_RUNS_DIR, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "scenes.json"), JSON.stringify({ version: 1, idea: null, scenes }));
  return dir;
}

describe("the film's edit", () => {
  test("with nothing saved, each scene with a finished take plays whole, in order", () => {
    const e = defaultEdit([scene("s1", [v("j1", "/a.mp4")]), scene("s2", []), scene("s3", [v("j3", "/c.mp4", "failed")]), scene("s4", [v("j4", "/d.mp4")])]);
    assert.deepEqual(e.clips.map((c) => c.scene), ["s1", "s4"]);
    assert.equal(e.saved, false);
    assert.deepEqual(e.clips[0], { id: "c1", scene: "s1", take: null, inS: 0, outS: null, speed: 1, into: "cut" });
  });

  test("a clip plays its named take, else the starred one, else the newest finished one", () => {
    const s = scene("s1", [v("j1", "/a"), v("j2", "/b"), v("j3", "/c", "failed")], "j1");
    assert.equal(takeOf(s, "j2").job, "j2");
    assert.equal(takeOf(s, null).job, "j1");
    assert.equal(takeOf({ ...s, chosen: null }, null).job, "j2");
  });

  test("saving checks every clip and title against the film and numbers them", () => {
    const scenes = [scene("s1", [v("j1", "/a")])];
    const e = cleanEdit({ clips: [{ scene: "s1", take: "j1", inS: 4.125, outS: 7.833, speed: 1, into: "cut", id: "evil" }], titles: [{ kind: "logo", text: "Shard", image: "refs/shard.png", atS: 14.4, durationS: 4, place: "upper" }] }, scenes);
    assert.equal(e.clips[0].id, "c1");
    assert.equal(e.titles[0].id, "t1");
    assert.throws(() => cleanEdit({ clips: [{ scene: "s9" }] }, scenes), /no scene s9/);
    assert.throws(() => cleanEdit({ clips: [{ scene: "s1", take: "j9" }] }, scenes), /no finished take j9/);
    assert.throws(() => cleanEdit({ clips: [{ scene: "s1", inS: 3, outS: 2 }] }, scenes), /end after it starts/);
    assert.throws(() => cleanEdit({ clips: [{ scene: "s1", speed: 3 }] }, scenes), /speed must be one of/);
    assert.throws(() => cleanEdit({ titles: [{ kind: "logo", text: "x", image: "../../etc/passwd" }] }, scenes), /refs folder/);
    assert.throws(() => cleanEdit({ titles: [{ kind: "text", text: "" }] }, scenes), /needs words/);
  });

  test("saved edits are read back; an unsaved film reads its default", () => {
    film("e1", [scene("s1", [v("j1", "/a")])]);
    assert.equal(readEdit("e1").saved, false);
    saveEdit("e1", { clips: [{ scene: "s1", inS: 1 }] });
    const e = readEdit("e1");
    assert.equal(e.saved, true);
    assert.equal(e.clips[0].inS, 1);
  });

  test("resolving places each clip in the film after trim, speed and fades", async () => {
    const scenes = [scene("s1", [v("j1", "/x")])];
    const edit = { clips: [
      { id: "c1", scene: "s1", take: null, inS: 0, outS: 4, speed: 1, into: "cut" },
      { id: "c2", scene: "s1", take: null, inS: 14.4, outS: null, speed: 0.4, into: "cut" },
      { id: "c3", scene: "s1", take: null, inS: 0, outS: 2, speed: 1, into: "fade" },
    ], titles: [] };
    const r = await resolveEdit("none", edit, { scenes, durationOf: async () => 16 });
    // The test's take is not on disk, so every clip is missing but still timed from what was asked.
    assert.equal(r.clips[0].missing, true);
    const ok = await resolveEdit("none", edit, { scenes: [scene("s1", [v("j1", import.meta.filename)])], durationOf: async () => 16 });
    assert.deepEqual(ok.clips.map((c) => [c.startS, c.lengthS]), [[0, 4], [4, 4], [7.6, 2]]);
    assert.equal(ok.lengthS, 9.6);
  });

  test("slow speeds chain atempo steps", () => {
    assert.equal(atempoChain(0.4), "atempo=0.5,atempo=0.8");
    assert.equal(atempoChain(0.25), "atempo=0.5,atempo=0.5");
    assert.equal(atempoChain(1.5), "atempo=1.5");
  });

  test("the export size follows the tallest clip at the film's ratio", () => {
    assert.deepEqual(exportSize([480, 480]), [854, 480]);
    assert.deepEqual(exportSize([480, 720]), [1280, 720]);
    assert.deepEqual(exportSize([2160]), [1920, 1080]);
    assert.deepEqual(exportSize([1080], "9:16"), [608, 1080]);
  });

  test("export arguments trim, slow, join and lay titles at their times", () => {
    const resolved = { clips: [
      { file: "/a.mp4", inS: 0, endS: 4, speed: 1, into: "cut", lengthS: 4, missing: false },
      { file: "/b.mp4", inS: 14.4, endS: 16, speed: 0.4, into: "cut", lengthS: 4, missing: false },
    ], titles: [{ atS: 6.6, place: "upper" }] };
    const { args, lengthS } = exportArgs(resolved, { width: 854, height: 480, titleFiles: ["/t.mov"], hasAudio: [true, true], out: "/o.mp4" });
    const graph = args[args.indexOf("-filter_complex") + 1];
    assert.equal(lengthS, 8);
    assert.match(graph, /\[1:v\]setpts=\(PTS-STARTPTS\)\/0\.4,fps=24,minterpolate/);
    assert.match(graph, /atempo=0\.5,atempo=0\.8/);
    assert.match(graph, /concat=n=2:v=1:a=1/);
    assert.match(graph, /setpts=PTS-STARTPTS\+6\.6\/TB\[t0\]/);
    assert.match(graph, /overlay=0:-96:/);
    assert.deepEqual(args.slice(0, 6), ["-ss", "0", "-to", "4", "-i", "/a.mp4"]);
  });
});

describe("exporting a real edit", () => {
  const hasFfmpeg = (() => {
    try {
      execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  test("two clips, one slowed and faded in, become one film of the right length", { skip: !hasFfmpeg }, async () => {
    const dir = film("e2", []);
    const make = (name, color, sound) => {
      const out = join(dir, name);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=${color}:s=320x180:d=3:r=24`, ...(sound ? ["-f", "lavfi", "-i", "sine=f=440:d=3", "-shortest"] : []), "-c:v", "libx264", "-pix_fmt", "yuv420p", ...(sound ? ["-c:a", "aac"] : []), out]);
      return out;
    };
    const a = make("a.mp4", "red", true);
    const b = make("b.mp4", "blue", false);
    film("e2", [scene("s1", [v("j1", a)]), scene("s2", [v("j2", b)])]);
    saveEdit("e2", { clips: [{ scene: "s1", inS: 0.5, outS: 2.5 }, { scene: "s2", inS: 0, outS: 1, speed: 0.5, into: "fade" }] });
    const r = await exportEdit("e2", { dir, tools: { probe, ffmpeg, render: async () => assert.fail("no titles") }, outFor: () => join(dir, "film.mp4"), tmpDir: dir });
    assert.ok(existsSync(r.out));
    const p = await probe(r.out);
    assert.ok(Math.abs(p.durationS - 3.6) < 0.15, `length ${p.durationS}`);
    assert.equal(p.hasAudio, true);
    assert.deepEqual([p.width, p.height], [854, 480]);
  });
});
