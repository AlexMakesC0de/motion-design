import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_REFS, attachLibraryMentions, cardTexts, mapCardTexts, nextRefId, removeRef, toStored } from "../../../cli/director/mentions.mjs";
import { DURATION, RATIOS, emptyScene } from "../../../cli/director/scene-shape.mjs";
import { api } from "../api/client";
import type { AssetSummary, Cards, Ref, Scene, ScenePreview, Span } from "../api/types";
import { libraryItemHref, libraryNewHref } from "../app/route";
import { onStudioEvent } from "../app/useStudio";
import { RefChooser } from "./RefChooser";
import { LooseInput, SceneCards } from "./SceneCards";
import { SceneRefs } from "./SceneRefs";
import { Versions } from "./Versions";
import { useScenes } from "./useScenes";
import "./scene.css";

/** The preview (prices and problems) is asked for this long after the scene last changed. */
const PREVIEW_PAUSE_MS = 500;
const LENGTHS = Array.from({ length: DURATION.max - DURATION.min + 1 }, (_, i) => DURATION.min + i);

/** Which slot the chooser fills: a ref by id, or a new one at the end. */
type Choosing = { refId: string | null; n: number };

/** With stages, the length is their sum; without, it stays in Seedance's range. */
function fit(s: Scene): Scene {
  const stages = s.cards.stages;
  const durationS = stages.length
    ? stages.reduce((n, st) => n + st.seconds, 0)
    : Math.min(DURATION.max, Math.max(DURATION.min, s.durationS));
  return durationS === s.durationS ? s : { ...s, durationS };
}

/**
 * One scene at a time: its references on the left, the cards in the centre,
 * versions and the two spending buttons on the right. Edits save as you go.
 */
export function SceneScreen({ run }: { run: string }) {
  const { scenes, loading, error, create, save, preview, draft, final, choose, uploadRef } = useScenes(run);
  const [library, setLibrary] = useState<AssetSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<Choosing | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [shownPreview, setShownPreview] = useState<{ id: string; data: ScenePreview } | null>(null);

  const scene = scenes.find((s) => s.id === selectedId) ?? scenes[0] ?? null;

  // The newest copy of the scene, ahead of React's: a field's blur commits its
  // text and then attaches its Library mentions in the same event.
  const latest = useRef<Scene | null>(scene);
  latest.current = scene;

  const update = useCallback(
    (change: (s: Scene) => Scene) => {
      const cur = latest.current;
      if (!cur) return;
      const next = fit(change(cur));
      if (next === cur) return;
      latest.current = next;
      save(next);
    },
    [save],
  );

  // The Library, with covers; the live event carries no covers, so it only says when to reload.
  useEffect(() => {
    const load = () => api<AssetSummary[]>("/api/library").then(setLibrary).catch(() => {});
    load();
    return onStudioEvent((e) => {
      if (e.event === "library") load();
    });
  }, []);
  const byName = useMemo(() => new Map(library.map((a) => [a.name, a])), [library]);
  const items = useMemo(() => new Map(library.map((a) => [a.name, { hasSheet: Boolean(a.hasSheet) }])), [library]);

  const newScene = useCallback(
    (count: number, ratio?: string) =>
      create({ ...emptyScene(), ...(ratio ? { ratio } : {}), title: `Scene ${count + 1}` })
        .then((s) => setSelectedId(s.id))
        .catch((e: Error) => setNote(e.message)),
    [create],
  );

  // A first visit finds no scene: make one, so there is somewhere to write. Once per run.
  const madeFirst = useRef<string | null>(null);
  useEffect(() => {
    if (loading || error || scenes.length || madeFirst.current === run) return;
    madeFirst.current = run;
    void newScene(0);
  }, [loading, error, scenes.length, run, newScene]);

  // Prices and problems for what is on screen, asked for once typing pauses.
  useEffect(() => {
    if (!scene) return;
    let live = true;
    const t = setTimeout(() => {
      preview(scene.id)
        .then((data) => live && setShownPreview({ id: scene.id, data }))
        .catch((e: Error) => live && setNote(e.message));
    }, PREVIEW_PAUSE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [scene, preview]);

  const onText = useCallback(
    (change: (c: Cards) => Cards, refs: Ref[] | null) =>
      update((s) => {
        const next = { ...s, cards: change(s.cards), refs: refs ?? s.refs };
        return refs ? attachLibraryMentions(next) : next;
      }),
    [update],
  );

  const onSettle = useCallback(() => update((s) => attachLibraryMentions(s)), [update]);

  /** A whole prompt in Dan's sections replaces the cards; its image numbers become empty slots, in order across cards. */
  const onPasteWhole = (cards: Cards) => {
    const cur = latest.current;
    if (!cur) return;
    if (cardTexts(cur.cards).some((t) => t.trim()) && !window.confirm("Replace this scene's cards with the pasted prompt?")) return;
    update((s) => {
      let refs = s.refs;
      const settled = mapCardTexts(cards, (t) => {
        const r = toStored(t, refs, { settle: true });
        refs = r.refs;
        return r.text;
      });
      return attachLibraryMentions({ ...s, refs, cards: settled });
    });
  };

  /** A red mention was clicked: choose a picture for its slot, or go and make the Library item. */
  const onChoose = (span: Span) => {
    const cur = latest.current;
    if (!cur) return;
    if (span.kind === "library") {
      window.location.hash = span.reason === "no sheet yet" ? libraryItemHref(span.name ?? "") : libraryNewHref(span.name ?? "");
      return;
    }
    const at = span.refId ? cur.refs.findIndex((r) => r.id === span.refId) : -1;
    if (at >= 0) {
      setChoosing({ refId: span.refId, n: at + 1 });
      return;
    }
    const n = span.n ?? 0;
    if (n < 1 || n > MAX_REFS) {
      setNote(`A scene holds at most ${MAX_REFS} images, so there is no image ${n}.`);
      return;
    }
    // No slot yet (typed "@image3" with two images): add empty ones up to it, bind the mentions, then choose.
    const refs = [...cur.refs];
    while (refs.length < n) refs.push({ id: nextRefId(refs), source: null });
    update((s) => ({ ...s, refs, cards: mapCardTexts(s.cards, (t) => toStored(t, refs).text) }));
    setChoosing({ refId: refs[n - 1].id, n });
  };

  const onPick = (source: string) => {
    const c = choosing;
    setChoosing(null);
    if (!c) return;
    update((s) => {
      if (c.refId) return { ...s, refs: s.refs.map((r) => (r.id === c.refId ? { ...r, source } : r)) };
      if (s.refs.length >= MAX_REFS) return s;
      return { ...s, refs: [...s.refs, { id: nextRefId(s.refs), source }] };
    });
  };

  const onMove = (i: number, by: -1 | 1) =>
    update((s) => {
      const j = i + by;
      if (j < 0 || j >= s.refs.length) return s;
      const refs = [...s.refs];
      [refs[i], refs[j]] = [refs[j], refs[i]];
      return { ...s, refs };
    });

  const onRemove = (id: string) => {
    const cur = latest.current;
    if (!cur) return;
    const n = cur.refs.findIndex((r) => r.id === id) + 1;
    const used = cardTexts(cur.cards).some((t) => t.includes(`@{${id}}`));
    if (used && !window.confirm(`image ${n} is used in the prompt. Remove it? Its mentions become plain words.`)) return;
    update((s) => removeRef(s, id));
  };

  const onKeep = (id: string, keep: string) => update((s) => ({ ...s, refs: s.refs.map((r) => (r.id === id ? { ...r, keep } : r)) }));

  const onUpload = async (file: File) => {
    setNote(null);
    try {
      const source = await uploadRef(file);
      update((s) => (s.refs.length >= MAX_REFS ? s : { ...s, refs: [...s.refs, { id: nextRefId(s.refs), source }] }));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };

  const problem = error ?? note;

  if (!scene) {
    return (
      <div className="scene scene--empty">
        {/* Not an alert: when the server is down, App's banner is the one alert. */}
        <p className={problem ? "scene-failure" : "scene-hint"}>{problem ?? (loading ? "Loading scenes…" : "Making a first scene…")}</p>
      </div>
    );
  }

  return (
    <div className="scene">
      <div className="scene__col scene__col--refs">
        <SceneRefs
          run={run}
          refs={scene.refs}
          library={byName}
          onMove={onMove}
          onRemove={onRemove}
          onKeep={onKeep}
          onChoose={(id) => setChoosing({ refId: id, n: scene.refs.findIndex((r) => r.id === id) + 1 })}
          onAdd={() => setChoosing({ refId: null, n: scene.refs.length + 1 })}
          onUpload={onUpload}
        />
      </div>

      <div className="scene__col scene__col--cards">
        <div className="scene-tabs">
          <div className="scene-tabs__list" role="tablist" aria-label="Scenes">
            {scenes.map((s, i) => (
              <button key={s.id} type="button" role="tab" className="scene-tab" aria-selected={s.id === scene.id} onClick={() => setSelectedId(s.id)}>
                <span className="mono">{i + 1}</span> {s.title || "Untitled"}
              </button>
            ))}
          </div>
          <button type="button" className="scene-tab scene-tab--new" aria-label="New scene" onClick={() => void newScene(scenes.length, scene.ratio)}>
            +
          </button>
        </div>

        {problem && (
          <div className="scene-failure" role="alert">
            <p>{problem}</p>
            {note && (
              <button type="button" className="button button--quiet" onClick={() => setNote(null)}>
                Dismiss
              </button>
            )}
          </div>
        )}

        <div className="scene-title">
          <LooseInput className="scene-title__input" aria-label="Scene title" placeholder="Untitled scene" value={scene.title} onValue={(title) => update((s) => ({ ...s, title }))} />
          <span className="scene-title__data mono">{`${scene.durationS}s · ${scene.ratio} · Seedance 2.5`}</span>
        </div>
        <div className="scene-settings">
          <label className="scene-setting">
            <span>Ratio</span>
            <select className="scene-input" aria-label="Ratio" value={scene.ratio} onChange={(e) => update((s) => ({ ...s, ratio: e.target.value }))}>
              {RATIOS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          {scene.cards.stages.length === 0 && (
            <label className="scene-setting">
              <span>Length</span>
              <select className="scene-input" aria-label="Length" value={scene.durationS} onChange={(e) => update((s) => ({ ...s, durationS: Number(e.target.value) }))}>
                {LENGTHS.map((n) => (
                  <option key={n} value={n}>{n}s</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <SceneCards scene={scene} items={items} onText={onText} onScene={update} onChoose={onChoose} onPasteWhole={onPasteWhole} onSettle={onSettle} />
      </div>

      <div className="scene__col scene__col--versions">
        <Versions
          key={scene.id}
          scene={scene}
          preview={shownPreview?.id === scene.id ? shownPreview.data : null}
          onDraft={() => draft(scene.id)}
          onFinal={(resolution) => final(scene.id, resolution)}
          onChoose={(job) => choose(scene.id, job)}
        />
      </div>

      {choosing && <RefChooser n={choosing.n} library={library} onPick={onPick} onUpload={uploadRef} onClose={() => setChoosing(null)} />}
    </div>
  );
}
