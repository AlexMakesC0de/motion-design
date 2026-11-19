// What both making pages load once: the films, the catalog, the Library, core's
// vocabulary, the looks (short styles) and the ad templates (whole films to adapt). The banner in App reports a server that is down; these just stay empty.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { AssetSummary, LooksView, ModelInfo, PresetInfo, RunSummary, Vocab } from "../api/types";
import { onStudioEvent } from "../app/useStudio";
import { getRun, setRun } from "./promptStore";

export function useStudioData() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [vocab, setVocab] = useState<Vocab>({ kinds: [], roles: [] });
  const [templates, setTemplates] = useState<PresetInfo[]>([]);
  const [looks, setLooks] = useState<LooksView>({ categories: [], looks: [] });

  const loadRuns = useCallback(
    () =>
      api<RunSummary[]>("/api/runs")
        .then((list) => {
          setRuns(list);
          if (!getRun() && list.length) setRun(list[0].run); // first visit: the newest film
        })
        .catch(() => {}),
    [],
  );

  useEffect(() => {
    loadRuns();
    // An answer of the wrong shape (a server mid-restart) keeps the empty default.
    const list = <T,>(set: (v: T[]) => void) => (v: T[] | null) => Array.isArray(v) && set(v);
    api<ModelInfo[]>("/api/models").then(list(setModels)).catch(() => {});
    api<AssetSummary[]>("/api/library").then(list(setAssets)).catch(() => {});
    api<Vocab>("/api/vocab").then((v) => v && Array.isArray(v.roles) && setVocab(v)).catch(() => {});
    api<PresetInfo[]>("/api/presets").then(list(setTemplates)).catch(() => {});
    api<LooksView>("/api/looks").then((v) => v && Array.isArray(v.looks) && setLooks(v)).catch(() => {});
  }, [loadRuns]);

  // The stream's library list has no covers; keep the ones already loaded.
  useEffect(
    () =>
      onStudioEvent((e) => {
        if (e.event !== "library") return;
        setAssets((held) => e.data.map((a) => ({ ...a, cover: a.cover ?? held.find((h) => h.name === a.name)?.cover ?? null })));
      }),
    [],
  );

  return { runs, models, assets, vocab, looks, templates, loadRuns };
}
