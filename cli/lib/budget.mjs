import { providerCredits } from "./providers.mjs";
import { budget as budgetError } from "./errors.mjs";

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
export async function preflight(catalog, route, { budgetUsd, quantity = 1, key, modelId, capability } = {}) {
  const estimatedUsd = (route.priceUsd ?? 0) * quantity;
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

  return { estimatedUsd, cap, creditsBefore: balance };
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
