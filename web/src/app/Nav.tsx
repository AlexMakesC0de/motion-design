import { TABS, type TabId } from "./route";

export function Nav({ current }: { current: TabId }) {
  return (
    <nav className="nav" aria-label="Sections">
      {TABS.map((t) => (
        <a key={t.id} href={`#/${t.id}`} aria-current={t.id === current ? "page" : undefined}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}
