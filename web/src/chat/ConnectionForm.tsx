import { useEffect, useId, useState } from "react";
import { api, ApiError } from "../api/client";
import type { ChatBackend, ChatSettingsView, CodexStatus, KeyBackend } from "../api/types";
import "./chat.css";

const message = (e: unknown) => (e instanceof ApiError ? e.message : String(e));

/** The ways to connect, in the order the form lists them, with one line on who bills what. */
export const CHOICES: { id: ChatBackend; label: string; hint: string }[] = [
  { id: "codex", label: "ChatGPT subscription", hint: "Through Codex on this computer. Uses your ChatGPT plan, not an API bill." },
  { id: "openai", label: "OpenAI API key", hint: "Each message is billed to the key's OpenAI account." },
  { id: "anthropic", label: "Anthropic API key (Claude)", hint: "Each message is billed to the key's Anthropic account." },
  { id: "openrouter", label: "OpenRouter API key", hint: "One key for models from many companies, billed by OpenRouter." },
  { id: "compatible", label: "Another AI service", hint: "Gemini, DeepSeek, Mistral, Groq, xAI, or a free model on this computer through Ollama or LM Studio." },
];

/** Services that answer like OpenAI, by their address. "Custom" is any other https address. */
export const SERVICES: { label: string; url: string }[] = [
  { label: "Google Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { label: "DeepSeek", url: "https://api.deepseek.com/v1" },
  { label: "Mistral", url: "https://api.mistral.ai/v1" },
  { label: "Groq", url: "https://api.groq.com/openai/v1" },
  { label: "xAI (Grok)", url: "https://api.x.ai/v1" },
  { label: "Ollama on this computer (free)", url: "http://localhost:11434/v1" },
  { label: "LM Studio on this computer (free)", url: "http://localhost:1234/v1" },
];
const CUSTOM = "custom";
const isLocal = (url: string) => url.startsWith("http://");

/**
 * The ways to connect the chat: the ChatGPT subscription through Codex, or an
 * API key (OpenAI, Anthropic, OpenRouter, or another service) with a model.
 * Used in Settings and, when nothing is set up, beside the chat itself. A key
 * goes to the server once and never comes back: the page only learns that
 * one is saved.
 */
export function ConnectionForm({ initial, onSaved }: { initial: ChatSettingsView; onSaved: (view: ChatSettingsView) => void }) {
  const id = useId();
  const [choice, setChoice] = useState<ChatBackend | null>(initial.backend);
  const [view, setView] = useState(initial);
  const [codex, setCodex] = useState<CodexStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [key, setKey] = useState("");
  const [models, setModels] = useState<string[] | null>(null);
  const [model, setModel] = useState(initial.model ?? "");
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl ?? SERVICES[0].url);
  const [service, setService] = useState(SERVICES.find((s) => s.url === (initial.baseUrl ?? SERVICES[0].url))?.url ?? CUSTOM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const keyed: KeyBackend | null = choice && choice !== "codex" ? choice : null;
  const keyInfo = keyed ? view.keys?.[keyed] : null;
  const keyReady = keyed === "openai" ? view.openai.keySaved : Boolean(keyInfo?.keySaved) || (keyed === "compatible" && isLocal(baseUrl));

  async function checkCodex() {
    setChecking(true);
    try {
      setCodex(await api<CodexStatus>("/api/chat-settings/codex"));
    } catch (e) {
      setCodex({ installed: false, loggedIn: false, plan: null, message: message(e) });
    } finally {
      setChecking(false);
    }
  }

  async function loadModels(backend: KeyBackend, url = baseUrl) {
    setError(null);
    const q = backend === "openai" ? "" : `?backend=${backend}${backend === "compatible" ? `&baseUrl=${encodeURIComponent(url)}` : ""}`;
    try {
      const r = await api<{ models: string[] }>(`/api/chat-settings/models${q}`);
      setModels(r.models);
      setModel((m) => (r.models.includes(m) ? m : (r.models[0] ?? m)));
    } catch (e) {
      setModels(null);
      setError(message(e));
    }
  }

  useEffect(() => {
    setError(null);
    setModels(null);
    if (choice === "codex" && !codex) checkCodex();
    if (keyed) {
      setModel(keyed === initial.backend ? (initial.model ?? "") : "");
      if (keyReady) loadModels(keyed);
    }
    // Each choice loads its status once; "Check again", saving a key and changing the address load again.
  }, [choice]);

  async function saveKey() {
    if (!keyed) return;
    setBusy(true);
    setError(null);
    try {
      const path = keyed === "openai" ? "/api/chat-settings/openai-key" : `/api/chat-settings/keys/${keyed}`;
      const next = await api<ChatSettingsView>(path, { method: "PUT", body: { key } });
      setKey("");
      setView(next);
      await loadModels(keyed);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function forgetKey() {
    if (!keyed) return;
    setBusy(true);
    try {
      setView(await api<ChatSettingsView>(`/api/chat-settings/keys/${keyed}`, { method: "DELETE" }));
      setModels(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function use() {
    setBusy(true);
    setError(null);
    try {
      const body = choice === "codex" ? { backend: "codex" } : { backend: choice, model, ...(choice === "compatible" ? { baseUrl } : {}) };
      const next = await api<ChatSettingsView>("/api/chat-settings", { method: "PUT", body });
      setView(next);
      onSaved(next);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  function pickService(url: string) {
    setService(url);
    if (url === CUSTOM) return;
    setBaseUrl(url);
    setModels(null);
    if (keyInfo?.keySaved || isLocal(url)) loadModels("compatible", url);
  }

  const ready = choice === "codex" ? Boolean(codex?.loggedIn) : keyed ? keyReady && Boolean(model.trim()) : false;
  // The option picked is the one already saved: nothing to switch to.
  const inUse = choice != null && choice === view.backend && (choice === "codex" || (model === view.model && (choice !== "compatible" || baseUrl === view.baseUrl)));
  const keyLabel = keyed === "compatible" ? "The service's API key" : (CHOICES.find((c) => c.id === keyed)?.label.replace(/ \(.*\)$/, "") ?? "API key");
  const source = keyed === "openai" ? view.openai : keyInfo;

  return (
    <div className="connect">
      <fieldset className="connect__choices">
        <legend>How the chat connects</legend>
        {CHOICES.map((c) => (
          <label key={c.id} className="connect__choice">
            <input type="radio" name={`${id}-backend`} checked={choice === c.id} onChange={() => setChoice(c.id)} />
            <span>
              <span className="connect__label">{c.label}</span>
              <span className="connect__hint">{c.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {choice === "codex" && (
        <div className="connect__detail">
          <p className="connect__status" data-ok={Boolean(codex?.loggedIn)} aria-live="polite">
            {checking ? "Checking Codex…" : codex ? (codex.loggedIn ? `Codex is logged in with ${codex.plan}.` : codex.message) : null}
          </p>
          <button type="button" className="button button--quiet" disabled={checking} onClick={checkCodex}>
            Check again
          </button>
        </div>
      )}

      {keyed && (
        <div className="connect__detail">
          {keyed === "compatible" && (
            <div className="connect__row">
              <label htmlFor={`${id}-service`}>Service</label>
              <select id={`${id}-service`} value={service} onChange={(e) => pickService(e.target.value)}>
                {SERVICES.map((s) => (
                  <option key={s.url} value={s.url}>
                    {s.label}
                  </option>
                ))}
                <option value={CUSTOM}>Another address…</option>
              </select>
              {service === CUSTOM && (
                <>
                  <label className="sr-only" htmlFor={`${id}-url`}>
                    Address
                  </label>
                  <input id={`${id}-url`} className="mono" placeholder="https://…/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value.trim())} />
                  <button type="button" className="button button--quiet" disabled={!baseUrl} onClick={() => loadModels("compatible")}>
                    List models
                  </button>
                </>
              )}
            </div>
          )}
          {source?.keySaved && (
            <p className="connect__status" data-ok="true">
              {source.keySource === "env" ? `Key found in ${source.keyEnv}.` : "Key saved."}
            </p>
          )}
          {keyed === "compatible" && isLocal(baseUrl) && !source?.keySaved && (
            <p className="connect__status" data-ok="true">
              A model on this computer needs no key.
            </p>
          )}
          {source?.keySource !== "env" && (
            <div className="connect__row">
              <label htmlFor={`${id}-key`}>{source?.keySaved ? "Replace the key" : keyLabel}</label>
              <input id={`${id}-key`} className="mono" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} />
              <button type="button" className="button" disabled={!key.trim() || busy} onClick={saveKey}>
                Save key
              </button>
              {source?.keySaved && keyed !== "openai" && (
                <button type="button" className="button button--quiet" disabled={busy} onClick={forgetKey}>
                  Forget key
                </button>
              )}
            </div>
          )}
          {keyReady && (
            <div className="connect__row">
              <label htmlFor={`${id}-model`}>Model</label>
              <input id={`${id}-model`} className="mono" list={`${id}-models`} value={model} placeholder={models ? "Pick or type a model id" : "Type a model id"} onChange={(e) => setModel(e.target.value.trim())} />
              <datalist id={`${id}-models`}>
                {(models ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
          )}
          {source && (
            <p className="connect__hint">
              Saved in <span className="mono">{source.keyFile}</span> (only this computer's user can read it)
              {source.keyEnv ? (
                <>
                  , or set <span className="mono">{source.keyEnv}</span>
                </>
              ) : null}
              .
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="connect__error" role="alert">
          {error}
        </p>
      )}
      {choice && (
        <div className="connect__actions">
          <button type="button" className="button" disabled={!ready || busy || inUse} onClick={use}>
            {inUse ? "In use" : "Use this connection"}
          </button>
        </div>
      )}
    </div>
  );
}

const NAMES: Record<ChatBackend, string> = { codex: "ChatGPT subscription", openai: "OpenAI", anthropic: "Anthropic", openrouter: "OpenRouter", compatible: "AI service" };

/** "ChatGPT subscription, through Codex", "OpenAI API key, gpt-x", or "Not connected". */
export function connectionLabel(view: ChatSettingsView): string {
  if (view.backend === "codex") return "ChatGPT subscription, through Codex";
  if (view.backend) return `${NAMES[view.backend]} API key, ${view.model}`;
  return "Not connected";
}

/** A quiet line: "ChatGPT subscription" or "API key · gpt-x"; null when nothing is connected. */
export function connectionShort(view: ChatSettingsView): string | null {
  if (view.backend === "codex") return "ChatGPT subscription";
  if (view.backend === "openai") return `API key · ${view.model}`;
  if (view.backend) return `${NAMES[view.backend]} · ${view.model}`;
  return null;
}
