// The director's making tools: casting sheets, stills, takes, review and the
// cut. Sheets, stills and takes spend kie credits; review and the cut are
// local ffmpeg and free.
import { z } from "zod";
import { runDir } from "../cli/lib/run.mjs";
import { uploadFile } from "../cli/lib/upload.mjs";
import { makeStill, makeSheet, adoptSheet } from "../cli/director/still.mjs";
import { filmShot, filmReady } from "../cli/director/film.mjs";
import { reviewShot, saveReview } from "../cli/director/review.mjs";
import { cutFilm } from "../cli/director/cut.mjs";
import { board, boardLines } from "../cli/director/board.mjs";
import { MAX_REDOS, afterReview, saveProduction } from "../cli/director/redo.mjs";
import { imagePreview } from "./preview.mjs";
import { ok } from "./results.mjs";
import { stoppable } from "./stop.mjs";

const LOOK = { readOnlyHint: true, openWorldHint: false };
const LOCAL_WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const SPEND = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

export function registerMaking(tool, { catalog, ctx, deps = {}, runFile }) {
  const run = z.string().describe("The film's run folder slug.");
  const shot = z.string().describe("A shot id from the plan, such as s1.");
  const dryRun = z.boolean().optional().describe("Plan the job and its price; submit nothing, spend nothing.");
  const Data = z.record(z.string(), z.unknown());

  /**
   * The making context for one call: the store, limits, Library and uploads,
   * with the server's stubs in tests. `extra.signal` (the call cancelled)
   * stops core before it reserves and submits.
   */
  const making = (a, extra = {}) => {
    const c = ctx();
    return {
      ...c,
      upload: deps.upload ?? ((path, opts) => uploadFile(catalog, path, opts)),
      deps: stoppable(deps.generate, extra.signal),
      via: "mcp",
      dryRun: a.dry_run ?? false,
    };
  };

  const Submitted = {
    localJobId: z.string().nullable(),
    dryRun: z.boolean(),
    model: z.string(),
    estimateUsd: z.number(),
    route: z.string(),
    refMapping: z.array(z.string()),
    notes: z.array(z.string()),
    next: z.string(),
    detail: Data,
  };
  /** One submitted (or dry-run) director job, as every spending tool reports it. */
  const submitted = (r, what, detail) => {
    const data = {
      localJobId: r.job?.id ?? null,
      dryRun: Boolean(r.dryRun),
      model: r.model,
      estimateUsd: r.estimateUsd,
      route: r.label,
      refMapping: r.refMapping ?? [],
      notes: r.notes ?? [],
      next: r.dryRun ? "Dry run: nothing was submitted or spent." : `Call wait_job with job_id "${r.job.id}".`,
      detail,
    };
    const head = r.dryRun ? `dry run: ${what} on ${data.route}, about $${data.estimateUsd.toFixed(2)}` : `submitted ${what} as ${data.localJobId} on ${data.route}, about $${data.estimateUsd.toFixed(2)}`;
    return ok([head, ...data.refMapping.map((m) => `ref ${m}`), ...data.notes, data.next].join("\n"), data);
  };

  tool(
    "get_shots",
    {
      title: "Storyboard",
      description:
        "The storyboard: each shot's still and take in use, every attempt, takes being filmed or failed, the review of the take in use, and the last cut. Free.",
      inputSchema: { run },
      outputSchema: { film: z.string(), brief: Data.nullable(), plan: Data.nullable(), shots: z.array(Data), production: Data, cut: Data.nullable() },
      annotations: LOOK,
    },
    async (a) => {
      const { store, library } = ctx();
      const b = board(store, a.run, { assets: library.list() });
      return ok(boardLines(b).join("\n"), b);
    },
  );

  tool(
    "make_sheet",
    {
      title: "Make a reference sheet",
      description:
        "Spends kie credits. A reference sheet for a Library character, product or location, made from its own images, so every still keeps them the same. " +
        "Only when the user asked to cast. Returns a job id at once; wait_job, show it, then adopt_sheet if the user likes it.",
      inputSchema: { run, asset: z.string().describe("The Library asset's name."), model: z.string().optional(), dry_run: dryRun },
      outputSchema: Submitted,
      annotations: SPEND,
    },
    async (a, extra) => {
      const r = await makeSheet(catalog, a.run, a.asset, { ...making(a, extra), model: a.model });
      return submitted(r, `${r.asset}'s sheet`, { asset: r.asset, prompt: r.prompt });
    },
  );

  tool(
    "adopt_sheet",
    {
      title: "Adopt a reference sheet",
      description: "Make a finished sheet its asset's first image, keeping up to three earlier images after it (the old version is kept in history). Free.",
      inputSchema: { job_id: z.string() },
      outputSchema: { name: z.string(), images: z.array(z.string()) },
      annotations: LOCAL_WRITE,
    },
    async (a) => {
      const { library, store } = ctx();
      const asset = adoptSheet(library, store, a.job_id);
      const images = asset.images.map((im) => im.path);
      return ok(`${asset.name} now leads with its sheet:\n${images.join("\n")}`, { name: asset.name, images });
    },
  );

  tool(
    "make_still",
    {
      title: "Make a still",
      description:
        "Spends kie credits. One shot's still: its first frame, worded from the plan on the shot's still model, with its cast and the film's style still as references. " +
        "The plan must pass the checker. Make the first shot's still first: it sets the look for the rest. Only when the user asked for stills. Returns a job id at once; then wait_job.",
      inputSchema: { run, shot, dry_run: dryRun },
      outputSchema: Submitted,
      annotations: SPEND,
    },
    async (a, extra) => {
      const r = await makeStill(catalog, a.run, a.shot, making(a, extra));
      return submitted(r, `${r.shot}'s still`, { shot: r.shot, prompt: r.prompt, style: r.style });
    },
  );

  tool(
    "film_shot",
    {
      title: "Film a shot",
      description:
        "Spends kie credits. Film one shot from its still (or, on a continuous cut, from the last frame of the shot before), worded for its model, padded for trimming, audio off unless it is lip-sync. " +
        "Also how a failed or rejected take is redone. Only when the user asked. Returns a job id at once; then wait_job.",
      inputSchema: { run, shot, dry_run: dryRun },
      outputSchema: Submitted,
      annotations: SPEND,
    },
    async (a, extra) => {
      const r = await filmShot(catalog, a.run, a.shot, making(a, extra));
      return submitted(r, `${r.shot}'s take (${r.generatedS}s)`, { shot: r.shot, prompt: r.prompt, params: r.params, generatedS: r.generatedS, firstFrame: r.firstFrame });
    },
  );

  tool(
    "film_all",
    {
      title: "Film all",
      description:
        "Spends kie credits. Submit every shot that is ready, in order, and return at once; call again after wait_job settles takes, for the shots that continue from them. " +
        "Only after the user has seen the storyboard and agreed the total: pass it as max_usd; a remaining cost above it is refused. Never refilms a failed take; it reports it.",
      inputSchema: { run, max_usd: z.number().min(0).describe("The total the user agreed to spend on filming."), dry_run: dryRun },
      outputSchema: {
        submitted: z.array(Data),
        filming: z.array(z.string()),
        waiting: z.array(z.string()),
        done: z.array(z.string()),
        failed: z.array(Data),
        stopped: Data.nullable(),
        remainingUsd: z.number(),
        dryRun: z.boolean(),
      },
      annotations: SPEND,
    },
    async (a, extra) => {
      const r = await filmReady(catalog, a.run, { ...making(a, extra), maxUsd: a.max_usd });
      const lines = [
        ...r.submitted.map((s) => `${s.shot}: ${r.dryRun ? "would film" : `filming ${s.jobId}`} on ${s.model}, ${s.generatedS}s, about $${s.estimateUsd.toFixed(2)}`),
        ...(r.filming.length ? [`filming: ${r.filming.join(", ")}`] : []),
        ...(r.waiting.length ? [`waiting for the shot before: ${r.waiting.join(", ")}`] : []),
        ...(r.done.length ? [`done: ${r.done.join(", ")}`] : []),
        ...r.failed.map((f) => `${f.shot}'s take ${f.state}: ${f.error ?? "no message"}. Not refilmed; ask the user, then film_shot.`),
        ...(r.stopped ? [`stopped at ${r.stopped.shot}: ${r.stopped.message}`] : []),
        r.dryRun ? "Dry run: nothing was submitted or spent." : "Call wait_job for each submitted job, then film_all again for the shots waiting.",
      ];
      return ok(lines.join("\n"), r);
    },
  );

  tool(
    "review_shot",
    {
      title: "Review a shot",
      description:
        "The contact sheet (shown) and first and last frames of the take a shot uses, with the shot's checks. Judge each check from the sheet, then save_review. Free, local.",
      inputSchema: { run, shot },
      outputSchema: { shot: z.string(), take: z.string(), sheet: z.string(), first: z.string(), last: z.string(), durationS: z.number(), checks: z.array(z.string()) },
      annotations: LOCAL_WRITE,
    },
    async (a) => {
      const r = await reviewShot(a.run, a.shot, { store: ctx().store });
      const sheet = await imagePreview(r.sheet, { width: 1024 });
      const text = [`${r.shot} · ${r.take} · ${r.durationS.toFixed(2)}s`, "checks:", ...r.checks.map((c) => `- ${c}`)].join("\n");
      return ok(text, r, sheet ? [sheet] : []);
    },
  );

  tool(
    "save_review",
    {
      title: "Save a review",
      description:
        "Record the verdict on the take a shot uses: pass or redo, every check judged with a note on what failed, and optionally the best window to keep (bestWindow.startS, used by the cut). Free, " +
        "unless the film has auto-redo on: then a redo verdict refilms the shot at once (spends kie credits), at most twice a shot and within the total the user set; then wait_job.",
      inputSchema: {
        run,
        shot,
        take: z.string().describe("The take file judged, as review_shot named it."),
        verdict: z.enum(["pass", "redo"]),
        checks: z.array(z.object({ check: z.string(), ok: z.boolean(), note: z.string().optional() })),
        best_window_start_s: z.number().min(0).optional(),
      },
      outputSchema: { take: z.string(), verdict: z.string(), checks: z.array(Data), bestWindow: Data.optional(), at: z.string(), redo: Data.nullable() },
      annotations: SPEND,
    },
    async (a, extra) => {
      const saved = saveReview(a.run, a.shot, {
        take: a.take,
        verdict: a.verdict,
        checks: a.checks,
        ...(a.best_window_start_s != null ? { bestWindow: { startS: a.best_window_start_s } } : {}),
      });
      const redo = await afterReview(catalog, a.run, a.shot, saved, making(a, extra));
      const lines = [`${a.shot}: ${saved.verdict} for ${saved.take}`];
      if (redo?.submitted) lines.push(`auto-redo: refilming ${a.shot} (redo ${redo.redo} of ${MAX_REDOS}) as ${redo.jobId} on ${redo.model}, about $${redo.estimateUsd.toFixed(2)}. Call wait_job with job_id "${redo.jobId}", then review it.`);
      else if (redo) lines.push(`auto-redo held back: ${redo.reason}`);
      return ok(lines.join("\n"), { ...saved, redo });
    },
  );

  tool(
    "set_auto_redo",
    {
      title: "Auto-redo",
      description:
        "Switch auto-redo on or off for a film. On: a take judged redo (save_review) is refilmed at once, at most twice a shot, while the film's takes stay within max_usd in all (first takes and redos together). " +
        "Only when the user asked for it and named the total. Free itself.",
      inputSchema: { run, on: z.boolean(), max_usd: z.number().positive().optional().describe("The most this film's takes may cost in all, redos included. Required to switch on.") },
      outputSchema: { autoRedo: z.boolean(), maxUsd: z.number().nullable() },
      annotations: LOCAL_WRITE,
    },
    async (a) => {
      const p = saveProduction(a.run, { autoRedo: a.on, maxUsd: a.max_usd });
      return ok(p.autoRedo ? `auto-redo on for ${a.run}: up to ${MAX_REDOS} redos a shot, takes within $${p.maxUsd.toFixed(2)} in all` : `auto-redo off for ${a.run}`, p);
    },
  );

  tool(
    "cut_film",
    {
      title: "Cut the film",
      description:
        "The editor pass: trim each shot's take (its reviewed best window, else past the padding), join them with the plan's cuts, add an end card, music and voice-over, and deliver film.mp4 in the run folder (numbered, never overwritten). Free, local.",
      inputSchema: {
        run,
        music: z.string().optional().describe("A music file in the run folder."),
        vo: z.string().optional().describe("A voice-over file in the run folder."),
        end_card: z.string().optional().describe("A rendered end card (kie render) in the run folder."),
      },
      outputSchema: { out: z.string(), totalS: z.number(), segments: z.array(Data), joins: z.array(Data), notes: z.array(z.string()) },
      annotations: LOCAL_WRITE,
    },
    async (a) => {
      const dir = runDir(a.run, { create: false });
      const { roots, store } = ctx();
      const r = await cutFilm(a.run, {
        store,
        music: a.music ? runFile(dir, a.music, roots) : null,
        vo: a.vo ? runFile(dir, a.vo, roots) : null,
        endCard: a.end_card ? runFile(dir, a.end_card, roots) : null,
      });
      const text = [...r.segments.map((s) => `${s.shot} ${s.file} ${s.startS}s +${s.durationS}s`), ...r.notes, `→ ${r.out} (${r.totalS}s)`].join("\n");
      return ok(text, { out: r.out, totalS: r.totalS, segments: r.segments, joins: r.joins, notes: r.notes });
    },
  );
}
