import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { CheckResult, JobView, SpendView } from "../api/types";
import { onStudioEvent } from "../app/useStudio";
import { takeCost, usd } from "../studio/format";
import { mergeJob, mergeJobs } from "../studio/useJobs";
import "./spend.css";

/** A clean top for the y axis: the tallest day rounded up to 1, 2, 2.5 or 5 of its power of ten. */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= max - 1e-9)!;
  return Math.round(step * power * 1e6) / 1e6;
}

/** The `kie job resolve` commands in core's message for an uncertain job with no task id. */
export function resolveCommands(message: string): string[] {
  return [...message.matchAll(/^\s*(kie job resolve \S+ (?:--task <task id>|--not-created))/gm)].map((m) => m[1]);
}

const time = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const CHECKABLE = new Set(["submitted", "uncertain"]);

function Today({ spend }: { spend: SpendView }) {
  const share = spend.capUsd > 0 ? Math.min(1, spend.spentUsd / spend.capUsd) : 1;
  return (
    <section className="spend-today" aria-labelledby="spend-today">
      <h2 id="spend-today">Today</h2>
      <p className="spend-today__figure">
        <span className="mono">{usd(spend.spentUsd)}</span> <span className="spend-today__of">of {usd(spend.capUsd)}</span>
      </p>
      <div className="spend-today__bar" aria-hidden="true">
        <span style={{ transform: `scaleX(${share})` }} />
      </div>
      <p className="spend-today__note">
        <span className="mono">{usd(spend.availableUsd)} left</span>
        {" · "}per job {spend.perJobUsd != null ? <span className="mono">{usd(spend.perJobUsd)}</span> : "no limit"}
      </p>
      {spend.unsettled > 0 && (
        <p className="spend-today__note">{spend.unsettled === 1 ? "1 job is" : `${spend.unsettled} jobs are`} still settling; their holds count until then.</p>
      )}
      <p className="spend-today__hint">
        Change the limits in <a href="#/settings">Settings</a>.
      </p>
    </section>
  );
}

function DayChart({ days, picked, onPick }: { days: SpendView["days"]; picked: string; onPick: (day: string) => void }) {
  const [shown, setShown] = useState<number | null>(null);
  const top = niceMax(Math.max(0, ...days.map((d) => d.usd)));
  const ticks = [top, top / 2, 0];
  return (
    <section className="spend-chart" aria-labelledby="spend-chart">
      <h2 id="spend-chart">Last 14 days</h2>
      <div className="spend-chart__frame">
        <div className="spend-chart__axis" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="mono">
              {usd(t)}
            </span>
          ))}
        </div>
        <div className="spend-chart__plot" role="group" aria-label="Spend per day, last 14 days" onPointerLeave={() => setShown(null)}>
          {ticks.map((t) => (
            <span key={t} className="spend-chart__grid" style={{ bottom: `${(t / top) * 100}%` }} aria-hidden="true" />
          ))}
          {days.map((d, i) => (
            <button
              key={d.day}
              type="button"
              className="spend-chart__day"
              aria-label={`${d.day}: ${usd(d.usd)}`}
              aria-pressed={picked === d.day}
              onPointerEnter={() => setShown(i)}
              onFocus={() => setShown(i)}
              onBlur={() => setShown(null)}
              onClick={() => onPick(picked === d.day ? "" : d.day)}
            >
              <span className="spend-chart__bar" style={{ height: d.usd > 0 ? `max(2px, ${(d.usd / top) * 100}%)` : 0 }} />
              <span className="spend-chart__label mono" aria-hidden="true">
                {d.day.slice(8)}
              </span>
            </button>
          ))}
          {shown != null && days[shown] && (
            <div role="tooltip" className="spend-chart__tip" style={{ left: `${((shown + 0.5) / days.length) * 100}%` }}>
              <strong className="mono">{usd(days[shown].usd)}</strong>
              <span className="mono">{days[shown].day}</span>
            </div>
          )}
        </div>
      </div>
      <details className="spend-chart__table">
        <summary>Show as a table</summary>
        <table aria-label="Spend per day">
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Spent</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day}>
                <td className="mono">{d.day}</td>
                <td className="mono">{usd(d.usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="resolve">
      <code className="mono">{command}</code>
      <button
        type="button"
        className="button button--quiet"
        aria-label={`Copy ${command}`}
        onClick={() =>
          navigator.clipboard
            ?.writeText(command)
            .then(() => setCopied(true))
            .catch(() => {})
        }
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

function JobRow({ job }: { job: JobView }) {
  const [note, setNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const canCheck = CHECKABLE.has(job.state) && job.upstreamTaskId != null;
  const commands = job.state === "uncertain" && !job.upstreamTaskId && job.uncertainMessage ? resolveCommands(job.uncertainMessage) : [];

  async function check() {
    setChecking(true);
    setNote(null);
    try {
      setNote((await api<CheckResult>(`/api/jobs/${job.id}/check`, { method: "POST" })).message);
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <tr data-state={job.state}>
        <td className="mono">{time(job.createdAt)}</td>
        <td className="mono">{job.model}</td>
        <td className="mono jobs__cost">{takeCost(job)}</td>
        <td className="mono jobs__source">{job.costSource}</td>
        <td className="jobs__state">{job.state}</td>
        <td>
          <a className="mono" href={`#/films/${encodeURIComponent(job.run)}`}>
            {job.run}
          </a>
        </td>
        <td>
          {canCheck && (
            <button type="button" className="button button--quiet" disabled={checking} onClick={check}>
              Check again
            </button>
          )}
        </td>
      </tr>
      {(note || commands.length > 0) && (
        <tr className="jobs__more">
          <td colSpan={7}>
            {note && <p className="jobs__note">{note}</p>}
            {commands.length > 0 && (
              <>
                <pre className="jobs__message">{job.uncertainMessage}</pre>
                {commands.map((c) => (
                  <CopyCommand key={c} command={c} />
                ))}
              </>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function SpendScreen() {
  const [spend, setSpend] = useState<SpendView | null>(null);
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [film, setFilm] = useState("");
  const [day, setDay] = useState("");

  useEffect(() => {
    const load = () => {
      api<SpendView>("/api/spend")
        .then(setSpend)
        .catch(() => {});
      api<JobView[]>("/api/jobs?limit=1000")
        .then((list) => setJobs((held) => mergeJobs(held, list)))
        .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
    };
    load();
    return onStudioEvent((e) => {
      if (e.event === "hello") load();
      if (e.event === "spend") setSpend(e.data);
      if (e.event === "job") setJobs((prev) => mergeJob(prev, e.data));
    });
  }, []);

  const films = [...new Set(jobs.map((j) => j.run))].sort();
  const days = [...new Set(jobs.map((j) => j.day).filter((d): d is string => !!d))].sort().reverse();
  const shown = jobs.filter((j) => (!film || j.run === film) && (!day || j.day === day));

  return (
    <div className="spend">
      <header className="spend__head">
        <h1>Spend</h1>
      </header>
      {spend && (
        <div className="spend__top">
          <Today spend={spend} />
          <DayChart days={spend.days} picked={day} onPick={setDay} />
        </div>
      )}
      <section className="jobs" aria-labelledby="jobs-title">
        <div className="jobs__head">
          <h2 id="jobs-title">Jobs</h2>
          <label htmlFor="jobs-film">Film</label>
          <select id="jobs-film" value={film} onChange={(e) => setFilm(e.target.value)}>
            <option value="">All films</option>
            {films.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <label htmlFor="jobs-day">Day</label>
          <select id="jobs-day" value={day} onChange={(e) => setDay(e.target.value)}>
            <option value="">All days</option>
            {[...new Set([...days, ...(day ? [day] : [])])].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <span className="jobs__count mono">{shown.length === 1 ? "1 job" : `${shown.length} jobs`}</span>
        </div>
        {error && (
          <p className="jobs__error" role="alert">
            {error}
          </p>
        )}
        <table className="jobs__table" aria-label="Jobs">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Model</th>
              <th scope="col">Cost</th>
              <th scope="col">Cost source</th>
              <th scope="col">State</th>
              <th scope="col">Film</th>
              <th scope="col" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {shown.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
          </tbody>
        </table>
        {!shown.length && !error && <p className="jobs__none">No jobs match.</p>}
      </section>
    </div>
  );
}
