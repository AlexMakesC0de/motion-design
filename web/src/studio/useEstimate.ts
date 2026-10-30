import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Estimate, ModelInfo } from "../api/types";
import { onStudioEvent } from "../app/useStudio";
import { estimateBody, type Draft } from "./promptStore";

/**
 * Core's estimate for the draft, asked `delay` ms after the last change and
 * again whenever today's spend moves (another job may have used the cap).
 * Free: /api/estimate reserves nothing and calls no provider.
 */
export function useEstimate(draft: Draft, model: ModelInfo | null, delay = 300) {
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spendTick, setSpendTick] = useState(0);
  const body = model ? JSON.stringify(estimateBody(draft, model)) : null;

  useEffect(() => onStudioEvent((e) => e.event === "spend" && setSpendTick((n) => n + 1)), []);

  useEffect(() => {
    if (!body) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<Estimate>("/api/estimate", { method: "POST", body: JSON.parse(body), signal: ctrl.signal })
        .then((e) => {
          setEstimate(e);
          setError(null);
        })
        .catch((e: ApiError) => {
          if (ctrl.signal.aborted) return;
          setEstimate(null);
          setError(e.message);
        });
    }, delay);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [body, delay, spendTick]);

  return { estimate: body ? estimate : null, error: body ? error : null };
}
