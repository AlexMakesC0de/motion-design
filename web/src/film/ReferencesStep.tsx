// web/src/film/ReferencesStep.tsx
// Cast: who is in the film. Each shot in the edit as a card: a frame from its
// starred take, the people as its words describe them and what they say.
// Then each Library item the shots use, with its sheet or a way to make one,
// and the pictures uploaded into shots. Nothing here gates generation.
import { useEffect, useMemo, useState } from "react";
import { libraryNames, refLabel, scriptLines, stageLines } from "../../../cli/director/mentions.mjs";
import type { Scene } from "../api/types";
import { shownVersion } from "../scene/Versions";
import { api } from "../api/client";
import type { AssetSummary } from "../api/types";
import { leaveFor } from "../app/back";
import { filmHref, libraryItemHref, libraryNewHref, sceneHref } from "../app/route";
import { onStudioEvent } from "../app/useStudio";
import { kindLabel } from "../library/kinds";
import { useScenes } from "../scene/useScenes";

/** One shot's people: a frame, how its words describe them and the lines they say. */
function ShotCast({ slug, scene, n }: { slug: string; scene: Scene; n: number }) {
  const [open, setOpen] = useState(false);
  const take = shownVersion(scene, null);
  const lines = [...scriptLines(scene), ...stageLines(scene)].map((l) => l.text);
  // A picture is written @{id} in the cards; here it reads as the picture's name.
  const words = (scene.cards.scene.trim() || scene.cards.goal.trim()).replace(/@\{([^}]+)\}/g, (_, id: string) => refLabel(scene.refs.find((r) => r.id === id)) || "the picture");
  return (
    <li className="cast-card">
      <a className="cast-card__frame" href={sceneHref(slug, scene.id)} style={{ aspectRatio: scene.ratio.replace(":", " / ") }} aria-label={`Open shot ${n}: ${scene.title || "Untitled"}`}>
        {take?.media ? <video src={`${take.media}#t=1`} muted playsInline preload="metadata" tabIndex={-1} aria-hidden="true" /> : <span className="cast-card__none">No take yet</span>}
        <span className="cast-card__n mono">{n}</span>
      </a>
      <div className="cast-card__text">
        <h3 className="cast-card__title">{scene.title || "Untitled"}</h3>
        {words ? (
          <p className="cast-card__words" data-open={open || undefined}>
            {words}
          </p>
        ) : (
          <p className="cast-card__words cast-card__words--none">This shot doesn't describe anyone yet.</p>
        )}
        {words.length > 220 && (
          <button type="button" className="button button--quiet cast-card__more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Show less" : "Read all"}
          </button>
        )}
        {lines.length > 0 && (
          <ul className="cast-card__lines" aria-label="Lines spoken">
            {lines.map((l, i) => (
              <li key={i}>“{l}”</li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

export function ReferencesStep({ slug, inFilm = null }: { slug: string; inFilm?: string[] | null }) {
  const { scenes, loading, error } = useScenes(slug);
  const [library, setLibrary] = useState<AssetSummary[] | null>(null);

  useEffect(() => {
    const load = () => api<AssetSummary[]>("/api/library").then(setLibrary).catch(() => setLibrary([]));
    load();
    return onStudioEvent((e) => {
      if (e.event === "library") load();
    });
  }, []);

  const byName = useMemo(() => new Map((library ?? []).map((a) => [a.name, a])), [library]);
  // Each item once, in the order the scenes first use it, with the scenes (by place) that use it.
  const items = useMemo(() => {
    const uses = new Map<string, number[]>();
    scenes.forEach((s, i) => {
      for (const name of libraryNames(s)) uses.set(name, [...(uses.get(name) ?? []), i + 1]);
    });
    return [...uses].map(([name, places]) => ({ name, places, asset: byName.get(name) }));
  }, [scenes, byName]);
  const files = scenes.flatMap((s, i) => s.refs.filter((r) => r.source?.startsWith("file:")).map((r) => ({ scene: s, n: i + 1, ref: r })));
  const missing = items.filter((it) => !it.asset?.hasSheet).length;

  if (loading || library === null) return <p className="film-step__loading">Loading the cast…</p>;
  const shown = inFilm ? scenes.filter((s) => inFilm.includes(s.id)) : scenes;
  const others = inFilm ? scenes.filter((s) => !inFilm.includes(s.id)) : [];
  const place = (s: Scene) => scenes.indexOf(s) + 1;

  return (
    <section className="refs-step" aria-labelledby="refs-h">
      {scenes.length > 0 && (
        <>
          <div className="refs-step__head">
            <h2 id="cast-h">In the film</h2>
            <p className="refs-step__summary">
              {items.length === 0 ? "Everyone here is described in words, so Seedance invents their look from each shot's text." : "The people each shot describes. Library items with a sheet keep the same face from shot to shot."}
            </p>
          </div>
          <ul className="cast-list" aria-labelledby="cast-h">
            {shown.map((s) => (
              <ShotCast key={s.id} slug={slug} scene={s} n={place(s)} />
            ))}
          </ul>
          {others.length > 0 && (
            <details className="cast-others">
              <summary>Shots not in the edit · {others.length}</summary>
              <ul className="cast-list">
                {others.map((s) => (
                  <ShotCast key={s.id} slug={slug} scene={s} n={place(s)} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <div className="refs-step__head">
        <h2 id="refs-h">Library cast &amp; props</h2>
        <p className="refs-step__summary">
          {items.length === 0
            ? "No shot uses a Library item. To keep a person the same across shots, make them in the Library and mention them as @library:name."
            : missing
              ? `${missing} of ${items.length} ${items.length === 1 ? "item needs" : "items need"} a sheet. You can still draft; a scene with a missing sheet is refused until it has one.`
              : `Every item the scenes use has a sheet.`}
        </p>
      </div>
      {error && (
        <p className="film-step__error" role="alert">
          {error}
        </p>
      )}

      {items.length > 0 && (
        <ul className="refs-step__list" aria-label="Library items">
          {items.map(({ name, places, asset }) => (
            <li key={name} className="refs-row">
              {asset?.hasSheet && asset.cover ? <img className="refs-row__thumb" src={asset.cover} alt="" loading="lazy" /> : <span className="refs-row__thumb refs-row__thumb--none">no sheet yet</span>}
              <div className="refs-row__text">
                <span className="mono refs-row__name">@library:{name}</span>
                <span className="refs-row__meta">
                  {asset ? kindLabel(asset.kind) : "not in the Library"} · used in{" "}
                  {places.map((n, i) => (
                    <span key={n}>
                      {i > 0 && ", "}
                      <a href={sceneHref(slug, scenes[n - 1].id)}>shot {n}</a>
                    </span>
                  ))}
                </span>
              </div>
              {asset?.hasSheet ? (
                <span className="refs-row__done">
                  <span aria-hidden="true">✓</span> Sheet
                </span>
              ) : (
                <button type="button" className="button" onClick={() => leaveFor(asset ? libraryItemHref(name) : libraryNewHref(name), "Cast")}>
                  {asset ? "Make its sheet" : `Make @library:${name}`}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <>
          <h3 className="refs-step__sub">Pictures in shots</h3>
          <ul className="refs-step__list" aria-label="Pictures in shots">
            {files.map(({ scene, n, ref }) => (
              <li key={`${scene.id}-${ref.id}`} className="refs-row">
                <img className="refs-row__thumb" src={`/media/runs/${encodeURIComponent(slug)}/${ref.source!.slice("file:".length)}`} alt="" loading="lazy" />
                <div className="refs-row__text">
                  <span className="refs-row__name">{refLabel(ref)}</span>
                  <span className="refs-row__meta">
                    <a href={sceneHref(slug, scene.id)}>shot {n}</a>
                    {ref.keep ? ` · keeps ${ref.keep}` : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <a className="button button--light button--lg refs-step__next" href={filmHref(slug, "scenes")}>
        Next: Shots →
      </a>
    </section>
  );
}
