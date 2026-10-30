#!/usr/bin/env node
// kie -- execution layer for the motion-design skill.
//
// The skill decides WHAT film to make. This decides HOW it reaches kie.ai, what
// it costs, and where the record lands. No creative judgement lives here, and
// no kie.ai model id, endpoint or price lives in the skill. See cli/README.md.

import { parseArgs } from "node:util";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { EXIT, CliError, usage, unknown, uncertain, provider as providerError } from "./lib/errors.mjs";
import { loadCatalog, resolveModel, validateVideoRequest, parseRef, parseParams, routesFor, isStale, catalogAgeDays } from "./lib/models.mjs";
import { redact } from "./lib/client.mjs";
import { getProvider, providerKey, hasKey, providerCredits } from "./lib/providers.mjs";
import { waitForTask, download } from "./lib/poll.mjs";
import { uploadFile } from "./lib/upload.mjs";
import { estimateUsd, priceLabel } from "./lib/budget.mjs";
import { runDir, nextArtifact, extFromUrl, writeRecord, outPath, inPath, REPO_ROOT } from "./lib/run.mjs";
import * as ledger from "./lib/ledger.mjs";
import { openJobs, resolveUncertain, uncertainMessage } from "./core/jobs.mjs";
import { readLimits, setDailyLimit, setPerJobLimit, limitsPath, dailyPosition } from "./core/spend.mjs";
import { submitJob, waitJob, shouldFailOver } from "./core/generate.mjs";
import { openLibrary, KINDS } from "./core/assets.mjs";
import { expandRefs } from "./core/refs.mjs";
import { checkLocalFile } from "./core/inputs.mjs";
import { loadPresets, findPreset, routeFor } from "./lib/presets.mjs";
import { probe, measureLoudness, dimsFor } from "./lib/ffmpeg.mjs";
import { extractFrames } from "./lib/frames.mjs";
import { assemble } from "./lib/assemble.mjs";
import { burnCaptions } from "./lib/caption.mjs";
import { makeVariants, captionOrderWarning } from "./lib/variants.mjs";
import { render, TEMPLATES, BRAND_DIR } from "./lib/render.mjs";

const HELP = `kie -- motion-design execution layer

  kie models     [--capability video|image|audio] [--json]
  kie presets    [--json]
  kie preflight  --model M [--duration N] [--resolution R] [--ar R] [--budget U]
  kie doctor
  kie providers
  kie upload     <path>
  kie asset      save <name> <image>... --kind K --description "..." [--replace]
                 list | show <name>      saved references; use as --ref zed:identity or --ref zed#2:first_frame

  kie video      --run SLUG (--prompt-file F | --preset P) [--model M]
                 [--duration N] [--ar R] [--resolution R] [--ref URL|ASSET:ROLE]...
                 [--param KEY=VALUE]... [--budget U]
                 [--provider kie|wavespeed] [--no-wait] [--dry-run]
  kie image      --run SLUG --prompt "..." [--model M] [--resolution R]
                 [--quality Q] [--ar R] [--ref URL|ASSET:ROLE]... [--background B]
                 [--param KEY=VALUE]... [--budget U]
                 [--provider kie|wavespeed] [--no-wait] [--dry-run]
  kie audio      --run SLUG (--music "..." | --tts-file F) [--model M]
                 [--voice V] [--budget U]
                 [--provider kie|wavespeed] [--no-wait] [--dry-run]

  kie job        <local job id>            wait for a job and download it
  kie job resolve <local job id> (--task ID | --not-created)
                                           settle an uncertain job after checking the provider's log
  kie limits     [--daily USD] [--per-job USD|off] [--json]   the daily cap, per-job limit, today's spend and unsettled jobs
  kie spend      [--today] [--run SLUG] [--since YYYY-MM-DD] [--json]

Finishing (local ffmpeg — no key, no spend):
  kie probe      <file>
  kie frames     <video> [--run SLUG] [--out-dir DIR]   contact sheet + first/last frame
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
  kind: { type: "string" },
  description: { type: "string" },
  replace: { type: "boolean", default: false },
  param: { type: "string", multiple: true, default: [] },
  budget: { type: "string" },
  resolution: { type: "string" },
  quality: { type: "string" },
  background: { type: "string" },
  // `--music` is a prompt in `kie audio` and a file in `kie assemble`. Both
  // read naturally in their own command and the two never co-occur.
  music: { type: "string" },
  vo: { type: "string" },
  "tts-file": { type: "string" },
  voice: { type: "string" },
  family: { type: "string" },
  provider: { type: "string" },
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
  daily: { type: "string" },
  "per-job": { type: "string" },
  task: { type: "string" },
  "not-created": { type: "boolean", default: false },
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

// ---------------------------------------------------------------- read-only

function cmdModels(catalog, args) {
  const list = catalog.list.filter((m) => !args.capability || m.capability === args.capability);
  if (args.json) return say(JSON.stringify(list, null, 2));

  warnIfStale(catalog);
  for (const cap of ["video", "image", "audio"]) {
    const rows = list.filter((m) => m.capability === cap);
    if (!rows.length) continue;
    say(`\n${cap.toUpperCase()}`);
    for (const m of rows) {
      const spec = [
        m.durationsS?.length ? `${m.durationsS[0]}-${m.durationsS.at(-1)}s` : null,
        m.aspectRatios?.length ? m.aspectRatios.join(" ") : null,
        m.nativeAudio ? "native-audio" : null,
        m.refs?.length ? `refs: ${m.refs.join("/")}` : null,
      ].filter(Boolean).join(" · ");
      say(`  ${m.id}`);
      if (spec) say(`    ${spec}`);
      for (const r of routesFor(catalog, m)) {
        const flags = [
          r.verified ? "verified" : "unverified",
          r.schemaVerified === false ? "schema-guessed" : null,
          r.measuredCredits != null ? `measured ${r.measuredCredits} cr` : null,
          !r.usable ? `SKIPPED — ${r.skipReason}` : null,
        ].filter(Boolean).join(", ");
        say(`    ${r.provider === m.routes[0].provider ? "→" : " "} ${r.prov.label.padEnd(10)} ${priceLabel(r).padEnd(34)} ${flags}`);
      }
      if (m.notes) say(`    ${m.notes}`);
    }
  }
  say(`\nArrow marks the primary route. Later routes are fallbacks, tried only when`);
  say(`the provider errors — never after an uncertain result, which may already exist.`);
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
  const bad = (m) => { failures += 1; say(`  FAIL  ${m}`); };

  say("kie doctor\n");

  let anyKey = false;
  for (const name of Object.keys(catalog.providers)) {
    const prov = getProvider(catalog, name);
    const key = providerKey(prov, { required: false });
    if (!key) {
      say(`  warn  ${prov.label}: no key (set ${prov.keyEnv} or write ~/${prov.keyFile}) — routes skipped`);
      continue;
    }
    anyKey = true;
    ok(`${prov.label}: key found (${key.slice(0, 4)}…${key.slice(-2)})`);
    if (prov.credits) {
      try {
        const c = await providerCredits(prov, key);
        c == null ? bad(`${prov.label}: credit endpoint gave no balance`) : ok(`${prov.label}: ${c} ${prov.creditUnit}`);
      } catch (e) {
        bad(`${prov.label}: credit check — ${e.message}`);
      }
    } else {
      say(`  ok    ${prov.label}: no balance endpoint — spend is not readable from here`);
    }
  }
  if (!anyKey) bad("No provider key configured at all — nothing can be generated.");

  const age = catalogAgeDays(catalog);
  (isStale(catalog) ? bad : ok)(`models.json captured ${catalog.captured}${age != null ? ` (${age}d ago)` : ""}`);

  const routes = catalog.list.flatMap((m) => routesFor(catalog, m).map((r) => ({ m, r })));
  const unverified = routes.filter(({ r }) => !r.verified);
  say(`  ${unverified.length ? "warn " : "ok   "} ${routes.length - unverified.length}/${routes.length} routes verified by a real job`);

  const noRoute = catalog.list.filter((m) => !routesFor(catalog, m).some((r) => r.usable));
  if (noRoute.length) say(`  warn  unreachable with current keys: ${noRoute.map((m) => m.id).join(", ")}`);

  const withFallback = catalog.list.filter((m) => routesFor(catalog, m).filter((r) => r.usable).length > 1);
  ok(`${withFallback.length}/${catalog.list.length} models have a working fallback: ${withFallback.map((m) => m.id).join(", ") || "none"}`);

  try {
    const presets = loadPresets();
    const mapped = presets.filter((p) => p.kie?.native || p.kie?.route?.length);
    ok(`presets: ${mapped.length}/${presets.length} routed to a model`);
    say(`        native-route presets: ${presets.filter((p) => p.kie?.native).map((p) => p.id).join(", ") || "none"}`);
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

  const routes = routesFor(catalog, model, { only: args.provider });
  const cap = num(args.budget) ?? catalog.defaultBudgetUsd?.[model.capability];

  say(`model:   ${model.id} (${model.capability})`);
  say(`budget:  $${Number(cap).toFixed(2)}`);
  const pos = dailyPosition(openJobs(), readLimits());
  say(`today:   $${pos.availableUsd.toFixed(2)} of the $${pos.capUsd.toFixed(2)} daily cap available`);
  say(`routes:`);
  const priced = routes.map((r) => ({
    ...r,
    estimate: estimateUsd(r, { durationS: num(args.duration), resolution: args.resolution }),
  }));
  for (const r of priced) {
    const verdict = !r.usable
      ? `skipped — ${r.skipReason}`
      : r.estimate.usd > cap
        ? `WOULD REFUSE — over budget`
        : `ok`;
    say(`  ${r.prov.label.padEnd(10)} $${r.estimate.usd.toFixed(2).padEnd(7)} ${verdict}  (${r.estimate.basis})`);
  }

  if (problems.length) {
    say(`\nWould be refused:`);
    for (const p of problems) say(`  · ${p}`);
    return EXIT.UNKNOWN;
  }
  const affordable = priced.filter((r) => r.usable && r.estimate.usd <= cap && r.estimate.usd <= pos.availableUsd);
  if (!affordable.length) {
    say(`\nWould be refused: no usable route within budget.`);
    return EXIT.BUDGET;
  }
  say(`\nOK to submit via ${affordable[0].prov.label}. Nothing was sent to any provider.`);
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
  if (s.actualUsd != null) say(`actual:         $${s.actualUsd.toFixed(2)}   (from ${s.actualSamples} task record(s) — a fact)`);
  say(
    s.creditsUsed == null
      ? `credits used:   not sampled`
      : `credits used:   ${s.creditsUsed}   (measured across ${s.creditSamples} job(s) — a fact)`,
  );
  if (s.byProvider?.length) {
    say(`\nby provider`);
    for (const p of s.byProvider) say(`  ${String(p.provider).padEnd(12)} ${String(p.jobs).padStart(3)}  $${p.estimated.toFixed(2)}`);
  }
  if (s.byModel.length) {
    say(`\nby model`);
    for (const m of s.byModel) say(`  ${String(m.model).padEnd(18)} ${String(m.jobs).padStart(3)}  $${m.estimated.toFixed(2)}`);
  }
}

function cmdLimits(args) {
  if (args.daily != null) {
    const next = setDailyLimit(args.daily);
    say(`daily cap set to $${next.dailyUsd.toFixed(2)}  (${limitsPath()})`);
  }
  if (args["per-job"] != null) {
    const next = setPerJobLimit(args["per-job"]);
    say(next.perJobUsd == null ? `per-job limit removed  (${limitsPath()})` : `per-job limit set to $${next.perJobUsd.toFixed(2)}  (${limitsPath()})`);
  }
  const store = openJobs();
  store.sweep();
  const pos = dailyPosition(store, readLimits());
  if (args.json) return say(JSON.stringify({ ...pos, perJobUsd: readLimits().perJobUsd ?? null }, null, 2));

  say(`daily cap:  $${pos.capUsd.toFixed(2)}`);
  const perJob = readLimits().perJobUsd;
  say(`per-job:    ${perJob == null ? "no limit" : `$${perJob.toFixed(2)}`}`);
  say(`today:      $${pos.spentUsd.toFixed(2)} spent or held, $${pos.availableUsd.toFixed(2)} available`);
  if (pos.unsettled.length) {
    say(`\nunsettled jobs (each holds its estimate until settled)`);
    for (const j of pos.unsettled) {
      say(
        `  ${j.id}  ${j.state.padEnd(10)} ${j.model} via ${j.provider}  ` +
          `$${(j.estimateUsd ?? 0).toFixed(2)}  ${j.upstreamTaskId ?? "(no task id: kie job resolve)"}`,
      );
    }
  }
}

function cmdAsset(args, positionals) {
  const [action, name, ...images] = positionals;
  const library = openLibrary();

  if (action === "save") {
    if (!name || !images.length || !args.kind || !args.description) {
      throw usage(`kie asset save <name> <image>... --kind ${KINDS.join("|")} --description "..." [--replace]`);
    }
    const a = library.save({ name, kind: args.kind, description: args.description, images, replace: args.replace });
    say(`saved ${a.name} (${a.kind}), ${a.images.length} image(s) in ${join(library.dir, a.name)}`);
    for (const im of a.images) say(`  #${im.n}  ${im.file}  ${im.width ?? "?"}×${im.height ?? "?"}`);
    return EXIT.OK;
  }

  if (action === "list" || !action) {
    const all = library.list();
    if (args.json) {
      say(JSON.stringify(all, null, 2));
      return EXIT.OK;
    }
    if (!all.length) say(`No assets yet. Save one: kie asset save <name> <image>... --kind K --description "..."`);
    for (const a of all) say(`  ${a.name.padEnd(20)} ${a.kind.padEnd(10)} ${a.imageCount} image(s)  ${a.description.slice(0, 60)}`);
    return EXIT.OK;
  }

  if (action === "show") {
    if (!name) throw usage("kie asset show <name>");
    const a = library.get(name);
    if (args.json) {
      say(JSON.stringify(a, null, 2));
      return EXIT.OK;
    }
    say(`${a.name}  (${a.kind})`);
    say(`  ${a.description}`);
    for (const im of a.images) {
      say(`  #${im.n}  ${im.path}  ${im.width ?? "?"}×${im.height ?? "?"}  ${im.upload ? `uploaded ${im.upload.at}` : "not uploaded"}`);
    }
    if (a.usedIn?.length) say(`  used in: ${a.usedIn.join(", ")}`);
    return EXIT.OK;
  }

  throw usage("kie asset save|list|show");
}

// -------------------------------------------------------------- generation

const onTick = (state, sec) => process.stderr.write(`\r  ${state} ${sec}s   `);

function costLine(job) {
  return job.costSource === "task-record"
    ? `cost: $${job.actualUsd.toFixed(2)} from the provider's task record (estimated $${job.estimateUsd.toFixed(2)})`
    : `cost: not reported by ${job.provider}; counted at the $${job.estimateUsd.toFixed(2)} estimate`;
}

/** Print a waitJob result, or throw the error its outcome calls for. */
function finishWait(w) {
  if (w.outcome === "succeeded") {
    for (const p of w.artifacts) say(`  → ${p}`);
    say(costLine(w.job));
    return EXIT.OK;
  }
  if (w.outcome === "pending") {
    throw uncertain(`${w.message}\n${uncertainMessage(w.job)}`, w.job.upstreamTaskId, { localJobId: w.job.id });
  }
  if (w.outcome === "no-artifact") throw providerError(w.message);
  throw w.error ?? providerError(`Job ${w.job.id} ended ${w.job.state}: ${w.job.error ?? "no message"}`);
}

/**
 * Submit through the core, then wait unless --no-wait. A job may fall over to
 * the same model at the next reseller only when it failed upstream and is
 * confirmed free (state failed-confirmed-free); a job that may have been
 * charged, or is uncertain, never does.
 */
async function generate(catalog, { capability, model, values, args, artifactBase, record }) {
  warnIfStale(catalog);
  const store = openJobs();
  const limits = readLimits();
  const onEvent = (e) => (e.type === "submitted" ? say(e.message) : warn(`! ${e.message}`));
  const tried = [];

  for (;;) {
    const sub = await submitJob(
      catalog,
      {
        capability,
        model,
        values,
        run: args.run,
        artifactBase,
        record,
        budgetUsd: num(args.budget),
        only: args.provider,
        exclude: tried,
        dryRun: args["dry-run"],
      },
      { store, limits, onEvent },
    );

    if (sub.dryRun) {
      const pos = dailyPosition(store, limits);
      say(`dry run — nothing submitted.`);
      say(`  route:    ${sub.label}`);
      say(`  estimate: $${sub.estimateUsd.toFixed(2)} (${sub.basis}; job budget $${Number(sub.budgetUsd).toFixed(2)})`);
      say(`  today:    $${pos.availableUsd.toFixed(2)} of $${pos.capUsd.toFixed(2)} available`);
      say(`  body:     ${JSON.stringify(sub.input).slice(0, 600)}`);
      await writeRecord(runDir(args.run), "planned.json", {
        model: model.id,
        route: sub.route,
        input: sub.input,
        estimatedUsd: sub.estimateUsd,
        basis: sub.basis,
        allRoutes: sub.routes,
      });
      return EXIT.OK;
    }

    tried.push(...sub.attempts.map((a) => a.provider));
    if (args["no-wait"]) {
      say(`not waiting. Rejoin: kie job ${sub.job.id}`);
      return EXIT.OK;
    }

    const w = await waitJob(catalog, store, sub.job.id, { onTick });
    process.stderr.write("\n");
    if (!shouldFailOver(w)) return finishWait(w);

    const more = routesFor(catalog, model, { only: args.provider }).some((r) => r.usable && !tried.includes(r.provider));
    if (!more) return finishWait(w);
    warn(`! ${w.job.error}`);
  }
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

/** Parsed --ref values → provider URLs plus the @Image mapping. Asset uploads are reused for 20h. */
async function refsFor(catalog, args, parsed) {
  if (!parsed.length) return { refs: [], refMapping: [], assets: [] };
  const library = openLibrary();
  const expanded = await expandRefs(parsed, {
    catalog,
    library,
    upload: (path, opts) => uploadFile(catalog, path, opts),
    dryRun: args["dry-run"],
  });
  if (!args["dry-run"]) for (const name of expanded.assets) library.recordUse(name, args.run);
  for (const line of expanded.refMapping) say(`  ref ${line}`);
  return expanded;
}

async function cmdVideo(catalog, args) {
  const presets = loadPresets();
  let usedSourcePromptRaw = false;
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

    // The archived source prompt is immutable REFERENCE material. SKILL.md is
    // explicit that its client names and copy are provenance, "never
    // authorization", and template-adaptation.md exists precisely to turn it
    // into your film. Submitting it unmodified reproduces the original ad --
    // verified: running kinetic-typography raw produced a Higgsfield
    // commercial, correct branding and all. Warn every time.
    if (!args["prompt-file"]) {
      usedSourcePromptRaw = true;
      warn(
        `\n! This is the ARCHIVED SOURCE PROMPT, unmodified. It will reproduce the original\n` +
          `  film — including its brand names, copy and product claims, which are provenance\n` +
          `  and not yours to ship. To make it your film:\n` +
          `    1. read ${preset.template ?? "the adaptation guide"} and references/template-adaptation.md\n` +
          `    2. adapt the source prompt to your subject, keeping its motion language\n` +
          `    3. re-run with --prompt-file <your-adapted-prompt.txt>\n` +
          `  Proceeding anyway produces a reference render, not a deliverable.\n`,
      );
    }
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
  const parsedRefs = (args.ref ?? []).map(parseRef);
  const params = parseParams(args.param);

  const problems = validateVideoRequest(catalog, model, { durationS, aspectRatio, refs: parsedRefs });
  if (problems.length) {
    throw unknown(
      `Refused before submitting — nothing was spent:\n` +
        problems.map((p) => `  · ${p}`).join("\n") +
        (preset ? durationAdvice(catalog, preset, model, durationS) : ""),
    );
  }
  const { refs, refMapping, assets } = await refsFor(catalog, args, parsedRefs);

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
    refMapping,
    params,
    promptChars: prompt.length,
    usedSourcePromptRaw,
    deliverable: !usedSourcePromptRaw,
    ...(usedSourcePromptRaw
      ? {
          warning:
            "Generated from the unmodified archived source prompt. This reproduces the ORIGINAL film including its branding and copy. It is a reference render, not a deliverable.",
        }
      : {}),
  });

  const hasFirstFrame = refs.find((r) => r.role === "first_frame");
  return generate(catalog, {
    capability: "video",
    model,
    values: {
      prompt,
      duration: durationS,
      aspect_ratio: aspectRatio,
      resolution: args.resolution,
      refs,
      params,
      // A first-frame reference makes this image-to-video on providers that
      // split the two into separate model ids.
      _useI2v: Boolean(hasFirstFrame),
    },
    args,
    artifactBase: "out",
    record: { refMapping, assets },
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

  // A reference turns this into an edit on routes that keep image-to-image
  // under its own model id, the same switch a first frame makes for video.
  const parsedRefs = (args.ref ?? []).map(parseRef);
  const { refs, refMapping, assets } = await refsFor(catalog, args, parsedRefs);
  const params = parseParams(args.param);

  const dir = runDir(args.run);
  await writeRecord(dir, "image-prompt.txt", args.prompt);
  if (refs.length || Object.keys(params).length) {
    await writeRecord(dir, "image-inputs.json", { model: model.id, refs, refMapping, params, background: args.background ?? null });
  }

  return generate(catalog, {
    capability: "image",
    model,
    values: {
      prompt: args.prompt,
      resolution: args.resolution,
      quality: args.quality,
      aspect_ratio: args.ar,
      background: args.background,
      refs,
      params,
      _useI2v: refs.length > 0,
    },
    args,
    artifactBase: "ref",
    record: { refMapping, assets },
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
    values: input,
    args,
    artifactBase: isTts ? "vo" : "music",
  });
}

async function cmdJob(catalog, args, positionals) {
  const [first, second] = positionals;
  if (first === "resolve") return cmdJobResolve(args, second);
  if (!first) throw usage("kie job <local job id>   (or a provider task id with --provider and --run)");
  if (first.startsWith("j-")) {
    const w = await waitJob(catalog, openJobs(), first, { onTick });
    process.stderr.write("\n");
    return finishWait(w);
  }
  // A provider task id from before local job ids existed, or from elsewhere.
  const taskId = first;
  const prov = getProvider(catalog, args.provider ?? "kie");
  const key = providerKey(prov);
  const family = args.family ?? Object.keys(prov.families)[0];

  const result = await waitForTask(prov, family, taskId, {
    key,
    onTick,
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

function cmdJobResolve(args, id) {
  if (!id || Boolean(args.task) === Boolean(args["not-created"])) {
    throw usage("kie job resolve <local job id> (--task <provider task id> | --not-created)");
  }
  const job = resolveUncertain(openJobs(), id, { task: args.task, notCreated: args["not-created"] });
  say(
    job.state === "submitted"
      ? `${job.id} rejoined as task ${job.upstreamTaskId}. Wait for it with: kie job ${job.id}`
      : `${job.id} recorded as never created. Its $${job.estimateUsd.toFixed(2)} hold is released.`,
  );
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
          (loud?.inputI != null && loud.inputTp != null ? `  ${loud.inputI.toFixed(1)} LUFS, peak ${loud.inputTp.toFixed(1)} dBTP` : loud ? "  silent" : "")
      : `  audio     none`,
  );
  say(`  size      ${(info.sizeBytes / 1e6).toFixed(2)}MB`);
  if (loud?.inputI != null && loud.inputI > -12) {
    say(`\n  ! ${loud.inputI.toFixed(1)} LUFS is hot. Social platforms normalise to about -16;`);
    say(`    deliver hotter and they turn it down, unevenly. \`kie assemble\` corrects this.`);
  }
  return EXIT.OK;
}

async function cmdFrames(args, positionals) {
  if (!positionals[0]) throw usage("kie frames <video> [--run SLUG] [--out-dir DIR]");
  const video = args.run ? inPath(runDir(args.run), positionals[0]) : resolve(positionals[0]);
  const r = await extractFrames(video, { outDir: args["out-dir"] ? resolve(args["out-dir"]) : undefined });
  say(r.sheet);
  say(`  first  ${r.first}`);
  say(`  last   ${r.last}`);
  say(`  ${r.tiles.length} frames at ${r.times.map((t) => t.toFixed(2)).join(", ")}s of ${r.durationS.toFixed(2)}s`);
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
    case "providers": {
      for (const name of Object.keys(catalog.providers)) {
        const prov = getProvider(catalog, name);
        const models = catalog.list.filter((m) => m.routes.some((r) => r.provider === name));
        say(`\n${prov.label}  (${name})`);
        say(`  key:      ${hasKey(prov) ? "configured" : `MISSING — set ${prov.keyEnv} or write ~/${prov.keyFile}`}`);
        say(`  base:     ${prov.baseUrl}`);
        say(`  errors:   reported in the ${prov.errorInBody ? "response BODY (HTTP 200 + code)" : "HTTP status"}`);
        say(`  balance:  ${prov.credits ? `readable (${prov.creditUnit})` : "not exposed"}`);
        say(`  uploads:  ${prov.upload ? "supported" : "not supported — upload elsewhere and pass the URL"}`);
        say(`  models:   ${models.map((m) => m.id).join(", ")}`);
        if (!hasKey(prov)) say(`  sign up:  ${prov.signup}`);
      }
      say(`\nRoutes are tried in the order listed under each model in \`kie models\`.`);
      return EXIT.OK;
    }
    case "preflight":
      if (!args.model) throw usage("kie preflight --model <id>");
      return cmdPreflight(catalog, args);
    case "upload": {
      if (!positionals[0]) throw usage("kie upload <path>");
      const file = checkLocalFile(positionals[0]);
      const { url, bytes, mime } = await uploadFile(catalog, file.path, { providerName: args.provider ?? "kie", mime: file.mime });
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
      return cmdJob(catalog, args, positionals);
    case "limits":
      return cmdLimits(args) ?? EXIT.OK;
    case "asset":
      return cmdAsset(args, positionals);
    case "spend":
      return cmdSpend(args) ?? EXIT.OK;
    case "probe":
      return cmdProbe(positionals);
    case "frames":
      return cmdFrames(args, positionals);
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
      if (!err.localJobId && err.taskId) warn(`\nTask id: ${err.taskId}  →  kie job ${err.taskId}`);
      process.exit(err.code);
    }
    warn(`\nUnexpected: ${redact(err?.stack ?? String(err))}`);
    process.exit(EXIT.PROVIDER);
  });
