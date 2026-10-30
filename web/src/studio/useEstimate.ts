import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Estimate, ModelInfo } from "../api/types";
import { onStudioEvent } from "../app/useStudio";
import { estimateBody, type Draft } from "./promptStore";

/** The request an estimate answers, as a comparable key. */
export const estimateKey = (draft: Draft, model: ModelInfo) => JSON.stringify(estimateBody(draft, model));

/**
 * Core's estimate for the draft, asked `delay` ms after the last change and
 * again whenever today's spend moves (another job may have used the cap).
 * Free: /api/estimate reserves nothing and calls no provider.
 *
 * Each answer is kept with the request it answers. Until the answer for the
 * current settings arrives, estimate and error are null (pending), so the
 * price on the button never belongs to settings the user has since changed.
 */
export function useEstimate(draft: Draft, model: ModelInfo | null, delay = 300) {
  const [answer, setAnswer] = useState<{ key: string; estimate: Estimate | null; error: string | null } | null>(null);
  const [spendTick, setSpendTick] = useState(0);
  const body = model ? estimateKey(draft, model) : null;

  useEffect(() => onStudioEvent((e) => e.event === "spend" && setSpendTick((n) => n + 1)), []);

  useEffect(() => {
    if (!body) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<Estimate>("/api/estimate", { method: "POST", body: JSON.parse(body), signal: ctrl.signal })
        .then((estimate) => setAnswer({ key: body, estimate, error: null }))
        .catch((e: ApiError) => {
          if (ctrl.signal.aborted) return;
          setAnswer({ key: body, estimate: null, error: e.message });
        });
    }, delay);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [body, delay, spendTick]);

  const current = body != null && answer?.key === body ? answer : null;
  return { estimate: current?.estimate ?? null, error: current?.error ?? null, key: current?.key ?? null, pending: body != null && !current };
}
