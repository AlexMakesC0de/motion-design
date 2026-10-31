// web/src/app/TopBar.tsx
// Where you are, how many jobs are running, and today's spend.
import type { ReactNode } from "react";
import type { SpendView } from "../api/types";
import { SpendMeter } from "./SpendMeter";

export function TopBar({ children, spend }: { children: ReactNode; spend: SpendView | null }) {
  const running = spend?.unsettled ?? 0;
  return (
    <header className="topbar">
      <div className="topbar__where">{children}</div>
      {running > 0 && (
        <a className="topbar__jobs" href="#/spend">
          {running === 1 ? "1 job running" : `${running} jobs running`}
        </a>
      )}
      <SpendMeter spend={spend} />
    </header>
  );
}
