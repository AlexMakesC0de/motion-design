// The Generate logic both making pages share (Image and Video): the draft's
// model kept to the page's capability, core's live estimate, why Generate is
// off, the budget lift, and the submit with its code-5 "unsure" hold.
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import type { ModelInfo, SubmitResult } from "../api/types";
import { sortModels } from "../app/modelMeta";
import { onlyBudgetBlocks, refusalReason, usd } from "./format";
import { fitToModel, generateBody, getDraft, setDraft, useDraft } from "./promptStore";
import { estimateKey, useEstimate } from "./useEstimate";

export interface GenerateOptions {
  /** Every model the catalog lists; the page keeps the ones of its capability. */
  models: ModelInfo[];
  capability: "image" | "video";
  /** Every reference role core knows; image models take any of them. */
  roles: string[];
  run: string;
  onSubmitted?: (r: SubmitResult) => void;
  /** A submit ended ambiguously (code 5): the job may exist, so the take list should show it. */
  onUncertain?: (localJobId: string | null) => void;
  /** Fields this page adds to the request (Image's conversation id). */
  extra?: Record<string, string>;
}

export function useGenerate({ models, capability, roles, run, onSubmitted, onUncertain, extra }: GenerateOptions) {
  const draft = useDraft();
  const pageModels = useMemo(() => sortModels(models.filter((m) => m.capability === capability)), [models, capability]);
  const model = pageModels.find((m) => m.id === draft.model) ?? null;
  const { estimate, error: estimateError, key: estimatedFor } = useEstimate(draft, model);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // A code-5 submit: the job may exist upstream. Generate stays off until the user has read this.
  const [unsure, setUnsure] = useState<string | null>(null);

  // The draft's model is of the other kind (the top bar's other menu, a reused take) or not chosen yet:
  // start on this page's first model, keeping the settings it takes.
  useEffect(() => {
    if (!pageModels.length || pageModels.some((m) => m.id === draft.model)) return;
    setDraft(fitToModel(pageModels[0], draft));
  }, [pageModels, draft]);

  // Only a real blocker is said out loud. An empty prompt just keeps Generate off; the placeholder already asks for one.
  const reason = estimateError ?? refusalReason(estimate) ?? (!run ? "Pick a film to work in." : null);
  const empty = !draft.prompt.trim();
  const price = estimate?.estimateUsd != null ? usd(estimate.estimateUsd) : "…";
  const lift = onlyBudgetBlocks(estimate) && estimate?.estimateUsd != null ? estimate.estimateUsd : null;
  const roleChoices = model?.capability === "video" ? model.refRoles : roles;
  const disabled = Boolean(reason) || empty || sending || !estimate || Boolean(unsure);

  function pickModel(id: string) {
    const m = pageModels.find((x) => x.id === id);
    if (m) setDraft(fitToModel(m, getDraft()));
  }

  async function generate() {
    if (!model || unsure) return;
    // Send exactly the settings the shown price was estimated for.
    const now = getDraft();
    if (estimateKey(now, model) !== estimatedFor) return;
    setSending(true);
    setFailure(null);
    try {
      const path = model.capability === "image" ? "/api/generate/image" : "/api/generate/video";
      const r = await api<SubmitResult>(path, { method: "POST", body: { ...generateBody(now, model, run), ...extra } });
      onSubmitted?.(r);
    } catch (e) {
      if (e instanceof ApiError && e.code === 5) {
        setUnsure(e.message);
        onUncertain?.(typeof e.detail.localJobId === "string" ? e.detail.localJobId : null);
      } else {
        setFailure(e instanceof ApiError ? e.message : String(e));
      }
    } finally {
      setSending(false);
    }
  }

  return {
    draft,
    model,
    pageModels,
    pickModel,
    roleChoices,
    estimate,
    price,
    reason,
    /** The estimate when only this job's own budget stands in the way, which one click may lift. */
    lift,
    liftBudget: () => lift != null && setDraft({ budgetUsd: lift }),
    disabled,
    sending,
    failure,
    unsure,
    dismissUnsure: () => setUnsure(null),
    generate,
  };
}

export type Generate = ReturnType<typeof useGenerate>;
