// The Image page as a conversation: each Generate is a turn. The prompt sits
// on the right with the model, shape, size and price it went out with; the
// picture comes back under it, with Vary, Edit, Use as style and Download.
// Oldest at the top, newest by the dock; a new turn scrolls into view.
import { useEffect, useRef } from "react";
import type { JobView } from "../api/types";
import { Icon } from "../app/icons";
import { modelName } from "../app/modelMeta";
import { clip, takeCost, typicalSeconds } from "./format";
import { addRef, reuseJob } from "./promptStore";
import { TakeTile } from "./TakeTile";

/** The runs-relative path a reference chip takes, from a picture's /media/runs/ URL; null for anything else. */
export function refSourceOf(url: string | undefined): string | null {
  const m = url?.match(/^\/media\/runs\/(.+)$/);
  return m ? m[1].split("/").map(decodeURIComponent).join("/") : null;
}

export function ImageThread({
  takes,
  allJobs,
  now,
  roles,
  onOpen,
  focusPrompt,
}: {
  /** Image takes, newest first (as useJobs keeps them). */
  takes: JobView[];
  /** Every job, for how long a model usually takes. */
  allJobs: JobView[];
  now: number;
  /** The reference roles an image prompt takes (identity, style). */
  roles: string[];
  onOpen: (job: JobView) => void;
  focusPrompt: () => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const turns = [...takes].reverse();
  const newest = takes[0]?.id;

  // A new turn (or the first paint) brings the newest into view.
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView?.({ block: "end" });
  }, [newest]);

  const editRole = roles.includes("identity") ? "identity" : roles[0];
  const styleRole = roles.includes("style") ? "style" : null;
  const attach = (job: JobView, role: string | null | undefined) => {
    const source = refSourceOf(job.media[0]);
    if (!source || !role) return;
    addRef({ source, role });
    focusPrompt();
  };

  return (
    <ol ref={list} className="thread" aria-label="Takes">
      {turns.map((j) => {
        const done = j.state === "succeeded" && j.media[0];
        const meta = [modelName(j.model), j.aspectRatio, j.resolution].filter(Boolean);
        return (
          <li key={j.id} className="turn">
            <div className="turn__ask">
              <p className="turn__prompt">{j.prompt ? clip(j.prompt, 600) : <span className="turn__none">No prompt</span>}</p>
              <p className="turn__meta mono">
                {meta.join(" · ")} · <span className="turn__cost">{takeCost(j)}</span>
              </p>
            </div>
            <div className="turn__answer">
              <TakeTile job={j} now={now} spec={false} expectedS={typicalSeconds(allJobs, j.model, j.capability)} onOpen={onOpen} />
              {done && (
                <div className="turn__actions" role="group" aria-label="With this picture">
                  <button
                    type="button"
                    className="turn__action"
                    title="Put this prompt and its settings back in the box"
                    onClick={() => {
                      reuseJob(j);
                      focusPrompt();
                    }}
                  >
                    <Icon name="vary" size={16} /> Vary
                  </button>
                  {editRole && refSourceOf(j.media[0]) && (
                    <button type="button" className="turn__action" title="Attach this picture to your next prompt, to change it" onClick={() => attach(j, editRole)}>
                      <Icon name="edit" size={16} /> Edit
                    </button>
                  )}
                  {styleRole && refSourceOf(j.media[0]) && (
                    <button type="button" className="turn__action" title="Attach this picture as a style for your next prompt" onClick={() => attach(j, styleRole)}>
                      <Icon name="image" size={16} /> Use as style
                    </button>
                  )}
                  <a className="turn__action" href={j.media[0]} download>
                    <Icon name="download" size={16} /> Download
                  </a>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
