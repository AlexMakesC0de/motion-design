// What both making pages load once: the films, the catalog, the Library, core's
// vocabulary and the looks. The banner in App reports a server that is down; these just stay empty.
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { AssetSummary, ModelInfo, PresetInfo, RunSummary, Vocab } from "../api/types";
import { onStudioEvent } from "../app/useStudio";
import { getRun, setRun } from "./promptStore";

export function useStudioData() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [vocab, setVocab] = useState<Vocab>({ kinds: [], roles: [] });
  const [looks, setLooks] = useState<PresetInfo[]>([]);

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
    api<ModelInfo[]>("/api/models").then(setModels).catch(() => {});
    api<AssetSummary[]>("/api/library").then(setAssets).catch(() => {});
    api<Vocab>("/api/vocab").then(setVocab).catch(() => {});
    api<PresetInfo[]>("/api/presets").then(setLooks).catch(() => {});
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

  return { runs, models, assets, vocab, looks, loadRuns };
}
