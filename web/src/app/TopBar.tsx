// web/src/app/TopBar.tsx
// The one bar across the top: the logo, the making pages (Image, Video, MCP),
// each opening a menu the moment the pointer reaches it, a divider, the
// studio's places, and on the right running jobs, today's spend and Settings.
import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { api } from "../api/client";
import type { ModelInfo, SpendView } from "../api/types";
import { fitToModel, getDraft, setDraft } from "../studio/promptStore";
import { Mark } from "./brands";
import { Icon } from "./icons";
import { Logo } from "./Logo";
import { AIM_REST_MS, aimingAt, tipOf } from "./menuAim";
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
  { href: "#/mcp/claude-code", icon: "claude", title: "Claude Code", text: "Create with Shard in Claude Code" },
  { href: "#/mcp/codex", icon: "openai", title: "Codex", text: "Create with Shard in Codex" },
  { href: "#/mcp/claude-desktop", icon: "claude", title: "Claude Desktop", text: "Generate images and videos in Claude" },
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
        <Mark name={e.icon} size={22} />
        {e.badge && <span className="menu-item__badge">{e.badge}</span>}
      </span>
      <span className="menu-item__words">
        <span className="menu-item__title">{e.title}</span>
        <span className="menu-item__text">{e.text}</span>
      </span>
    </a>
  );
}

/** What one menu holds: one column of hosts for MCP, Features and Models for Image and Video. */
function MenuContent({ id, models, close }: { id: MenuId; models: ModelInfo[]; close(): void }) {
  if (id === "mcp") {
    return (
      <div className="menu-panel menu-panel--one" role="menu" aria-label="MCP">
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
    <div className="menu-panel" role="menu" aria-label={id === "image" ? "Image" : "Video"}>
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

const ORDER: MenuId[] = ["image", "video", "mcp"];

/**
 * The one menu shell. It stays mounted while the pointer moves between Image, Video and MCP,
 * sliding under the new link and resizing to the new content, which fades in from the side
 * the pointer came from. Fixed, because the bar scrolls sideways on narrow windows.
 */
function MenuShell({ id, from, anchor, models, close }: { id: MenuId; from: MenuId | null; anchor: HTMLElement | null; models: ModelInfo[]; close(): void }) {
  const shell = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  useLayoutEffect(() => {
    const el = shell.current;
    const body = inner.current;
    if (!el || !body || !anchor) return;
    const w = body.offsetWidth;
    const h = body.offsetHeight;
    const r = anchor.getBoundingClientRect();
    const left = Math.max(16, Math.min(r.left - 12, window.innerWidth - w - 16));
    // The first placement jumps; every later one glides from where the shell was.
    el.dataset.moving = placed.current ? "true" : "false";
    el.style.top = `${r.bottom + 6}px`;
    el.style.left = `${left}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    placed.current = true;
  }, [id, anchor, models]);
  const dir = from && from !== id ? (ORDER.indexOf(id) > ORDER.indexOf(from) ? "right" : "left") : "none";
  return (
    <div ref={shell} className="menu-shell">
      <div ref={inner} key={id} className="menu-shell__inner" data-from={dir}>
        <MenuContent id={id} models={models} close={close} />
      </div>
    </div>
  );
}

export function TopBar({ current, spend, children }: { current: NavId; spend: SpendView | null; children?: ReactNode }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [menu, setMenu] = useState<{ id: MenuId; from: MenuId | null } | null>(null);
  const bar = useRef<HTMLElement>(null);
  const links = useRef<Partial<Record<MenuId, HTMLAnchorElement | null>>>({});
  const timer = useRef<number | undefined>(undefined);
  // Escape hands focus back to the link; that focus must not reopen the menu.
  const quiet = useRef(false);

  useEffect(() => {
    api<ModelInfo[]>("/api/models").then(setModels).catch(() => {});
  }, []);

  const open = (id: MenuId) => {
    window.clearTimeout(timer.current);
    if (quiet.current) {
      quiet.current = false;
      return;
    }
    setMenu((m) => (m?.id === id ? m : { id, from: m?.id ?? null }));
  };
  const shut = () => {
    window.clearTimeout(timer.current);
    setMenu(null);
  };
  // A short grace period, so the pointer can cross from a link to the panel.
  const later = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMenu(null), 140);
  };
  const stay = () => window.clearTimeout(timer.current);

  // Menu aim: where the pointer has been lately, and what it last hovered while
  // heading for the open panel. That hover waits until the pointer stops aiming.
  const trail = useRef<{ x: number; y: number; t: number }[]>([]);
  const pending = useRef<MenuId | "close" | null>(null);
  const aimTimer = useRef<number | undefined>(undefined);
  const aiming = () => {
    const panel = bar.current?.querySelector(".menu-shell");
    const now = trail.current[trail.current.length - 1];
    if (!panel || !now) return false;
    return aimingAt(tipOf(trail.current, now.t), now, panel.getBoundingClientRect());
  };
  const settle = () => {
    window.clearTimeout(aimTimer.current);
    const target = pending.current;
    pending.current = null;
    if (target === "close") shut();
    else if (target) open(target);
  };
  /** Hovering a link: open its menu (or close the menu), unless the pointer is on its way into the open panel. */
  const intent = (target: MenuId | "close") => {
    window.clearTimeout(aimTimer.current);
    if (menu && target !== menu.id && aiming()) {
      pending.current = target;
      aimTimer.current = window.setTimeout(settle, AIM_REST_MS);
      return;
    }
    pending.current = null;
    if (target === "close") shut();
    else open(target);
  };
  const track = (e: MouseEvent) => {
    const t = performance.now();
    trail.current = [...trail.current.filter((p) => t - p.t < 200), { x: e.clientX, y: e.clientY, t }].slice(-8);
    if (!pending.current) return;
    const panel = bar.current?.querySelector(".menu-shell");
    if (panel?.contains(e.target as Node)) {
      // Made it into the panel: the links it crossed never count.
      window.clearTimeout(aimTimer.current);
      pending.current = null;
    } else if (!aiming()) settle();
    else {
      window.clearTimeout(aimTimer.current);
      aimTimer.current = window.setTimeout(settle, AIM_REST_MS);
    }
  };
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      window.clearTimeout(aimTimer.current);
    },
    [],
  );

  // A new page closes the menu, even with the pointer still over the link.
  useEffect(() => {
    let at = window.location.hash;
    const onHash = () => {
      if (window.location.hash !== at) setMenu(null);
      at = window.location.hash;
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const blur = (e: FocusEvent) => {
    if (!bar.current?.contains(e.relatedTarget as Node | null)) setMenu(null);
  };
  const keys = (e: KeyboardEvent) => {
    if (!menu) {
      const id = ORDER.find((k) => links.current[k] === e.target);
      if (id && e.key === "ArrowDown") {
        e.preventDefault();
        open(id);
        requestAnimationFrame(() => bar.current?.querySelector<HTMLAnchorElement>(".menu-item")?.focus());
      }
      return;
    }
    if (e.key === "Escape") {
      const link = links.current[menu.id];
      shut();
      if (link && document.activeElement !== link) {
        quiet.current = true;
        link.focus();
      }
    }
    if (e.key === "ArrowDown" && ORDER.some((k) => links.current[k] === e.target)) {
      e.preventDefault();
      bar.current?.querySelector<HTMLAnchorElement>(".menu-item")?.focus();
    }
  };

  const running = spend?.unsettled ?? 0;
  return (
    <header className="topbar" ref={bar} onMouseLeave={later} onMouseEnter={stay} onMouseMove={track} onBlur={blur} onKeyDown={keys}>
      <a className="topbar__brand" href="#/" aria-label="Shard home" onMouseEnter={() => intent("close")}>
        <Logo size={30} />
      </a>
      <nav className="topnav" aria-label="Shard">
        {NAV.main.map((n) =>
          n.id === "image" || n.id === "video" || n.id === "mcp" ? (
            <div key={n.id} className="topnav__menu" onMouseEnter={() => intent(n.id as MenuId)}>
              <a
                ref={(el) => {
                  links.current[n.id as MenuId] = el;
                }}
                className="topnav__link"
                href={navHref(n.id)}
                aria-current={current === n.id ? "page" : undefined}
                aria-haspopup="menu"
                aria-expanded={menu?.id === n.id}
                onFocus={() => open(n.id as MenuId)}
              >
                {n.label}
              </a>
            </div>
          ) : (
            <a key={n.id} className="topnav__link" href={navHref(n.id)} aria-current={current === n.id ? "page" : undefined} onMouseEnter={() => intent("close")} onFocus={shut}>
              {n.label}
            </a>
          ),
        )}
        <span className="topnav__divider" aria-hidden="true" />
        {NAV.studio.map((n) => (
          <a key={n.id} className="topnav__link topnav__link--studio" href={navHref(n.id)} aria-current={current === n.id ? "page" : undefined} onMouseEnter={() => intent("close")} onFocus={shut}>
            {n.label}
            {n.badge && <span className="topnav__badge">{n.badge}</span>}
          </a>
        ))}
      </nav>
      {menu && <MenuShell id={menu.id} from={menu.from} anchor={links.current[menu.id] ?? null} models={models} close={shut} />}
      {children && <div className="topbar__where">{children}</div>}
      <div className="topbar__end" onMouseEnter={() => intent("close")}>
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
