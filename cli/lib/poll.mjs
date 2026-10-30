import { createWriteStream, realpathSync, rmSync } from "node:fs";
import { once } from "node:events";
import { dirname } from "node:path";
import { isInside } from "./run.mjs";
import { queryTask } from "./client.mjs";
import { redact } from "./redact.mjs";
import { provider, uncertain, usage } from "./errors.mjs";

const SUCCESS = new Set(["success", "succeeded", "completed", "done", "finished"]);
const FAILURE = new Set([
  "fail",
  "failed",
  "error",
  "create_task_failed",
  "generate_failed",
  "cancelled",
  "canceled",
  // WaveSpeed's terminal set adds these two. Treating an unknown terminal state
  // as "still running" would poll until the timeout and then report uncertain,
  // sending the caller to rejoin a job that is already dead.
  "timeout",
  "deleted",
]);

function stateOf(data) {
  const raw =
    data?.state ?? data?.status ?? data?.successFlag ?? data?.taskStatus ?? "";
  // Some routes report a numeric flag: 0 pending, 1 success, 2/3 failure.
  if (typeof raw === "number") {
    if (raw === 1) return "success";
    if (raw === 0) return "generating";
    return "fail";
  }
  return String(raw).toLowerCase();
}

/**
 * kie.ai result payloads are not uniformly shaped across families, so this is
 * deliberately liberal. Anything it cannot read is not treated as failure --
 * the raw response is kept in job.json so a new shape is diagnosable rather
 * than silently lost.
 */
export function extractUrls(data) {
  const out = [];
  const push = (v) => {
    if (typeof v === "string" && /^https?:\/\//i.test(v)) out.push(v);
    else if (Array.isArray(v)) v.forEach(push);
  };

  let result = data?.resultJson ?? data?.response ?? data?.result ?? data;
  if (typeof result === "string") {
    try {
      result = JSON.parse(result);
    } catch {
      push(result);
      return [...new Set(out)];
    }
  }

  // WaveSpeed: { data: { outputs: { video: "https://..." } } }
  if (result?.outputs && typeof result.outputs === "object") {
    for (const v of Object.values(result.outputs)) push(v);
  }

  for (const key of [
    "outputs",
    "resultUrls",
    "result_urls",
    "resultUrl",
    "videoUrl",
    "video_url",
    "imageUrl",
    "image_url",
    "audioUrl",
    "audio_url",
    "url",
    "originUrls",
  ]) {
    push(result?.[key]);
  }
  if (Array.isArray(result)) result.forEach((r) => push(r?.url ?? r));
  return [...new Set(out)];
}

function failureReason(data) {
  return (
    data?.failMsg ??
    data?.errorMessage ??
    data?.error ??
    data?.msg ??
    data?.message ??
    "(kie.ai reported failure with no message)"
  );
}

/**
 * Poll to a terminal state. A timeout is NOT a failure -- it exits 5 carrying
 * the task id so the run is rejoinable, because resubmitting is how you pay
 * twice for one film.
 */
export async function waitForTask(
  prov,
  family,
  taskId,
  { key, timeoutMs = 20 * 60_000, onTick } = {},
) {
  const started = Date.now();
  let delay = 3000;

  for (;;) {
    const data = await queryTask(prov, family, taskId, { key });
    const state = stateOf(data);
    onTick?.(state, Math.round((Date.now() - started) / 1000));

    if (SUCCESS.has(state)) {
      const urls = extractUrls(data);
      if (!urls.length) {
        throw provider(
          `${prov.label}: task ${taskId} succeeded but no artifact URL was found. ` +
            `Raw payload saved to job.json -- the result shape may have changed.`,
          { data, succeededWithoutUrl: true },
        );
      }
      return { state, urls, data, elapsedS: Math.round((Date.now() - started) / 1000) };
    }

    if (FAILURE.has(state)) {
      throw provider(`${prov.label}: task ${taskId} failed: ${redact(String(failureReason(data)))}`, {
        data,
      });
    }

    if (Date.now() - started > timeoutMs) {
      throw uncertain(
        `${prov.label}: task ${taskId} still "${state}" after ${Math.round(timeoutMs / 60_000)} min. ` +
          `It is probably still running -- rejoin with: kie job ${taskId}`,
        taskId,
        { data },
      );
    }

    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.4, 15_000);
  }
}

/**
 * Fetch a result the provider returned for this task. https only, streamed
 * with a size ceiling, and written only inside `within` (the run directory),
 * so a strange URL in a task record cannot fill the disk or land elsewhere.
 */
export async function download(url, destPath, { within, maxBytes = 500_000_000 } = {}) {
  if (!/^https:\/\//i.test(url)) throw provider(`Refusing to download a non-https result URL: ${redact(url)}`);
  if (within) {
    const destDir = realpathSync(dirname(destPath));
    const root = realpathSync(within);
    if (destDir !== root && !isInside(destDir, root)) {
      throw usage(`${destPath} is outside the run directory ${within}; results are only written there.`);
    }
  }

  const res = await fetch(url);
  if (!res.ok) throw provider(`Download failed (${res.status}) for ${redact(url)}`);
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) throw provider(`Result is ${declared} bytes, over the ${maxBytes}-byte limit: ${redact(url)}`);

  const out = createWriteStream(destPath);
  let total = 0;
  try {
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > maxBytes) throw provider(`Result grew over the ${maxBytes}-byte limit; download stopped: ${redact(url)}`);
      if (!out.write(chunk)) await once(out, "drain");
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  } catch (err) {
    out.destroy();
    rmSync(destPath, { force: true });
    throw err;
  }
  return destPath;
}
