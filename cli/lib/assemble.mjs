import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpeg, probe, requireFfmpeg, measureLoudness } from "./ffmpeg.mjs";
import { usage } from "./errors.mjs";

/**
 * Assembly is FINISHING, not segmentation.
 *
 * production.md's strongest rule is that one film is one job -- shots are not
 * separate generations. Nothing here weakens that. This exists for what a
 * generated film still lacks before it is a deliverable: a music bed under a
 * voiceover, consistent loudness, and (for an ad brief) two or three takes cut
 * together deliberately. If you find yourself generating five clips in order to
 * concatenate them, re-read production.md first -- that is the fallback it
 * warns about, not the workflow.
 */

/**
 * xfade offsets are cumulative and easy to get subtly wrong, which shows up as
 * a film that drifts shorter than intended. For clips d0..dn and transition D:
 *   offset(k) = sum(d[0..k]) - (k+1) * D
 * and the finished duration is sum(d) - n*D.
 */
export function crossfadePlan(durations, transitionS) {
  if (durations.length < 2) return { offsets: [], totalS: durations[0] ?? 0 };

  const shortest = Math.min(...durations);
  if (transitionS >= shortest) {
    throw usage(
      `Transition ${transitionS}s is not shorter than the shortest shot (${shortest}s). ` +
        `A crossfade must fit inside both clips it joins.`,
    );
  }

  const offsets = [];
  let cumulative = 0;
  for (let k = 0; k < durations.length - 1; k++) {
    cumulative += durations[k];
    offsets.push(Math.round((cumulative - (k + 1) * transitionS) * 1000) / 1000);
  }
  const totalS =
    durations.reduce((a, b) => a + b, 0) - transitionS * (durations.length - 1);
  return { offsets, totalS: Math.round(totalS * 1000) / 1000 };
}

function videoChain(shots, { transitionS, transition, width, height, fps }) {
  const norm = shots
    .map(
      (_, i) =>
        `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps}[v${i}]`,
    )
    .join(";");

  if (shots.length === 1) return { filter: norm, out: "[v0]" };
  if (!transitionS) {
    const inputs = shots.map((_, i) => `[v${i}]`).join("");
    return { filter: `${norm};${inputs}concat=n=${shots.length}:v=1:a=0[vout]`, out: "[vout]" };
  }

  const { offsets } = crossfadePlan(shots.map((s) => s.durationS), transitionS);
  let chain = norm;
  let prev = "[v0]";
  offsets.forEach((offset, k) => {
    const out = k === offsets.length - 1 ? "[vout]" : `[vx${k}]`;
    chain += `;${prev}[v${k + 1}]xfade=transition=${transition}:duration=${transitionS}:offset=${offset}${out}`;
    prev = out;
  });
  return { filter: chain, out: "[vout]" };
}

/**
 * The ad mix: music ducked under narration rather than merely quieter than it.
 * A fixed -18dB music bed either buries a quiet line or fights a loud one;
 * sidechain compression keyed on the voice tracks whatever the VO actually
 * does. Everything lands at -16 LUFS, the loudness every social platform
 * normalises to -- deliver hotter and the platform turns it down, unevenly.
 */
function audioChain(shots, { musicIndex, voIndex, keepShotAudio, totalS, musicGainDb, duck }) {
  const parts = [];
  const mix = [];

  if (keepShotAudio) {
    const withAudio = shots.map((s, i) => ({ ...s, i })).filter((s) => s.hasAudio);
    if (withAudio.length) {
      const tags = withAudio.map(({ i }) => {
        parts.push(`[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[sa${i}]`);
        return `[sa${i}]`;
      });
      if (tags.length === 1) {
        parts.push(`${tags[0]}anull[shots]`);
      } else {
        parts.push(`${tags.join("")}concat=n=${tags.length}:v=0:a=1[shots]`);
      }
      mix.push("[shots]");
    }
  }

  if (voIndex != null) {
    parts.push(
      `[${voIndex}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
        `apad=whole_dur=${totalS},atrim=0:${totalS}[vo]`,
    );
  }

  if (musicIndex != null) {
    // Loop the bed to cover the film, trim to length, fade both ends.
    const fadeOut = Math.max(0, totalS - 1.5);
    parts.push(
      `[${musicIndex}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
        `aloop=loop=-1:size=2e9,atrim=0:${totalS},` +
        `volume=${musicGainDb}dB,afade=t=in:st=0:d=1,afade=t=out:st=${fadeOut}:d=1.5[bed]`,
    );

    if (voIndex != null && duck) {
      parts.push(`[vo]asplit=2[vo1][vokey]`);
      parts.push(
        `[bed][vokey]sidechaincompress=threshold=0.05:ratio=8:attack=15:release=350[bedduck]`,
      );
      mix.push("[bedduck]", "[vo1]");
    } else {
      mix.push("[bed]");
      if (voIndex != null) mix.push("[vo]");
    }
  } else if (voIndex != null) {
    mix.push("[vo]");
  }

  if (!mix.length) return null;

  const merged =
    mix.length === 1
      ? `${mix[0]}anull[amix]`
      : `${mix.join("")}amix=inputs=${mix.length}:duration=longest:dropout_transition=0:normalize=0[amix]`;

  parts.push(merged);
  return { filter: parts.join(";"), out: "[amix]" };
}

export async function assemble({
  shots,
  music = null,
  vo = null,
  out,
  transitionS = 0,
  transition = "fade",
  ratio = "16:9",
  width,
  height,
  fps = 30,
  shotAudio = "auto",
  musicGainDb = -14,
  duck = true,
  onLine,
}) {
  requireFfmpeg();
  if (!shots.length) throw usage("assemble needs at least one --shot.");

  const probed = [];
  for (const s of shots) {
    const info = await probe(s);
    if (!info.hasVideo) throw usage(`${s} has no video stream.`);
    if (!info.durationS) throw usage(`Could not read a duration from ${s}.`);
    probed.push(info);
  }

  const keepShotAudio =
    shotAudio === "keep" ? true : shotAudio === "drop" ? false : !music && !vo;

  const inputs = [...shots];
  const musicIndex = music ? (inputs.push(music), inputs.length - 1) : null;
  const voIndex = vo ? (inputs.push(vo), inputs.length - 1) : null;

  const v = videoChain(probed, { transitionS, transition, width, height, fps });
  const totalS = transitionS
    ? crossfadePlan(probed.map((p) => p.durationS), transitionS).totalS
    : Math.round(probed.reduce((a, p) => a + p.durationS, 0) * 1000) / 1000;

  const a = audioChain(probed, {
    musicIndex,
    voIndex,
    keepShotAudio,
    totalS,
    musicGainDb,
    duck,
  });

  /**
   * Loudness is normalised in TWO passes, not one.
   *
   * Single-pass loudnorm is a dynamic normaliser: it lands somewhere near the
   * target, and on a mix with quiet stretches it misses by several LU. Measured
   * on this project's own test mix it delivered -19.3 LUFS against a stated
   * -16 -- a claim the tool did not meet. So the mix is rendered to a temp
   * file, measured, and re-normalised with the measured values fed back in,
   * which is linear and exact. Two extra audio passes; no video re-encode.
   */
  let mixedAudio = null;
  let loudness = null;
  let tmpDir = null;

  if (a) {
    tmpDir = await mkdtemp(join(tmpdir(), "kie-mix-"));
    mixedAudio = join(tmpDir, "mix.wav");

    const mixArgs = [];
    for (const i of inputs) mixArgs.push("-i", i);
    mixArgs.push(
      "-filter_complex", a.filter,
      "-map", a.out,
      "-c:a", "pcm_s24le",
      "-ar", "48000",
      "-t", String(totalS),
      mixedAudio,
    );
    await ffmpeg(mixArgs, { onLine });
    loudness = await measureLoudness(mixedAudio);
  }

  const args = [];
  for (const i of inputs) args.push("-i", i);
  if (mixedAudio) args.push("-i", mixedAudio);

  const audioFilter =
    mixedAudio && loudness
      ? `[${inputs.length}:a]loudnorm=I=-16:TP=-1.5:LRA=11:` +
        `measured_I=${loudness.inputI}:measured_TP=${loudness.inputTp}:` +
        `measured_LRA=${loudness.inputLra}:measured_thresh=${loudness.inputThresh}:` +
        `offset=${loudness.targetOffset}:linear=true[aout]`
      : null;

  args.push("-filter_complex", audioFilter ? `${v.filter};${audioFilter}` : v.filter);
  args.push("-map", v.out);
  if (mixedAudio) args.push("-map", audioFilter ? "[aout]" : `${inputs.length}:a`);
  args.push(
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-r", String(fps),
  );
  if (mixedAudio) args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000");
  args.push("-t", String(totalS), out);

  await ffmpeg(args, { onLine });
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });

  // Measure the delivered file rather than reporting the target. Two-pass gets
  // close but AAC encoding and loudnorm's own gating move it a little, and this
  // project's rule everywhere else is that a measurement outranks an intention.
  const delivered = a ? await measureLoudness(out) : null;

  return {
    out,
    totalS,
    shots: probed.map((p) => ({ path: p.path, durationS: p.durationS })),
    ratio,
    width,
    height,
    fps,
    audio: {
      shotAudio: keepShotAudio,
      music: music ?? null,
      vo: vo ?? null,
      ducked: Boolean(music && vo && duck),
      musicGainDb: music ? musicGainDb : null,
      loudnessTarget: a ? "-16 LUFS / -1.5 dBTP (EBU R128), two-pass linear" : null,
      loudnessDelivered: delivered
        ? { lufs: Math.round(delivered.inputI * 10) / 10, truePeakDb: Math.round(delivered.inputTp * 10) / 10 }
        : null,
      measuredBeforeNormalisation: loudness
        ? { lufs: loudness.inputI, truePeakDb: loudness.inputTp, lra: loudness.inputLra }
        : null,
    },
    transition: transitionS ? { kind: transition, durationS: transitionS } : null,
  };
}
