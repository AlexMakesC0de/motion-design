// The Studio page's conversations. Each is its own transcript,
// runs/explore/chats/<id>.jsonl, read and written through the chat session
// under the key "explore:<id>". Archived ones stay on disk, listed only in
// Settings; archived.json in the same folder holds their ids. Deleting
// removes the file for good.
import { existsSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXPLORE_RUN, runDir } from "../../../cli/lib/run.mjs";
import { HttpError } from "../http.mjs";
import { CHAT_FILE, CONVERSATIONS_DIR, CONVERSATION_ID, chatPath, conversationKey, readChat } from "./transcript.mjs";

const ARCHIVED_FILE = "archived.json";
const TITLE_MAX = 90;

const folder = () => join(runDir(EXPLORE_RUN, { create: false }), CONVERSATIONS_DIR);

/** A conversation id from the page: c- and 4 to 32 of a-z0-9, or a 404. */
export function conversationId(id) {
  if (typeof id !== "string" || !CONVERSATION_ID.test(id)) throw new HttpError(404, "No such conversation.");
  return id;
}

function readArchived() {
  try {
    const ids = JSON.parse(readFileSync(join(folder(), ARCHIVED_FILE), "utf8"));
    return new Set(Array.isArray(ids) ? ids.filter((x) => typeof x === "string" && CONVERSATION_ID.test(x)) : []);
  } catch {
    return new Set();
  }
}

function writeArchived(ids) {
  chatPath(conversationKey("c-0000"), { create: true }); // makes and checks runs/explore/chats/
  const file = join(folder(), ARCHIVED_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify([...ids].sort(), null, 2)}\n`);
  renameSync(tmp, file);
}

/**
 * Before conversations, Explore kept one chat in runs/explore/chat.jsonl.
 * It moves, once, into chats/ as the first conversation (named after the
 * file's last change), so nothing said there is lost.
 */
export function migrateLegacyChat() {
  const old = join(runDir(EXPLORE_RUN, { create: false }), CHAT_FILE);
  if (!existsSync(old)) return null;
  const id = `c-${Math.floor(statSync(old).mtimeMs).toString(36)}`;
  const into = chatPath(conversationKey(id), { create: true });
  if (existsSync(into)) return null;
  renameSync(old, into);
  return id;
}

/** One line for the list: the first thing the user said. */
function summary(id, archived) {
  const { entries } = readChat(conversationKey(id));
  const said = entries.filter((e) => e.kind === "user");
  if (!said.length) return null; // nothing said yet (or only before a reset): not a conversation to list
  const first = said[0].text.replace(/\s+/g, " ").trim();
  return {
    id,
    title: first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1)}…` : first || "Untitled",
    messages: said.length,
    startedAt: said[0].at,
    updatedAt: entries.at(-1).at ?? said.at(-1).at,
    archived,
  };
}

/** The conversations, the most recently active first: the open ones, or with { archived: true } the archived ones. */
export function listConversations({ archived = false } = {}) {
  migrateLegacyChat();
  let names;
  try {
    names = readdirSync(folder());
  } catch {
    return [];
  }
  const hidden = readArchived();
  return names
    .map((n) => n.match(/^(c-[a-z0-9]{4,32})\.jsonl$/)?.[1])
    .filter((id) => id && hidden.has(id) === archived)
    .map((id) => summary(id, archived))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/** Archive (hide from the page, keep the file) or bring one back. */
export function setArchived(id, archived, { busy = false } = {}) {
  if (!existsSync(chatPath(conversationKey(id)))) throw new HttpError(404, "No such conversation.");
  if (archived && busy) throw new HttpError(409, "The chat is still answering in this conversation. Wait for it, or press Stop.");
  const ids = readArchived();
  if (archived) ids.add(id);
  else ids.delete(id);
  writeArchived(ids);
  return { id, archived };
}

/** Delete a conversation's file for good. */
export function deleteConversation(id, { busy = false } = {}) {
  if (busy) throw new HttpError(409, "The chat is still answering in this conversation. Wait for it, or press Stop.");
  const file = chatPath(conversationKey(id));
  if (!existsSync(file)) throw new HttpError(404, "No such conversation.");
  unlinkSync(file);
  const ids = readArchived();
  if (ids.delete(id)) writeArchived(ids);
  return { id, deleted: true };
}
