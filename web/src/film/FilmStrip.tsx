// web/src/film/FilmStrip.tsx
// The film as it plays, along the bottom of every step but Edit: each clip as
// a frame from its take, as wide as it plays, and the total against the
// length the Idea aims for. A clip opens its shot.
import type { EditView } from "../api/types";
import { sceneHref } from "../app/route";
import { seconds } from "./editMath";

export function FilmStrip({ slug, edit, targetS, here }: { slug: string; edit: EditView; targetS: number | null; here?: string | null }) {
  const clips = edit.clips.filter((c) => c.lengthS > 0 || c.missing);
  const total = edit.lengthS;
  return (
    <section className="filmstrip" aria-label="The film">
      <div className="filmstrip__head">
        <h2 className="filmstrip__title">The film</h2>
        <span className="filmstrip__len mono">
          {seconds(total)}
          {targetS ? ` of ${targetS}s` : ""}
        </span>
        {!edit.saved && clips.length > 0 && <span className="filmstrip__note">Every shot whole, in order. Arrange it in Edit.</span>}
        <a className="filmstrip__edit" href={`#/films/${encodeURIComponent(slug)}/finish`}>
          Open Edit
        </a>
      </div>
      {clips.length ? (
        <ol className="filmstrip__lane">
          {clips.map((c) => (
            <li key={c.id} className="filmstrip__clip" style={{ flexGrow: Math.max(c.lengthS, 0.6) }} data-here={c.scene === here || undefined} data-missing={c.missing || undefined}>
              <a href={sceneHref(slug, c.scene)} aria-label={`${c.sceneTitle}, ${seconds(c.lengthS)}`}>
                {c.url && !c.missing ? <video className="filmstrip__frame" src={`${c.url}#t=${c.inS + 0.05}`} preload="metadata" muted playsInline tabIndex={-1} /> : <span className="filmstrip__frame filmstrip__frame--empty" />}
                <span className="filmstrip__label">
                  <span className="filmstrip__name">{c.sceneTitle}</span>
                  <span className="mono">{c.missing ? "no take" : seconds(c.lengthS)}</span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      ) : (
        <p className="filmstrip__empty">Nothing plays yet. A shot joins the film when its first take finishes.</p>
      )}
    </section>
  );
}
