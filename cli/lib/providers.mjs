import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { usage, provider as providerError, uncertain } from "./errors.mjs";
import { redact } from "./redact.mjs";

/**
 * Two resellers, one interface.
 *
 * They are not shaped alike and pretending otherwise is what breaks:
 *   kie        POST /api/v1/jobs/createTask  { model, input }   errors in the BODY (HTTP 200 + code 500)
 *   wavespeed  POST /api/v3/{model}          the input itself   errors in the HTTP status
 *
 * The differences live in models.json under `providers`, so adding a third is a
 * data edit. What must never be config is the failover POLICY -- see canFailOver.
 */

export function getProvider(catalog, name) {
  const p = catalog.providers && Object.hasOwn(catalog.providers, name) ? catalog.providers[name] : undefined;
  if (!p) {
    throw usage(
      `Unknown provider "${name}". Configured: ${Object.keys(catalog.providers ?? {}).join(", ")}`,
    );
  }
  return { name, ...p };
}

/** Per-provider key. Never a flag: argv lands in shell history and the transcript. */
export function providerKey(prov, { required = true } = {}) {
  const fromEnv = process.env[prov.keyEnv];
  if (fromEnv?.trim()) return fromEnv.trim();

  const dotenv = join(process.cwd(), ".env");
  if (existsSync(dotenv)) {
    const m = readFileSync(dotenv, "utf8").match(
      new RegExp(`^\\s*${prov.keyEnv}\\s*=\\s*(.+)\\s*$`, "m"),
    );
    if (m) return m[1].replace(/^["']|["']$/g, "").trim();
  }

  const keyfile = join(homedir(), prov.keyFile);
  if (existsSync(keyfile)) return readFileSync(keyfile, "utf8").trim();

  if (!required) return null;
  throw usage(
    `No ${prov.label} API key. Set ${prov.keyEnv}, or write it to ~/${prov.keyFile} (chmod 600).\n` +
      `Get one at ${prov.signup}. Do not pass it as a flag.`,
  );
}

export const hasKey = (prov) => Boolean(providerKey(prov, { required: false }));

export function createUrl(prov, family, modelString) {
  const fam = prov.families[family];
  if (!fam) throw usage(`Provider ${prov.name} has no API family "${family}".`);
  const path = fam.modelInPath
    ? fam.create.replace("{model}", modelString)
    : fam.create;
  return prov.baseUrl + path;
}

export function queryUrl(prov, family, taskId) {
  const fam = prov.families[family];
  if (fam.idInPath) return prov.baseUrl + fam.query.replace("{id}", encodeURIComponent(taskId));
  return `${prov.baseUrl}${fam.query}?${fam.queryParam}=${encodeURIComponent(taskId)}`;
}

export function createBody(prov, family, modelString, input) {
  const shape = prov.families[family].bodyShape;
  if (shape === "bare") return input; // wavespeed: the body IS the input
  if (shape === "flat") return { model: modelString, ...input }; // kie veo
  return { model: modelString, input }; // kie jobs
}

/**
 * Did the provider reject this? kie answers in the body, wavespeed in the status.
 * Getting this wrong reads a rejection as a success and then fails confusingly
 * later on a missing task id.
 */
export function readFailure(prov, res) {
  if (prov.errorInBody) {
    const code = res.json?.code;
    if (typeof code === "number" && code !== (prov.bodyOkCode ?? 200)) {
      return `code ${code}: ${redact(res.json?.msg ?? res.json?.message ?? "(no message)")}`;
    }
  }
  if (!res.ok) {
    return `HTTP ${res.status}: ${redact(
      res.json?.message ?? res.json?.msg ?? res.json?.error ?? res.text ?? "(no body)",
    )}`;
  }
  return null;
}

export function readTaskId(res) {
  const d = res.json?.data ?? res.json;
  return d?.taskId ?? d?.task_id ?? d?.id ?? null;
}

/**
 * FAILOVER POLICY. This is the part that must not be configuration.
 *
 * Falling over to a second provider means paying twice if the first one already
 * did work. So it is allowed only where the first attempt provably produced
 * nothing chargeable and provably left no job to rejoin:
 *
 *   4  provider error   -> YES. Rejected outright, or the job failed upstream.
 *   2  budget refused   -> NO.  Our decision, not their outage. A fallback would
 *                              silently spend money the cap just refused.
 *   3  invalid request  -> NO.  Our bug. The second provider rejects it too, for
 *                              money, after a delay.
 *   1  usage error      -> NO.  Same reason.
 *   5  UNCERTAIN        -> NEVER. The job may exist. Failing over both double
 *                              charges AND abandons the only rejoin handle.
 *
 * WaveSpeed's own documentation independently arrives at the last rule: "do not
 * blindly retry POST submissions since disconnected responses may still
 * represent accepted predictions."
 */
export function canFailOver(err) {
  return err?.code === 4;
}

export async function providerCredits(prov, key) {
  if (!prov.credits) return null;
  const res = await fetch(prov.baseUrl + prov.credits, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!res.ok) throw providerError(`${prov.label} credit check failed (HTTP ${res.status}).`);
  const json = await res.json().catch(() => null);
  const d = json?.data;
  return typeof d === "number" ? d : (d?.credits ?? d?.balance ?? null);
}

/**
 * What a finished task cost, from the provider's own record. kie reports
 * `creditsConsumed` per task (0 for a failed one). Balance differences cannot
 * stand in for it once two jobs overlap. Providers with no per-task figure
 * return null, and the caller keeps the estimate.
 */
export function taskCost(prov, data) {
  const credits = data?.creditsConsumed;
  if (typeof credits !== "number" || typeof prov.usdPerCredit !== "number") return null;
  return { usd: Math.round(credits * prov.usdPerCredit * 10_000) / 10_000, credits };
}

export { uncertain };
