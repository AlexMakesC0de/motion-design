// web/src/app/icons.tsx
// The rail's icons: 20px line drawings in currentColor, hidden from screen
// readers (the label under each icon names it).
const paths: Record<string, string> = {
  home: "M3 10.5 10 4l7 6.5V17a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1z",
  projects: "M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z",
  create: "M10 3v14M3 10h14",
  library: "M4 3h3v14H4zM9 3h3v14H9zM14 4l3 .8-3.2 12.6-3-.8z",
  presets: "M5 3h10v14l-5-3.5L5 17z",
  chat: "M3 4h14v9H8l-4 3v-3H3z",
  spend: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm0 3v8m-2.5-6h3.5a1.5 1.5 0 0 1 0 3H9a1.5 1.5 0 0 0 0 3h3.5",
  // Three sliders: a track and a round knob on each row.
  settings:
    "M3 5h3M10 5h7M6 5a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM3 10h8M15 10h2M11 10a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM3 15h1M8 15h9M4 15a2 2 0 1 0 4 0 2 2 0 0 0-4 0z",
};

export function Icon({ name }: { name: keyof typeof paths | string }) {
  return (
    <svg className="icon" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d={paths[name] ?? ""} />
    </svg>
  );
}
