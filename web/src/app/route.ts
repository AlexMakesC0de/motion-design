export const TABS = [
  { id: "studio", label: "Studio" },
  { id: "library", label: "Library" },
  { id: "presets", label: "Presets" },
  { id: "films", label: "Films" },
  { id: "spend", label: "Spend" },
  { id: "settings", label: "Settings" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

export function parseRoute(hash: string): { tab: TabId; rest: string[] } {
  const [first = "", ...rest] = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const tab = TABS.find((t) => t.id === first)?.id;
  return tab ? { tab, rest } : { tab: "studio", rest: [] };
}
