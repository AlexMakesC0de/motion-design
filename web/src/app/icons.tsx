// web/src/app/icons.tsx
// The rail's icons: 20px line drawings in currentColor, hidden from screen
// readers (the label under each icon names it).
const paths: Record<string, string> = {
  home: "M3 10.5 10 4l7 6.5V17a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1z",
  projects: "M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z",
  create: "M10 3v14M3 10h14",
  library: "M4 3h3v14H4zM9 3h3v14H9zM14 4l3 .8-3.2 12.6-3-.8z",
  presets: "M5 3h10v14l-5-3.5L5 17z",
  // Two stacked cards: a saved set of instructions.
  skills: "M4 7l6-3.5L16 7l-6 3.5zM4 10.5l6 3.5 6-3.5M4 14l6 3.5 6-3.5",
  chat: "M3 4h14v9H8l-4 3v-3H3z",
  spend: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm0 3v8m-2.5-6h3.5a1.5 1.5 0 0 1 0 3H9a1.5 1.5 0 0 0 0 3h3.5",
  // Three sliders: a track and a round knob on each row.
  settings:
    "M3 5h3M10 5h7M6 5a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM3 10h8M15 10h2M11 10a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM3 15h1M8 15h9M4 15a2 2 0 1 0 4 0 2 2 0 0 0-4 0z",
  // Small action icons in the same 20px line style.
  down: "M6 8l4 4 4-4",
  arrow: "M4 10h12M11 5l5 5-5 5",
  check: "M4.5 10.5l3.5 3.5 7.5-8",
  plus: "M10 4v12M4 10h12",
  minus: "M4 10h12",
  more: "M5 10h.01M10 10h.01M15 10h.01",
  play: "M6.5 4.5v11l9-5.5z",
  upload: "M10 13V4M6 8l4-4 4 4M4 13v3h12v-3",
  close: "M5 5l10 10M15 5L5 15",
  up: "M6 12l4-4 4 4",
  // Top-bar menu icons, same 20px line style.
  image: "M3.5 4.5h13v11h-13zM3.5 12.5l4-4 3.5 3.5 2-2 3.5 3.5M12.5 7.5h.01",
  video: "M3 5.5h10v9H3zM13 9l4-2.5v7L13 11",
  scenes: "M3 4h14v12H3zM3 7.5h14M3 12.5h14M6.5 4v3.5M10 4v3.5M13.5 4v3.5M6.5 12.5V16M10 12.5V16M13.5 12.5V16",
  sheet: "M7 8a3 3 0 1 0 6 0 3 3 0 0 0-6 0zM4.5 17c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5",
  terminal: "M3 4h14v12H3zM6 8l2.5 2L6 12M10 12h4",
  code: "M7 6l-4 4 4 4M13 6l4 4-4 4M11 4l-2 12",
  plug: "M7 3v4M13 3v4M5 7h10v3a5 5 0 0 1-10 0zM10 15v2",
  model: "M4 15V9M8 15V5M12 15v-4M16 15V7",
};

export function Icon({ name, size = 20 }: { name: keyof typeof paths | string; size?: number }) {
  // The dots of "more" need a heavier pen to read as dots.
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 20 20" fill={name === "play" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={name === "more" ? 2.6 : 1.5} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d={paths[name] ?? ""} />
    </svg>
  );
}
