import { useEffect } from "react";
import { Rail } from "./Rail";
import { TopBar } from "./TopBar";
import { parseRoute, railItemFor, replaceHash, type Place } from "./route";
import { useRoute, useStudio } from "./useStudio";
import { HomeScreen } from "../home/HomeScreen";
import { ProjectsScreen } from "../projects/ProjectsScreen";
import { FilmWorkspace } from "../film/FilmWorkspace";
import { StudioScreen } from "../studio/StudioScreen";
import { LibraryScreen } from "../library/LibraryScreen";
import { PresetsScreen } from "../presets/PresetsScreen";
import { SpendScreen } from "../spend/SpendScreen";
import { SettingsScreen } from "../settings/SettingsScreen";
import { ChatDrawer } from "../chat/ChatDrawer";
import { useRun } from "../studio/promptStore";
import "./App.css";

const TITLES: Record<Exclude<Place["screen"], "film">, string> = {
  home: "Home",
  projects: "Projects",
  create: "Create",
  library: "Library",
  presets: "Presets",
  spend: "Spend",
  settings: "Settings",
};

function Screen({ place }: { place: Place }) {
  switch (place.screen) {
    case "home":
      return <HomeScreen />;
    case "projects":
      return <ProjectsScreen />;
    case "film":
      return <FilmWorkspace key={place.slug} slug={place.slug} step={place.step} />;
    case "create":
      return <StudioScreen />;
    case "library":
      return <LibraryScreen />;
    case "presets":
      return <PresetsScreen />;
    case "spend":
      return <SpendScreen />;
    case "settings":
      return <SettingsScreen />;
  }
}

export function App() {
  const route = parseRoute(useRoute());
  const { spend, online } = useStudio();
  const run = useRun();
  const redirect = "redirect" in route ? route.redirect : null;
  useEffect(() => {
    if (redirect) replaceHash(redirect);
  }, [redirect]);
  if ("redirect" in route) return null;

  // The chat talks about the film you are in, or else the film Create saves into.
  const film = route.screen === "film" ? route.slug : run || null;
  return (
    <div className="app">
      <Rail current={railItemFor(route)} />
      <div className="app__col">
        <TopBar spend={spend}>
          {route.screen === "film" ? (
            <>
              <a href="#/projects">Projects</a> <span aria-hidden="true">/</span> <span className="mono">{route.slug}</span>
            </>
          ) : (
            TITLES[route.screen]
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
      <ChatDrawer film={film} />
    </div>
  );
}
