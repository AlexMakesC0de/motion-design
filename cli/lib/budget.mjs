import { credits } from "./client.mjs";
import { budget as budgetError } from "./errors.mjs";

/**
 * Pre-flight refusal, not post-hoc reporting.
 *
 * SKILL.md forbids submitting a job merely to check access or cost, and
 * production.md forbids unbounded paid retry loops. Both become enforceable
 * only if the check happens before submission and can say no. A refusal here
 * costs nothing: exit 2, nothing uploaded, nothing generated.
 */
export async function preflight(
  catalog,
  model,
  { budgetUsd, quantity = 1, key, checkCredits = true } = {},
) {
  const estimatedUsd = (model.priceUsd ?? 0) * quantity;
  const cap = budgetUsd ?? catalog.defaultBudgetUsd?.[model.capability] ?? null;

  if (cap != null && estimatedUsd > cap) {
    throw budgetError(
      `Estimated $${estimatedUsd.toFixed(2)} for ${quantity}× ${model.id} exceeds the ` +
        `$${cap.toFixed(2)} budget. Nothing was submitted.\n` +
        `Raise it with --budget, or pick a cheaper model (kie models --capability ${model.capability}).`,
      { estimatedUsd, cap },
    );
  }

  let balance = null;
  if (checkCredits) {
    try {
      ({ credits: balance } = await credits(catalog, { key }));
    } catch {
      // A credit endpoint that is down must not block a within-budget job. The
      // budget cap is the real guard; the balance is a courtesy check.
      balance = null;
    }
    if (typeof balance === "number" && balance <= 0) {
      throw budgetError(
        `kie.ai account has no credits remaining (balance ${balance}). Nothing was submitted.`,
        { estimatedUsd, balance },
      );
    }
  }

  return { estimatedUsd, cap, creditsBefore: balance };
}

/** Read the balance again after a job so the ledger holds a fact, not just a guess. */
export async function creditsAfter(catalog, { key }) {
  try {
    const { credits: c } = await credits(catalog, { key });
    return c;
  } catch {
    return null;
  }
}
