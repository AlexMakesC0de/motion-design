import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_REFS, attachLibraryMentions, cardTexts, mapCardTexts, nextRefId, removeRef, toStored } from "../../../cli/director/mentions.mjs";
import { hasPicks } from "../../../cli/director/picks.mjs";
import { DURATION, RATIOS, emptyScene } from "../../../cli/director/scene-shape.mjs";
import { api } from "../api/client";
import type { AssetSummary, Cards, Ref, Scene, ScenePreview, Span, VoiceAs } from "../api/types";
import { libraryItemHref, libraryNewHref } from "../app/route";
import { leaveFor } from "../app/back";
import { onStudioEvent } from "../app/useStudio";
import { RefChooser } from "./RefChooser";
import { SaveIntoFilm } from "./SaveIntoFilm";
import { LooseInput, SceneCards, StageTimeline, addStage, gel } from "./SceneCards";
import { SceneRefs } from "./SceneRefs";
import { Icon } from "../app/icons";
import { MakeAlerts, MakeBar, Player, VersionList, shownVersion, useMaking, versionNames } from "./Versions";
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
export function SceneScreen({ run, initialId, saveInto = false, autoFirst = true, inFilm }: {
  run: string;
  /** The scene to open (#/films/<slug>/scenes/<id>). */
  initialId?: string;
  /** Create's scratch scenes offer "Save into film". */
  saveInto?: boolean;
  /** Make a first scene on a first visit (Create); a film shows an empty state instead. */
  autoFirst?: boolean;
  /** A film's Shots step: the shot ids its edit plays (null until the edit loads). Create leaves it out. */
  inFilm?: string[] | null;
}) {
  const film = inFilm !== undefined;
  const { scenes, loading, error, flush, create, save, preview, draft, final, choose, uploadRef } = useScenes(run);
  const [library, setLibrary] = useState<AssetSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (initialId) setSelectedId(initialId);
  }, [initialId]);
  const [choosing, setChoosing] = useState<Choosing | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [shownPreview, setShownPreview] = useState<{ id: string; data: ScenePreview } | null>(null);

  const scene = scenes.find((s) => s.id === selectedId) ?? scenes[0] ?? null;
  // The version in the player and the stage open in the notes, both per scene.
  const [picked, setPicked] = useState<{ scene: string; job: string } | null>(null);
  const [openStage, setOpenStage] = useState<{ scene: string; i: number } | null>(null);
  const shownVoices = scene && shownPreview?.id === scene.id ? shownPreview.data.voices : undefined;
  const making = useMaking({
    preview: scene && shownPreview?.id === scene.id ? shownPreview.data : null,
    onDraft: () => draft(scene!.id),
    onFinal: (resolution) => final(scene!.id, resolution),
    onChoose: (job) => choose(scene!.id, job),
  });

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
    if (!autoFirst || loading || error || scenes.length || madeFirst.current === run) return;
    madeFirst.current = run;
    void newScene(0);
  }, [autoFirst, loading, error, scenes.length, run, newScene]);

  // Prices and problems for what is on screen, asked for once typing pauses. Only the
  // wording counts as a change: a take's progress refreshes the scene every second
  // while it films, and that used to hold the price back ("no price") the whole time.
  const sceneId = scene?.id ?? null;
  const wording = scene ? JSON.stringify({ ...scene, versions: undefined, chosen: undefined }) : "";
  useEffect(() => {
    if (!sceneId) return;
    let live = true;
    const t = setTimeout(() => {
      preview(sceneId)
        .then((data) => live && setShownPreview({ id: sceneId, data }))
        .catch((e: Error) => live && setNote(e.message));
    }, PREVIEW_PAUSE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [sceneId, wording, preview]);

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
    if ((cardTexts(cur.cards).some((t) => t.trim()) || hasPicks(cur.cards)) && !window.confirm("Replace this scene's cards with the pasted prompt?")) return;
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
      leaveFor(span.reason === "no sheet yet" ? libraryItemHref(span.name ?? "") : libraryNewHref(span.name ?? ""), "the scene");
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
    const empty = !autoFirst && !loading && !problem;
    return (
      <div className="scene scene--empty">
        {/* Not an alert: when the server is down, App's banner is the one alert. */}
        <p className={problem ? "scene-failure" : "scene-hint"}>
          {problem ?? (loading ? "Loading scenes…" : empty ? "No scenes yet. Plan them on the Idea step, or start one here." : "Making a first scene…")}
        </p>
        {empty && (
          <button type="button" className="button" onClick={() => void newScene(0)}>
            <Icon name="plus" size={16} />
            New scene
          </button>
        )}
      </div>
    );
  }

  const stageCount = scene.cards.stages.length;
  const stage = stageCount ? Math.min(openStage?.scene === scene.id ? openStage.i : 0, stageCount - 1) : null;
  const shown = shownVersion(scene, picked?.scene === scene.id ? picked.job : null);
  const shownName = shown ? versionNames(scene.versions)[scene.versions.indexOf(shown)] : "";
  const sceneNo = scenes.indexOf(scene) + 1;

  return (
    <div className="scene">
      <nav className="scene-strip" aria-label={film ? "Shots in this film" : "Scenes"}>
        <h2 className="scene-head">
          {film ? "Shots" : "Scenes"}{" "}
          <span className="scene-head__n">
            {film && inFilm ? `${scenes.filter((s) => inFilm.includes(s.id)).length} of ${scenes.length} in the edit` : `${scenes.reduce((n, s) => n + s.durationS, 0)}s`}
          </span>
        </h2>
        <div className="scene-strip__list" role="tablist" aria-label="Scenes" aria-orientation="vertical">
          {scenes.map((s, i) => {
            const cover = shownVersion(s, null);
            const takes = s.versions.length === 0 ? "No takes yet" : `${s.versions.length} take${s.versions.length === 1 ? "" : "s"}${s.chosen ? " · starred" : ""}`;
            const spare = Boolean(inFilm && s.versions.some((v) => v.state === "succeeded") && !inFilm.includes(s.id));
            const status = inFilm?.includes(s.id) ? `In the edit · ${takes}` : spare ? `Not in the edit · ${takes}` : takes;
            return (
              <button key={s.id} type="button" role="tab" className="scene-tab" data-spare={spare || undefined} aria-selected={s.id === scene.id} aria-label={`${i + 1} ${s.title || "Untitled"}`} onClick={() => setSelectedId(s.id)}>
                <span className="scene-tab__thumb" style={{ aspectRatio: s.ratio.replace(":", " / ") }}>
                  {cover?.media && <video src={`${cover.media}#t=1`} muted playsInline preload="metadata" tabIndex={-1} aria-hidden="true" />}
                  <span className="scene-tab__n mono">{i + 1}</span>
                  <span className="scene-tab__len mono">{s.durationS}s</span>
                </span>
                <span className="scene-tab__title">{s.title || "Untitled"}</span>
                <span className="scene-tab__meta">{status}</span>
                {s.cards.stages.length > 0 && (
                  <span className="scene-tab__gels" aria-hidden="true">
                    {s.cards.stages.map((st, j) => (
                      <i key={j} style={{ flexGrow: st.seconds, background: gel(j) }} />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button type="button" className="scene-strip__new" aria-label={film ? "New shot" : "New scene"} onClick={() => void newScene(scenes.length, scene.ratio)}>
          <Icon name="plus" size={16} />
          {film ? "New shot" : "New scene"}
        </button>
      </nav>

      <section className="scene-stage" aria-label={`Scene ${sceneNo}`}>
        <div className="scene-stage__scroll">
          <div className="scene-title">
            <LooseInput className="scene-title__input" aria-label="Scene title" placeholder="Untitled scene" value={scene.title} onValue={(title) => update((s) => ({ ...s, title }))} />
            <label className="chip-select">
              Shape
              <select aria-label="Ratio" value={scene.ratio} onChange={(e) => update((s) => ({ ...s, ratio: e.target.value }))}>
                {RATIOS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
            {stageCount === 0 ? (
              <label className="chip-select">
                Length
                <select aria-label="Length" value={scene.durationS} onChange={(e) => update((s) => ({ ...s, durationS: Number(e.target.value) }))}>
                  {LENGTHS.map((n) => (
                    <option key={n} value={n}>{n}s</option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="scene-title__data mono" title="The stages set the length">{scene.durationS}s</span>
            )}
            {(shownVoices?.length ?? 0) > 0 && (
              <label className="chip-select" title="A talking clip is the character saying a few lines in their voice, made once in their Voice panel; a voice card is a black video with the name and the voice. Either one's seconds are billed on top of the scene's.">
                Voice
                <select aria-label="Send the voice as" value={scene.voiceAs ?? "clip"} onChange={(e) => update((s) => ({ ...s, voiceAs: e.target.value as VoiceAs }))}>
                  <option value="clip">Talking clip, else card</option>
                  <option value="card">Voice card</option>
                  <option value="file">Voice file · cheaper</option>
                </select>
              </label>
            )}
            <span className="scene-title__model">Seedance 2.5</span>
            {saveInto && (
              <button type="button" className="button scene-title__save" onClick={() => void flush().then(() => setSaving(true))}>
                Save into film…
              </button>
            )}
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

          <Player scene={scene} version={shown} name={shownName} onChoose={(job) => void making.choose(job)} />
          <StageTimeline
            scene={scene}
            stage={stage}
            onStage={(i) => {
              setOpenStage({ scene: scene.id, i });
              // Bring the stage's notes into view, in case the column was scrolled away from them.
              requestAnimationFrame(() => document.querySelector(".scene-card--stage")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }));
            }}
            onAdd={() => {
              update(addStage);
              setOpenStage({ scene: scene.id, i: stageCount });
            }}
          />
          <VersionList scene={scene} shown={shown?.job ?? null} onShow={(job) => setPicked({ scene: scene.id, job })} onChoose={(job) => void making.choose(job)} />
        </div>
        <div className="scene-dock">
          <MakeAlerts making={making} />
          <MakeBar making={making} />
        </div>
      </section>

      <aside className="scene-notes" aria-label="Director's notes">
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
        <SceneCards key={scene.id} scene={scene} items={items} stage={stage} onText={onText} onScene={update} onChoose={onChoose} onPasteWhole={onPasteWhole} onSettle={onSettle} />
      </aside>

      {saving && <SaveIntoFilm run={run} scene={scene} onClose={() => setSaving(false)} />}
      {choosing && <RefChooser n={choosing.n} library={library} onPick={onPick} onUpload={uploadRef} onClose={() => setChoosing(null)} />}
    </div>
  );
}
