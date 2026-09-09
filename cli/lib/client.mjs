import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { provider, uncertain, usage } from "./errors.mjs";

/**
 * Key resolution, in order. Never accepted as a CLI flag -- a key in argv lands
 * in shell history and in the agent transcript.
 */
export function apiKey() {
  if (process.env.KIE_API_KEY) return process.env.KIE_API_KEY.trim();

  const dotenv = join(process.cwd(), ".env");
  if (existsSync(dotenv)) {
    const m = readFileSync(dotenv, "utf8").match(/^\s*KIE_API_KEY\s*=\s*(.+)\s*$/m);
    if (m) return m[1].replace(/^["']|["']$/g, "").trim();
  }

  const keyfile = join(homedir(), ".config", "kie", "key");
  if (existsSync(keyfile)) return readFileSync(keyfile, "utf8").trim();

  throw usage(
    "No kie.ai API key. Set KIE_API_KEY, or write it to ~/.config/kie/key (chmod 600).\n" +
      "Get one at https://kie.ai/api-key. Do not pass it as a flag.",
  );
}

/** Redact anything key-shaped before it reaches a log, an error or the run record. */
export function redact(text) {
  if (typeof text !== "string") return text;
  return text.replace(/\b(sk-|kie-)?[A-Za-z0-9_-]{24,}\b/g, (m) =>
    m.length > 8 ? `${m.slice(0, 4)}…${m.slice(-2)}` : "…",
  );
}

// kie.ai allows 20 new generation requests per 10s. Polling is not metered as
// creation, so only creates pass through the bucket.
const CREATE_WINDOW_MS = 10_000;
const CREATE_MAX = 18; // headroom under the documented 20
const createTimes = [];

async function throttleCreate() {
  for (;;) {
    const now = Date.now();
    while (createTimes.length && now - createTimes[0] > CREATE_WINDOW_MS) createTimes.shift();
    if (createTimes.length < CREATE_MAX) {
      createTimes.push(now);
      return;
    }
    const waitMs = CREATE_WINDOW_MS - (now - createTimes[0]) + 50;
    await new Promise((r) => setTimeout(r, waitMs));
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
      /* provider returned non-JSON; keep the text for the error */
    }
    return { status: res.status, json, text, ok: res.ok };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A create is NOT idempotent. It is retried only when the request was
 * definitively rejected before doing any work -- an explicit 429, or a
 * connection that never opened. A timeout, an aborted read, or a 5xx after the
 * body was sent all mean the job MAY exist, so those surface as `uncertain`
 * rather than being retried into a double charge.
 */
export async function createTask(catalog, family, payload, { key, attempts = 3 } = {}) {
  const fam = catalog.api.families[family];
  if (!fam) throw usage(`Unknown API family "${family}" in models.json.`);
  const url = catalog.api.baseUrl + fam.create;

  let lastRejection = null;
  for (let i = 0; i < attempts; i++) {
    await throttleCreate();
    let res;
    try {
      res = await request(url, { method: "POST", body: payload, key });
    } catch (err) {
      const preflight =
        err.cause?.code === "ECONNREFUSED" ||
        err.cause?.code === "ENOTFOUND" ||
        err.cause?.code === "EAI_AGAIN";
      if (preflight && i < attempts - 1) {
        lastRejection = err.message;
        await new Promise((r) => setTimeout(r, jitter(1500 * 2 ** i)));
        continue;
      }
      throw uncertain(
        `Create request to kie.ai did not complete cleanly (${err.name}: ${redact(err.message)}).\n` +
          `The job MAY have been created. Check https://kie.ai before resubmitting.`,
        null,
      );
    }

    if (res.status === 429) {
      lastRejection = "429 rate limited";
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, jitter(4000 * 2 ** i)));
        continue;
      }
      throw provider(`kie.ai rate limited the request after ${attempts} attempts.`);
    }

    // kie.ai reports failures in the BODY, not the HTTP status: a rejected
    // request comes back 200 OK carrying {"code":500,"msg":"..."}. Checking
    // res.ok alone reads that as success and then fails confusingly later on a
    // missing task id. The body code is authoritative.
    const bodyCode = res.json?.code;
    const failed = !res.ok || (typeof bodyCode === "number" && bodyCode !== 200);

    if (failed) {
      const msg = redact(res.json?.msg ?? res.json?.message ?? res.text ?? "(no body)");
      throw provider(`kie.ai rejected the request (code ${bodyCode ?? res.status}): ${msg}`, {
        status: res.status,
        bodyCode,
      });
    }

    const taskId =
      res.json?.data?.taskId ?? res.json?.data?.task_id ?? res.json?.taskId ?? null;

    // 200 means "task created", not "task succeeded" -- but no id means we
    // cannot rejoin, which is exactly the uncertain case.
    if (!taskId) {
      throw uncertain(
        `kie.ai accepted the request but returned no task id: ${redact(res.text?.slice(0, 400) ?? "")}`,
        null,
      );
    }

    return { taskId, raw: res.json };
  }
  throw provider(`Create failed: ${lastRejection ?? "unknown"}`);
}

/** Polling is idempotent, so it retries freely. */
export async function queryTask(catalog, family, taskId, { key, attempts = 4 } = {}) {
  const fam = catalog.api.families[family];
  const url = `${catalog.api.baseUrl}${fam.query}?${fam.queryParam}=${encodeURIComponent(taskId)}`;

  let last = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await request(url, { key, timeoutMs: 30_000 });
      if (res.ok) return res.json?.data ?? res.json;
      last = `${res.status}: ${redact(res.json?.msg ?? res.text ?? "")}`;
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      last = `${err.name}: ${redact(err.message)}`;
    }
    await new Promise((r) => setTimeout(r, jitter(1500 * 2 ** i)));
  }
  throw uncertain(`Could not read task ${taskId} (${last}). Retry: kie job ${taskId}`, taskId);
}

export async function credits(catalog, { key } = {}) {
  const url = catalog.api.baseUrl + catalog.api.credits;
  const res = await request(url, { key, timeoutMs: 20_000 });
  if (!res.ok) {
    throw provider(
      `Credit check failed (${res.status}): ${redact(res.json?.msg ?? res.text ?? "")}`,
      { status: res.status },
    );
  }
  const d = res.json?.data;
  const value = typeof d === "number" ? d : (d?.credits ?? d?.balance ?? null);
  return { credits: value, raw: res.json };
}
