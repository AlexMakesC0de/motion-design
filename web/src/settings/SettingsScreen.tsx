import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { ChatSettingsView, DoctorResult, LimitsView, SettingsView } from "../api/types";
import { ConnectionForm, connectionLabel } from "../chat/ConnectionForm";
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
    <section className="settings__section" aria-labelledby="limits-title">
      <h2 id="limits-title">Spending limits</h2>
      <p className="settings__hint">
        Every paid job checks these before it is sent. Saved in <span className="mono">{initial.file}</span>, the same file{" "}
        <span className="mono">kie limits</span> writes.
      </p>
      <div className="settings__grid">
        <label htmlFor="limit-daily">Daily cap</label>
        <span className="settings__money">
          <span aria-hidden="true">$</span>
          <input id="limit-daily" className="mono" type="number" min="0" step="0.5" value={cap} onChange={(e) => setCap(e.target.value)} />
        </span>
        <label htmlFor="limit-job">Per-job limit</label>
        <span className="settings__money">
          <span aria-hidden="true">$</span>
          <input
            id="limit-job"
            className="mono"
            type="number"
            min="0"
            step="0.25"
            placeholder="none"
            value={perJob}
            onChange={(e) => setPerJob(e.target.value)}
          />
        </span>
      </div>
      {form.problem && <p className="settings__problem">{form.problem}</p>}
      <div className="settings__actions">
        <button type="button" className="button" disabled={!changed || sending} onClick={save}>
          Save limits
        </button>
        {note && <span className="settings__note">{note}</span>}
      </div>
      {error && (
        <p className="settings__error" role="alert">
          {error}
        </p>
      )}
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

  return (
    <section className="settings__section" aria-labelledby="doctor-title">
      <h2 id="doctor-title">Check the setup</h2>
      <p className="settings__hint">
        Runs kie doctor: provider keys, the kie.ai balance and the model catalog. Its one network request is the free balance read; nothing is generated.
      </p>
      <div className="settings__actions">
        <button type="button" className="button" disabled={running} onClick={run}>
          Run kie doctor
        </button>
        {running && <span className="settings__note">Checking…</span>}
      </div>
      {error && (
        <p className="settings__error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <>
          <ul className="doctor" aria-label="Doctor checks">
            {result.checks.map((c, i) => (
              <li key={i} data-level={c.level}>
                <span className="doctor__tag mono">{TAG[c.level]}</span>
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
          <p className="settings__note">
            {result.failures === 0 ? "No problems found." : result.failures === 1 ? "1 problem found." : `${result.failures} problems found.`}
          </p>
        </>
      )}
    </section>
  );
}

function ChatSection() {
  const [view, setView] = useState<ChatSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<ChatSettingsView>("/api/chat-settings")
      .then(setView)
      .catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, []);

  return (
    <section className="settings__section" aria-labelledby="chat-title">
      <h2 id="chat-title">Chat</h2>
      <p className="settings__hint">
        The Studio's chat uses the same tools as the CLI. It never asks before spending: within the limits above it goes ahead, and a job over them is
        refused.
      </p>
      {error && (
        <p className="settings__error" role="alert">
          {error}
        </p>
      )}
      {view && (
        <>
          <p className="settings__note">Now: {connectionLabel(view)}</p>
          <ConnectionForm initial={view} onSaved={setView} />
        </>
      )}
    </section>
  );
}

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
      </header>
      {error && (
        <p className="settings__error" role="alert">
          {error}
        </p>
      )}
      {view && (
        <>
          <LimitsForm initial={view.limits} />
          <section className="settings__section" aria-labelledby="providers-title">
            <h2 id="providers-title">Providers</h2>
            <p className="settings__hint">Keys stay on this computer. The studio only says whether one is set.</p>
            <ul className="providers" aria-label="Providers">
              {view.providers.map((p) => (
                <li key={p.name} className="provider">
                  <span className="provider__name">{p.label}</span>
                  <span className="provider__key" data-ok={p.keyConfigured}>
                    {p.keyConfigured ? "Key found" : "No key"}
                  </span>
                  <span className="provider__where">
                    Set <span className="mono">{p.keyEnv}</span> or put the key in <span className="mono">{p.keyFile}</span>
                  </span>
                  {!p.keyConfigured && (
                    <a className="provider__signup" href={p.signup} target="_blank" rel="noreferrer">
                      Get a {p.label} key
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <Doctor />
        </>
      )}
      <ChatSection />
    </div>
  );
}
