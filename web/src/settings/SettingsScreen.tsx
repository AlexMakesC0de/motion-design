import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "../api/client";
import type { DoctorResult, LimitsView, ProviderInfo, SavedKey, SettingsView } from "../api/types";
import { Icon } from "../app/icons";
import { usd } from "../studio/format";
import "./settings.css";

type Limits = Pick<LimitsView, "dailyUsd" | "perJobUsd">;

/** The form's text as limits, or the sentence saying what is wrong. Empty per-job means none. */
export function readLimitsForm(cap: string, perJob: string): { limits: Limits; problem: null } | { limits: null; problem: string } {
  const daily = cap.trim() === "" ? NaN : Number(cap);
  if (!Number.isFinite(daily) || daily < 0) return { limits: null, problem: "The daily cap is a dollar amount of 0 or more." };
  if (perJob.trim() === "") return { limits: { dailyUsd: daily, perJobUsd: null }, problem: null };
  const each = Number(perJob);
  if (!Number.isFinite(each) || each <= 0) return { limits: null, problem: "The per-job limit is a dollar amount above 0. Leave it empty for none." };
  return { limits: { dailyUsd: daily, perJobUsd: each }, problem: null };
}

const describe = (l: Limits) => `daily cap ${usd(l.dailyUsd)}, per job ${l.perJobUsd != null ? usd(l.perJobUsd) : "no limit"}`;
const TAG = { ok: "ok", warn: "warn", fail: "FAIL", info: "note" } as const;
const LEVEL_ICON = { ok: "check", warn: "minus", fail: "close", info: "more" } as const;
const QUICK_CAPS = [5, 10, 25, 50];

/** A card's head: an icon tile, its title and one line on what it is for. */
function CardHead({ id, icon, title, children }: { id: string; icon: string; title: string; children: ReactNode }) {
  return (
    <div className="set-card__head">
      <span className="set-card__tile" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <div className="set-card__words">
        <h2 id={id}>{title}</h2>
        <p className="settings__hint">{children}</p>
      </div>
    </div>
  );
}

function LimitsForm({ initial }: { initial: LimitsView }) {
  // What the file held when last read; sent as `was` so a stale page is refused.
  const [saved, setSaved] = useState<Limits>({ dailyUsd: initial.dailyUsd, perJobUsd: initial.perJobUsd });
  const [cap, setCap] = useState(String(initial.dailyUsd));
  const [perJob, setPerJob] = useState(initial.perJobUsd != null ? String(initial.perJobUsd) : "");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const form = readLimitsForm(cap, perJob);
  const changed = form.limits != null && (form.limits.dailyUsd !== saved.dailyUsd || form.limits.perJobUsd !== saved.perJobUsd);

  async function save() {
    if (!form.limits) return;
    setSending(true);
    setNote(null);
    setError(null);
    try {
      const r = await api<{ limits: LimitsView }>("/api/settings/limits", { method: "PUT", body: { ...form.limits, was: saved } });
      setSaved({ dailyUsd: r.limits.dailyUsd, perJobUsd: r.limits.perJobUsd });
      setNote("Saved.");
    } catch (e) {
      const current = e instanceof ApiError ? (e.detail.current as LimitsView | undefined) : undefined;
      if (current) {
        // Show what the file holds now, in the inputs as well as `was`: inputs left at the old values
        // would send them with a matching `was` on the next save and undo the change made elsewhere.
        setSaved({ dailyUsd: current.dailyUsd, perJobUsd: current.perJobUsd });
        setCap(String(current.dailyUsd));
        setPerJob(current.perJobUsd == null ? "" : String(current.perJobUsd));
      }
      const message = e instanceof ApiError ? e.message : String(e);
      setError(current ? `${message} Saved now: ${describe(current)}. The fields show these values now.` : message);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="set-card" aria-labelledby="limits-title">
      <CardHead id="limits-title" icon="spend" title="Spending limits">
        Every paid job checks these before it is sent, from here, the CLI or an agent.
      </CardHead>
      <div className="limits">
        <div className="limit">
          <label className="limit__label" htmlFor="limit-daily">
            Daily cap
          </label>
          <span className="limit__money">
            <span aria-hidden="true">$</span>
            <input id="limit-daily" className="mono" type="number" min="0" step="0.5" value={cap} onChange={(e) => setCap(e.target.value)} />
          </span>
          <div className="limit__quick" role="group" aria-label="Quick daily caps">
            {QUICK_CAPS.map((v) => (
              <button key={v} type="button" className="limit__pick" aria-pressed={Number(cap) === v} aria-label={`Set daily cap to $${v}`} onClick={() => setCap(String(v))}>
                ${v}
              </button>
            ))}
          </div>
        </div>
        <div className="limit">
          <label className="limit__label" htmlFor="limit-job">
            Per-job limit
          </label>
          <span className="limit__money">
            <span aria-hidden="true">$</span>
            <input id="limit-job" className="mono" type="number" min="0" step="0.25" placeholder="none" value={perJob} onChange={(e) => setPerJob(e.target.value)} />
          </span>
          <div className="limit__quick">
            <button type="button" className="limit__pick" aria-pressed={perJob.trim() === ""} onClick={() => setPerJob("")}>
              No limit
            </button>
          </div>
        </div>
      </div>
      {form.problem && <p className="settings__problem">{form.problem}</p>}
      {error && (
        <p className="settings__error" role="alert">
          {error}
        </p>
      )}
      <div className="set-card__foot">
        <p className="settings__hint">
          Saved in <span className="mono">{initial.file}</span>, the same file <span className="mono">kie limits</span> writes.
        </p>
        {note && <span className="settings__note">{note}</span>}
        <button type="button" className="button button--light" disabled={!changed || sending} onClick={save}>
          Save limits
        </button>
      </div>
    </section>
  );
}

function Doctor() {
  const [result, setResult] = useState<DoctorResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      setResult(await api<DoctorResult>("/api/settings/doctor", { method: "POST" }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const summary = running
    ? "Checking…"
    : !result
      ? "Runs kie doctor only when you ask."
      : result.failures === 0
        ? "No problems found."
        : result.failures === 1
          ? "1 problem found."
          : `${result.failures} problems found.`;

  return (
    <section className="set-card" aria-labelledby="doctor-title">
      <CardHead id="doctor-title" icon="check" title="Check the setup">
        Provider keys, the kie.ai balance and the model catalog. Its one network request is the free balance read; nothing is generated.
      </CardHead>
      {error && (
        <p className="settings__error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <ul className="doctor" aria-label="Doctor checks">
          {result.checks.map((c, i) => (
            <li key={i} data-level={c.level}>
              <span className="doctor__icon" aria-hidden="true">
                <Icon name={LEVEL_ICON[c.level]} size={14} />
              </span>
              <span className="sr-only">{TAG[c.level]}: </span>
              <span>{c.text}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="set-card__foot">
        <p className="settings__note" data-problems={result ? result.failures > 0 : undefined}>
          {summary}
        </p>
        <button type="button" className="button button--light" disabled={running} onClick={run}>
          Run kie doctor
        </button>
      </div>
    </section>
  );
}

const SOURCE = { env: "From the environment", dotenv: "From this project's .env", file: "Saved on this computer" } as const;

/** One provider: whether a key is set, and a paste box with the exact page to get one. */
function ProviderRow({ initial }: { initial: ProviderInfo }) {
  const [p, setP] = useState(initial);
  const [open, setOpen] = useState(!initial.keyConfigured);
  const [key, setKey] = useState("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputId = `key-${p.name}`;

  async function send(method: "PUT" | "DELETE") {
    setSending(true);
    setNote(null);
    setError(null);
    try {
      if (method === "PUT") {
        const r = await api<SavedKey>(`/api/settings/keys/${p.name}`, { method, body: { key } });
        setP(r.provider);
        setKey("");
        setOpen(false);
        setNote(
          r.warning ??
            (r.checked ? `Key saved and working${r.balance != null ? `: ${r.balance.toLocaleString()} credits left` : ""}.` : "Key saved. It is checked on the first job."),
        );
      } else {
        const r = await api<{ provider: ProviderInfo }>(`/api/settings/keys/${p.name}`, { method });
        setP(r.provider);
        setOpen(!r.provider.keyConfigured);
        setNote(r.provider.keyConfigured ? `Saved key removed. A key from ${r.provider.keySource === "env" ? "the environment" : ".env"} is still in use.` : "Key removed.");
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <li className="provider">
      <div className="provider__row">
        <span className="provider__mark" aria-hidden="true">
          {p.label.slice(0, 1)}
        </span>
        <span className="provider__main">
          <span className="provider__name">{p.label}</span>
          <span className="provider__where">
            {p.keySource ? (
              <>
                {SOURCE[p.keySource]}
                {p.keySource === "file" ? (
                  <>
                    {" "}
                    in <span className="mono">{p.keyFile}</span>
                  </>
                ) : (
                  <>
                    {" "}
                    as <span className="mono">{p.keyEnv}</span>
                  </>
                )}
              </>
            ) : (
              <>
                Paste a key below, or set <span className="mono">{p.keyEnv}</span>
              </>
            )}
          </span>
        </span>
        <span className="provider__key" data-ok={p.keyConfigured}>
          <Icon name={p.keyConfigured ? "check" : "minus"} size={14} />
          {p.keyConfigured ? "Key found" : "No key"}
        </span>
        {p.keyConfigured && !open && (
          <button type="button" className="button button--quiet provider__action" onClick={() => setOpen(true)}>
            {p.keySource === "file" ? "Replace" : "Save a key"}
          </button>
        )}
        {p.keySource === "file" && !open && (
          <button type="button" className="button button--quiet provider__action" disabled={sending} onClick={() => send("DELETE")} aria-label={`Remove the saved ${p.label} key`}>
            Remove
          </button>
        )}
      </div>
      {open && (
        <form
          className="provider__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) void send("PUT");
          }}
        >
          <p className="provider__steps">
            <span className="provider__step">1</span>
            <span>
              {p.keySteps ?? `Sign in to ${p.label} and copy your API key.`}{" "}
              <a className="provider__signup" href={p.signup} target="_blank" rel="noreferrer" aria-label={`Open the ${p.label} key page (new tab)`}>
                Open the key page <span aria-hidden="true">↗</span>
              </a>
            </span>
          </p>
          <div className="provider__paste">
            <span className="provider__step" aria-hidden="true">
              2
            </span>
            <label className="sr-only" htmlFor={inputId}>
              {`${p.label} API key`}
            </label>
            <input
              id={inputId}
              className="provider__input mono"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={`Paste your ${p.label} key`}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button type="submit" className="button button--light" disabled={!key.trim() || sending}>
              {sending ? "Checking…" : "Save key"}
            </button>
            {p.keyConfigured && (
              <button type="button" className="button button--quiet" onClick={() => (setOpen(false), setKey(""), setError(null))}>
                Cancel
              </button>
            )}
          </div>
          <p className="settings__hint provider__fine">
            Saved to <span className="mono">{p.keyFile}</span> (only you can read it), the file the CLI and MCP server read too.
            {p.balanceReadable ? " The key is tried with a free balance read before it is saved." : ""}
          </p>
        </form>
      )}
      {error && (
        <p className="settings__error provider__msg" role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className="settings__note provider__msg" role="status">
          {note}
        </p>
      )}
    </li>
  );
}

function Providers({ view }: { view: SettingsView }) {
  return (
    <section className="set-card" aria-labelledby="providers-title">
      <CardHead id="providers-title" icon="plug" title="Providers">
        Paste a key to start generating. Start with kie.ai; WaveSpeed is an optional backup. Keys stay on this computer and are never shown again.
      </CardHead>
      <ul className="providers" aria-label="Providers">
        {view.providers.map((p) => (
          <ProviderRow key={p.name} initial={p} />
        ))}
      </ul>
    </section>
  );
}

/** Settings: one centred column of cards. Limits first, since they guard every paid job. */
export function SettingsScreen() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<SettingsView>("/api/settings")
      .then(setView)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  return (
    <div className="settings">
      <header className="settings__head">
        <h1>Settings</h1>
        <p>Your budget, your keys and a quick health check. Everything here stays on this computer.</p>
      </header>
      {error && (
        <p className="settings__error" role="alert">
          {error}
        </p>
      )}
      {view && (
        <>
          <LimitsForm initial={view.limits} />
          <Providers view={view} />
          <Doctor />
        </>
      )}
      <section className="set-card" aria-labelledby="agents-title">
        <CardHead id="agents-title" icon="terminal" title="Agents">
          Work with Shard from Claude Code, Codex or Claude Desktop through the MCP server, with your skills as slash commands.
        </CardHead>
        <div className="set-card__links">
          <a className="button button--light" href="#/mcp">
            Set up MCP
          </a>
          <a className="button button--quiet" href="#/skills">
            Your skills
          </a>
        </div>
      </section>
    </div>
  );
}
