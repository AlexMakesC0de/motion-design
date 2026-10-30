import { useEffect, useId, useState } from "react";
import { api, ApiError } from "../api/client";
import type { ChatBackend, ChatSettingsView, CodexStatus } from "../api/types";
import "./chat.css";

const message = (e: unknown) => (e instanceof ApiError ? e.message : String(e));

/**
 * The two ways to connect the chat: the ChatGPT subscription through Codex, or
 * an OpenAI API key with a model. Used in Settings and, when nothing is set
 * up, in the chat panel itself. The key goes to the server once and never
 * comes back: the page only learns that one is saved.
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function loadModels() {
    try {
      const r = await api<{ models: string[] }>("/api/chat-settings/models");
      setModels(r.models);
      if (!r.models.includes(model)) setModel(r.models[0] ?? "");
    } catch (e) {
      setModels(null);
      setError(message(e));
    }
  }

  useEffect(() => {
    setError(null);
    if (choice === "codex" && !codex) checkCodex();
    if (choice === "openai" && view.openai.keySaved && !models) loadModels();
    // Each choice loads its status once; "Check again" and saving a key load again.
  }, [choice]);

  async function saveKey() {
    setBusy(true);
    setError(null);
    try {
      const next = await api<ChatSettingsView>("/api/chat-settings/openai-key", { method: "PUT", body: { key } });
      setKey("");
      setView(next);
      await loadModels();
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
      const next = await api<ChatSettingsView>("/api/chat-settings", { method: "PUT", body: choice === "openai" ? { backend: "openai", model } : { backend: "codex" } });
      setView(next);
      onSaved(next);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const ready = choice === "codex" ? Boolean(codex?.loggedIn) : choice === "openai" ? view.openai.keySaved && Boolean(model) : false;

  return (
    <div className="connect">
      <fieldset className="connect__choices">
        <legend>How the chat connects</legend>
        <label className="connect__choice">
          <input type="radio" name={`${id}-backend`} checked={choice === "codex"} onChange={() => setChoice("codex")} />
          <span>
            <span className="connect__label">ChatGPT subscription</span>
            <span className="connect__hint">Through Codex on this computer. Uses your ChatGPT plan, not an API bill.</span>
          </span>
        </label>
        <label className="connect__choice">
          <input type="radio" name={`${id}-backend`} checked={choice === "openai"} onChange={() => setChoice("openai")} />
          <span>
            <span className="connect__label">OpenAI API key</span>
            <span className="connect__hint">Each message is billed to the key's OpenAI account.</span>
          </span>
        </label>
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

      {choice === "openai" && (
        <div className="connect__detail">
          {view.openai.keySaved && (
            <p className="connect__status" data-ok="true">
              {view.openai.keySource === "env" ? `Key found in ${view.openai.keyEnv}.` : "Key saved."}
            </p>
          )}
          {view.openai.keySource !== "env" && (
            <div className="connect__row">
              <label htmlFor={`${id}-key`}>{view.openai.keySaved ? "Replace the key" : "OpenAI API key"}</label>
              <input id={`${id}-key`} className="mono" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} />
              <button type="button" className="button" disabled={!key.trim() || busy} onClick={saveKey}>
                Save key
              </button>
            </div>
          )}
          {view.openai.keySaved && models && (
            <div className="connect__row">
              <label htmlFor={`${id}-model`}>Model</label>
              <select id={`${id}-model`} value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="connect__hint">
            Saved in <span className="mono">{view.openai.keyFile}</span> (only this computer's user can read it), or set <span className="mono">{view.openai.keyEnv}</span>.
          </p>
        </div>
      )}

      {error && (
        <p className="connect__error" role="alert">
          {error}
        </p>
      )}
      {choice && (
        <div className="connect__actions">
          <button type="button" className="button" disabled={!ready || busy} onClick={use}>
            Use this connection
          </button>
        </div>
      )}
    </div>
  );
}

/** "ChatGPT subscription (Codex)", "OpenAI API key, gpt-x", or "Not connected". */
export function connectionLabel(view: ChatSettingsView): string {
  if (view.backend === "codex") return "ChatGPT subscription, through Codex";
  if (view.backend === "openai") return `OpenAI API key, ${view.model}`;
  return "Not connected";
}
