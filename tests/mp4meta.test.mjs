import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mp4Meta } from "../cli/lib/mp4meta.mjs";

const box = (type, ...parts) => {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, body]);
};

function mvhd(timescale, duration) {
  const b = Buffer.alloc(100);
  b.writeUInt32BE(timescale, 12);
  b.writeUInt32BE(duration, 16);
  return box("mvhd", b);
}

function tkhd(w, h) {
  const b = Buffer.alloc(84);
  b.writeUInt32BE(w * 65536, 76);
  b.writeUInt32BE(h * 65536, 80);
  return box("tkhd", b);
}

const dir = mkdtempSync(join(tmpdir(), "mp4meta-"));
const file = (name, buf) => {
  const p = join(dir, name);
  writeFileSync(p, buf);
  return p;
};

test("reads the length from moov/mvhd and the size from the video track's tkhd, with moov after the media", () => {
  const audio = box("trak", tkhd(0, 0));
  const video = box("trak", tkhd(720, 1280));
  const p = file("a.mp4", Buffer.concat([box("ftyp", Buffer.from("isom")), box("mdat", Buffer.alloc(1000)), box("moov", mvhd(1000, 6400), audio, video)]));
  assert.deepEqual(mp4Meta(p), { durationS: 6.4, width: 720, height: 1280 });
});

test("a file with no moov says nothing rather than guessing", () => {
  const p = file("b.mp4", Buffer.concat([box("ftyp", Buffer.from("isom")), Buffer.alloc(64)]));
  assert.deepEqual(mp4Meta(p), { durationS: null, width: null, height: null });
});
