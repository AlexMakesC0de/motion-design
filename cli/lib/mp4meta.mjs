// The length and picture size of an MP4 or MOV, read from its own boxes:
// moov/mvhd for the duration and the first video trak's tkhd for the size.
// No ffprobe, so pricing a clip by its seconds works on a machine whose
// ffmpeg is missing or broken. Reads box headers only, never the media.
import { closeSync, fstatSync, openSync, readSync } from "node:fs";

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  const n = readSync(fd, buf, 0, len, pos);
  return buf.subarray(0, n);
}

/** The boxes between start and end: [{ type, start, size, body }]. */
function boxes(fd, start, end) {
  const out = [];
  let pos = start;
  while (pos + 8 <= end) {
    const head = readAt(fd, pos, 16);
    if (head.length < 8) break;
    let size = head.readUInt32BE(0);
    const type = head.toString("latin1", 4, 8);
    let header = 8;
    if (size === 1) {
      if (head.length < 16) break;
      size = Number(head.readBigUInt64BE(8));
      header = 16;
    } else if (size === 0) size = end - pos;
    if (size < header || pos + size > end) break;
    out.push({ type, start: pos, size, body: pos + header });
    pos += size;
  }
  return out;
}

/** { durationS, width, height }, any of them null when the file does not say. Throws only on an unreadable file. */
export function mp4Meta(path) {
  const fd = openSync(path, "r");
  try {
    const end = fstatSync(fd).size;
    const moov = boxes(fd, 0, end).find((b) => b.type === "moov");
    if (!moov) return { durationS: null, width: null, height: null };
    const inner = boxes(fd, moov.body, moov.start + moov.size);
    let durationS = null;
    const mvhd = inner.find((b) => b.type === "mvhd");
    if (mvhd) {
      const v = readAt(fd, mvhd.body, 32);
      const version = v[0];
      const timescale = version === 1 ? v.readUInt32BE(20) : v.readUInt32BE(12);
      const duration = version === 1 ? Number(v.readBigUInt64BE(24)) : v.readUInt32BE(16);
      if (timescale > 0 && duration > 0 && duration !== 0xffffffff) durationS = Math.round((duration / timescale) * 1000) / 1000;
    }
    let width = null;
    let height = null;
    for (const trak of inner.filter((b) => b.type === "trak")) {
      const tkhd = boxes(fd, trak.body, trak.start + trak.size).find((b) => b.type === "tkhd");
      if (!tkhd) continue;
      const v = readAt(fd, tkhd.body, 92);
      const off = v[0] === 1 ? 88 : 76; // width and height are the last 8 bytes, 16.16 fixed point
      if (v.length < off + 8) continue;
      const w = v.readUInt32BE(off) / 65536;
      const h = v.readUInt32BE(off + 4) / 65536;
      if (w > 0 && h > 0) {
        width = Math.round(w);
        height = Math.round(h);
        break; // the first track with a picture size is the video
      }
    }
    return { durationS, width, height };
  } finally {
    closeSync(fd);
  }
}
