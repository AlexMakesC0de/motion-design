import { providerCredits } from "./providers.mjs";
import { budget as budgetError } from "./errors.mjs";

/**
 * Price a job the way the provider bills it. Seedance 2.5 and H3 on kie charge
 * per second at a per-resolution rate, so a flat per-job figure overstates a 4s
 * draft by 4x and understates a 30s film by 5x -- and the budget cap is only as
 * honest as this number. Routes without per-second pricing keep `priceUsd`.
 */
export function estimateUsd(route, { durationS, resolution } = {}) {
  const pricing = route.pricing;
  if (pricing?.per !== "second") return { usd: route.priceUsd ?? 0, basis: "per-job" };

  const res = resolution ?? route.input?.defaults?.resolution;
  const rate = pricing.usdPerSecond?.[res];
  const seconds = Number(durationS ?? route.input?.defaults?.duration);
  if (rate == null || !Number.isFinite(seconds) || seconds <= 0) {
    return { usd: route.priceUsd ?? 0, basis: "per-job-fallback" };
  }
  return {
    usd: Math.round(rate * seconds * 10_000) / 10_000,
    basis: `${seconds}s × $${rate}/s at ${res}`,
  };
}

/** How `kie models` and `kie preflight` show a route's price. */
export function priceLabel(route) {
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
  { budgetUsd, quantity = 1, key, modelId, capability, durationS, resolution } = {},
) {
  const { usd, basis } = estimateUsd(route, { durationS, resolution });
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
