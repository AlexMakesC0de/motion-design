import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { AssetSummary, ModelInfo, SubmitResult } from "../api/types";
import { onlyBudgetBlocks, refusalReason, usd } from "./format";
import { addRef, fitToModel, generateBody, getDraft, removeRef, setDraft, useDraft } from "./promptStore";
import { estimateKey, useEstimate } from "./useEstimate";

interface Props {
  models: ModelInfo[];
  assets: AssetSummary[];
  /** Every reference role core knows; image models take any of them. */
  roles: string[];
  run: string;
  onSubmitted: (r: SubmitResult) => void;
  /** A submit ended ambiguously (code 5): the job may exist, so the take list should show it. */
  onUncertain?: (localJobId: string | null) => void;
}

/** A chip: a labelled native select, so it works from the keyboard and with screen readers. */
function Chip<T extends string | number>({
  label,
  value,
  options,
  format = String,
  empty = "—",
  onChange,
}: {
  label: string;
  value: T | null;
  options: T[];
  format?: (v: T) => string;
  /** What no choice means here. */
  empty?: string;
  onChange: (v: T) => void;
}) {
  if (!options.length) return null;
  return (
    <label className="chip">
      <span className="chip__label">{label}</span>
      <select
        className="chip__select mono"
        value={value == null ? "" : String(value)}
        onChange={(e) => {
          const hit = options.find((o) => String(o) === e.target.value);
          if (hit != null) onChange(hit);
        }}
      >
        {value == null && <option value="">{empty}</option>}
        {value != null && !options.includes(value) && <option value={String(value)}>{format(value)} (not offered)</option>}
        {options.map((o) => (
          <option key={String(o)} value={String(o)}>
            {format(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

function RefPicker({ assets, roles }: { assets: AssetSummary[]; roles: string[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  if (!roles.length) return null;
  if (!open) {
    return (
      <button type="button" className="chip chip--add" onClick={() => setOpen(true)} disabled={!assets.length} title={assets.length ? undefined : "Save an asset in the Library first"}>
        + @asset
      </button>
    );
  }
  const pickedName = name || assets[0]?.name || "";
  const pickedRole = role || roles[0];
  return (
    <span className="ref-picker" role="group" aria-label="Add an asset reference">
      <select aria-label="Asset" className="chip__select mono" value={pickedName} onChange={(e) => setName(e.target.value)}>
        {assets.map((a) => (
          <option key={a.name} value={a.name}>
            @{a.name}
          </option>
        ))}
      </select>
      <select aria-label="Role" className="chip__select mono" value={pickedRole} onChange={(e) => setRole(e.target.value)}>
        {roles.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="chip"
        onClick={() => {
          if (pickedName) addRef({ source: pickedName, role: pickedRole });
          setOpen(false);
        }}
      >
        Add
      </button>
      <button type="button" className="chip chip--quiet" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </span>
  );
}

export function PromptBar({ models, assets, roles, run, onSubmitted, onUncertain }: Props) {
  const draft = useDraft();
  const model = models.find((m) => m.id === draft.model) ?? null;
  const { estimate, error: estimateError, key: estimatedFor } = useEstimate(draft, model);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // A code-5 submit: the job may exist upstream. Generate stays off until the user has read this.
  const [unsure, setUnsure] = useState<string | null>(null);

  // First visit: start on the first video model, with settings it takes.
  useEffect(() => {
    if (draft.model || !models.length) return;
    const first = models.find((m) => m.capability === "video") ?? models[0];
    setDraft(fitToModel(first, draft));
  }, [models, draft]);

  // Only a real blocker is said out loud. An empty prompt just keeps Generate off; the placeholder already asks for one.
  const reason = estimateError ?? refusalReason(estimate) ?? (!run ? "Pick a film to work in." : null);
  const empty = !draft.prompt.trim();
  const price = estimate?.estimateUsd != null ? usd(estimate.estimateUsd) : "…";
  const roleChoices = model?.capability === "video" ? model.refRoles : roles;

  async function generate() {
    if (!model || unsure) return;
    // Send exactly the settings the shown price was estimated for.
    const now = getDraft();
    if (estimateKey(now, model) !== estimatedFor) return;
    setSending(true);
    setFailure(null);
    try {
      const path = model.capability === "image" ? "/api/generate/image" : "/api/generate/video";
      const r = await api<SubmitResult>(path, { method: "POST", body: generateBody(now, model, run) });
      onSubmitted(r);
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

  return (
    <section className="prompt-bar" aria-label="Prompt">
      {draft.preset && (
        <p className="prompt-bar__note">
          From preset <span className="mono">{draft.preset}</span>: this is the source prompt. Adapt it to your subject before generating.
        </p>
      )}
      <textarea
        className="prompt-bar__text"
        aria-label="Prompt"
        placeholder="Describe the shot…"
        rows={3}
        value={draft.prompt}
        onChange={(e) => setDraft({ prompt: e.target.value })}
      />
      <div className="prompt-bar__row">
        <div className="prompt-bar__chips">
          <Chip
            label="Model"
            value={draft.model || null}
            options={models.map((m) => m.id)}
            onChange={(id) => {
              const m = models.find((x) => x.id === id);
              if (m) setDraft(fitToModel(m, draft));
            }}
          />
          {model?.capability === "video" && <Chip label="Duration" value={draft.durationS} options={model.durationsS} format={(s) => `${s}s`} onChange={(durationS) => setDraft({ durationS, budgetUsd: null })} />}
          {model && <Chip label="Aspect ratio" value={draft.aspectRatio} options={model.aspectRatios} onChange={(aspectRatio) => setDraft({ aspectRatio })} />}
          {model && <Chip label="Resolution" value={draft.resolution} options={model.resolutionOptions} empty="default" onChange={(resolution) => setDraft({ resolution, budgetUsd: null })} />}
          {draft.refs.map((r, i) => (
            <span key={`${r.source}:${r.role}`} className="chip chip--ref mono">
              @{r.source} · {r.role}
              <button type="button" className="chip__remove" aria-label={`Remove @${r.source} ${r.role}`} onClick={() => removeRef(i)}>
                ×
              </button>
            </span>
          ))}
          <RefPicker assets={assets} roles={roleChoices} />
        </div>
        <div className="prompt-bar__go">
          {reason && (
            <p id="generate-reason" className="prompt-bar__reason" role="status">
              {reason}
              {onlyBudgetBlocks(estimate) && estimate?.estimateUsd != null && (
                <button type="button" className="prompt-bar__lift" onClick={() => setDraft({ budgetUsd: estimate.estimateUsd })}>
                  Allow {usd(estimate.estimateUsd)} for this job
                </button>
              )}
            </p>
          )}
          <button type="button" className="generate" disabled={Boolean(reason) || empty || sending || !estimate || Boolean(unsure)} aria-describedby={reason ? "generate-reason" : undefined} onClick={generate}>
            {sending ? "Sending…" : "Generate"} <span className="mono">{price}</span>
          </button>
        </div>
      </div>
      {failure && (
        <p className="prompt-bar__failure" role="alert">
          {failure}
        </p>
      )}
      {unsure && (
        <div className="prompt-bar__failure prompt-bar__unsure" role="alert">
          <p>{unsure}</p>
          <button type="button" className="button button--quiet" onClick={() => setUnsure(null)}>
            Dismiss
          </button>
        </div>
      )}
    </section>
  );
}
