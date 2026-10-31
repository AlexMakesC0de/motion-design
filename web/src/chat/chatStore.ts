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
  if (!state.open) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  set({ open: true });
}

export function closeChat() {
  set({ open: false });
  opener?.focus();
  opener = null;
}

export const toggleChat = () => (state.open ? closeChat() : openChat());

export function sendToChat(text: string) {
  openChat();
  set({ outbox: { id: (state.outbox?.id ?? 0) + 1, text } });
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
}
