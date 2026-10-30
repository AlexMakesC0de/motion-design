import { Nav } from "./Nav";
import { SpendMeter } from "./SpendMeter";
import { Placeholder } from "./Placeholder";
import { parseRoute } from "./route";
import { useRoute, useStudio } from "./useStudio";
import "./App.css";

const SCREENS = {
  studio: ["Studio", "The prompt bar and your takes arrive in the next build step."],
  library: ["Library", "Saved characters, products, places and styles will show here."],
  presets: ["Presets", "The preset gallery will show here."],
  films: ["Films", "Your run folders, ready to finish, will show here."],
  spend: ["Spend", "Daily totals and every job will show here."],
  settings: ["Settings", "Chat connection, limits and provider keys will show here."],
} as const;

export function App() {
  const { tab } = parseRoute(useRoute());
  const { spend, online } = useStudio();
  const [title, next] = SCREENS[tab];
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
      <main className="app__main">
        <Placeholder title={title} next={next} />
      </main>
    </div>
  );
}
