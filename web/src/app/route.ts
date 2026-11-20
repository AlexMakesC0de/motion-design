// web/src/app/route.ts
// The page's places, read from the hash. A film lives at #/films/<slug>/<step>;
// old hashes from the six-tab studio redirect so links in docs keep working.
import type { FilmStep } from "../api/types";

export type NavId = "home" | "newfilm" | "image" | "video" | "jutsu" | "influencers" | "mcp" | "projects" | "library" | "presets" | "skills" | "spend" | "settings";
/** Kept for older imports: the place a top-bar item opens. */
export type RailId = NavId;
export type Screen = NavId | "film";
// The Library can open straight to the sheet maker for a name (#/library/new/<name>) or to one item (#/library/item/<name>).
// Video opens on Create video, or on the scene editor at #/video/scenes. MCP can open on one host's tab (#/mcp/<host>).
export type Route =
  | { screen: Exclude<Screen, "film" | "library" | "video" | "mcp"> }
  | { screen: "library"; newName?: string; item?: string }
  | { screen: "video"; tab?: "create" | "scenes" }
  | { screen: "mcp"; host?: string }
  | { screen: "film"; slug: string; step: FilmStep | null; scene?: string }
  | { redirect: string };
export type Place = Exclude<Route, { redirect: string }>;

export const STEPS: { id: FilmStep; label: string }[] = [
  { id: "idea", label: "Idea" },
  { id: "references", label: "Cast" },
  { id: "scenes", label: "Shots" },
  { id: "finish", label: "Edit" },
];

/** The top bar: the making pages first (each opens a menu on hover), then the studio's places. */
export const NAV: { main: { id: NavId; label: string }[]; studio: { id: NavId; label: string; badge?: string }[] } = {
  main: [
    { id: "home", label: "Studio" },
    { id: "image", label: "Image" },
    { id: "video", label: "Video" },
    { id: "mcp", label: "MCP" },
  ],
  studio: [
    { id: "jutsu", label: "Openjutsu", badge: "Beta" },
    { id: "influencers", label: "AI Influencers", badge: "New" },
    { id: "projects", label: "Films" },
    { id: "library", label: "Library" },
    { id: "presets", label: "Looks" },
    { id: "skills", label: "Skills" },
  ],
};
/** Reached from the top bar's right side (the spend meter and the settings button), and New film from Films. */
const UTILITY: NavId[] = ["spend", "settings", "newfilm"];

export const navHref = (id: NavId) => (id === "home" ? "#/" : `#/${id}`);

const NAV_IDS = new Set<string>([...NAV.main.map((r) => r.id), ...NAV.studio.map((r) => r.id), ...UTILITY]);
// Create split into Image and Video; its scene editor is Video's Scenes tab.
const REDIRECTS: Record<string, string> = { studio: "#/video", create: "#/video", films: "#/projects", chat: "#/mcp", genjutsu: "#/jutsu", openjutsu: "#/jutsu", influencer: "#/influencers" };
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
  // #/library/new with no name opens New sheet empty.
  if (first === "library" && (rest[0] === "new" || (rest[0] === "item" && rest[1]))) {
    return rest[0] === "new" ? { screen: "library", newName: decoded(rest[1] ?? "") } : { screen: "library", item: decoded(rest[1]) };
  }
  if (first === "video") return rest[0] === "scenes" ? { screen: "video", tab: "scenes" } : { screen: "video" };
  if (first === "mcp") return rest[0] ? { screen: "mcp", host: decoded(rest[0]) } : { screen: "mcp" };
  if (Object.hasOwn(REDIRECTS, first)) return { redirect: REDIRECTS[first] };
  if (NAV_IDS.has(first)) return { screen: first as Exclude<Screen, "film" | "library" | "video" | "mcp"> };
  return { screen: "home" };
}

/** The top-bar item lit for a place: inside a film, Films. */
export const navItemFor = (place: Place): NavId => (place.screen === "film" ? "projects" : place.screen);
export const railItemFor = navItemFor;

export const libraryNewHref = (name: string) => `#/library/new/${encodeURIComponent(name)}`;
export const libraryItemHref = (name: string) => `#/library/item/${encodeURIComponent(name)}`;

export const filmHref = (slug: string, step?: FilmStep) => `#/films/${encodeURIComponent(slug)}${step ? `/${step}` : ""}`;
export const sceneHref = (slug: string, id: string) => `${filmHref(slug, "scenes")}/${encodeURIComponent(id)}`;

/** Go somewhere without a history entry (a redirect), and tell useRoute. */
export function replaceHash(hash: string) {
  history.replaceState(null, "", hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
