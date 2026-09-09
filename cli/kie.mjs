#!/usr/bin/env node
// kie -- execution layer for the motion-design skill.
//
// The skill decides WHAT film to make. This decides HOW it reaches kie.ai, what
// it costs, and where the record lands. No creative judgement lives here, and
// no kie.ai model id, endpoint or price lives in the skill. See cli/README.md.

import { parseArgs } from "node:util";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { EXIT, CliError, usage, unknown } from "./lib/errors.mjs";
import { loadCatalog, resolveModel, validateVideoRequest, parseRef, isStale, catalogAgeDays } from "./lib/models.mjs";
import { apiKey, createTask, credits, redact } from "./lib/client.mjs";
import { waitForTask, download, extractUrls } from "./lib/poll.mjs";
import { uploadFile } from "./lib/upload.mjs";
import { preflight, creditsAfter } from "./lib/budget.mjs";
import { runDir, nextArtifact, extFromUrl, writeRecord, outPath, inPath, REPO_ROOT } from "./lib/run.mjs";
import * as ledger from "./lib/ledger.mjs";
import { loadPresets, findPreset, routeFor } from "./lib/presets.mjs";
import { probe, measureLoudness, dimsFor } from "./lib/ffmpeg.mjs";
import { assemble } from "./lib/assemble.mjs";
import { burnCaptions } from "./lib/caption.mjs";
import { makeVariants, captionOrderWarning } from "./lib/variants.mjs";
import { render, TEMPLATES, BRAND_DIR } from "./lib/render.mjs";

const HELP = `kie -- motion-design execution layer

  kie models     [--capability video|image|audio] [--json]
  kie presets    [--json]
  kie preflight  --model M [--duration N] [--ar R] [--budget U]
  kie doctor
  kie upload     <path>

  kie video      --run SLUG (--prompt-file F | --preset P) [--model M]
                 [--duration N] [--ar R] [--ref URL:ROLE]... [--budget U]
                 [--no-wait] [--dry-run]
  kie image      --run SLUG --prompt "..." [--model M] [--resolution R]
                 [--quality Q] [--ar R] [--budget U] [--dry-run]
  kie audio      --run SLUG (--music "..." | --tts-file F) [--model M]
                 [--voice V] [--budget U] [--dry-run]

  kie job        <taskId> [--family jobs|veo] [--run SLUG]
  kie spend      [--today] [--run SLUG] [--since YYYY-MM-DD] [--json]

Finishing (local ffmpeg — no key, no spend):
  kie probe      <file>
  kie assemble   --run SLUG --shot A.mp4 [--shot B.mp4]... [--music M] [--vo V]
                 [--transition fade:0.5] [--ratio 16:9] [--shot-audio auto|keep|drop]
                 [--out film.mp4]
  kie caption    --run SLUG --video F --srt S [--style social|subtle] [--out C.mp4]
  kie variants   --run SLUG --video F --ratios 9:16,1:1 [--mode blur|crop|pad]

Graphic motion (code-rendered — no key, no spend):
  kie templates
  kie render     --run SLUG --template T [--props P.json] [--ratio R] [--duration N]
                 [--brand NAME] [--alpha] [--out X.mp4]

Exit codes: 0 ok · 1 usage · 2 budget refused (nothing spent) · 3 unknown model
            4 provider error · 5 uncertain -- rejoin with \`kie job <id>\`, never resubmit

The API key is read from KIE_API_KEY, ./.env or ~/.config/kie/key. Never a flag.
`;

const OPTS = {
  capability: { type: "string" },
  json: { type: "boolean", default: false },
  model: { type: "string" },
  preset: { type: "string" },
  run: { type: "string" },
  "prompt-file": { type: "string" },
  prompt: { type: "string" },
  duration: { type: "string" },
  ar: { type: "string" },
  ref: { type: "string", multiple: true, default: [] },
  budget: { type: "string" },
  resolution: { type: "string" },
  quality: { type: "string" },
  // `--music` is a prompt in `kie audio` and a file in `kie assemble`. Both
  // read naturally in their own command and the two never co-occur.
  music: { type: "string" },
  vo: { type: "string" },
  "tts-file": { type: "string" },
  voice: { type: "string" },
  family: { type: "string" },
  shot: { type: "string", multiple: true, default: [] },
  video: { type: "string" },
  srt: { type: "string" },
  style: { type: "string" },
  transition: { type: "string" },
  "shot-audio": { type: "string" },
  "music-gain": { type: "string" },
  "no-duck": { type: "boolean", default: false },
  // `--ar` is the generation-side name (it mirrors the provider field) and
  // `--ratio` reads better for finishing. Both accepted everywhere rather than
  // making the user remember which half of the tool they are in.
  ratio: { type: "string" },
  ratios: { type: "string" },
  mode: { type: "string" },
  fps: { type: "string" },
  out: { type: "string" },
  "out-dir": { type: "string" },
  template: { type: "string" },
  props: { type: "string" },
  brand: { type: "string" },
  alpha: { type: "boolean", default: false },
  font: { type: "string" },
  "font-size": { type: "string" },
  today: { type: "boolean", default: false },
  since: { type: "string" },
  "no-wait": { type: "boolean", default: false },
  "dry-run": { type: "boolean", default: false },
  help: { type: "boolean", default: false },
};

const num = (v) => (v == null ? undefined : Number(v));
const say = (...a) => console.log(...a);
const warn = (...a) => console.error(...a);

function warnIfStale(catalog) {
  if (isStale(catalog)) {
    warn(
      `! cli/models.json was captured ${catalogAgeDays(catalog)} days ago. kie.ai's catalog ` +
        `moves fast; prices and schemas here may be wrong. Re-verify before trusting a budget.`,
    );
  }
}

function warnIfUnverified(model) {
  if (!model.verified) {
    warn(
      `! ${model.id} is unverified: no job has succeeded on it from this machine, so its ` +
        `price ($${model.priceUsd}) and schema in models.json are unconfirmed. ` +
        `Set "verified": true once you've seen real output.`,
    );
  }
}

// ---------------------------------------------------------------- read-only

function cmdModels(catalog, args) {
  const list = catalog.list.filter(
    (m) => !args.capability || m.capability === args.capability,
  );
  if (args.json) return say(JSON.stringify(list, null, 2));

  warnIfStale(catalog);
  for (const cap of ["video", "image", "audio"]) {
    const rows = list.filter((m) => m.capability === cap);
    if (!rows.length) continue;
    say(`\n${cap.toUpperCase()}`);
    for (const m of rows) {
      const spec = [
        m.durationsS ? `${m.durationsS.join("/")}s` : null,
        m.aspectRatios ? m.aspectRatios.join(" ") : null,
        m.nativeAudio ? "native-audio" : null,
        m.refs ? `refs: ${m.refs.join("/")}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      say(`  ${m.id.padEnd(18)} $${String(m.priceUsd).padEnd(6)} ${m.verified ? " " : "?"} ${spec}`);
      if (m.notes) say(`  ${" ".repeat(18)} ${m.notes}`);
    }
  }
  say(`\n  ? = unverified (no successful job recorded yet)`);
}

function cmdPresets(catalog, args) {
  const presets = loadPresets();
  if (args.json) return say(JSON.stringify(presets, null, 2));

  for (const p of presets) {
    let route;
    try {
      route = routeFor(p, catalog);
    } catch {
      route = null;
    }
    const d = p.defaults ?? {};
    say(`\n${p.id}  —  ${p.title}`);
    say(`  ${p.tagline ?? ""}`);
    say(`  best for: ${p.best_for ?? "—"}`);
    say(`  defaults: ${d.duration_s}s ${d.aspect_ratio} ${d.fps}fps`);
    if (route) {
      const tag = route.fidelity === "native" ? "NATIVE" : "adaptation";
      say(`  route:    ${route.modelId} [${tag}]  (source: ${route.sourceLabel ?? "?"})`);
      if (route.fidelity !== "native") say(`            ${route.note}`);
    } else {
      say(`  route:    (none mapped)`);
    }
  }
}

async function cmdDoctor(catalog) {
  let failures = 0;
  const ok = (m) => say(`  ok    ${m}`);
  const bad = (m) => {
    failures += 1;
    say(`  FAIL  ${m}`);
  };

  say("kie doctor\n");

  let key = null;
  try {
    key = apiKey();
    ok(`API key found (${key.slice(0, 4)}…${key.slice(-2)})`);
  } catch (e) {
    bad(e.message.split("\n")[0]);
  }

  const age = catalogAgeDays(catalog);
  (isStale(catalog) ? bad : ok)(
    `models.json captured ${catalog.captured}${age != null ? ` (${age}d ago)` : ""}`,
  );

  const unverified = catalog.list.filter((m) => !m.verified);
  say(
    `  ${unverified.length ? "warn " : "ok   "} ${catalog.list.length - unverified.length}/${catalog.list.length} models verified` +
      (unverified.length ? ` — unverified: ${unverified.map((m) => m.id).join(", ")}` : ""),
  );

  if (key) {
    try {
      const { credits: c, raw } = await credits(catalog, { key });
      c == null
        ? bad(`credit endpoint answered but no balance found: ${JSON.stringify(raw).slice(0, 200)}`)
        : ok(`account credits: ${c}`);
    } catch (e) {
      bad(`credit check: ${e.message}`);
    }
  }

  try {
    const presets = loadPresets();
    const mapped = presets.filter((p) => p.kie?.native || p.kie?.route?.length);
    ok(`presets: ${mapped.length}/${presets.length} routed to a kie model`);
    const native = presets.filter((p) => p.kie?.native);
    say(`        native-route presets: ${native.map((p) => p.id).join(", ") || "none"}`);
  } catch (e) {
    bad(`presets.json: ${e.message}`);
  }

  say(`\n${failures ? `${failures} check(s) failed.` : "All checks passed."}`);
  return failures ? EXIT.PROVIDER : EXIT.OK;
}

function cmdPreflight(catalog, args) {
  const model = resolveModel(catalog, args.model);
  const problems =
    model.capability === "video"
      ? validateVideoRequest(catalog, model, {
          durationS: num(args.duration),
          aspectRatio: args.ar,
          refs: (args.ref ?? []).map(parseRef),
        })
      : [];

  const cap = num(args.budget) ?? catalog.defaultBudgetUsd?.[model.capability];
  say(`model:     ${model.id} (${model.capability}) ${model.verified ? "" : "[unverified]"}`);
  say(`estimate:  $${(model.priceUsd ?? 0).toFixed(2)}   budget: $${Number(cap).toFixed(2)}`);
  if (model.notes) say(`note:      ${model.notes}`);

  if (problems.length) {
    say(`\nWould be refused:`);
    for (const p of problems) say(`  · ${p}`);
    return EXIT.UNKNOWN;
  }
  if ((model.priceUsd ?? 0) > cap) {
    say(`\nWould be refused: over budget.`);
    return EXIT.BUDGET;
  }
  say(`\nOK to submit. Nothing was sent to kie.ai.`);
  return EXIT.OK;
}

function cmdSpend(args) {
  const rows = ledger.filter(ledger.read(), {
    run: args.run,
    today: args.today,
    since: args.since,
  });
  const s = ledger.summarise(rows);
  if (args.json) return say(JSON.stringify({ ...s, entries: rows }, null, 2));

  say(`jobs:           ${s.jobs}${s.failures ? `  (${s.failures} failed)` : ""}`);
  say(`estimated:      $${s.estimatedUsd.toFixed(2)}   (from models.json — a guess)`);
  say(
    s.creditsUsed == null
      ? `credits used:   not sampled`
      : `credits used:   ${s.creditsUsed}   (measured across ${s.creditSamples} job(s) — a fact)`,
  );
  if (s.byModel.length) {
    say(`\nby model`);
    for (const m of s.byModel) say(`  ${String(m.model).padEnd(18)} ${String(m.jobs).padStart(3)}  $${m.estimated.toFixed(2)}`);
  }
}

// -------------------------------------------------------------- generation

/** Shared submit → poll → download → record path for every capability. */
async function generate(catalog, { capability, model, input, args, artifactBase }) {
  const key = apiKey();
  const dir = runDir(args.run);

  warnIfStale(catalog);
  warnIfUnverified(model);

  const { estimatedUsd, cap, creditsBefore } = await preflight(catalog, model, {
    budgetUsd: num(args.budget),
    key,
  });

  if (args["dry-run"]) {
    say(`dry run — nothing submitted.`);
    say(`  model:    ${model.id} → ${model.model}`);
    say(`  estimate: $${estimatedUsd.toFixed(2)} (budget $${Number(cap).toFixed(2)})`);
    say(`  input:    ${JSON.stringify(input).slice(0, 600)}`);
    await writeRecord(dir, "planned.json", { model: model.id, input, estimatedUsd });
    return EXIT.OK;
  }

  const fam = catalog.api.families[model.family];
  const payload =
    fam.bodyShape === "flat"
      ? { model: model.model, ...input }
      : { model: model.model, input };

  const { taskId, raw: createRaw } = await createTask(catalog, model.family, payload, { key });
  say(`submitted ${taskId} (${model.id})`);

  const base = {
    run: args.run,
    capability,
    model: model.id,
    providerModel: model.model,
    taskId,
    estimatedUsd,
    creditsBefore,
  };

  if (args["no-wait"]) {
    ledger.append({ ...base, status: "submitted" });
    await writeRecord(dir, "job.json", { ...base, create: createRaw, state: "submitted" });
    say(`not waiting. Rejoin with: kie job ${taskId} --family ${model.family} --run ${args.run}`);
    return EXIT.OK;
  }

  let result;
  try {
    result = await waitForTask(catalog, model.family, taskId, {
      key,
      onTick: (state, s) => process.stderr.write(`\r  ${state} ${s}s   `),
    });
    process.stderr.write("\n");
  } catch (err) {
    process.stderr.write("\n");
    ledger.append({
      ...base,
      status: err.code === EXIT.UNCERTAIN ? "uncertain" : "failed",
      creditsAfter: await creditsAfter(catalog, { key }),
      error: redact(err.message),
    });
    await writeRecord(dir, "job.json", {
      ...base,
      state: err.code === EXIT.UNCERTAIN ? "uncertain" : "failed",
      error: redact(err.message),
      raw: err.data ?? null,
    });
    throw err;
  }

  const saved = [];
  for (const url of result.urls) {
    const { path } = nextArtifact(dir, artifactBase, extFromUrl(url, ".bin"));
    await download(url, path);
    saved.push(path);
    say(`  → ${path}`);
  }

  const after = await creditsAfter(catalog, { key });
  ledger.append({ ...base, status: "success", creditsAfter: after, elapsedS: result.elapsedS });
  await writeRecord(dir, "job.json", {
    ...base,
    state: "success",
    elapsedS: result.elapsedS,
    urls: result.urls,
    artifacts: saved.map((p) => basename(p)),
    creditsAfter: after,
    raw: result.data,
  });
  await writeRecord(dir, "cost.json", {
    estimatedUsd,
    creditsBefore,
    creditsAfter: after,
    creditsUsed:
      typeof creditsBefore === "number" && typeof after === "number"
        ? creditsBefore - after
        : null,
    note: "estimatedUsd is from cli/models.json and is a guess; credit figures are measured.",
  });

  if (typeof creditsBefore === "number" && typeof after === "number") {
    say(`cost: ${creditsBefore - after} credits (estimated $${estimatedUsd.toFixed(2)})`);
  }
  return EXIT.OK;
}

/**
 * A preset's default duration and its native model's real capability often
 * disagree -- three presets default to 15s while the model their source prompt
 * was generated on tops out at 10s. production.md is explicit that retiming is
 * a decision requiring a retiming map, not something a tool does quietly. So
 * the CLI refuses and lays out both routes with their actual cost in fidelity.
 */
function durationAdvice(catalog, preset, model, requestedS) {
  if (!model.durationsS?.length || model.durationsS.includes(requestedS)) return "";

  const nearest = model.durationsS.reduce((a, b) =>
    Math.abs(b - requestedS) < Math.abs(a - requestedS) ? b : a,
  );
  const alts = catalog.list
    .filter((m) => m.capability === "video" && m.durationsS?.includes(requestedS))
    .map((m) => m.id);

  const native = preset.kie?.native === model.id;
  const lines = [
    ``,
    ``,
    `Two ways forward for "${preset.id}":`,
    `  a) --duration ${nearest}  — keeps ${model.id}${native ? " (the model this source prompt was generated on)" : ""},`,
    `     but ${requestedS}s → ${nearest}s is a retime. production.md wants an explicit retiming`,
    `     map for that; do not report the timing as unchanged.`,
  ];
  if (alts.length) {
    lines.push(
      `  b) --model ${alts[0]}  — holds ${requestedS}s${native ? ", but drops the native route to an adaptation" : ""}.`,
    );
  }
  if (preset.structure) {
    lines.push(``, `  Source note: ${preset.structure}`);
  }
  return lines.join("\n");
}

async function cmdVideo(catalog, args) {
  const presets = loadPresets();
  let promptPath = args["prompt-file"];
  let modelId = args.model;
  let durationS = num(args.duration);
  let aspectRatio = args.ar;
  let preset = null;

  if (args.preset) {
    preset = findPreset(presets, args.preset);
    const route = routeFor(preset, catalog, { override: args.model });
    modelId ??= route.modelId;
    durationS ??= route.defaults.duration_s;
    aspectRatio ??= route.defaults.aspect_ratio;
    promptPath ??= join(REPO_ROOT, "skills", "motion-design", route.promptPath ?? "");

    say(`preset:   ${preset.id} [${route.fidelity}]`);
    say(`          ${route.note}`);
    if (route.fidelity !== "native") {
      warn(
        `! This is an adaptation, not a reproduction. Say so when you report the result — ` +
          `SKILL.md requires the distinction.`,
      );
    }
  }

  if (!promptPath) {
    throw usage(
      "Need --prompt-file or --preset.\n" +
        "Video prompts are 5–13KB with structured newlines; they are read from a file, " +
        "never argv, so the exact submitted bytes land in the run record intact.",
    );
  }
  if (!existsSync(promptPath)) throw usage(`No such prompt file: ${promptPath}`);
  if (!modelId) throw usage("Need --model (or --preset, which supplies one). See: kie models");

  const model = resolveModel(catalog, modelId, "video");
  const refs = (args.ref ?? []).map(parseRef);

  const problems = validateVideoRequest(catalog, model, { durationS, aspectRatio, refs });
  if (problems.length) {
    throw unknown(
      `Refused before submitting — nothing was spent:\n` +
        problems.map((p) => `  · ${p}`).join("\n") +
        (preset ? durationAdvice(catalog, preset, model, durationS) : ""),
    );
  }

  const prompt = readFileSync(promptPath, "utf8");
  const dir = runDir(args.run);
  await writeRecord(dir, "prompt.txt", prompt);
  await writeRecord(dir, "inputs.json", {
    preset: preset?.id ?? null,
    sourcePromptPath: preset?.source?.prompt_path ?? null,
    sourcePromptSha256: preset?.source?.prompt_sha256 ?? null,
    model: model.id,
    durationS,
    aspectRatio,
    refs,
    promptChars: prompt.length,
  });

  const hasFirstFrame = refs.find((r) => r.role === "first_frame");
  const input = {
    prompt,
    ...(durationS ? { duration: durationS } : {}),
    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
    ...(hasFirstFrame ? { image_url: hasFirstFrame.url } : {}),
    ...(refs.length ? { references: refs.map((r) => ({ url: r.url, role: r.role })) } : {}),
  };

  // A first-frame reference makes this image-to-video on models that split the two.
  const effective = hasFirstFrame && model.i2vModel ? { ...model, model: model.i2vModel } : model;

  return generate(catalog, {
    capability: "video",
    model: effective,
    input,
    args,
    artifactBase: "out",
  });
}

async function cmdImage(catalog, args) {
  if (!args.prompt) throw usage("Need --prompt.");
  const model = resolveModel(catalog, args.model ?? "gpt-image-2", "image");

  if (args.resolution && model.resolutions && !model.resolutions.includes(args.resolution)) {
    throw unknown(`${model.id} supports resolutions ${model.resolutions.join(", ")}.`);
  }
  if (args.quality && model.qualities && !model.qualities.includes(args.quality)) {
    throw unknown(`${model.id} supports qualities ${model.qualities.join(", ")}.`);
  }

  const dir = runDir(args.run);
  await writeRecord(dir, "image-prompt.txt", args.prompt);

  return generate(catalog, {
    capability: "image",
    model,
    input: {
      prompt: args.prompt,
      ...(args.resolution ? { resolution: args.resolution } : {}),
      ...(args.quality ? { quality: args.quality } : {}),
      ...(args.ar ? { aspect_ratio: args.ar } : {}),
    },
    args,
    artifactBase: "ref",
  });
}

async function cmdAudio(catalog, args) {
  const isTts = Boolean(args["tts-file"]);
  if (!isTts && !args.music) throw usage("Need --music \"...\" or --tts-file <file>.");

  const model = resolveModel(
    catalog,
    args.model ?? (isTts ? "elevenlabs-tts" : "suno-music"),
    "audio",
  );

  let input;
  if (isTts) {
    if (!existsSync(args["tts-file"])) throw usage(`No such file: ${args["tts-file"]}`);
    input = {
      text: readFileSync(args["tts-file"], "utf8"),
      ...(args.voice ? { voice_id: args.voice } : {}),
    };
  } else {
    input = { prompt: args.music, instrumental: true };
  }

  return generate(catalog, {
    capability: "audio",
    model,
    input,
    args,
    artifactBase: isTts ? "vo" : "music",
  });
}

async function cmdJob(catalog, args, taskId) {
  if (!taskId) throw usage("kie job <taskId>");
  const key = apiKey();
  const family = args.family ?? "jobs";

  const result = await waitForTask(catalog, family, taskId, {
    key,
    onTick: (state, s) => process.stderr.write(`\r  ${state} ${s}s   `),
  });
  process.stderr.write("\n");

  if (!args.run) {
    say(`success. ${result.urls.length} artifact(s):`);
    for (const u of result.urls) say(`  ${u}`);
    say(`\nPass --run <slug> to download into a run directory.`);
    return EXIT.OK;
  }

  const dir = runDir(args.run);
  for (const url of result.urls) {
    const { path } = nextArtifact(dir, "out", extFromUrl(url, ".bin"));
    await download(url, path);
    say(`  → ${path}`);
  }
  ledger.append({ run: args.run, taskId, status: "success", rejoined: true, model: "(rejoined)" });
  await writeRecord(dir, "job.json", {
    taskId,
    state: "success",
    rejoined: true,
    urls: result.urls,
    raw: result.data,
  });
  return EXIT.OK;
}

// --------------------------------------------------- finishing (local, free)

const tick = (line) => {
  const m = String(line).match(/time=(\d+:\d+:\d+\.\d+)/);
  if (m) process.stderr.write(`\r  encoding ${m[1]}   `);
};

async function cmdProbe(positionals) {
  if (!positionals[0]) throw usage("kie probe <file>");
  const info = await probe(positionals[0]);
  const loud = info.hasAudio ? await measureLoudness(positionals[0]) : null;

  say(`${info.path}`);
  say(`  duration  ${info.durationS?.toFixed(2)}s`);
  say(`  video     ${info.width}×${info.height} @ ${info.fps}fps (${info.videoCodec})`);
  say(
    info.hasAudio
      ? `  audio     ${info.audioCodec} ${info.sampleRate}Hz` +
          (loud ? `  ${loud.inputI.toFixed(1)} LUFS, peak ${loud.inputTp.toFixed(1)} dBTP` : "")
      : `  audio     none`,
  );
  say(`  size      ${(info.sizeBytes / 1e6).toFixed(2)}MB`);
  if (loud && loud.inputI > -12) {
    say(`\n  ! ${loud.inputI.toFixed(1)} LUFS is hot. Social platforms normalise to about -16;`);
    say(`    deliver hotter and they turn it down, unevenly. \`kie assemble\` corrects this.`);
  }
  return EXIT.OK;
}

async function cmdAssemble(args) {
  const dir = runDir(args.run);
  const shots = args.shot.map((s) => inPath(dir, s));
  for (const s of shots) if (!existsSync(s)) throw usage(`No such shot: ${s}`);

  let transitionKind = "fade";
  let transitionS = 0;
  if (args.transition) {
    const [kind, secs] = args.transition.split(":");
    transitionKind = kind || "fade";
    transitionS = Number(secs ?? 0.5);
    if (!Number.isFinite(transitionS) || transitionS <= 0) {
      throw usage(`--transition wants "<kind>:<seconds>", e.g. fade:0.5 — got "${args.transition}".`);
    }
  }

  const ratio = args.ar ?? "16:9";
  const [width, height] = dimsFor(ratio);
  const out = outPath(dir, args.out, "film", ".mp4");

  if (shots.length > 1) {
    warn(
      `! Assembling ${shots.length} shots. production.md treats a film as ONE generation — ` +
        `if these came from separate jobs to work around a duration limit, say so in the review.`,
    );
  }

  const result = await assemble({
    shots,
    music: inPath(dir, args.music),
    vo: inPath(dir, args.vo),
    out,
    transitionS,
    transition: transitionKind,
    ratio,
    width,
    height,
    fps: Number(args.fps ?? 30),
    shotAudio: args["shot-audio"] ?? "auto",
    musicGainDb: Number(args["music-gain"] ?? -14),
    duck: !args["no-duck"],
    onLine: tick,
  });
  process.stderr.write("\n");

  await writeRecord(dir, "assembly.json", result);
  say(`  → ${result.out}  (${result.totalS}s, ${width}×${height})`);
  if (result.audio.loudnessTarget) {
    const d = result.audio.loudnessDelivered;
    say(
      `  ${result.audio.ducked ? "music ducked under VO, " : ""}` +
        `normalised toward -16 LUFS` +
        (d ? ` — delivered ${d.lufs} LUFS, peak ${d.truePeakDb} dBTP` : ""),
    );
  }
  return EXIT.OK;
}

async function cmdCaption(args) {
  const dir = runDir(args.run);
  if (!args.video || !args.srt) throw usage("kie caption --run SLUG --video F.mp4 --srt F.srt");

  const video = inPath(dir, args.video);
  const srt = inPath(dir, args.srt);
  if (!existsSync(video)) throw usage(`No such video: ${args.video}`);
  if (!existsSync(srt)) throw usage(`No such SRT: ${args.srt}`);

  const out = outPath(dir, args.out, "captioned", ".mp4");
  const result = await burnCaptions({
    video,
    srt,
    out,
    style: args.style ?? "social",
    brand: args.brand,
    onLine: tick,
  });
  process.stderr.write("\n");

  for (const w of result.warnings) warn(`  ! ${w}`);
  await writeRecord(dir, "captions.json", result);
  say(`  → ${result.out}  (${result.cues} cues, ${result.style})`);
  return EXIT.OK;
}

async function cmdVariants(args) {
  const dir = runDir(args.run);
  if (!args.video) throw usage("kie variants --run SLUG --video F.mp4 --ratios 9:16,1:1");
  const video = inPath(dir, args.video);
  if (!existsSync(video)) throw usage(`No such video: ${args.video}`);

  const orderWarning = captionOrderWarning(video, dir, (p) => {
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  });
  if (orderWarning) warn(`! ${orderWarning}`);

  const ratios = (args.ratios ?? "9:16,1:1").split(",").map((r) => r.trim()).filter(Boolean);
  const outDir = args["out-dir"] ? join(dir, args["out-dir"]) : dir;
  mkdirSync(outDir, { recursive: true });

  const result = await makeVariants({
    video,
    ratios,
    outDir,
    mode: args.mode ?? "blur",
    onLine: tick,
  });
  process.stderr.write("\n");

  await writeRecord(dir, "variants.json", result);
  for (const v of result.variants) say(`  → ${v.out}  (${v.width}×${v.height}, ${v.mode})`);
  return EXIT.OK;
}

// ----------------------------------------- graphic motion (code-rendered)

function cmdTemplates() {
  say(`Code-rendered graphic motion. No key, no spend, pixel-exact, re-renderable.\n`);
  for (const [id, desc] of Object.entries(TEMPLATES)) say(`  ${id.padEnd(14)} ${desc}`);
  say(`\nBrand kits: ${BRAND_DIR}/<name>.json  (--brand <name>)`);
  say(`Props:      a JSON file matching the template's props (--props p.json)`);
  say(`\nUse these instead of a video model whenever the copy, a logo, or a number`);
  say(`must land exactly — generated video draws a picture of text and gets it wrong.`);
  return EXIT.OK;
}

async function cmdRender(args) {
  if (!args.template) {
    throw usage(`kie render --run SLUG --template <id>. See: kie templates`);
  }
  const dir = runDir(args.run);
  const ext = args.alpha ? ".mov" : ".mp4";
  const out = outPath(dir, args.out, args.template, ext);

  say(`rendering ${args.template} …`);
  const result = await render({
    template: args.template,
    propsPath: args.props,
    out,
    ratio: args.ar ?? "16:9",
    fps: Number(args.fps ?? 30),
    durationS: args.duration ? Number(args.duration) : undefined,
    brand: args.brand,
    alpha: args.alpha,
    onLine: (l) => {
      const m = String(l).match(/(\d+)\/(\d+)/);
      if (m) process.stderr.write(`\r  frame ${m[1]}/${m[2]}   `);
    },
  });
  process.stderr.write("\n");

  await writeRecord(dir, `render-${args.template}.json`, result);
  say(`  → ${result.out}  (${result.width}×${result.height}${result.alpha ? ", alpha" : ""})`);
  return EXIT.OK;
}

// -------------------------------------------------------------------- main

async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    say(HELP);
    return EXIT.OK;
  }

  const positionals = [];
  const flags = [];
  for (const a of rest) (a.startsWith("-") || flags.length ? flags : positionals).push(a);

  let args;
  try {
    ({ values: args } = parseArgs({ args: flags, options: OPTS, allowPositionals: true }));
  } catch (e) {
    throw usage(e.message);
  }
  if (args.help) {
    say(HELP);
    return EXIT.OK;
  }

  args.ar ??= args.ratio;
  args.ratio ??= args.ar;

  const catalog = loadCatalog();

  switch (command) {
    case "models":
      return cmdModels(catalog, args) ?? EXIT.OK;
    case "presets":
      return cmdPresets(catalog, args) ?? EXIT.OK;
    case "doctor":
      return cmdDoctor(catalog);
    case "preflight":
      if (!args.model) throw usage("kie preflight --model <id>");
      return cmdPreflight(catalog, args);
    case "upload": {
      if (!positionals[0]) throw usage("kie upload <path>");
      const { url, bytes, mime } = await uploadFile(catalog, positionals[0]);
      say(url);
      warn(`  uploaded ${(bytes / 1e6).toFixed(2)}MB ${mime}`);
      return EXIT.OK;
    }
    case "video":
      return cmdVideo(catalog, args);
    case "image":
      return cmdImage(catalog, args);
    case "audio":
      return cmdAudio(catalog, args);
    case "job":
      return cmdJob(catalog, args, positionals[0]);
    case "spend":
      return cmdSpend(args) ?? EXIT.OK;
    case "probe":
      return cmdProbe(positionals);
    case "assemble":
      return cmdAssemble(args);
    case "caption":
      return cmdCaption(args);
    case "variants":
      return cmdVariants(args);
    case "templates":
      return cmdTemplates();
    case "render":
      return cmdRender(args);
    default:
      throw usage(`Unknown command "${command}".\n\n${HELP}`);
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code ?? EXIT.OK))
  .catch((err) => {
    if (err instanceof CliError) {
      warn(`\n${err.message}`);
      if (err.taskId) warn(`\nTask id: ${err.taskId}  →  kie job ${err.taskId}`);
      process.exit(err.code);
    }
    warn(`\nUnexpected: ${redact(err?.stack ?? String(err))}`);
    process.exit(EXIT.PROVIDER);
  });
