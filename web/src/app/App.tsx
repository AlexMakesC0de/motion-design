import { useEffect } from "react";
import { TopBar } from "./TopBar";
import { navItemFor, parseRoute, replaceHash, type Place } from "./route";
import { useRoute, useStudio } from "./useStudio";
import { ExploreScreen } from "../home/ExploreScreen";
import { NewFilmScreen } from "../home/NewFilmScreen";
import { ProjectsScreen } from "../projects/ProjectsScreen";
import { FilmWorkspace } from "../film/FilmWorkspace";
import { ImageScreen } from "../studio/ImageScreen";
import { VideoScreen } from "../studio/VideoScreen";
import { JutsuScreen } from "../jutsu/JutsuScreen";
import { InfluencerScreen } from "../influencers/InfluencerScreen";
import { McpScreen } from "../mcp/McpScreen";
import { LibraryScreen } from "../library/LibraryScreen";
import { PresetsScreen } from "../presets/PresetsScreen";
import { SkillsScreen } from "../skills/SkillsScreen";
import { SpendScreen } from "../spend/SpendScreen";
import { SettingsScreen } from "../settings/SettingsScreen";
import "./App.css";

const TITLES: Record<Exclude<Place["screen"], "film">, string> = {
  home: "Studio",
  newfilm: "New film",
  projects: "Films",
  image: "Image",
  video: "Video",
  jutsu: "Openjutsu",
  influencers: "AI Influencers",
  mcp: "MCP",
  library: "Library",
  presets: "Looks",
  skills: "Skills",
  spend: "Spend",
  settings: "Settings",
};

function Screen({ place }: { place: Place }) {
  switch (place.screen) {
    case "home":
      return <ExploreScreen />;
    case "newfilm":
      return <NewFilmScreen />;
    case "projects":
      return <ProjectsScreen />;
    case "film":
      return <FilmWorkspace key={place.slug} slug={place.slug} step={place.step} scene={place.scene} />;
    case "image":
      return <ImageScreen />;
    case "video":
      return <VideoScreen tab={place.tab ?? "create"} />;
    case "jutsu":
      return <JutsuScreen />;
    case "influencers":
      return <InfluencerScreen />;
    case "mcp":
      return <McpScreen host={place.host} />;
    case "library":
      return <LibraryScreen newName={place.newName} item={place.item} />;
    case "presets":
      return <PresetsScreen />;
    case "skills":
      return <SkillsScreen />;
    case "spend":
      return <SpendScreen />;
    case "settings":
      return <SettingsScreen />;
  }
}

export function App() {
  const route = parseRoute(useRoute());
  const { spend, online } = useStudio();
  const redirect = "redirect" in route ? route.redirect : null;
  useEffect(() => {
    if (redirect) replaceHash(redirect);
  }, [redirect]);
  const title = "redirect" in route ? null : route.screen === "film" ? route.slug : TITLES[route.screen];
  useEffect(() => {
    if (title) document.title = `${title} · Shard`;
  }, [title]);
  if ("redirect" in route) return null;

  // Inside a film the bar says which one; elsewhere the lit item already says where you are.
  return (
    <div className="app">
      <div className="app__col">
        <TopBar current={navItemFor(route)} spend={spend}>
          {route.screen === "film" && (
            <>
              <a href="#/projects">Films</a> <span aria-hidden="true">/</span> <span className="mono">{route.slug}</span>
            </>
          )}
        </TopBar>
        {!online && (
          <div className="banner" role="alert">
            Shard's server isn't running. Start it with <code className="mono">npm run studio</code>, and this page reconnects.
          </div>
        )}
        <main className="app__main" data-screen={route.screen}>
          <Screen place={route} />
        </main>
      </div>
    </div>
  );
}
