import { routesFor, buildInput, effectiveRoute } from "../lib/models.mjs";
import { getProvider, providerKey, canFailOver, taskCost } from "../lib/providers.mjs";
import { preflight as realPreflight, creditsAfter as realCreditsAfter } from "../lib/budget.mjs";
import { createTask as realCreateTask } from "../lib/client.mjs";
import { waitForTask as realWaitForTask, download as realDownload } from "../lib/poll.mjs";
import { rmSync } from "node:fs";
import { runDir, landArtifact, extFromUrl, writeRecord } from "../lib/run.mjs";
import * as ledger from "../lib/ledger.mjs";
import { redact } from "../lib/redact.mjs";
import { EXIT, unknown, usage, uncertain } from "../lib/errors.mjs";
import { UNSETTLED, uncertainMessage } from "./jobs.mjs";
import { reserve } from "./spend.mjs";

const REAL = {
  preflight: realPreflight,
  createTask: realCreateTask,
  waitForTask: realWaitForTask,
  download: realDownload,
  creditsAfter: realCreditsAfter,
};

const ledgerEntry = (job, status) => ({
  run: job.run,
  localJobId: job.id,
  taskId: job.upstreamTaskId,
  capability: job.capability,
  model: job.model,
  provider: job.provider,
  providerModel: job.providerModel,
  estimatedUsd: job.estimateUsd,
  actualUsd: job.actualUsd,
  costSource: job.costSource,
  status,
  creditsBefore: job.creditsBefore ?? null,
  creditsAfter: job.creditsAfter ?? null,
  failedOver: job.failedOver ?? false,
  ...(job.error ? { error: job.error } : {}),
});

/**
 * Plan, reserve and submit one job, returning as soon as the provider has
 * accepted it. Waiting is waitJob's business, so a caller that cannot block
 * for minutes (an MCP tool) gets its local job id back at once.
 *
 * Routes are tried in order. Falling over to the next reseller happens only
 * on a clean rejection at create time (code 4); see canFailOver. Every attempt
 * that reaches the network has its own job record. `req.record` holds extra
 * fields for the job record, such as the reference mapping. `req.claim` is
 * passed to reserve(): a last check under the spend lock that may refuse.
 */
export async function submitJob(catalog, req, { store, limits, deps = {}, onEvent = () => {} }) {
  const d = { ...REAL, ...deps };
  const { capability, model, values, run, artifactBase, budgetUsd, only, exclude = [], dryRun = false, record = {}, claim = null } = req;
  runDir(run); // validates the slug before anything else happens

  const routes = routesFor(catalog, model, { only });
  const usable = routes.filter((r) => r.usable && !exclude.includes(r.provider));
  if (!usable.length) {
    throw usage(
      `No usable route for ${model.id}:\n` +
        routes
          .map((r) => `  · ${r.provider}: ${exclude.includes(r.provider) ? "already tried" : r.skipReason}`)
          .join("\n"),
    );
  }
  for (const r of routes.filter((r) => !r.usable)) {
    onEvent({ type: "skip", message: `skipping ${r.provider}: ${r.skipReason}` });
  }

  // `_durationS` prices a job whose length is not a request field (motion
  // control bills the reference video's seconds). `_inputS` is a reference
  // video's length where the provider bills it on top of the output (H3
  // reference-to-video). Neither is sent.
  const { _useI2v, _durationS, _inputS, ...inputValues } = values;
  const attempts = [];
  let lastError = null;
  const refusals = []; // each route's own refusal, so the final error names them all

  for (const [i, route] of usable.entries()) {
    const callRoute = effectiveRoute(route, _useI2v);
    const label = `${route.prov.label} · ${callRoute.model}`;
    if (i > 0) {
      onEvent({
        type: "fallback",
        message:
          `${lastError?.message?.split("\n")[0] ?? "previous route failed"}\n` +
          `  Falling back to ${label}, a different reseller of the same model; output may differ slightly.`,
      });
    }
    if (!route.verified) {
      onEvent({
        type: "unverified",
        message: `${model.id} via ${route.prov.label} is unverified: no job has succeeded on this route, so its price is unconfirmed.`,
      });
    }

    const built = buildInput(callRoute, inputValues);
    if (built.problems.length) {
      // Wrong for this route's contract. Not a provider fault, but a sibling
      // route may have a contract that accepts it, so try the next one.
      lastError = unknown(
        `${label} refused before submitting — nothing was spent:\n` + built.problems.map((p) => `  · ${p}`).join("\n"),
      );
      refusals.push(lastError);
      attempts.push({ provider: route.provider, outcome: "invalid-request" });
      continue;
    }
    if (built.unverified) {
      onEvent({
        type: "contract-unverified",
        message: `${label}'s request contract was never captured from its doc page; the body being sent is a guess and may be rejected.`,
      });
    }

    const key = providerKey(route.prov);
    const pre = await d.preflight(catalog, callRoute, {
      budgetUsd,
      key,
      modelId: model.id,
      capability,
      durationS: built.input.duration ?? _durationS,
      inputS: _inputS,
      resolution: built.input.resolution,
      quality: built.input.quality,
      input: built.input,
    });
    const plan = {
      route: { provider: route.provider, family: route.family, model: callRoute.model },
      label,
      input: built.input,
      estimateUsd: pre.estimatedUsd,
      basis: pre.basis,
      budgetUsd: pre.cap,
    };
    if (dryRun) {
      return {
        dryRun: true,
        ...plan,
        routes: routes.map((r) => ({ provider: r.provider, usable: r.usable, skipReason: r.skipReason })),
      };
    }

    let job = await reserve(
      store,
      {
        ...record,
        run,
        capability,
        model: model.id,
        provider: route.provider,
        family: route.family,
        providerModel: callRoute.model,
        artifactBase,
        estimateUsd: pre.estimatedUsd,
        basis: pre.basis,
        creditsBefore: pre.creditsBefore ?? null,
        failedOver: i > 0,
        input: built.input,
      },
      { limits, claim },
    );
    job = store.transition(job.id, "sending");

    try {
      const created = await d.createTask(route.prov, route.family, callRoute.model, built.input, { key });
      job = store.transition(job.id, "submitted", { upstreamTaskId: created.taskId });
      attempts.push({ provider: route.provider, outcome: "submitted", localJobId: job.id });
      onEvent({ type: "submitted", message: `submitted ${created.taskId} (${label}) as ${job.id}` });
      return { dryRun: false, job, ...plan, attempts };
    } catch (err) {
      if (err.code === EXIT.PROVIDER && canFailOver(err)) {
        job = store.transition(job.id, "failed-confirmed-free", {
          actualUsd: 0,
          costSource: "create-rejected",
          error: redact(err.message),
          note: "the provider rejected the create; no task exists",
        });
        ledger.append(ledgerEntry(job, "provider-error"));
        attempts.push({ provider: route.provider, outcome: "provider-error", localJobId: job.id });
        lastError = err;
        continue;
      }
      // A timeout, a dropped connection, a missing task id, or a bug: the job
      // may exist upstream. Never retried, never failed over.
      job = store.transition(job.id, "uncertain", {
        upstreamTaskId: err.taskId ?? null,
        error: redact(err.message ?? String(err)),
      });
      ledger.append(ledgerEntry(job, "uncertain"));
      throw uncertain(`${redact(err.message ?? String(err))}\n${uncertainMessage(job)}`, job.upstreamTaskId, {
        localJobId: job.id,
      });
    }
  }
  if (refusals.length > 1 && refusals.at(-1) === lastError) throw unknown(refusals.map((e) => e.message).join("\n"));
  throw lastError ?? usage(`No route produced a result for ${model.id}.`);
}

const OUTCOME = {
  succeeded: "succeeded",
  "failed-charged": "failed",
  "failed-unconfirmed": "failed",
  "failed-confirmed-free": "failed",
  refused: "failed",
};

/** The result to hand back for a job that is already settled. */
const settledResult = (job) => ({ outcome: OUTCOME[job.state], job, artifacts: job.artifacts ?? [] });

/**
 * Settle a job, unless another waiter (the studio's follower, `kie job`, an
 * MCP wait_job) settled it first. Returns null when this waiter lost: the
 * caller then discards its own copy and reports the recorded result. Within
 * one process the read and the write cannot interleave; across processes the
 * store refuses the second move, which is read the same way.
 */
function settle(store, id, state, patch) {
  if (!UNSETTLED.has(store.get(id).state)) return null;
  try {
    return store.transition(id, state, patch);
  } catch (err) {
    if (!UNSETTLED.has(store.get(id).state)) return null;
    throw err;
  }
}

const removeAll = (paths) => paths.forEach((p) => rmSync(p, { force: true }));

/**
 * Whether a waitJob result may be retried on the next reseller. Only a failure
 * confirmed free qualifies: a job that may have been charged is never repeated,
 * because a second submission would pay for the same film twice.
 */
export const shouldFailOver = (w) => w.outcome === "failed" && w.job.state === "failed-confirmed-free";

/**
 * Poll a job to a final state, download its results into the run and settle
 * its cost. Running out of time is a normal result ("pending"), never an
 * error: the job stays submitted and can be waited on again. Any other failure
 * to read the task rethrows as code 5 carrying the local job id.
 */
export async function waitJob(catalog, store, id, { timeoutMs = 20 * 60_000, onTick, deps = {} } = {}) {
  const d = { ...REAL, ...deps };
  let job = store.get(id);
  if (!UNSETTLED.has(job.state)) return settledResult(job);
  if (!job.upstreamTaskId) {
    throw uncertain(uncertainMessage(job), null, { localJobId: job.id });
  }

  const prov = getProvider(catalog, job.provider);
  const key = providerKey(prov);
  const dir = runDir(job.run);

  let result;
  try {
    result = await d.waitForTask(prov, job.family, job.upstreamTaskId, { key, timeoutMs, onTick });
  } catch (err) {
    if (err.code === EXIT.UNCERTAIN && err.timedOut) {
      // poll.mjs words its own timeout for the legacy rejoin path, which never
      // settles the local job, so the message is built here instead.
      const waited = timeoutMs < 120_000 ? `${Math.round(timeoutMs / 1000)} s` : `${Math.round(timeoutMs / 60_000)} min`;
      return { outcome: "pending", job, message: `${prov.label}: task ${job.upstreamTaskId} is still running after ${waited}.` };
    }
    if (err.code === EXIT.UNCERTAIN) {
      // Not the deadline: the task could not be read (bad key, 404, network). That is
      // not "still running". The job stays submitted; the error names it.
      err.localJobId ??= job.id;
      err.taskId ??= job.upstreamTaskId;
      throw err;
    }
    if (err.code !== EXIT.PROVIDER) throw err;
    if (err.succeededWithoutUrl) {
      // The provider finished and billed the task but gave us nothing to fetch.
      // Recording this as a failure would invite a second, paid submission.
      const paid = taskCost(prov, err.data);
      const settled = settle(store, job.id, "succeeded", {
        actualUsd: paid?.usd ?? null,
        costSource: paid ? "task-record" : "estimate",
        artifacts: [],
        error: redact(err.message),
      });
      if (!settled) return settledResult(store.get(job.id));
      job = settled;
      ledger.append(ledgerEntry(job, "success-no-artifact"));
      await writeRecord(dir, "job.json", { ...job, raw: err.data ?? null });
      return {
        outcome: "no-artifact",
        job,
        message:
          `${prov.label}: task ${job.upstreamTaskId} succeeded and was charged, but no file link was found in the result. ` +
          `The raw payload is in runs/${job.run}/job.json. It must not be resubmitted.`,
      };
    }
    const cost = taskCost(prov, err.data);
    const state = cost == null ? "failed-unconfirmed" : cost.usd === 0 ? "failed-confirmed-free" : "failed-charged";
    const settled = settle(store, job.id, state, {
      actualUsd: cost?.usd ?? null,
      costSource: cost ? "task-record" : "estimate",
      error: redact(err.message),
    });
    if (!settled) return { ...settledResult(store.get(job.id)), error: err };
    job = settled;
    ledger.append(ledgerEntry(job, "provider-error"));
    await writeRecord(dir, "job.json", { ...job, raw: err.data ?? null });
    return { outcome: "failed", job, error: err };
  }

  const artifacts = [];
  try {
    for (const url of result.urls) {
      // Downloaded to a .part file, then moved to a take name chosen at that
      // moment, so a second waiter or an interrupted download never leaves a
      // clobbered or truncated out.mp4.
      const { path } = await landArtifact(dir, job.artifactBase ?? "out", extFromUrl(url, ".bin"), (part) =>
        d.download(url, part, { within: dir }),
      );
      artifacts.push(path);
    }
  } catch (err) {
    // The task is finished and paid for. Leave the job submitted, still
    // holding its estimate, so waiting on it again fetches the result. What
    // this attempt already kept goes too, or the next attempt duplicates it.
    removeAll(artifacts);
    return {
      outcome: "pending",
      job,
      message:
        `Task ${job.upstreamTaskId} succeeded, but downloading its result failed (${redact(err.message ?? String(err))}). ` +
        `Nothing is lost: rejoin with kie job ${job.id} to fetch it again. Do not resubmit.`,
    };
  }
  const cost = taskCost(prov, result.data);
  const lost = () => {
    // Another waiter settled this job while we downloaded: its record and its
    // files stand, and ours were duplicates.
    removeAll(artifacts);
    return settledResult(store.get(job.id));
  };
  if (!UNSETTLED.has(store.get(job.id).state)) return lost();
  const after = await d.creditsAfter(prov, key);
  const settled = settle(store, job.id, "succeeded", {
    actualUsd: cost?.usd ?? null,
    costSource: cost ? "task-record" : "estimate",
    creditsAfter: after,
    artifacts,
    urls: result.urls,
    elapsedS: result.elapsedS,
  });
  if (!settled) return lost();
  job = settled;
  ledger.append(ledgerEntry(job, "success"));
  await writeRecord(dir, "job.json", { ...job, raw: result.data });
  await writeRecord(dir, "cost.json", {
    localJobId: job.id,
    estimateUsd: job.estimateUsd,
    actualUsd: job.actualUsd,
    costSource: job.costSource,
    credits: cost?.credits ?? null,
    creditsBefore: job.creditsBefore,
    creditsAfter: after,
    note:
      job.costSource === "task-record"
        ? "actualUsd is the provider's own figure for this task."
        : "This provider reports no per-task cost; the estimate from cli/models.json stands.",
  });
  return { outcome: "succeeded", job, artifacts };
}
