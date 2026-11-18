import { providerCredits } from "./providers.mjs";
import { budget as budgetError } from "./errors.mjs";

/**
 * Price a job the way the provider bills it. Seedance 2.5 and H3 on kie charge
 * per second at a per-resolution rate, so a flat per-job figure overstates a 4s
 * draft by 4x and understates a 30s film by 5x -- and the budget cap is only as
 * honest as this number. Routes without per-second pricing keep `priceUsd`.
 */
export function estimateUsd(route, { durationS, resolution, quality, input } = {}) {
  const pricing = route.pricing;
  if (pricing?.per === "image") return imagePrice(route, { resolution, quality });
  if (pricing?.per === "characters") return scriptPrice(route, input);
  if (pricing?.per !== "second") return { usd: route.priceUsd ?? 0, basis: "per-job" };

  // Kling's motion control names its resolution `mode`; the route says which field holds it.
  const field = pricing.resolutionField;
  const res = resolution ?? (field ? input?.[field] ?? route.input?.defaults?.[field] : undefined) ?? route.input?.defaults?.resolution;
  const seconds = Number(durationS ?? route.input?.defaults?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { usd: route.priceUsd ?? 0, basis: "per-job-fallback" };
  }
  const video = pricing.videoInput;
  if (video && input?.[video.field]?.length) return videoInputPrice(video, seconds, res);
  const rate = pricing.usdPerSecond?.[res];
  if (rate == null) {
    // The seconds are known but the resolution is not (or has no rate): the flat
    // figure would undercount a long job, so assume the dearest resolution.
    const top = Math.max(...Object.values(pricing.usdPerSecond ?? {}).filter(Number.isFinite));
    if (!Number.isFinite(top)) return { usd: route.priceUsd ?? 0, basis: "per-job-fallback" };
    return {
      usd: Math.round(top * seconds * 10_000) / 10_000,
      basis: `${seconds}s × $${top}/s (highest rate; resolution unknown)`,
    };
  }
  return {
    usd: Math.round(rate * seconds * 10_000) / 10_000,
    basis: `${seconds}s × $${rate}/s at ${res}`,
  };
}

/**
 * A job that sends a reference video. kie's Seedance 2 Fast then charges a lower
 * rate on the input seconds plus the output seconds, which comes to more than
 * the usual rate on the output alone. The video's length is not known when the
 * price is asked for, so the longest the provider accepts is counted: the cap
 * may overcount a short reference, never undercount a long one.
 */
function videoInputPrice({ usdPerSecond = {}, maxInputS }, seconds, res) {
  const known = usdPerSecond[res];
  const rate = known ?? Math.max(...Object.values(usdPerSecond).filter(Number.isFinite));
  const usd = Math.round(rate * (seconds + maxInputS) * 10_000) / 10_000;
  const at = known == null ? "(highest rate; resolution unknown)" : `at ${res}`;
  return { usd, basis: `(${seconds}s + up to ${maxInputS}s of reference video) × $${rate}/s ${at}` };
}

/** Speech billed by the script's length (ElevenLabs on kie: per 1,000 characters). */
function scriptPrice(route, input) {
  const { usdPer1000, field } = route.pricing;
  const chars = typeof input?.[field] === "string" ? input[field].length : 0;
  if (!chars) return { usd: route.priceUsd ?? 0, basis: "per-job-fallback" };
  return { usd: Math.round((chars / 1000) * usdPer1000 * 10_000) / 10_000, basis: `${chars} characters × $${usdPer1000} per 1,000` };
}

/**
 * Image routes that bill by the picture's resolution (GPT Image 2.5, Nano Banana 2)
 * or by a quality setting (Seedream). `pricing.by` names the input field and
 * `pricing.usd` its price per value. A value with no listed price is charged at
 * the dearest one, so the cap never undercounts.
 */
function imagePrice(route, { resolution, quality }) {
  const { by, usd: table = {} } = route.pricing;
  const asked = by === "quality" ? quality : resolution;
  const value = asked ?? route.input?.defaults?.[by];
  const key = Object.keys(table).find((k) => k.toLowerCase() === String(value ?? "").toLowerCase());
  if (key) return { usd: table[key], basis: `per image at ${by} ${key}` };
  const top = Math.max(...Object.values(table).filter(Number.isFinite));
  if (!Number.isFinite(top)) return { usd: route.priceUsd ?? 0, basis: "per-job" };
  return { usd: top, basis: `per image (highest rate; ${by} ${value ?? "unknown"})` };
}

/** How `kie models` and `kie preflight` show a route's price. */
export function priceLabel(route) {
  if (route.pricing?.per === "characters") return `$${route.pricing.usdPer1000} per 1,000 characters`;
  if (route.pricing?.per === "image") return Object.entries(route.pricing.usd ?? {}).map(([k, usd]) => `${k} $${usd}`).join(" ");
  const rates = route.pricing?.per === "second" ? Object.entries(route.pricing.usdPerSecond ?? {}) : [];
  if (!rates.length) return `$${route.priceUsd}`;
  return rates.map(([res, usd]) => `${res} $${usd}/s`).join(" ");
}

/**
 * Pre-flight refusal, not post-hoc reporting.
 *
 * SKILL.md forbids submitting a job merely to check access or cost, and
 * production.md forbids unbounded paid retry loops. Both become enforceable
 * only if the check happens before submission and can say no. A refusal costs
 * nothing: exit 2, nothing uploaded, nothing generated.
 *
 * Applied PER ROUTE, so a fallback is checked against the same cap the primary
 * was -- otherwise a failover could quietly spend more than the budget the user
 * set, which is precisely the moment they are not watching.
 */
export async function preflight(
  catalog,
  route,
  { budgetUsd, quantity = 1, key, modelId, capability, durationS, resolution, quality, input } = {},
) {
  const { usd, basis } = estimateUsd(route, { durationS, resolution, quality, input });
  const estimatedUsd = usd * quantity;
  const cap = budgetUsd ?? catalog.defaultBudgetUsd?.[capability] ?? null;

  if (cap != null && estimatedUsd > cap) {
    throw budgetError(
      `Estimated $${estimatedUsd.toFixed(2)} for ${quantity}x ${modelId ?? route.model} via ` +
        `${route.prov.label} exceeds the $${cap.toFixed(2)} budget. Nothing was submitted.\n` +
        `Raise it with --budget, or pick a cheaper model (kie models).`,
      { estimatedUsd, cap },
    );
  }

  let balance = null;
  if (route.prov.credits) {
    try {
      balance = await providerCredits(route.prov, key);
    } catch {
      // A credit endpoint that is down must not block a within-budget job. The
      // budget cap is the real guard; the balance is a courtesy check.
      balance = null;
    }
    if (typeof balance === "number" && balance <= 0) {
      throw budgetError(
        `${route.prov.label} has no credits remaining (balance ${balance}). Nothing was submitted.`,
        { estimatedUsd, balance },
      );
    }
  }

  return { estimatedUsd, basis, cap, creditsBefore: balance };
}

/** Read the balance again after a job so the ledger holds a fact, not just a guess. */
export async function creditsAfter(prov, key) {
  if (!prov.credits) return null;
  try {
    return await providerCredits(prov, key);
  } catch {
    return null;
  }
}
