import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api/client";
import type { SkillInfo } from "../api/types";
import { Icon } from "../app/icons";
import { Logo } from "../app/Logo";
import "./mcp.css";

interface McpInfo {
  server: { command: string; args: string[] };
  claudeCode: string;
  codexToml: string;
  claudeDesktopJson: string;
  install: string;
  cli: string;
  registered: { claudeCode: boolean; codex: boolean };
}

const HOSTS = [
  { id: "claude-code", label: "Claude Code", icon: "terminal" },
  { id: "codex", label: "Codex", icon: "code" },
  { id: "claude-desktop", label: "Claude Desktop", icon: "plug" },
  { id: "cli", label: "CLI", icon: "terminal" },
  { id: "skills", label: "Skills", icon: "skills" },
] as const;
type HostId = (typeof HOSTS)[number]["id"];

const ASKS = [
  "Plan a 15s product film",
  "Draft scene 2 at 480p",
  "Make a character sheet for Maya",
  "What did I spend today?",
  "Recreate this video with my product",
];

/** Copies text and flips to true for 1.5 s. Guarded: clipboard is missing on plain http. */
function useCopy() {
  const [done, setDone] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      return;
    }
    setDone(key);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(null), 1500);
  }
  return { done, copy };
}

type Copier = ReturnType<typeof useCopy>;

function Code({ id, label, text, c }: { id: string; label: string; text: string; c: Copier }) {
  return (
    <div className="mcp-code">
      <pre>
        <code>{text}</code>
      </pre>
      <button type="button" className="button mcp-code__copy" aria-label={`Copy ${label}`} onClick={() => c.copy(id, text)}>
        <Icon name={c.done === id ? "check" : "plus"} size={14} />
        {c.done === id ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children?: ReactNode }) {
  return (
    <li className="mcp-step">
      <span className="mcp-step__n" aria-hidden="true">{n}</span>
      <div className="mcp-step__body">
        <h3>{title}</h3>
        {children}
      </div>
    </li>
  );
}

function Status({ ok, host }: { ok: boolean; host: string }) {
  return (
    <p className={`mcp-status${ok ? " mcp-status--ok" : ""}`} role="status">
      <span className="mcp-status__dot" aria-hidden="true" />
      {ok ? `Connected: ${host} has the motion-design server.` : `Not registered yet in ${host}.`}
    </p>
  );
}

function Steps({ host, info, skills, c }: { host: HostId; info: McpInfo | null; skills: SkillInfo[] | null; c: Copier }) {
  if (host === "skills") {
    return (
      <>
        <p className="mcp-lede">
          Each skill is a slash command in Claude Code and Codex, and an MCP prompt for any host that lists prompts. Type <code>/name</code> to run it.
        </p>
        <div className="mcp-skills">
          {skills?.length === 0 && <p className="mcp-lede">No skills yet.</p>}
          {skills?.map((s) => (
            <article key={s.name} className="mcp-skill" aria-label={`/${s.name}`}>
              <h3>/{s.name}</h3>
              <p>{s.description}</p>
            </article>
          ))}
        </div>
        <a className="button" href="#/skills">Manage skills</a>
      </>
    );
  }
  if (!info) return <p className="mcp-lede">Loading the setup commands…</p>;
  if (host === "claude-code")
    return (
      <ol className="mcp-steps">
        <Step n={1} title="Run the installer, or add the server yourself">
          <p>The installer registers the server and links your skills.</p>
          <Code id="install" label="install command" text={info.install} c={c} />
          <p>Or only the server:</p>
          <Code id="add" label="claude mcp add command" text={info.claudeCode} c={c} />
        </Step>
        <Step n={2} title="Restart Claude Code" />
        <Step n={3} title="Ask it to call status">
          <Code id="ask" label="status request" text="Call the motion-design status tool" c={c} />
          <Status ok={info.registered.claudeCode} host="Claude Code" />
        </Step>
      </ol>
    );
  if (host === "codex")
    return (
      <ol className="mcp-steps">
        <Step n={1} title="Add this to ~/.codex/config.toml, or run the installer">
          <Code id="toml" label="Codex config" text={info.codexToml} c={c} />
          <Code id="install" label="install command" text={info.install} c={c} />
        </Step>
        <Step n={2} title="Restart Codex" />
        <Step n={3} title="Ask it to call status">
          <Code id="ask" label="status request" text="Call the motion-design status tool" c={c} />
          <Status ok={info.registered.codex} host="Codex" />
        </Step>
      </ol>
    );
  if (host === "claude-desktop")
    return (
      <ol className="mcp-steps">
        <Step n={1} title="Add this to claude_desktop_config.json">
          <Code id="json" label="Claude Desktop config" text={info.claudeDesktopJson} c={c} />
        </Step>
        <Step n={2} title="Restart Claude Desktop" />
      </ol>
    );
  return (
    <ol className="mcp-steps">
      <Step n={1} title="See every command">
        <Code id="help" label="kie --help" text="kie --help" c={c} />
      </Step>
      <Step n={2} title="Check your key and setup">
        <Code id="doctor" label="kie doctor" text="kie doctor" c={c} />
      </Step>
      <Step n={3} title="List your skills">
        <Code id="skills" label="kie skill list" text="kie skill list" c={c} />
      </Step>
    </ol>
  );
}

export function McpScreen({ host }: { host?: string }) {
  const hostId = (HOSTS.find((h) => h.id === host)?.id ?? "claude-code") as HostId;
  const current = HOSTS.find((h) => h.id === hostId)!;
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const c = useCopy();
  const steps = useRef<HTMLElement>(null);

  useEffect(() => {
    api<McpInfo>("/api/mcp").then(setInfo, () => {});
  }, []);
  useEffect(() => {
    if (hostId === "skills") api<SkillInfo[]>("/api/skills").then(setSkills, () => setSkills([]));
  }, [hostId]);

  const command = !info
    ? ""
    : { "claude-code": info.claudeCode, codex: info.codexToml, "claude-desktop": info.claudeDesktopJson, cli: info.cli, skills: "kie skill list" }[hostId];

  return (
    <div className="mcp">
      <nav className="mcp-tabs" aria-label="Connect from">
        {HOSTS.map((h) => (
          <a key={h.id} href={`#/mcp/${h.id}`} className="mcp-tab" aria-current={h.id === hostId ? "page" : undefined}>
            <Icon name={h.icon} size={18} />
            {h.label}
          </a>
        ))}
      </nav>

      <section className="mcp-hero" aria-labelledby="mcp-title">
        <div className="mcp-pattern" aria-hidden="true" />
        <h1 id="mcp-title" className="mcp-title">
          <span className="mcp-title__line">
            {hostId === "skills" ? "RUN YOUR " : "GENERATE "}
            <em>{hostId === "skills" ? "SKILLS" : "IMAGES & VIDEOS"}</em>
          </span>
          <span className="mcp-title__line">
            IN <span className="mcp-tile mcp-tile--host"><Icon name={current.icon} size={30} /></span> {current.label.toUpperCase()} WITH{" "}
            <span className="mcp-tile mcp-tile--logo"><Logo size={36} /></span> SHARD
          </span>
        </h1>
        <div className="mcp-actions">
          <button type="button" className="button button--light button--lg" disabled={!command} onClick={() => c.copy("hero", command)}>
            <Icon name={c.done === "hero" ? "check" : "plug"} size={18} />
            {c.done === "hero" ? "Copied" : "Copy setup command"}
          </button>
          <button type="button" className="button button--lg mcp-dark" onClick={() => steps.current?.scrollIntoView?.({ behavior: "smooth", block: "start" })}>
            How to connect?
          </button>
        </div>
        <ul className="mcp-asks" aria-label="Things to ask">
          {ASKS.map((a) => (
            <li key={a}>
              <button type="button" className="mcp-ask" onClick={() => c.copy(`ask-${a}`, a)}>
                {c.done === `ask-${a}` ? "Copied" : a}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="mcp-how" ref={steps} aria-labelledby="mcp-how">
        <h2 id="mcp-how">How to connect</h2>
        <Steps host={hostId} info={info} skills={skills} c={c} />
      </section>
    </div>
  );
}
