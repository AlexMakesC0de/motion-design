import { EXIT } from "../cli/lib/errors.mjs";
import { redact } from "../cli/lib/redact.mjs";

/** A successful tool result: readable text, structured data matching the tool's outputSchema, optional images. */
export function ok(text, data, extra = []) {
  return { content: [{ type: "text", text }, ...extra], structuredContent: data };
}

const NEXT = {
  [EXIT.USAGE]: [false, "Fix the arguments the message names and call again."],
  [EXIT.BUDGET]: [
    false,
    "Nothing was spent. Ask the user whether to raise the per-job budget (budget_usd) or the daily cap " +
      "(they run kie limits --daily N), or choose a cheaper model, resolution or duration.",
  ],
  [EXIT.UNKNOWN]: [false, "Fix the request using the allowed values or folders in the message."],
  [EXIT.PROVIDER]: [
    true,
    "The provider or the spend lock failed. A create the provider rejected was not charged. Retry once; if it fails again, tell the user.",
  ],
};

function uncertainNext(localJobId, upstreamTaskId) {
  const job = localJobId ?? "the job";
  if (upstreamTaskId) {
    return `${job} was submitted as ${upstreamTaskId} and its outcome is not known yet. Call wait_job with job_id "${localJobId}". Do not resubmit.`;
  }
  return (
    `${job} may exist at kie, and there is no upstream task id to poll. Do not resubmit. ` +
    `Ask the user to check kie's task log (kie.ai dashboard) and record the outcome with ` +
    `kie job resolve ${localJobId ?? "<local job id>"} --task <task id> (it exists) or ` +
    `kie job resolve ${localJobId ?? "<local job id>"} --not-created (it does not).`
  );
}

/**
 * A thrown error as an isError result. The structured part goes in _meta, not
 * structuredContent: SDK 1.32 clients validate structuredContent against the
 * tool's outputSchema even on an error, and an error object would fail it.
 */
export function fail(err) {
  const known = typeof err?.code === "number" && err.code >= EXIT.USAGE && err.code <= EXIT.UNCERTAIN;
  const code = known ? err.code : EXIT.USAGE;
  const localJobId = err?.localJobId ?? null;
  const upstreamTaskId = err?.taskId ?? null;
  const [retryable, nextAction] =
    code === EXIT.UNCERTAIN
      ? [false, uncertainNext(localJobId, upstreamTaskId)]
      : known
        ? NEXT[code]
        : [false, "An unexpected error. Show the message to the user; before generating again, call status to see whether a job is pending."];
  const message = redact(String(err?.message ?? err));
  return {
    isError: true,
    content: [{ type: "text", text: `Error ${code}: ${message}\nNext: ${nextAction}` }],
    _meta: { error: { code, retryable, nextAction, localJobId, upstreamTaskId } },
  };
}
