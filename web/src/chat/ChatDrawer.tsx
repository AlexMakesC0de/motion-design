// The chat as a drawer over the right edge of any page. It talks about the
// film you are in (or the film Create saves into). Escape closes it and gives
// focus back to whatever opened it.
import { useEffect, useRef } from "react";
import { ChatPanel } from "./ChatPanel";
import { clearOutbox, closeChat, useChatDrawer } from "./chatStore";

export function ChatDrawer({ film }: { film: string | null }) {
  const { open, outbox } = useChatDrawer();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeChat();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="drawer" role="dialog" aria-modal="false" aria-label="Chat drawer" ref={box}>
      <ChatPanel film={film} outbox={outbox} onClose={closeChat} onTaken={clearOutbox} />
    </div>
  );
}
