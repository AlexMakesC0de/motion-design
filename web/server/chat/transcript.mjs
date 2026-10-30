// One transcript shape for the chat, whichever backend answers. Entries:
//   { id, kind: "user", at, text }
//   { id, kind: "assistant", at, text, streaming }
//   { id, kind: "tool", at, name, args, result, state: "running" | "done" | "failed" }
//   { id, kind: "notice", at, text, tone: "error" | "info" }
// A tool step's args and result are short lines for people, such as
// "minimax-h3 4s 480p" and "$0.16". History lives in runs/<film>/chat.jsonl,
// one JSON object per line, plus { kind: "codex-thread", threadId } lines the
// page never sees.
import { closeSync, constants, existsSync, lstatSync, openSync, readFileSync, realpathSync, writeSync } from "node:fs";
import { join, sep } from "node:path";
import { RUNS_DIR, runDir } from "../../../cli/lib/run.mjs";
import { EXIT, unknown } from "../../../cli/lib/errors.mjs";
import { redact } from "../../../cli/lib/redact.mjs";

export const CHAT_FILE = "chat.jsonl";
const KINDS = new Set(["user", "assistant", "tool", "notice"]);

/** A chat failure with one sentence for the page. `connect` means: show the two connection options. */
export class ChatError extends Error {
  constructor(message, { connect = false } = {}) {
    super(message);
    this.connect = connect;
  }
}

let seq = 0;
const newId = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;
const now = () => new Date().toISOString();

export const userEntry = (text) => ({ id: newId(), kind: "user", at: now(), text });
export const assistantEntry = (text = "", streaming = true) => ({ id: newId(), kind: "assistant", at: now(), text, streaming });
export const toolEntry = (name, args) => ({ id: newId(), kind: "tool", at: now(), name, args: argsLine(args), result: null, state: "running" });
export const noticeEntry = (text, tone = "error") => ({ id: newId(), kind: "notice", at: now(), text: redact(text), tone });

/**
 * The film's chat file. runDir checks the slug (code 1 for a bad one); the
 * film's folder must be a real folder inside runs/ (not a link), and a
 * chat.jsonl that is a link, even one to a missing file, is refused, so a
 * write can never land outside the film.
 */
export function chatPath(film, { create = false } = {}) {
  const dir = runDir(film, { create: false });
  const linked = (what) => unknown(`runs/${film}${what} is a link; the studio only writes plain files in a film.`);
  const d = lstatSync(dir, { throwIfNoEntry: false });
  if (d && (d.isSymbolicLink() || !d.isDirectory())) throw linked("");
  if (!d && create) runDir(film, { create: true });
  if (d || create) {
    const root = realpathSync(RUNS_DIR);
    if (!realpathSync(dir).startsWith(root + sep)) throw linked("");
  }
  const file = join(dir, CHAT_FILE);
  if (lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) throw linked(`/${CHAT_FILE}`);
  return file;
}

/** The saved transcript, oldest first, and the film's Codex thread if it has one. A missing film or file is an empty chat. */
export function readChat(film) {
  const file = chatPath(film);
  const out = { entries: [], codexThread: null };
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // a torn last line from a crash; the rest is still good
    }
    if (rec?.kind === "codex-thread" && typeof rec.threadId === "string") out.codexThread = rec.threadId;
    else if (KINDS.has(rec?.kind) && typeof rec.id === "string") out.entries.push(rec);
  }
  return out;
}

/** Append records to the film's chat, making the film's folder if this is its first line. */
export function appendChat(film, records) {
  if (!records.length) return;
  // O_NOFOLLOW: a link swapped in after the check is refused by the open itself.
  const fd = openSync(chatPath(film, { create: true }), constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o644);
  try {
    writeSync(fd, records.map((r) => `${JSON.stringify(r)}\n`).join(""));
  } finally {
    closeSync(fd);
  }
}

/** The saved user and assistant lines as model input, newest 40. Tool steps and notices stay on the page. */
export function historyMessages(entries, max = 40) {
  return entries
    .filter((e) => (e.kind === "user" || e.kind === "assistant") && e.text)
    .slice(-max)
    .map((e) => ({ role: e.kind, content: e.text }));
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const usd = (v) => `$${Number(v).toFixed(2)}`;
const firstLine = (s) => String(s ?? "").split("\n").find((l) => l.trim()) ?? "";
const firstSentence = (s) => firstLine(s).match(/^.*?[.!?](?=\s|$)/)?.[0] ?? firstLine(s);

// The arguments worth a glance, in this order. Prompts are clipped; runs are the film itself.
const SHOWN = ["model", "preset", "duration_s", "resolution", "aspect_ratio", "job_id", "name", "template", "video", "capability"];

/** "minimax-h3 4s 480p" from a tool's arguments. */
export function argsLine(args) {
  const a = args && typeof args === "object" ? args : {};
  const parts = [];
  for (const k of SHOWN) {
    const v = a[k];
    if (v == null || v === "" || typeof v === "object") continue;
    parts.push(k === "duration_s" ? `${v}s` : String(v));
  }
  if (Array.isArray(a.refs) && a.refs.length) parts.push(`${a.refs.length} ref${a.refs.length > 1 ? "s" : ""}`);
  if (typeof a.prompt === "string" && a.prompt.trim()) parts.push(`"${clip(a.prompt.trim(), 32)}"`);
  if (!parts.length && typeof a.run === "string") parts.push(a.run);
  return redact(clip(parts.join(" "), 120));
}

/** All text parts of an MCP tool result. */
export function resultText(result) {
  return (result?.content ?? [])
    .filter((c) => c?.type === "text")
    .map((c) => c.text)
    .join("\n");
}

/**
 * The typed core error in a tool result, or null. MCP results carry it in
 * _meta.error (and "Error <code>: <message>" in the text); Codex passes the
 * same result through. `code` is null for a failure that did not come from
 * core (Codex timing a tool out, say).
 */
export function failure(result) {
  if (!result?.isError && result?._meta?.error == null) return null;
  const text = resultText(result);
  const raw = result?._meta?.error?.code ?? text.match(/^Error (\d)\b/)?.[1];
  const message = text.replace(/^Error \d: /, "").split("\nNext:")[0].trim() || "The tool failed.";
  return { code: raw == null ? null : Number(raw), message };
}

const ERROR_LINES = {
  [EXIT.USAGE]: (m) => `refused: ${firstSentence(m)}`,
  [EXIT.BUDGET]: () => "stopped by the limits, nothing spent",
  [EXIT.UNKNOWN]: (m) => `refused: ${firstSentence(m)}`,
  [EXIT.PROVIDER]: (m) => `provider error: ${firstSentence(m)}`,
  [EXIT.UNCERTAIN]: () => "uncertain: still checking, do not resubmit",
};

/** The short result of a tool step: "$0.16", "j-20261030-7f3a running", or one line saying what failed. */
export function resultLine(name, result) {
  const f = failure(result);
  if (f) return redact(clip((ERROR_LINES[f.code] ?? ((m) => `failed: ${firstSentence(m)}`))(f.message), 140));
  const sc = result?.structuredContent ?? {};
  if (name === "estimate" && "estimateUsd" in sc) return sc.estimateUsd == null ? "no estimate" : `${usd(sc.estimateUsd)}${sc.allowed ? "" : " · not allowed"}`;
  if ((name === "generate_video" || name === "generate_image") && sc.localJobId) return `${sc.localJobId} ${sc.state}`;
  if (name === "wait_job" && sc.outcome) return `${sc.outcome}${sc.actualUsd != null ? ` ${usd(sc.actualUsd)}` : ""}`;
  return redact(clip(firstLine(resultText(result)), 100)) || "done";
}

/**
 * What the assistant says when a limit refuses a job (code 2). The chat
 * never asks before spending, so a refusal ends the turn: core's reason,
 * then the way out.
 */
export function budgetSentence(message) {
  const reason = String(message).split(/\s*Ask the user/)[0].trim();
  return `${reason} I've stopped here: raise the limit in Settings, or ask me for something cheaper.`;
}

/**
 * The sink a backend writes one turn into. Backends name things by their own
 * keys (an OpenAI item id, a Codex item id, a call id); the sink turns them
 * into entries and calls `onEntry(entry)` on every change, so the page sees
 * text stream in and tool steps go from running to done. `entries` is the
 * turn's entries in the order they began.
 */
export function createTurnLog(onEntry) {
  const entries = [];
  const byKey = new Map();
  const add = (key, entry) => {
    byKey.set(key, entry);
    entries.push(entry);
    return entry;
  };
  return {
    entries,
    text(key, delta) {
      const e = byKey.get(key) ?? add(key, assistantEntry());
      e.text += delta;
      onEntry(e);
    },
    textDone(key, text) {
      const e = byKey.get(key) ?? add(key, assistantEntry());
      if (typeof text === "string" && text) e.text = text;
      e.streaming = false;
      onEntry(e);
    },
    toolStart(key, name, args) {
      onEntry(add(key, toolEntry(name, args)));
    },
    /** Finish a tool step from the MCP result. Returns the typed core error in it, or null. */
    toolDone(key, name, result, args = {}) {
      const e = byKey.get(key) ?? add(key, toolEntry(name, args));
      const f = failure(result);
      e.state = f ? "failed" : "done";
      e.result = resultLine(name, result);
      onEntry(e);
      return f;
    },
    say(text) {
      onEntry(add(Symbol("say"), assistantEntry(text, false)));
    },
    notice(text, tone = "error") {
      onEntry(add(Symbol("notice"), noticeEntry(text, tone)));
    },
    /** At the end of a turn: nothing is left streaming or running. */
    settle() {
      for (const e of entries) {
        if (e.kind === "assistant" && e.streaming) {
          e.streaming = false;
          onEntry(e);
        }
        if (e.kind === "tool" && e.state === "running") {
          e.state = "failed";
          e.result = "stopped before it finished";
          onEntry(e);
        }
      }
    },
  };
}
