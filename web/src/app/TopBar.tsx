// web/src/app/TopBar.tsx
// The one bar across the top: the logo, the making pages (Image, Video, MCP),
// each opening a menu the moment the pointer reaches it, a divider, the
// studio's places, and on the right running jobs, today's spend and Settings.
import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { api } from "../api/client";
import type { ModelInfo, SpendView } from "../api/types";
import { fitToModel, getDraft, setDraft } from "../studio/promptStore";
import { Icon } from "./icons";
import { Logo } from "./Logo";
import { modelBadge, modelBlurb, modelName, sortModels } from "./modelMeta";
import { NAV, navHref, type NavId } from "./route";
import { SpendMeter } from "./SpendMeter";

type MenuId = "image" | "video" | "mcp";

interface Entry {
  href: string;
  icon: string;
  title: string;
  text: string;
  badge?: string | null;
  onPick?: () => void;
}

const FEATURES: Record<"image" | "video", Entry[]> = {
  image: [
    { href: "#/image", icon: "image", title: "Create Image", text: "Generate images from a prompt" },
    { href: "#/library", icon: "sheet", title: "Character Sheets", text: "Turn a face or product into a reusable reference" },
    { href: "#/library", icon: "library", title: "Library", text: "Every saved character, product and place" },
    { href: "#/presets", icon: "presets", title: "Looks", text: "Start from a proven style prompt" },
  ],
  video: [
    { href: "#/video", icon: "video", title: "Create Video", text: "Generate a take from a prompt and references" },
    { href: "#/video/scenes", icon: "scenes", title: "Scenes", text: "Direct one shot in stages, then draft and finalise" },
    { href: "#/projects", icon: "projects", title: "Films", text: "Plan a film from idea to finished cut" },
    { href: "#/presets", icon: "presets", title: "Looks", text: "Start from a proven style prompt" },
  ],
};

const HOSTS: Entry[] = [
  { href: "#/mcp/claude-code", icon: "terminal", title: "Claude Code", text: "Create with Shard in Claude Code" },
  { href: "#/mcp/codex", icon: "code", title: "Codex", text: "Create with Shard in Codex" },
  { href: "#/mcp/claude-desktop", icon: "plug", title: "Claude Desktop", text: "Generate images and videos in Claude" },
  { href: "#/mcp/cli", icon: "terminal", title: "CLI", text: "Create with Shard from your terminal" },
  { href: "#/skills", icon: "skills", title: "Skills", text: "Your saved skills, as slash commands" },
];

function MenuItem({ e, close }: { e: Entry; close(): void }) {
  return (
    <a
      className="menu-item"
      href={e.href}
      role="menuitem"
      onClick={() => {
        e.onPick?.();
        close();
      }}
    >
      <span className="menu-item__tile" data-badge={e.badge ?? undefined}>
        <Icon name={e.icon} size={22} />
        {e.badge && <span className="menu-item__badge">{e.badge}</span>}
      </span>
      <span className="menu-item__words">
        <span className="menu-item__title">{e.title}</span>
        <span className="menu-item__text">{e.text}</span>
      </span>
    </a>
  );
}

/**
 * Fixed under its link (the bar scrolls sideways on narrow windows, which would clip an absolute panel),
 * nudged left when it would run off the right edge.
 */
function usePlacement(anchor: HTMLElement | null) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const room = window.innerWidth - el.offsetWidth - 16;
    el.style.top = `${r.bottom + 6}px`;
    el.style.left = `${Math.max(16, Math.min(r.left - 12, room))}px`;
  }, [anchor]);
  return ref;
}

function Panel({ id, models, close, anchor }: { id: MenuId; models: ModelInfo[]; close(): void; anchor: HTMLElement | null }) {
  const ref = usePlacement(anchor);
  if (id === "mcp") {
    return (
      <div ref={ref} className="menu-panel menu-panel--one" role="menu" aria-label="MCP">
        <p className="menu-panel__label">Generate with Shard in</p>
        {HOSTS.map((e) => (
          <MenuItem key={e.title} e={e} close={close} />
        ))}
      </div>
    );
  }
  const list: Entry[] = sortModels(models.filter((m) => m.capability === id)).map((m) => ({
    href: `#/${id}`,
    icon: "model",
    title: modelName(m.id),
    text: modelBlurb(m),
    badge: modelBadge(m.id),
    onPick: () => setDraft(fitToModel(m, getDraft())),
  }));
  return (
    <div ref={ref} className="menu-panel" role="menu" aria-label={id === "image" ? "Image" : "Video"}>
      <div className="menu-panel__col">
        <p className="menu-panel__label">Features</p>
        {FEATURES[id].map((e) => (
          <MenuItem key={e.title} e={e} close={close} />
        ))}
      </div>
      <div className="menu-panel__col">
        <p className="menu-panel__label">Models</p>
        {list.length ? list.map((e) => <MenuItem key={e.title} e={e} close={close} />) : <p className="menu-panel__empty">Models load when the server is running.</p>}
      </div>
    </div>
  );
}

/** A top-bar link that opens its menu on hover or focus, and closes on leave, Escape or a pick. */
function MenuLink({ id, label, current, models }: { id: MenuId; label: string; current: NavId; models: ModelInfo[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  // Escape hands focus back to the link; that focus must not reopen the menu.
  const quiet = useRef(false);
  const show = () => {
    window.clearTimeout(timer.current);
    if (quiet.current) {
      quiet.current = false;
      return;
    }
    setOpen(true);
  };
  // A short grace period, so the pointer can cross from the link to the panel.
  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), 120);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // A new page closes the menu, even with the pointer still over the link.
  useEffect(() => {
    let at = window.location.hash;
    const shut = () => {
      if (window.location.hash !== at) setOpen(false);
      at = window.location.hash;
    };
    window.addEventListener("hashchange", shut);
    return () => window.removeEventListener("hashchange", shut);
  }, []);
  const blur = (e: FocusEvent) => {
    if (!wrap.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      const link = wrap.current?.querySelector<HTMLAnchorElement>(".topnav__link");
      if (link && document.activeElement !== link) {
        quiet.current = true;
        link.focus();
      }
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => wrap.current?.querySelector<HTMLAnchorElement>(".menu-item")?.focus());
    }
  };
  return (
    <div className="topnav__menu" ref={wrap} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={blur} onKeyDown={keys}>
      <a className="topnav__link" href={navHref(id)} aria-current={current === id ? "page" : undefined} aria-haspopup="menu" aria-expanded={open}>
        {label}
      </a>
      {open && <Panel id={id} models={models} close={() => setOpen(false)} anchor={wrap.current} />}
    </div>
  );
}

export function TopBar({ current, spend, children }: { current: NavId; spend: SpendView | null; children?: ReactNode }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  useEffect(() => {
    api<ModelInfo[]>("/api/models").then(setModels).catch(() => {});
  }, []);
  const running = spend?.unsettled ?? 0;
  return (
    <header className="topbar">
      <a className="topbar__brand" href="#/" aria-label="Shard home">
        <Logo size={30} />
      </a>
      <nav className="topnav" aria-label="Shard">
        {NAV.main.map((n) =>
          n.id === "image" || n.id === "video" || n.id === "mcp" ? (
            <MenuLink key={n.id} id={n.id} label={n.label} current={current} models={models} />
          ) : (
            <a key={n.id} className="topnav__link" href={navHref(n.id)} aria-current={current === n.id ? "page" : undefined}>
              {n.label}
            </a>
          ),
        )}
        <span className="topnav__divider" aria-hidden="true" />
        {NAV.studio.map((n) => (
          <a key={n.id} className="topnav__link topnav__link--studio" href={navHref(n.id)} aria-current={current === n.id ? "page" : undefined}>
            {n.label}
            {n.badge && <span className="topnav__badge">{n.badge}</span>}
          </a>
        ))}
      </nav>
      {children && <div className="topbar__where">{children}</div>}
      <div className="topbar__end">
        {running > 0 && (
          <a className="topbar__jobs" href="#/spend">
            {running === 1 ? "1 job running" : `${running} jobs running`}
          </a>
        )}
        <a className="topbar__spend" href="#/spend" aria-label="Spend" aria-current={current === "spend" ? "page" : undefined}>
          <SpendMeter spend={spend} />
        </a>
        <a className="topbar__icon" href="#/settings" aria-label="Settings" aria-current={current === "settings" ? "page" : undefined}>
          <Icon name="settings" size={18} />
        </a>
      </div>
    </header>
  );
}
