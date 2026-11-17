import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { SkillAdded, SkillDetail, SkillInfo } from "../api/types";
import { Icon } from "../app/icons";
import "./skills.css";

const message = (e: unknown) => (e instanceof ApiError ? e.message : String(e));

function Skill({ skill }: { skill: SkillInfo }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !detail) {
      setError(null);
      try {
        setDetail(await api<SkillDetail>(`/api/skills/${encodeURIComponent(skill.name)}`));
      } catch (e) {
        setError(message(e));
      }
    }
  }

  async function copy() {
    try {
      await navigator.clipboard?.writeText(`/${skill.name}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: nothing to do */
    }
  }

  return (
    <article className="skill" aria-label={`/${skill.name}`}>
      <h2 className="skill__name mono">/{skill.name}</h2>
      <p className="skill__desc">{skill.description}</p>
      <p className="skill__linked">{skill.linked.length ? `Linked in ${skill.linked.join(", ")}` : "Not linked yet: run kie skill link"}</p>
      <div className="skill__actions">
        <button type="button" className="button button--light" onClick={copy}>
          <Icon name={copied ? "check" : "plus"} size={16} />
          {copied ? "Copied" : `Copy /${skill.name}`}
        </button>
        <button type="button" className="button button--quiet" aria-expanded={open} onClick={toggle}>
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && (
        <div className="skill__detail">
          {error && (
            <p className="skills__error" role="alert">
              {error}
            </p>
          )}
          {!detail && !error && <p className="skill__linked">Loading…</p>}
          {detail && (
            <>
              <ul className="skill__files mono" aria-label={`Files in /${skill.name}`}>
                {detail.files.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <pre className="skill__body">{detail.body}</pre>
            </>
          )}
        </div>
      )}
    </article>
  );
}

/** The saved skills: add one from a folder, see where it runs, read its instructions. */
export function SkillsScreen() {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [path, setPath] = useState("");
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<SkillInfo[]>("/api/skills")
        .then(setSkills)
        .catch((e) => setError(message(e))),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!path.trim()) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const r = await api<SkillAdded>("/api/skills", { method: "POST", body: { path: path.trim(), replace } });
      const hosts = r.links.filter((l) => l.state === "linked" || l.state === "ok").map((l) => l.host);
      setStatus(
        hosts.length
          ? `Added /${r.name} and linked it into ${hosts.join(", ")}. Restart Claude Code to see the new /command.`
          : `Added /${r.name}, but it is not linked into any agent yet.`,
      );
      setPath("");
      await load();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="skills">
      <header className="skills__head">
        <h1>Skills</h1>
        <p>These are your saved skills. Each runs in Claude Code or Codex as /name, and through the motion-design MCP server (list_skills, get_skill, and a prompt per skill).</p>
      </header>

      <form className="skills__add" onSubmit={add}>
        <h2>Add a skill</h2>
        <label htmlFor="skill-path">Skill folder</label>
        <input id="skill-path" type="text" value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/skills/seedance-2-5-prompter" autoComplete="off" spellCheck={false} />
        <label className="skills__replace">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          Replace if it exists
        </label>
        <div>
          <button type="submit" className="button" disabled={busy || !path.trim()}>
            {busy ? "Adding…" : "Add skill"}
          </button>
        </div>
        {status && (
          <p className="skills__status" role="status">
            {status}
          </p>
        )}
        {error && (
          <p className="skills__error" role="alert">
            {error}
          </p>
        )}
      </form>

      <ul className="skills__list" aria-label="Skills">
        {(skills ?? []).map((s) => (
          <li key={s.name}>
            <Skill skill={s} />
          </li>
        ))}
      </ul>
      {skills && !skills.length && <p className="skills__empty">No skills yet. Add a folder that holds a SKILL.md.</p>}
    </div>
  );
}
