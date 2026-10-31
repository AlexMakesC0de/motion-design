// web/src/app/Rail.tsx
// The left rail: where you can go, plus the Chat drawer's button. Places you
// visit now and then (Spend, Settings) sit at the bottom with Chat.
import { Icon } from "./icons";
import { RAIL, type RailId } from "./route";
import { toggleChat, useChatDrawer } from "../chat/chatStore";

function Item({ id, label, current }: { id: RailId; label: string; current: RailId }) {
  return (
    <a className="rail__item" href={id === "home" ? "#/" : `#/${id}`} aria-current={id === current ? "page" : undefined}>
      <Icon name={id} />
      <span>{label}</span>
    </a>
  );
}

export function Rail({ current }: { current: RailId }) {
  const { open } = useChatDrawer();
  return (
    <nav className="rail" aria-label="Studio">
      <a className="rail__brand" href="#/" aria-label="Studio home">
        MD
      </a>
      {RAIL.top.map((r) => (
        <Item key={r.id} {...r} current={current} />
      ))}
      <span className="rail__gap" />
      <button type="button" className="rail__item" aria-expanded={open} onClick={toggleChat} data-chat-button>
        <Icon name="chat" />
        <span>Chat</span>
      </button>
      {RAIL.bottom.map((r) => (
        <Item key={r.id} {...r} current={current} />
      ))}
    </nav>
  );
}
