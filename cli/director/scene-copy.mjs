// Create's "Save into film": a scene, its pictures and its versions copied
// into a film. The copy stands on its own: the scene's uploaded pictures go
// into the film's refs folder and each version's video into the film, so the
// film shows them in Projects and on Finish. The original is left as it was.
import { copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { extname, join } from "node:path";
import { insertScene } from "./scenes.mjs";
import { findScene, freeName } from "./scene-make.mjs";
import { RUNS_DIR, isInside, runDir } from "../lib/run.mjs";
import { unknown } from "../lib/errors.mjs";

/** A plain file inside runs/, never a link; else null. */
function plainFile(path) {
  if (!path || !existsSync(path)) return null;
  const st = lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink()) return null;
  return isInside(realpathSync(path), realpathSync(RUNS_DIR)) ? path : null;
}

/** The file a version shows: its own copy in the film when it has one, else its job's first artifact. */
export function versionFile(film, version, store) {
  if (version.file) {
    const own = plainFile(join(runDir(film, { create: false }), version.file));
    if (own) return own;
  }
  try {
    return plainFile(store.get(version.job)?.artifacts?.[0]);
  } catch {
    return null; // a version whose job record is gone
  }
}

/**
 * Copy scene `id` of film `from` into film `to` (made if missing) as its next
 * scene. Returns the new scene. A picture or video that is gone is left out:
 * its slot is emptied, or its version keeps only the job id.
 */
export function copyScene(from, id, to, { store }) {
  if (from === to) throw unknown("The scene is already in that film.", { field: "to" });
  const scene = findScene(from, id);
  const fromRefs = join(runDir(from, { create: false }), "refs");
  return insertScene(to, (newId) => {
    const dir = runDir(to);
    const refsDir = join(dir, "refs");
    const refs = scene.refs.map((r) => {
      if (!r.source?.startsWith("file:refs/")) return r;
      const src = plainFile(join(fromRefs, r.source.slice("file:refs/".length)));
      if (!src) return { ...r, source: null };
      mkdirSync(refsDir, { recursive: true });
      const ext = extname(src);
      const name = freeName(realpathSync(refsDir), r.source.slice("file:refs/".length, -ext.length || undefined), ext);
      copyFileSync(src, join(refsDir, name));
      return { ...r, source: `file:refs/${name}` };
    });
    const versions = scene.versions.map((v) => {
      const { file: _old, ...rest } = v;
      const src = versionFile(from, v, store);
      if (!src) return rest;
      const name = freeName(realpathSync(dir), `${newId}-${v.kind}`, extname(src));
      copyFileSync(src, join(dir, name));
      return { ...rest, file: name };
    });
    return { title: scene.title, durationS: scene.durationS, ratio: scene.ratio, refs, cards: scene.cards, versions, chosen: scene.chosen };
  });
}
