// web/src/app/Logo.tsx
// Shard's mark: a play triangle with a shard split off. Drawn from Alex's
// neon-lime logo; the same shape is web/public/logo.svg (the favicon).
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path d="M24 22 L74 46 L26 70 Z M44 74 L72 61 L62 86 Z" fill="var(--accent)" stroke="var(--accent)" strokeWidth="9" strokeLinejoin="round" />
    </svg>
  );
}
