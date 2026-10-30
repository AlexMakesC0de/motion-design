import type { ChatEntry } from "../api/types";

export type ToolEntry = Extract<ChatEntry, { kind: "tool" }>;

const MARK = { running: "…", done: "✓", failed: "✕" } as const;

/**
 * One tool call in the chat: its name, short arguments and short result, read
 * as "estimate seedance-2-5 4s 480p → $0.56". A failed step's result already
 * says what went wrong ("stopped by the limits, nothing spent"); the mark is
 * decoration.
 */
export function ToolStep({ entry }: { entry: ToolEntry }) {
  return (
    <div className="tool-step" data-state={entry.state}>
      <span className="tool-step__mark" aria-hidden="true">
        {MARK[entry.state]}
      </span>
      <span className="tool-step__name mono">{entry.name}</span>
      {entry.args && <span className="tool-step__args mono"> {entry.args}</span>}
      <span className="tool-step__result"> → {entry.result ?? "running…"}</span>
    </div>
  );
}
