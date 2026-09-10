import { provider as providerError, uncertain } from "./errors.mjs";
import { redact } from "./redact.mjs";
import { createUrl, queryUrl, createBody, readFailure, readTaskId } from "./providers.mjs";

export { redact };

// Rate limits are per provider, not global: kie allows 20 creates per 10s and
// throttling WaveSpeed on kie's budget would slow the fallback for no reason.
const CREATE_WINDOW_MS = 10_000;
const CREATE_MAX = 18;
const buckets = new Map();

async function throttleCreate(providerName) {
  const times = buckets.get(providerName) ?? [];
  buckets.set(providerName, times);
  for (;;) {
    const now = Date.now();
    while (times.length && now - times[0] > CREATE_WINDOW_MS) times.shift();
    if (times.length < CREATE_MAX) {
      times.push(now);
      return;
    }
    await new Promise((r) => setTimeout(r, CREATE_WINDOW_MS - (now - times[0]) + 50));
  }
}

const jitter = (ms) => ms * (0.5 + Math.random());

async function request(url, { method = "GET", body, key, timeoutMs = 60_000 }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* keep the text for the error */
    }
    return { status: res.status, json, text, ok: res.ok };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A create is NOT idempotent. It is retried only when the request was
 * definitively rejected before any work happened -- an explicit 429, or a
 * connection that never opened. A timeout, an aborted read, or a 200 carrying
 * no task id all mean the job MAY exist, so those surface as `uncertain`
 * rather than being retried into a double charge.
 */
export async function createTask(prov, family, modelString, input, { key, attempts = 3 } = {}) {
  const url = createUrl(prov, family, modelString);
  const body = createBody(prov, family, modelString, input);

  let lastRejection = null;
  for (let i = 0; i < attempts; i++) {
    await throttleCreate(prov.name);
    let res;
    try {
      res = await request(url, { method: "POST", body, key });
    } catch (err) {
      const neverOpened =
        err.cause?.code === "ECONNREFUSED" ||
        err.cause?.code === "ENOTFOUND" ||
        err.cause?.code === "EAI_AGAIN";
      if (neverOpened && i < attempts - 1) {
        lastRejection = err.message;
        await new Promise((r) => setTimeout(r, jitter(1500 * 2 ** i)));
        continue;
      }
      throw uncertain(
        `${prov.label}: create did not complete cleanly (${err.name}: ${redact(err.message)}).\n` +
          `The job MAY have been created. Check ${prov.signup} before resubmitting.`,
        null,
      );
    }

    if (res.status === 429) {
      lastRejection = "429 rate limited";
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, jitter(4000 * 2 ** i)));
        continue;
      }
      throw providerError(`${prov.label} rate limited the request after ${attempts} attempts.`);
    }

    const failure = readFailure(prov, res);
    if (failure) {
      throw providerError(`${prov.label} rejected the request (${failure})`, {
        status: res.status,
      });
    }

    const taskId = readTaskId(res);
    if (!taskId) {
      throw uncertain(
        `${prov.label} accepted the request but returned no task id: ${redact(
          (res.text ?? "").slice(0, 400),
        )}`,
        null,
      );
    }
    return { taskId, raw: res.json };
  }
  throw providerError(`${prov.label} create failed: ${lastRejection ?? "unknown"}`);
}

/** Polling is idempotent, so it retries freely. */
export async function queryTask(prov, family, taskId, { key, attempts = 4 } = {}) {
  const url = queryUrl(prov, family, taskId);

  let last = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await request(url, { key, timeoutMs: 30_000 });
      const failure = readFailure(prov, res);
      if (!failure) return res.json?.data ?? res.json;
      last = failure;
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      last = `${err.name}: ${redact(err.message)}`;
    }
    await new Promise((r) => setTimeout(r, jitter(1500 * 2 ** i)));
  }
  throw uncertain(
    `${prov.label}: could not read task ${taskId} (${last}). Retry: kie job ${taskId}`,
    taskId,
  );
}
