// web/src/app/route.ts
// The page's places, read from the hash. A film lives at #/films/<slug>/<step>;
// old hashes from the six-tab studio redirect so links in docs keep working.
import type { FilmStep } from "../api/types";

export type RailId = "home" | "projects" | "create" | "library" | "presets" | "spend" | "settings";
export type Screen = RailId | "film";
// The Library can open straight to the sheet maker for a name (#/library/new/<name>) or to one item (#/library/item/<name>).
export type Route =
  | { screen: Exclude<Screen, "film" | "library"> }
  | { screen: "library"; newName?: string; item?: string }
  | { screen: "film"; slug: string; step: FilmStep | null; scene?: string }
  | { redirect: string };
export type Place = Exclude<Route, { redirect: string }>;

export const STEPS: { id: FilmStep; label: string }[] = [
  { id: "idea", label: "Idea" },
  { id: "references", label: "References" },
  { id: "scenes", label: "Scenes" },
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
// A film's steps before Shard: Brief became Idea, Shots became Scenes.
const OLD_STEPS: Record<string, FilmStep> = { brief: "idea", shots: "scenes" };

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
    if (Object.hasOwn(OLD_STEPS, rest[1] ?? "")) return { redirect: filmHref(decoded(rest[0]), OLD_STEPS[rest[1]]) };
    const step = STEPS.find((s) => s.id === rest[1])?.id ?? null;
    // #/films/<slug>/scenes/<id> opens that scene.
    if (step === "scenes" && rest[2]) return { screen: "film", slug: decoded(rest[0]), step, scene: decoded(rest[2]) };
    return { screen: "film", slug: decoded(rest[0]), step };
  }
  if (first === "library" && rest[1] && (rest[0] === "new" || rest[0] === "item")) {
    return rest[0] === "new" ? { screen: "library", newName: decoded(rest[1]) } : { screen: "library", item: decoded(rest[1]) };
  }
  if (Object.hasOwn(REDIRECTS, first)) return { redirect: REDIRECTS[first] };
  if (RAIL_IDS.has(first)) return { screen: first as Exclude<Screen, "film" | "library"> };
  return { screen: "home" };
}

/** The rail item lit for a place: inside a film, Projects. */
export const railItemFor = (place: Place): RailId => (place.screen === "film" ? "projects" : place.screen);

export const libraryNewHref = (name: string) => `#/library/new/${encodeURIComponent(name)}`;
export const libraryItemHref = (name: string) => `#/library/item/${encodeURIComponent(name)}`;

export const filmHref = (slug: string, step?: FilmStep) => `#/films/${encodeURIComponent(slug)}${step ? `/${step}` : ""}`;
export const sceneHref = (slug: string, id: string) => `${filmHref(slug, "scenes")}/${encodeURIComponent(id)}`;

/** Go somewhere without a history entry (a redirect), and tell useRoute. */
export function replaceHash(hash: string) {
  history.replaceState(null, "", hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
