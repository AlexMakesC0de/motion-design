// web/src/film/useEdit.ts
// A film's edit: read it, change it locally at once, and save it a moment
// later (the server answers with every clip placed again). A finished take or
// an export reads it again.
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { EditInput, EditView } from "../api/types";
import { onStudioEvent } from "../app/useStudio";

const SAVE_AFTER_MS = 350;

export const editInput = (e: Pick<EditView, "clips" | "titles">): EditInput => ({
  clips: e.clips.map(({ scene, take, inS, outS, speed, into }) => ({ scene, take, inS, outS, speed, into })),
  titles: e.titles.map(({ kind, text, image, atS, durationS, place }) => ({ kind, text, image, atS, durationS, place })),
});

export function useEdit(slug: string) {
  const [edit, setEdit] = useState<EditView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const url = `/api/films/${encodeURIComponent(slug)}/edit`;

  const load = useCallback(() => {
    const mine = ++seq.current;
    api<EditView>(url)
      .then((e) => mine === seq.current && (setEdit(e), setError(null)))
      .catch((e) => mine === seq.current && setError(e instanceof ApiError ? e.message : String(e)));
  }, [url]);

  useEffect(() => {
    setEdit(null);
    load();
    return () => {
      seq.current++;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  useEffect(
    () =>
      onStudioEvent((e) => {
        if (e.event === "job" && e.data.run === slug && e.data.state === "succeeded") load();
        else if (e.event === "task" && e.data.run === slug && e.data.state !== "running") load();
      }),
    [slug, load],
  );

  /** Change the edit now and save it shortly; quick changes in a row save once. */
  const change = useCallback(
    (next: Pick<EditView, "clips" | "titles">) => {
      setEdit((e) => (e ? { ...e, ...next } : e));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const mine = ++seq.current;
        setSaving(true);
        api<EditView>(url, { method: "PUT", body: editInput(next) })
          .then((e) => mine === seq.current && (setEdit(e), setError(null)))
          .catch((e) => mine === seq.current && setError(e instanceof ApiError ? e.message : String(e)))
          .finally(() => setSaving(false));
      }, SAVE_AFTER_MS);
    },
    [url],
  );

  return { edit, error, saving, change, reload: load };
}
