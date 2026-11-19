import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/**
 * An audio file as MP3 in a fresh temporary folder, for formats a provider will
 * not take as they are (a phone's M4A voice memo). Returns the new path.
 */
export async function toMp3(path, { signal } = {}) {
  requireFfmpeg();
  const out = join(mkdtempSync(join(tmpdir(), "shard-voice-")), "voice.mp3");
  await ffmpegWriting(out, ["-i", path, "-vn", "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-q:a", "2", out], { signal });
  return out;
}

/** A voice card runs 5 to 15 seconds: long enough to carry the voice, short enough not to pay for more (kie bills a reference video by the second). */
export const CARD_MIN_S = 5;
export const CARD_MAX_S = 15;

/**
 * Where to cut a voice for its card, given its length and its pauses
 * ([{ start, end }] in seconds). A voice that fits is used whole. A longer one
 * is cut in the last pause that ends the card by `maxS`, so no word is cut in
 * half; with no such pause it is cut at `maxS` and faded out.
 * Returns { voiceS, seconds, fade }: the voice kept, the card's whole seconds.
 */
export function cardCut(durationS, pauses = [], { minS = CARD_MIN_S, maxS = CARD_MAX_S } = {}) {
  const whole = (t) => Math.max(2, Math.ceil(t - 1e-9));
  if (whole(durationS) <= maxS) return { voiceS: durationS, seconds: whole(durationS), fade: false };
  const cuts = pauses.filter((p) => p.start >= minS && p.start < maxS).map((p) => Math.min(p.end ?? Infinity, p.start + 0.25, maxS));
  if (cuts.length) {
    const voiceS = Math.round(Math.max(...cuts) * 100) / 100;
    return { voiceS, seconds: Math.min(maxS, whole(voiceS)), fade: false };
  }
  return { voiceS: maxS, seconds: maxS, fade: true };
}

/**
 * How quiet and how long a pause must be, strictest first. A trimmed or
 * loudness-levelled recording has short, not quite silent gaps, which only
 * the looser levels find.
 */
export const PAUSE_LEVELS = [
  { noiseDb: -35, minS: 0.2 },
  { noiseDb: -35, minS: 0.1 },
  { noiseDb: -30, minS: 0.1 },
];

/** The pauses in a recording at one level: stretches quieter than `noiseDb` for at least `minS`. */
export async function pauses(path, { noiseDb = -35, minS = 0.2, signal } = {}) {
  requireFfmpeg();
  const { stderr } = await ffmpeg(["-i", path, "-af", `silencedetect=noise=${noiseDb}dB:d=${minS}`, "-f", "null", "-"], { signal });
  return parsePauses(stderr);
}

/** Where to cut `path` for its card: at the strictest level that finds a pause in reach. */
async function cardCutOf(path, durationS, { signal } = {}) {
  let cut = cardCut(durationS);
  if (!cut.fade) return cut;
  for (const level of PAUSE_LEVELS) {
    cut = cardCut(durationS, await pauses(path, { ...level, signal }));
    if (!cut.fade) return cut;
  }
  return cut;
}

export function parsePauses(text) {
  const out = [];
  for (const m of String(text).matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const t = Number(m[2]);
    if (m[1] === "start") out.push({ start: Math.max(0, t), end: null });
    else if (out.length && out.at(-1).end == null) out.at(-1).end = t;
  }
  return out;
}

/**
 * A voice card: the character's voice on a black 1280x720 frame with their name
 * in white, 5 to 15 whole seconds (see cardCut; silence pads the end). Scenes
 * send it to Seedance as a reference video. The name is drawn by ffmpeg when
 * its build has drawtext, else by ImageMagick, else the card is plain black.
 * Returns { path, seconds, voiceS, faded, text }.
 */
export async function makeVoiceCard({ audio, out, text = "", durationS, signal } = {}) {
  requireFfmpeg();
  const length = durationS ?? (await probe(audio, { signal })).durationS;
  if (!Number.isFinite(length) || length <= 0) throw usage("Could not read how long that voice is.");
  const { voiceS, seconds, fade } = await cardCutOf(audio, length, { signal });
  const dir = mkdtempSync(join(tmpdir(), "shard-card-"));
  try {
    const name = cardText(text);
    const font = name ? cardFont() : null;
    let input = ["-f", "lavfi", "-i", `color=c=black:s=1280x720:r=24:d=${seconds}`];
    let vf = [];
    let drawn = false;
    if (name && font && (await hasFilter("drawtext"))) {
      const file = join(dir, "name.txt");
      writeFileSync(file, name);
      vf = ["-vf", `drawtext=fontfile=${escapeFilterPath(font)}:textfile=${escapeFilterPath(file)}:fontcolor=white:fontsize=110:x=(w-text_w)/2:y=(h-text_h)/2`];
      drawn = true;
    } else if (name && font && onPath("magick")) {
      const png = join(dir, "card.png");
      await run("magick", ["-size", "1280x720", "xc:black", "-font", font, "-fill", "white", "-pointsize", "110", "-gravity", "center", "-annotate", "+0+0", magickText(name), png], { signal });
      input = ["-loop", "1", "-framerate", "24", "-i", png];
      drawn = true;
    }
    const af = [`atrim=0:${voiceS}`, ...(fade ? [`afade=t=out:st=${Math.max(0, voiceS - 0.3)}:d=0.3`] : []), "apad"].join(",");
    await ffmpegWriting(
      out,
      [...input, "-i", audio, ...vf, "-map", "0:v", "-map", "1:a", "-af", af, "-t", String(seconds), "-r", "24", "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ac", "1", "-movflags", "+faststart", out],
      { signal },
    );
    return { path: out, seconds, voiceS: Math.round(voiceS * 100) / 100, faded: fade, text: drawn ? name : "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One line, at most 40 characters, no control characters. */
export const cardText = (text) => String(text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
// ImageMagick reads "@file" and expands "%" and "\" in annotate text.
const magickText = (t) => t.replace(/\\/g, "\\\\").replace(/%/g, "%%").replace(/^@/, "\\@");
const onPath = (bin) => (process.env.PATH ?? "").split(":").some((d) => d && existsSync(`${d}/${bin}`));
const FONTS = ["/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/SFNS.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/TTF/DejaVuSans.ttf", "C:\\Windows\\Fonts\\arial.ttf"];
const cardFont = () => FONTS.find((f) => existsSync(f)) ?? null;
const filters = new Map();
async function hasFilter(name) {
  if (!filters.has(name)) filters.set(name, run("ffmpeg", ["-hide_banner", "-filters"]).then(({ stdout }) => new RegExp(`\\s${name}\\s`).test(stdout)).catch(() => false));
  return filters.get(name);
}

/** What core/voice.mjs prepareVoice and the voice card need from ffmpeg. */
export const voiceTools = { probe: (path) => probe(path), convert: (path) => toMp3(path), card: (opts) => makeVoiceCard(opts) };

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
