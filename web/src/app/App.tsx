import { Nav } from "./Nav";
import { SpendMeter } from "./SpendMeter";
import { Placeholder } from "./Placeholder";
import { parseRoute, type TabId } from "./route";
import { useRoute, useStudio } from "./useStudio";
import { StudioScreen } from "../studio/StudioScreen";
import { LibraryScreen } from "../library/LibraryScreen";
import { PresetsScreen } from "../presets/PresetsScreen";
import { FilmsScreen } from "../films/FilmsScreen";
import { SpendScreen } from "../spend/SpendScreen";
import "./App.css";

const LATER = {
  settings: ["Settings", "Chat connection, limits and provider keys will show here."],
} as const;

function Screen({ tab, rest }: { tab: TabId; rest: string[] }) {
  if (tab === "studio") return <StudioScreen />;
  if (tab === "library") return <LibraryScreen />;
  if (tab === "presets") return <PresetsScreen />;
  if (tab === "films") return <FilmsScreen slug={rest[0]} />;
  if (tab === "spend") return <SpendScreen />;
  const [title, next] = LATER[tab];
  return <Placeholder title={title} next={next} />;
}

export function App() {
  const { tab, rest } = parseRoute(useRoute());
  const { spend, online } = useStudio();
  return (
    <div className="app">
      <header className="app__top">
        <a className="app__brand" href="#/studio" aria-label="Studio home">Studio</a>
        <Nav current={tab} />
        <SpendMeter spend={spend} />
      </header>
      {!online && (
        <div className="banner" role="alert">
          Studio server isn't running. Start it with <code className="mono">npm run studio</code>, and this page reconnects.
        </div>
      )}
      <main className="app__main" data-tab={tab}>
        <Screen tab={tab} rest={rest} />
      </main>
    </div>
  );
}
