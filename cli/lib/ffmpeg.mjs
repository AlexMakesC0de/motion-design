import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
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

/**
 * Run a program to completion. With `signal`, aborting it stops the program
 * and everything it started (npx starts node starts a headless browser), then
 * rejects: SIGTERM to the whole process group, SIGKILL `killGraceMs` later for
 * anything that ignored it. Only a call that is given a signal puts the child
 * in its own process group, so the CLI and MCP server behave as before.
 */
export function run(bin, args, { onLine, cwd, signal, killGraceMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const stopped = () => provider(`${bin} was stopped before it finished.`);
    if (signal?.aborted) return reject(stopped());

    const proc = spawn(bin, args, { ...(cwd ? { cwd } : {}), ...(signal ? { detached: true } : {}) });
    let stderr = "";
    let stdout = "";
    let aborted = false; // the signal fired while the program was running
    let exited = false;
    let stoppedByAbort = false; // the program has exited because of it
    let finished = false;
    let killer = null;
    let forced = false; // SIGKILL has gone to the whole group

    const finish = (fn) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", onAbort);
      clearTimeout(killer); // nothing is left to kill, or it already was
      fn();
    };
    const kill = (sig) => {
      try {
        process.kill(-proc.pid, sig); // the whole group
      } catch {
        try {
          proc.kill(sig);
        } catch {
          /* already gone */
        }
      }
    };
    const groupGone = () => {
      try {
        process.kill(-proc.pid, 0);
        return false;
      } catch {
        return true;
      }
    };
    function onAbort() {
      aborted = true;
      kill("SIGTERM");
      // Whatever is still running when the grace is up is killed outright.
      killer = setTimeout(() => {
        forced = true;
        kill("SIGKILL");
        if (exited) finish(() => reject(stopped()));
      }, killGraceMs);
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => {
      const text = String(d);
      stderr += text;
      // ffmpeg's stderr is a firehose; keep only the tail for diagnosis.
      if (stderr.length > 40_000) stderr = stderr.slice(-20_000);
      onLine?.(text);
    });

    proc.on("error", (err) => finish(() => reject(provider(`Could not run ${bin}: ${err.message}`))));
    // After an abort the program's exit is what counts, not "close": a browser it
    // left holding the output pipes would delay that. Anything of its group still
    // running (the browser) is killed when the grace ends, and only then do we reject.
    proc.on("exit", () => {
      exited = true;
      if (!aborted) return;
      stoppedByAbort = true;
      proc.stdout.destroy();
      proc.stderr.destroy();
      // After SIGKILL the group may still answer for a moment as unreaped
      // processes (Linux), and no timer is left to check again: count it as gone.
      if (forced || groupGone()) finish(() => reject(stopped()));
    });
    proc.on("close", (code) => {
      if (stoppedByAbort) return;
      finish(() => {
        if (code === 0) return resolve({ stdout, stderr });
        const tail = stderr.trim().split("\n").slice(-6).join("\n");
        reject(provider(`${bin} exited ${code}:\n${tail}`));
      });
    });
  });
}

export const ffmpeg = (args, opts) => run("ffmpeg", ["-hide_banner", "-y", ...args], opts);

/**
 * ffmpeg writing the file `out`. When `opts.signal` stops it, the half-written
 * file is removed rather than left to look like a finished (unplayable) output.
 */
export async function ffmpegWriting(out, args, opts = {}) {
  try {
    return await ffmpeg(args, opts);
  } catch (err) {
    if (opts.signal?.aborted) rmSync(out, { force: true });
    throw err;
  }
}

/** Real numbers off the file. Never assume a generated clip is the length you asked for. */
export async function probe(path, { signal } = {}) {
  requireFfmpeg();
  if (!existsSync(path)) throw usage(`No such file: ${path}`);

  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    path,
  ], { signal });

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
export async function measureLoudness(path, { signal } = {}) {
  requireFfmpeg();
  const { stderr } = await ffmpeg([
    "-i", path,
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
    "-f", "null", "-",
  ], { signal });
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
  // Own keys only: "constructor" or "__proto__" is not a ratio.
  const d = Object.hasOwn(RATIOS, ratio) ? RATIOS[ratio] : null;
  if (!d) {
    throw usage(`Unknown aspect ratio "${ratio}". Known: ${Object.keys(RATIOS).join(", ")}`);
  }
  return d;
}
