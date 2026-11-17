// web/src/film/ReferencesStep.tsx
// A film's References: each Library item its scenes use, with its sheet or a
// way to make one, and the pictures uploaded into each scene. Nothing here
// gates generation; it shows what is missing.
import { useEffect, useMemo, useState } from "react";
import { libraryNames, refLabel } from "../../../cli/director/mentions.mjs";
import { api } from "../api/client";
import type { AssetSummary } from "../api/types";
import { leaveFor } from "../app/back";
import { filmHref, libraryItemHref, libraryNewHref, sceneHref } from "../app/route";
import { onStudioEvent } from "../app/useStudio";
import { kindLabel } from "../library/kinds";
import { useScenes } from "../scene/useScenes";

export function ReferencesStep({ slug }: { slug: string }) {
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

  if (loading || library === null) return <p className="film-step__loading">Loading references…</p>;

  return (
    <section className="refs-step" aria-labelledby="refs-h">
      <div className="refs-step__head">
        <h2 id="refs-h">Cast &amp; props</h2>
        <p className="refs-step__summary">
          {items.length === 0
            ? "No scene uses a Library item yet. Mention one as @library:name in a scene's cards."
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
                      <a href={sceneHref(slug, scenes[n - 1].id)}>scene {n}</a>
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
          <h3 className="refs-step__sub">Pictures in scenes</h3>
          <ul className="refs-step__list" aria-label="Pictures in scenes">
            {files.map(({ scene, n, ref }) => (
              <li key={`${scene.id}-${ref.id}`} className="refs-row">
                <img className="refs-row__thumb" src={`/media/runs/${encodeURIComponent(slug)}/${ref.source!.slice("file:".length)}`} alt="" loading="lazy" />
                <div className="refs-row__text">
                  <span className="refs-row__name">{refLabel(ref)}</span>
                  <span className="refs-row__meta">
                    <a href={sceneHref(slug, scene.id)}>scene {n}</a>
                    {ref.keep ? ` · keeps ${ref.keep}` : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <a className="idea__next" href={filmHref(slug, "scenes")}>
        Next: Scenes →
      </a>
    </section>
  );
}
