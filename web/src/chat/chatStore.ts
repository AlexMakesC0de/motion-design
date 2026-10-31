// The chat drawer's state, shared by the rail's Chat button, the drawer and
// any screen that hands the chat a message (the storyboard's "Plan this").
// Open or closed is remembered across reloads.
import { useSyncExternalStore } from "react";

const KEY = "studio.chatOpen";
const readOpen = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

interface ChatState {
  open: boolean;
  outbox: { id: number; text: string } | null;
}

let state: ChatState = { open: readOpen(), outbox: null };
/** The element that opened the drawer, so closing gives focus back. */
let opener: HTMLElement | null = null;
/** True once the drawer is opened on this page; a drawer restored open from the last visit is not, and leaves focus alone. */
let openedHere = false;
/** Outbox ids only grow, so a cleared outbox never makes a new message look already handed over. */
let lastOutbox = 0;
const listeners = new Set<() => void>();

function set(next: Partial<ChatState>) {
  state = { ...state, ...next };
  try {
    localStorage.setItem(KEY, state.open ? "1" : "0");
  } catch {
    // private mode: the drawer just forgets
  }
  listeners.forEach((fn) => fn());
}

export const getChat = () => state;

export function openChat() {
  if (!state.open) {
    opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    openedHere = true;
  }
  set({ open: true });
}

/** Whether the open drawer was opened by the user on this page (so it may move focus into itself). */
export const openedByUser = () => openedHere;

/** Closing gives focus back to what opened the drawer; with no opener (restored after a reload, or it has gone), to the rail Chat button. */
export function closeChat() {
  set({ open: false });
  const back = opener?.isConnected ? opener : document.querySelector<HTMLElement>("[data-chat-button]");
  back?.focus();
  opener = null;
  openedHere = false;
}

export const toggleChat = () => (state.open ? closeChat() : openChat());

export function sendToChat(text: string) {
  openChat();
  set({ outbox: { id: ++lastOutbox, text } });
}

/** The chat took the message (sent it, or left it in the box): a drawer opened later must not hand it over again. */
export function clearOutbox() {
  if (state.outbox) set({ outbox: null });
}

export function useChatDrawer(): ChatState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

export function resetChatForTests() {
  state = { open: readOpen(), outbox: null };
  opener = null;
  openedHere = false;
  lastOutbox = 0;
}
