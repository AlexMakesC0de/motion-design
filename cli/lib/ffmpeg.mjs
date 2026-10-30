import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { usage, provider } from "./errors.mjs";

let checked = false;

/**
 * ffmpeg is the one binary dependency in this project. Everything else is
 * zero-install so the CLI works identically in three hosts; finishing is the
 * exception because there is no honest way to concatenate, mix and re-encode
 * video in pure Node.
 */
export function requireFfmpeg() {
  if (checked) return;
  for (const bin of ["ffmpeg", "ffprobe"]) {
    const found = (process.env.PATH ?? "")
      .split(":")
      .some((d) => d && existsSync(`${d}/${bin}`));
    if (!found) {
      throw usage(
        `${bin} not found on PATH. Finishing commands need it:\n` +
          `  brew install ffmpeg\n` +
          `Generation (kie video/image/audio) does not — only assemble, caption, variants and probe.`,
      );
    }
  }
  checked = true;
}

export function run(bin, args, { onLine, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, cwd ? { cwd } : undefined);
    let stderr = "";
    let stdout = "";

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => {
      const text = String(d);
      stderr += text;
      // ffmpeg's stderr is a firehose; keep only the tail for diagnosis.
      if (stderr.length > 40_000) stderr = stderr.slice(-20_000);
      onLine?.(text);
    });

    proc.on("error", (err) => reject(provider(`Could not run ${bin}: ${err.message}`)));
    proc.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      const tail = stderr.trim().split("\n").slice(-6).join("\n");
      reject(provider(`${bin} exited ${code}:\n${tail}`));
    });
  });
}

export const ffmpeg = (args, opts) => run("ffmpeg", ["-hide_banner", "-y", ...args], opts);

/** Real numbers off the file. Never assume a generated clip is the length you asked for. */
export async function probe(path) {
  requireFfmpeg();
  if (!existsSync(path)) throw usage(`No such file: ${path}`);

  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    path,
  ]);

  const data = JSON.parse(stdout);
  const v = data.streams.find((s) => s.codec_type === "video");
  const a = data.streams.find((s) => s.codec_type === "audio");

  const fps = v?.r_frame_rate?.includes("/")
    ? (() => {
        const [n, d] = v.r_frame_rate.split("/").map(Number);
        return d ? Math.round((n / d) * 1000) / 1000 : null;
      })()
    : null;

  return {
    path,
    durationS: Number(data.format?.duration) || null,
    sizeBytes: Number(data.format?.size) || null,
    width: v?.width ?? null,
    height: v?.height ?? null,
    fps,
    videoCodec: v?.codec_name ?? null,
    hasVideo: Boolean(v),
    hasAudio: Boolean(a),
    audioCodec: a?.codec_name ?? null,
    sampleRate: a ? Number(a.sample_rate) : null,
  };
}

/** EBU R128 measurement. Reported, never silently corrected. */
export async function measureLoudness(path) {
  requireFfmpeg();
  const { stderr } = await ffmpeg([
    "-i", path,
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
    "-f", "null", "-",
  ]);
  return parseLoudnorm(stderr);
}

/**
 * The loudnorm JSON report in ffmpeg's stderr. A silent track measures "-inf"
 * (and an offset of "inf"), which Number() turns into NaN; those become null so
 * a caller never has to tell NaN from a real reading.
 */
export function parseLoudnorm(text) {
  const match = text.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  if (!match) return null;
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  try {
    const j = JSON.parse(match[0]);
    return {
      inputI: num(j.input_i),
      inputTp: num(j.input_tp),
      inputLra: num(j.input_lra),
      inputThresh: num(j.input_thresh),
      targetOffset: num(j.target_offset),
    };
  } catch {
    return null;
  }
}

/**
 * The subtitles filter parses its argument, so a path containing a colon,
 * comma, bracket or quote silently becomes a different filter. On macOS an
 * absolute path always contains at least one colon-free segment but a run slug
 * or a drive-style path can still break it, so escape unconditionally.
 */
export function escapeFilterPath(path) {
  return path.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

export const RATIOS = {
  "16:9": [1920, 1080],
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
  "4:3": [1440, 1080],
  "21:9": [2560, 1080],
};

export function dimsFor(ratio) {
  const d = RATIOS[ratio];
  if (!d) {
    throw usage(`Unknown aspect ratio "${ratio}". Known: ${Object.keys(RATIOS).join(", ")}`);
  }
  return d;
}
