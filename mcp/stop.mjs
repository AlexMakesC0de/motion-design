// Stop for spending tools. A client that cancels a call (the studio chat's
// Stop button, or its tool timeout) aborts the handler's signal, but a
// handler already running would still reserve and submit. The provider calls
// a spending tool hands to core are wrapped so the price check, the last step
// before core reserves the money and submits, refuses once the call is
// cancelled: nothing is reserved, nothing reaches the provider.
import { preflight as realPreflight } from "../cli/lib/budget.mjs";
import { usage } from "../cli/lib/errors.mjs";

export const STOPPED = "Stopped before submitting: the call was cancelled, so nothing was reserved or spent.";

/** `generate` (core's provider calls, or the tests' stubs) with a preflight that refuses once `signal` is aborted. */
export function stoppable(generate, signal) {
  if (!signal) return generate;
  const preflight = generate?.preflight ?? realPreflight;
  const check = () => {
    if (signal.aborted) throw usage(STOPPED);
  };
  return {
    ...generate,
    async preflight(...args) {
      check();
      const out = await preflight(...args);
      check(); // core reserves and submits right after this returns
      return out;
    },
  };
}
