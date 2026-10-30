import type { TaskView } from "../api/types";
import { elapsed } from "../studio/format";
import { useNow } from "../studio/useJobs";

function status(t: TaskView, now: number): string {
  if (t.state === "running") return `${t.label} · running ${elapsed(t.startedAt, now)}`;
  const took = t.endedAt ? ` in ${elapsed(t.startedAt, Date.parse(t.endedAt))}` : "";
  return `${t.label} · ${t.state}${took}`;
}

/** This film's finishing tasks, newest first: progress while running, then outputs or the reason it failed. */
export function TaskList({ tasks }: { tasks: TaskView[] }) {
  const now = useNow();
  if (!tasks.length) return null;
  return (
    <ul className="tasks" aria-label="Tasks">
      {tasks.map((t) => (
        <li key={t.id} className="task" data-state={t.state}>
          <p className="task__status">
            {status(t, now)}
            {t.state === "running" && t.outS != null && (
              <>
                {" · "}
                <span className="mono">{t.outS.toFixed(1)}s written</span>
              </>
            )}
          </p>
          {t.outputs.length > 0 && (
            <p className="task__outputs">
              {t.outputs.map((o) =>
                o.url ? (
                  <a key={o.name} className="mono" href={o.url} target="_blank" rel="noreferrer">
                    {o.name}
                  </a>
                ) : (
                  <span key={o.name} className="mono">
                    {o.name}
                  </span>
                ),
              )}
            </p>
          )}
          {t.warnings.map((w) => (
            <p key={w} className="task__warning">
              {w}
            </p>
          ))}
          {t.error && <p className="task__error">{t.error}</p>}
        </li>
      ))}
    </ul>
  );
}
