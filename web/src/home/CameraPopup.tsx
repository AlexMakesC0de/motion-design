// web/src/home/CameraPopup.tsx
// The Camera card's popup: three tabs. Setup builds the camera for the whole
// take from three endless wheels (camera, lens, aperture) you drag or flick;
// the pill that rests in the middle is the pick. Framing is the same for focal
// length, shot size and angle. No previews. Movement is every move on the
// director's menu as a tile with its preview; picking one writes its #tag into the prompt
// (several per shot, in order), so the move sits where it happens. A move a
// look or the AI chose as the take's one move (picks.move) shows as picked too.
//
// A move's preview is its agreed clip when one sits in runs/camera-moves/
// (served by /api/camera-moves; never committed, it shows a personal character),
// else "Preview coming soon".
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { api } from "../api/client";
import menu from "../../../cli/director/menu.json";
import { findMoveTags, setPick } from "../../../cli/director/picks.mjs";
import { Icon } from "../app/icons";
import { useOnScreen } from "../app/useOnScreen";
import { getDraft, setDraft, type VideoPicks } from "../studio/promptStore";
import "./camera.css";

type SetupKey = "camera" | "lensLook" | "depth" | "lens" | "size" | "angle";
interface Option {
  id: string;
  label: string;
  when: string;
}

const SETUP: { key: SetupKey; title: string; options: Option[] }[] = [
  { key: "camera", title: "Camera", options: menu.cameras },
  // Warm vintage is a colour grade, not glass ("grade" in menu.json): Looks and the AI still use it, the Lens wheel leaves it out.
  { key: "lensLook", title: "Lens", options: menu.lensLooks.filter((o) => !(o as { grade?: boolean }).grade) },
  { key: "depth", title: "Aperture", options: menu.depths },
  { key: "lens", title: "Focal length", options: menu.lenses },
  { key: "size", title: "Shot size", options: menu.sizes },
  { key: "angle", title: "Angle", options: menu.angles },
];

/** Every move, by id and by the tag typed for it (#arc-left is the move orbit-left). */
export const MOVE_IDS: { id: string; tag?: string }[] = menu.moves;
export const moveById = (id: string) => menu.moves.find((m) => m.id === id) ?? null;
/** The name a move is typed and shown by in the prompt: its tag, else its id. */
export const tagOf = (id: string) => (moveById(id) as { tag?: string } | null)?.tag ?? id;

// The agreed clips, fetched once for the page and shared by every tile.
let clips: Record<string, string> = {};
let clipsAsked = false;
const clipListeners = new Set<() => void>();
function askClips() {
  if (clipsAsked) return;
  clipsAsked = true;
  api<{ clips?: Record<string, string> }>("/api/camera-moves")
    .then((v) => {
      if (!v?.clips || typeof v.clips !== "object") return;
      clips = v.clips;
      for (const l of clipListeners) l();
    })
    .catch(() => {}); // no server or no clips: the drawings stay
}
function subscribeClips(l: () => void) {
  askClips();
  clipListeners.add(l);
  return () => clipListeners.delete(l);
}
/** The URL of a move's agreed clip, or null while it has none. */
export function useMoveClip(id: string | undefined) {
  return useSyncExternalStore(subscribeClips, () => (id ? (clips[id] ?? null) : null));
}

/** A small shot of a move: its agreed clip, else a note that its preview is coming. */
export function CameraScene({ move }: { move?: string }) {
  const clip = useMoveClip(move);
  if (clip)
    return (
      <span className="cam-scene cam-scene--clip" data-move={move} aria-hidden="true">
        <video src={clip} muted loop autoPlay playsInline preload="auto" />
      </span>
    );
  return (
    <span className="cam-scene cam-scene--soon" data-move={move} aria-hidden="true">
      <span>Preview coming soon</span>
    </span>
  );
}

function Tile({ label, picked, onPick, title, children }: { label: string; picked: boolean; onPick(): void; title?: string; children: ReactNode }) {
  return (
    <button type="button" className="cam-tile" aria-pressed={picked} title={title} onClick={onPick}>
      <span className="cam-tile__media">
        {children}
        {picked && (
          <span className="cam-tile__check">
            <Icon name="check" size={12} />
          </span>
        )}
      </span>
      <span className="cam-tile__label">{label}</span>
    </button>
  );
}

const setSetup = (key: SetupKey, id: string | undefined) => setDraft({ picks: (setPick(getDraft().picks, key, id) ?? {}) as VideoPicks });

/** Pictures of the gear, cut out on no background, in web/public/gear/<key>/<id>.png. Add an entry when its picture lands. */
const GEAR_ART: Record<string, string> = {};

const AUTO_ICON: Record<string, string> = { camera: "camera", lensLook: "look", depth: "light", lens: "look", size: "image", angle: "image" };
/** The wheels on Setup: the three parts of the camera you build. */
const BUILD = SETUP.filter((s) => s.key === "camera" || s.key === "lensLook" || s.key === "depth");
/** The wheels on Framing: how the shot is framed. */
const FRAMING = SETUP.filter((s) => s.key === "lens" || s.key === "size" || s.key === "angle");
/** Pixels between two pills' centres; camera.css sizes the pill to fit. */
const STEP = 184;
const frame = (f: FrameRequestCallback) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(f) : (f(performance.now()), 0));

/**
 * One part of the camera as an endless wheel: Auto, then each choice, round and round.
 * Grab it and drag up or down, flick it, scroll it, click a pill or use the arrow keys;
 * the pill that comes to rest in the middle is the pick.
 */
function Wheel({ setKey, title, options, value }: { setKey: SetupKey; title: string; options: Option[]; value: string | undefined }) {
  const items: { id: string | undefined; label: string; when: string }[] = [{ id: undefined, label: "Auto", when: "The AI picks from the prompt" }, ...options];
  const n = items.length;
  const mod = (k: number) => ((k % n) + n) % n;
  const index = Math.max(0, items.findIndex((o) => o.id === value));
  const picked = useRef(index);
  picked.current = index;

  // The wheel's turn in pixels: pill k sits in the middle when it is k * STEP (any lap).
  const [turn, setTurnState] = useState(index * STEP);
  const at = useRef(turn);
  const setTurn = (y: number) => {
    at.current = y;
    setTurnState(y);
  };
  const anim = useRef<number | null>(null);
  const stop = () => {
    if (anim.current) cancelAnimationFrame(anim.current);
    anim.current = null;
  };
  const glide = (to: number, then?: () => void) => {
    stop();
    const from = at.current;
    const t0 = performance.now();
    const ms = Math.min(560, 200 + Math.abs(to - from) * 0.5);
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      setTurn(from + (to - from) * (1 - (1 - p) ** 3));
      if (p < 1) anim.current = frame(tick);
      else {
        anim.current = null;
        then?.();
      }
    };
    anim.current = frame(tick);
  };
  /** Come to rest on the pill nearest y, and pick it. */
  const settle = (y: number) => {
    const k = Math.round(y / STEP);
    glide(k * STEP, () => {
      if (mod(k) !== picked.current) setSetup(setKey, items[mod(k)].id);
    });
  };
  // A pick from outside (a click, a key, Reset all): turn the short way round to it.
  useEffect(() => {
    const k = Math.round(at.current / STEP);
    if (mod(k) === index) return;
    let d = mod(index - k);
    if (d > n / 2) d -= n;
    glide((k + d) * STEP);
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => stop, []);

  const drag = useRef<{ y: number; from: number; moved: boolean; lastY: number; lastT: number; v: number } | null>(null);
  const rest = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(rest.current), []);
  const centre = mod(Math.round(turn / STEP));

  return (
    <section className="cam-wheel" aria-label={title}>
      <h3 className="cam-wheel__title">{title}</h3>
      <div
        className="cam-wheel__list"
        role="listbox"
        aria-label={title}
        tabIndex={0}
        data-dragging={drag.current?.moved || undefined}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          stop();
          drag.current = { y: e.clientY, from: at.current, moved: false, lastY: e.clientY, lastT: e.timeStamp, v: 0 };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (!d.moved && Math.abs(e.clientY - d.y) < 5) return;
          if (!d.moved) {
            d.moved = true;
            e.currentTarget.setPointerCapture?.(e.pointerId); // from here a release is not a click on a pill
          }
          const dt = Math.max(1, e.timeStamp - d.lastT);
          d.v = 0.8 * ((d.lastY - e.clientY) / dt) + 0.2 * d.v;
          d.lastY = e.clientY;
          d.lastT = e.timeStamp;
          setTurn(d.from - (e.clientY - d.y));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d?.moved) return;
          const v = e.timeStamp - d.lastT > 80 ? 0 : Math.max(-2, Math.min(2, d.v)); // a hand that stopped before letting go doesn't flick
          settle(at.current + v * 110); // a flick carries on by a pill or two
        }}
        onPointerCancel={() => {
          if (drag.current?.moved) settle(at.current);
          drag.current = null;
        }}
        onWheel={(e) => {
          stop();
          setTurn(at.current + e.deltaY);
          window.clearTimeout(rest.current);
          rest.current = window.setTimeout(() => settle(at.current), 120);
        }}
        onKeyDown={(e) => {
          const by = { ArrowDown: 1, ArrowUp: -1 }[e.key];
          if (by === undefined) return;
          e.preventDefault();
          setSetup(setKey, items[mod(index + by)].id);
        }}
      >
        {items.map((o, i) => {
          // Where pill i sits from the middle, wrapped so the wheel has no ends.
          const span = n * STEP;
          const y = ((((i * STEP - turn) % span) + span * 1.5) % span) - span / 2;
          const far = Math.min(Math.abs(y) / STEP, 1.6);
          const art = o.id && GEAR_ART[`${setKey}:${o.id}`];
          return (
            <div
              key={o.id ?? "auto"}
              role="option"
              aria-selected={o.id === value}
              data-centre={i === centre || undefined}
              className="cam-wheel__item"
              title={o.when}
              style={{ transform: `translateY(${y}px) scale(${1 - far * 0.1})`, opacity: 1 - far * 0.42 }}
              onClick={() => setSetup(setKey, o.id)}
            >
              <span className="cam-wheel__pill">
                {art ? <img className="cam-wheel__art" src={art} alt="" draggable={false} /> : !o.id && <Icon name={AUTO_ICON[setKey]} size={26} />}
                <span className="cam-wheel__label">{o.label}</span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Setup (the camera you build) or Framing (how it frames the shot): three wheels side by side. No previews. */
function WheelsTab({ picks, wheels }: { picks: VideoPicks; wheels: typeof SETUP }) {
  return (
    <div className="cam-build">
      {wheels.map((s) => (
        <Wheel key={s.key} setKey={s.key} title={s.title} options={s.options} value={picks[s.key]} />
      ))}
    </div>
  );
}

function MovementTab({ picks, prompt, onTag, onUntag }: { picks: VideoPicks; prompt: string; onTag(id: string): void; onUntag(id: string): void }) {
  const [query, setQuery] = useState("");
  const tagged = new Set(findMoveTags(prompt, MOVE_IDS).map((t) => t.id));
  const q = query.trim().toLowerCase();
  const shown = menu.moves.filter((m) => !q || m.label.toLowerCase().includes(q) || m.id.includes(q) || tagOf(m.id).includes(q) || m.when.toLowerCase().includes(q));
  return (
    <div className="cam-moves">
      <div className="cam-moves__head">
        <div>
          <h3 className="cam-moves__title">Direct a camera move</h3>
          <p className="cam-moves__hint">
            Adds a tag to the prompt box, or type <span className="cam-hash">#</span> there. Several per shot; order matters.
          </p>
        </div>
        <label className="cam-search">
          <Icon name="look" size={14} />
          <input type="search" placeholder="Search moves" aria-label="Search moves" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      {picks.move && !tagged.has(picks.move) && (
        <p className="cam-moves__note">
          The take's move is <strong>{moveById(picks.move)?.label ?? picks.move}</strong>, set by a look or the AI.{" "}
          <button type="button" className="cam-link" onClick={() => setSetupMove(undefined)}>
            Clear it
          </button>
        </p>
      )}
      <div className="cam-grid">
        {shown.map((m) => {
          const picked = tagged.has(m.id) || picks.move === m.id;
          return (
            <Tile
              key={m.id}
              label={m.label}
              title={m.when}
              picked={picked}
              onPick={() => {
                if (tagged.has(m.id)) onUntag(m.id);
                else if (picks.move === m.id) setSetupMove(undefined);
                else onTag(m.id);
              }}
            >
              <CameraScene move={m.id} />
            </Tile>
          );
        })}
        {!shown.length && <p className="cam-empty">No move matches “{query}”.</p>}
      </div>
    </div>
  );
}

const setSetupMove = (id: string | undefined) => setDraft({ picks: (setPick(getDraft().picks, "move", id) ?? {}) as VideoPicks });

/** Remove every #id tag from a prompt, tidying the space it leaves. */
export function untag(prompt: string, id: string) {
  const tags = findMoveTags(prompt, MOVE_IDS).filter((t) => t.id === id);
  let out = prompt;
  for (const t of [...tags].reverse()) out = `${out.slice(0, t.start).replace(/ $/, "")}${out.slice(t.end).replace(/^ (?=[\s.,;!?]|$)/, "")}`;
  return out.replace(/^ +/, "");
}

export function CameraPopup({ picks, prompt, anchor, onTag, onClose }: { picks: VideoPicks; prompt: string; anchor: RefObject<HTMLElement | null>; onTag(id: string): void; onClose(): void }) {
  const [tab, setTab] = useState<"setup" | "framing" | "movement">("movement");
  const panel = useRef<HTMLDivElement>(null);
  useOnScreen(panel, true);
  const anyPicked = useMemo(() => SETUP.some((s) => picks[s.key]) || Boolean(picks.move) || findMoveTags(prompt, MOVE_IDS).length > 0, [picks, prompt]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // A click outside closes it, except in the prompt box, where its tags land.
    const away = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!panel.current?.contains(t) && !anchor.current?.contains(t) && !t.closest?.(".xprompt")) onClose();
    };
    document.addEventListener("keydown", esc);
    document.addEventListener("mousedown", away);
    return () => {
      document.removeEventListener("keydown", esc);
      document.removeEventListener("mousedown", away);
    };
  }, [onClose, anchor]);

  return (
    <div ref={panel} className="cam-pop" role="dialog" aria-label="Camera">
      <div className="cam-pop__top">
        <h2 className="cam-pop__title">Camera</h2>
        <button
          type="button"
          className="cam-pop__reset"
          disabled={!anyPicked}
          onClick={() => {
            const next: VideoPicks = { ...getDraft().picks };
            for (const s of SETUP) delete next[s.key];
            delete next.move;
            delete next.speed;
            let text = getDraft().prompt;
            for (const id of new Set(findMoveTags(text, MOVE_IDS).map((t) => t.id))) text = untag(text, id);
            setDraft({ picks: next, prompt: text });
          }}
        >
          Reset all
        </button>
        <button type="button" className="cam-pop__close" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="cam-pop__body">
        <nav className="cam-nav" role="tablist" aria-label="Camera">
          <button type="button" role="tab" aria-selected={tab === "setup"} className="cam-nav__tab" onClick={() => setTab("setup")}>
            <Icon name="camera" size={18} /> Setup
          </button>
          <button type="button" role="tab" aria-selected={tab === "framing"} className="cam-nav__tab" onClick={() => setTab("framing")}>
            <Icon name="image" size={18} /> Framing
          </button>
          <button type="button" role="tab" aria-selected={tab === "movement"} className="cam-nav__tab" onClick={() => setTab("movement")}>
            <Icon name="arrow" size={18} /> Movement
          </button>
        </nav>
        <div className={`cam-pop__main${tab !== "movement" ? " cam-pop__main--build" : ""}`} role="tabpanel">
          {tab !== "movement" ? (
            <WheelsTab key={tab} picks={picks} wheels={tab === "setup" ? BUILD : FRAMING} />
          ) : (
            <MovementTab picks={picks} prompt={prompt} onTag={onTag} onUntag={(id) => setDraft({ prompt: untag(getDraft().prompt, id) })} />
          )}
        </div>
      </div>
    </div>
  );
}
