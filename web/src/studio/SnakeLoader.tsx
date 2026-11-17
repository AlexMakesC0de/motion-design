// web/src/studio/SnakeLoader.tsx
// What a take shows while it is being made: a grid of dots with a game of
// Snake on it, and a progress bar. The snake steers itself until someone
// presses an arrow key (or WASD) with the pointer over it or the game focused;
// after a few seconds without a key the autopilot takes back over.
import { useEffect, useRef, useState } from "react";
import { autopilot, KEYS, newSnake, step, turn, type Snake } from "./snake";

/** Grid spacing in CSS pixels. */
const CELL = 16;
/** One snake step. */
const TICK_MS = 110;
/** How long a player's last key keeps the autopilot off. */
const HANDS_OFF_MS = 5000;

const reduced = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

function draw(ctx: CanvasRenderingContext2D, s: Snake, w: number, h: number, t: number) {
  const css = getComputedStyle(ctx.canvas);
  const dot = css.getPropertyValue("--snake-dot").trim() || "#3a3b3f";
  const body = css.getPropertyValue("--snake-body").trim() || "#f4f4f5";
  const food = css.getPropertyValue("--snake-food").trim() || "#84f80a";
  const ox = (w - s.cols * CELL) / 2 + CELL / 2;
  const oy = (h - s.rows * CELL) / 2 + CELL / 2;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = dot;
  for (let y = 0; y < s.rows; y++)
    for (let x = 0; x < s.cols; x++) {
      ctx.beginPath();
      ctx.arc(ox + x * CELL, oy + y * CELL, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  // Food: a dot that breathes.
  ctx.fillStyle = food;
  ctx.beginPath();
  ctx.arc(ox + s.food.x * CELL, oy + s.food.y * CELL, 4 + Math.sin(t / 180) * 1.2, 0, Math.PI * 2);
  ctx.fill();
  // The snake: big dots, the tail fading out.
  ctx.fillStyle = body;
  s.body.forEach((c, i) => {
    ctx.globalAlpha = Math.max(0.25, 1 - i / (s.body.length + 2));
    ctx.beginPath();
    ctx.arc(ox + c.x * CELL, oy + c.y * CELL, i === 0 ? 5 : 4, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

export function SnakeLoader({ progress, label }: { progress: number; label: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<Snake | null>(null);
  const lastKey = useRef(0);
  const hovered = useRef(false);
  const [score, setScore] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    const ctx = el?.getContext?.("2d");
    if (!el || !box || !ctx) return;
    let w = 0;
    let h = 0;
    const fit = () => {
      const r = box.getBoundingClientRect();
      w = r.width;
      h = r.height;
      const dpr = window.devicePixelRatio || 1;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cols = Math.max(4, Math.floor(w / CELL));
      const rows = Math.max(4, Math.floor(h / CELL));
      if (!game.current || game.current.cols !== cols || game.current.rows !== rows) game.current = newSnake(cols, rows);
      draw(ctx, game.current, w, h, performance.now());
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(box);
    if (reduced()) return () => ro?.disconnect();

    let raf = 0;
    let acc = 0;
    let last = performance.now();
    const frame = (t: number) => {
      acc += t - last;
      last = t;
      while (acc >= TICK_MS && game.current) {
        acc -= TICK_MS;
        const g = game.current;
        const steer = t - lastKey.current > HANDS_OFF_MS ? turn(g, autopilot(g)) : g;
        game.current = step(steer);
        if (game.current.score !== g.score) setScore(game.current.score);
      }
      if (game.current) draw(ctx, game.current, w, h, t);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Steering works with the game focused, or with the pointer over it.
    const onKey = (e: KeyboardEvent) => {
      const dir = KEYS[e.key];
      if (!dir || !game.current) return;
      if (!hovered.current && document.activeElement !== box) return;
      e.preventDefault();
      lastKey.current = performance.now();
      game.current = turn(game.current, dir);
      setPlaying(true);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const pct = Math.round(progress * 100);
  return (
    <div
      ref={wrap}
      className="snake"
      tabIndex={0}
      role="group"
      aria-label={`${label}. While you wait, steer the snake with the arrow keys.`}
      onMouseEnter={() => (hovered.current = true)}
      onMouseLeave={() => (hovered.current = false)}
    >
      <canvas ref={canvas} className="snake__board" aria-hidden="true" />
      {playing && (
        <span className="snake__score mono" aria-live="polite">
          {score}
        </span>
      )}
      <span className="snake__hint" aria-hidden="true">
        ← ↑ → ↓ to play
      </span>
      <div className="snake__progress">
        <div className="snake__bar" role="progressbar" aria-label="Made so far" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="snake__pct mono">{pct}%</span>
      </div>
    </div>
  );
}
