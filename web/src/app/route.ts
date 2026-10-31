// web/src/app/route.ts
// The page's places, read from the hash. A film lives at #/films/<slug>/<step>;
// old hashes from the six-tab studio redirect so links in docs keep working.
import type { FilmStep } from "../api/types";

export type RailId = "home" | "projects" | "create" | "library" | "presets" | "spend" | "settings";
export type Screen = RailId | "film";
export type Route = { screen: Exclude<Screen, "film"> } | { screen: "film"; slug: string; step: FilmStep | null } | { redirect: string };
export type Place = Exclude<Route, { redirect: string }>;

export const STEPS: { id: FilmStep; label: string }[] = [
  { id: "brief", label: "Brief" },
  { id: "references", label: "References" },
  { id: "shots", label: "Shots" },
  { id: "finish", label: "Finish" },
];

export const RAIL: { top: { id: RailId; label: string }[]; bottom: { id: RailId; label: string }[] } = {
  top: [
    { id: "home", label: "Home" },
    { id: "projects", label: "Projects" },
    { id: "create", label: "Create" },
    { id: "library", label: "Library" },
    { id: "presets", label: "Presets" },
  ],
  bottom: [
    { id: "spend", label: "Spend" },
    { id: "settings", label: "Settings" },
  ],
};

const RAIL_IDS = new Set<string>([...RAIL.top, ...RAIL.bottom].map((r) => r.id));
const REDIRECTS: Record<string, string> = { studio: "#/create", films: "#/projects" };

/** The hash part as typed; a stray % must not break the page. */
export function decoded(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export function parseRoute(hash: string): Route {
  const [first = "", ...rest] = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (first === "films" && rest[0]) {
    const step = STEPS.find((s) => s.id === rest[1])?.id ?? null;
    return { screen: "film", slug: decoded(rest[0]), step };
  }
  if (Object.hasOwn(REDIRECTS, first)) return { redirect: REDIRECTS[first] };
  if (RAIL_IDS.has(first)) return { screen: first as Exclude<Screen, "film"> };
  return { screen: "home" };
}

/** The rail item lit for a place: inside a film, Projects. */
export const railItemFor = (place: Place): RailId => (place.screen === "film" ? "projects" : place.screen);

export const filmHref = (slug: string, step?: FilmStep) => `#/films/${encodeURIComponent(slug)}${step ? `/${step}` : ""}`;

/** Go somewhere without a history entry (a redirect), and tell useRoute. */
export function replaceHash(hash: string) {
  history.replaceState(null, "", hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
