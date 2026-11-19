// One transcript shape for the chat, whichever backend answers. Entries:
//   { id, kind: "user", at, text }
//   { id, kind: "assistant", at, text, streaming }
//   { id, kind: "tool", at, name, args, result, state: "running" | "done" | "failed", jobs? }
//   { id, kind: "notice", at, text, tone: "error" | "info" }
// A tool step's args and result are short lines for people, such as
// "minimax-h3 4s 480p" and "$0.16". History lives in runs/<film>/chat.jsonl,
// one JSON object per line, plus { kind: "codex-thread", threadId } lines the
// page never sees.
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, writeSync } from "node:fs";
import { join, sep } from "node:path";
import { RUNS_DIR, runDir } from "../../../cli/lib/run.mjs";
import { EXIT, unknown } from "../../../cli/lib/errors.mjs";
import { redact } from "../../../cli/lib/redact.mjs";

export const CHAT_FILE = "chat.jsonl";
/** How often, at most, a streaming assistant entry is resent to the page. */
export const TEXT_THROTTLE_MS = 100;
/** The most tool rounds one turn may take, whichever backend runs it. */
export const MAX_STEPS = 24;
const KINDS = new Set(["user", "assistant", "tool", "notice"]);

/**
 * The MCP tools that can reserve and submit a paid job (annotated open-world,
 * not read-only, not idempotent). Cut off mid-call, one may have submitted.
 */
export const SPENDING_TOOLS = new Set(["generate_image", "generate_video", "make_sheet", "make_still", "film_shot", "film_all", "save_review", "draft_scene", "final_scene", "make_voice"]);
export const STOPPED_SPENDING = "stopped; it may still have been submitted, see the feed";

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

/** What has been read of each chat file: up to `offset` (after its last whole line), and what that held. */
const parsed = new Map(); // file → { dev, ino, offset, mtimeMs, size, entries, codexThread }

/** Whole lines from `buf`, parsed into `into`; returns how many bytes they took. A torn last line waits for the next read. */
function takeLines(buf, into) {
  const end = buf.lastIndexOf(0x0a) + 1;
  for (const line of buf.subarray(0, end).toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // a line torn by a crash; the rest is still good
    }
    if (rec?.kind === "codex-thread" && typeof rec.threadId === "string") into.codexThread = rec.threadId;
    else if (KINDS.has(rec?.kind) && typeof rec.id === "string") into.entries.push(rec);
  }
  return end;
}

/**
 * The saved transcript, oldest first, and the film's Codex thread if it has
 * one. A missing film or file is an empty chat. The file only grows, so a
 * read after the first parses just the lines appended since; a file that
 * shrank, or was replaced, is read again from the start.
 */
export function readChat(film) {
  const file = chatPath(film);
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (err) {
    if (err.code === "ENOENT") {
      parsed.delete(file);
      return { entries: [], codexThread: null };
    }
    throw err;
  }
  try {
    const st = fstatSync(fd);
    let c = parsed.get(file);
    const same = c && c.dev === st.dev && c.ino === st.ino && st.size >= c.size && (st.size > c.size || st.mtimeMs === c.mtimeMs);
    if (!same) c = { dev: st.dev, ino: st.ino, offset: 0, entries: [], codexThread: null };
    if (st.size > c.offset) {
      const buf = Buffer.alloc(st.size - c.offset);
      let got = 0;
      while (got < buf.length) {
        const n = readSync(fd, buf, got, buf.length - got, c.offset + got);
        if (!n) break;
        got += n;
      }
      c.offset += takeLines(buf.subarray(0, got), c);
    }
    c.size = st.size;
    c.mtimeMs = st.mtimeMs;
    parsed.set(file, c);
    return { entries: [...c.entries], codexThread: c.codexThread };
  } finally {
    closeSync(fd);
  }
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

/** A tool step as the model reads it in history: name, arguments, how it ended, and the jobs it named. */
const toolHistoryLine = (e) =>
  `[tool step] ${e.name}${e.args ? ` ${e.args}` : ""} → ${e.state}: ${e.result ?? "no result"}${e.jobs?.length ? ` (job ${e.jobs.join(", ")})` : ""}`;

/**
 * The saved user and assistant lines as model input, newest 60, with a short
 * line for each tool step, so a later "continue" still knows which jobs exist.
 * Notices stay on the page.
 */
export function historyMessages(entries, max = 60) {
  return entries
    .filter((e) => ((e.kind === "user" || e.kind === "assistant") && e.text) || (e.kind === "tool" && e.name))
    .slice(-max)
    .map((e) => (e.kind === "tool" ? { role: "assistant", content: toolHistoryLine(e) } : { role: e.kind, content: e.text }));
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

const JOB_ID = /\bj-\d{8}-[0-9a-f]{6}\b/g;

/** The local job ids a tool result names: its structured data, its error's _meta, or (Codex may drop both) its text. */
export function jobIds(result) {
  const sc = result?.structuredContent ?? {};
  const ids = [
    sc.localJobId,
    sc.redo?.jobId,
    ...(Array.isArray(sc.submitted) ? sc.submitted.map((s) => s?.jobId) : []),
    result?._meta?.error?.localJobId,
    ...(resultText(result).match(JOB_ID) ?? []),
  ];
  return [...new Set(ids.filter((id) => typeof id === "string" && id))];
}

/**
 * What the assistant says when a tool's outcome is unknown (code 5): a job
 * may exist, so the turn ends rather than let the model try again.
 */
export function uncertainSentence({ tool, message }) {
  const reason = clip(firstLine(message).split(";")[0].trim().replace(/[.!?]+$/, ""), 160);
  return `I can't tell whether ${tool} went through${reason ? ` (${reason})` : ""}, so I've stopped here rather than try again: it may have been submitted. Check the feed before asking for it again.`;
}

/**
 * The sink a backend writes one turn into. Backends name things by their own
 * keys (an OpenAI item id, a Codex item id, a call id); the sink turns them
 * into entries and calls `onEntry(entry)` on every change, so the page sees
 * text stream in and tool steps go from running to done. `entries` is the
 * turn's entries in the order they began.
 */
export function createTurnLog(onEntry, { throttleMs = TEXT_THROTTLE_MS } = {}) {
  const entries = [];
  const byKey = new Map();
  const add = (key, entry) => {
    byKey.set(key, entry);
    entries.push(entry);
    return entry;
  };
  // Streaming text: each change resends the whole entry, so an entry goes out at most once per throttleMs.
  const sent = new Map(); // entry → when it last went out
  const held = new Map(); // entry → the timer that sends it
  const send = (e) => {
    clearTimeout(held.get(e));
    held.delete(e);
    sent.set(e, Date.now());
    onEntry(e);
  };
  return {
    entries,
    text(key, delta) {
      if (typeof delta !== "string") return;
      const e = byKey.get(key) ?? add(key, assistantEntry());
      e.text += delta;
      const wait = (sent.get(e) ?? -Infinity) + throttleMs - Date.now();
      if (wait <= 0) send(e);
      else if (!held.has(e)) held.set(e, setTimeout(() => send(e), wait));
    },
    textDone(key, text) {
      const e = byKey.get(key) ?? add(key, assistantEntry());
      if (typeof text === "string" && text) e.text = text;
      e.streaming = false;
      send(e);
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
      const jobs = jobIds(result);
      if (jobs.length) e.jobs = jobs;
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
          send(e);
        }
        if (e.kind === "tool" && e.state === "running") {
          e.state = "failed";
          // A free tool never submits; a spending one may have got past the point Stop can reach.
          e.result = SPENDING_TOOLS.has(e.name) ? STOPPED_SPENDING : "stopped before it finished";
          onEntry(e);
        }
      }
    },
  };
}
