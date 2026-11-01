// Scenes, as in the studio's Create > Scene tab: one Seedance 2.5
// reference-to-video generation each. Reading, editing and the prompt
// preview are free; draft_scene and final_scene spend kie credits.
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { readScenes, saveScene, deleteScene, chooseVersion, RATIOS } from "../cli/director/scenes.mjs";
import { compileFor, scenePrices, makeScene, findScene, addSceneImage, FINALS } from "../cli/director/scene-make.mjs";
import { RUNS_DIR } from "../cli/lib/run.mjs";
import { uploadFile } from "../cli/lib/upload.mjs";
import { ok } from "./results.mjs";
import { stoppable } from "./stop.mjs";

const LOOK = { readOnlyHint: true, openWorldHint: false };
const LOCAL_WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const LOCAL_DELETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
const SPEND = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

const MENTIONS =
  'In the cards, @{r1} is the scene image whose id is r1 and @library:name is a Library item (added as an image by itself). ' +
  'Dialogue is written @{r1} says {"line"}.';

export function registerScenes(tool, { catalog, ctx, deps = {} }) {
  const run = z.string().describe('The film\'s run folder slug. The studio\'s Create tab uses "create".');
  const id = z.string().describe("A scene id, such as s1.");
  const Data = z.record(z.string(), z.unknown());
  const Scene = {
    id: z.string(),
    title: z.string(),
    durationS: z.number(),
    ratio: z.string(),
    refs: z.array(Data),
    cards: Data,
    versions: z.array(Data),
    chosen: z.string().nullable(),
  };
  const Stage = z.object({
    title: z.string(),
    seconds: z.number().int().min(1),
    camera: z.string(),
    action: z.string(),
    end: z.string(),
  });
  const Ref = z.object({
    id: z.string().describe("r1, r2…"),
    source: z.string().nullable().describe("library:<name>, file:refs/<file> (see add_scene_image), or null for an empty slot."),
    keep: z.string().optional().describe("What to preserve from this image; a Library item's own keep is used when empty."),
  });

  /** Each version with its job's state, file and cost. The prompt stays in scenes.json. */
  const versionsOf = (scene) => {
    const { store } = ctx();
    return scene.versions.map(({ prompt, ...v }) => {
      let job = null;
      try {
        job = store.get(v.job);
      } catch {
        // a version whose job record is gone still shows
      }
      return { ...v, state: job?.state ?? null, file: job?.artifacts?.[0] ?? null, estimateUsd: job?.estimateUsd ?? null, actualUsd: job?.actualUsd ?? null };
    });
  };
  const view = (scene) => ({ ...scene, versions: versionsOf(scene) });
  const line = (s) => `${s.id} "${s.title}" ${s.durationS}s ${s.ratio}, ${s.refs.length} image(s), ${s.versions.length} version(s)`;

  tool(
    "list_scenes",
    {
      title: "List scenes",
      description: "A film's scenes with their cards, images and versions (job state, file, cost). Free.",
      inputSchema: { run },
      outputSchema: { idea: z.unknown(), scenes: z.array(Data) },
      annotations: LOOK,
    },
    async ({ run }) => {
      const data = readScenes(run);
      const scenes = data.scenes.map(view);
      return ok(scenes.map(line).join("\n") || "no scenes yet", { idea: data.idea ?? null, scenes });
    },
  );

  tool(
    "get_scene_prompt",
    {
      title: "Scene prompt",
      description:
        "The exact prompt and images a scene would send, the problems that would stop it, and the draft and final prices. " +
        "Read this before draft_scene or final_scene. Free.",
      inputSchema: { run, id },
      outputSchema: { prompt: z.string(), refs: z.array(Data), problems: z.array(z.string()), prices: Data },
      annotations: LOOK,
    },
    async ({ run, id }) => {
      const { store, limits, library } = ctx();
      const scene = findScene(run, id);
      const { prompt, refs, problems } = compileFor(catalog, run, scene, library);
      const prices = scenePrices(catalog, scene, { store, limits });
      const head = problems.length ? `PROBLEMS:\n${problems.join("\n")}` : `draft $${prices.draft.usd} · 720p $${prices.final720.usd} · 1080p $${prices.final1080.usd}`;
      return ok(`${head}\n\n${prompt}`, { prompt, refs, problems, prices });
    },
  );

  tool(
    "save_scene",
    {
      title: "Save scene",
      description:
        "Create a scene (no id) or change one (with id). When changing, only the fields given are replaced: " +
        "cards merge by key (goal, scene, stages, style, audio), and stages, when given, replace the whole list. " +
        "Change only what the user asked for. The length is the sum of the stages' seconds (4 to 30). " +
        MENTIONS +
        " Free.",
      inputSchema: {
        run,
        id: id.optional(),
        title: z.string().optional(),
        ratio: z.enum(RATIOS).optional(),
        durationS: z.number().int().optional().describe("Only for a scene with no stages."),
        refs: z.array(Ref).optional(),
        cards: z
          .object({
            goal: z.string().optional(),
            scene: z.string().optional(),
            stages: z.array(Stage).optional(),
            style: z.string().optional(),
            audio: z.string().optional(),
          })
          .optional(),
      },
      outputSchema: Scene,
      annotations: LOCAL_WRITE,
    },
    async ({ run, id, cards, ...fields }) => {
      const given = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      const before = id ? findScene(run, id) : null;
      const merged = before
        ? { ...before, ...given, cards: { ...before.cards, ...(cards ?? {}) } }
        : { title: "", ratio: "16:9", refs: [], ...given, cards: { goal: "", scene: "", stages: [], style: "", audio: "", ...(cards ?? {}) } };
      const saved = saveScene(run, { ...merged, id });
      return ok(`saved ${line(saved)}. Call get_scene_prompt to see what it would send.`, view(saved));
    },
  );

  tool(
    "add_scene_image",
    {
      title: "Add scene image",
      description:
        "Copy a picture (a path inside runs/, library/ or an allowed folder; relative means inside runs/) into the film's refs folder, " +
        "never over another file. Returns the source to put in a scene's refs. Free.",
      inputSchema: { run, path: z.string(), name: z.string().optional().describe("File name to use; defaults to the picture's own.") },
      outputSchema: { source: z.string(), width: z.number().nullable(), height: z.number().nullable() },
      annotations: LOCAL_WRITE,
    },
    async ({ run, path, name }) => {
      const { roots } = ctx();
      const r = addSceneImage(run, isAbsolute(path) ? path : join(RUNS_DIR, path), { roots, name });
      return ok(`added ${r.source} (${r.width}×${r.height})`, r);
    },
  );

  tool(
    "delete_scene",
    {
      title: "Delete scene",
      description: "Remove a scene from the film. Its videos stay on disk. Only when the user asked. Free.",
      inputSchema: { run, id },
      outputSchema: { ok: z.boolean() },
      annotations: LOCAL_DELETE,
    },
    async ({ run, id }) => {
      deleteScene(run, id);
      return ok(`deleted ${id}`, { ok: true });
    },
  );

  tool(
    "choose_version",
    {
      title: "Choose version",
      description: "Mark one of a scene's versions (a job id) as the one to use. Free.",
      inputSchema: { run, id, job: z.string() },
      outputSchema: Scene,
      annotations: LOCAL_WRITE,
    },
    async ({ run, id, job }) => {
      const saved = chooseVersion(run, id, job);
      return ok(`${id} uses ${job}`, view(saved));
    },
  );

  const Made = {
    localJobId: z.string(),
    state: z.string(),
    estimateUsd: z.number().nullable(),
    basis: z.string().nullable(),
    refMapping: z.array(z.string()),
    warnings: z.array(z.string()),
    next: z.string(),
  };
  const make = async (run, id, kind, resolution, extra) => {
    const { store, limits, roots, library } = ctx();
    const upload = deps.upload ?? ((path, opts) => uploadFile(catalog, path, opts));
    const r = await makeScene(catalog, run, id, kind, resolution, {
      store,
      limits,
      roots,
      library,
      upload,
      deps: stoppable(deps.generate, extra.signal),
      via: "mcp",
    });
    const next = `Call wait_job with job_id "${r.job.id}". Do not submit this scene again while it runs.`;
    const data = { localJobId: r.job.id, state: r.job.state, estimateUsd: r.estimateUsd ?? null, basis: r.basis ?? null, refMapping: r.refMapping, warnings: r.warnings, next };
    return ok(`${id} ${kind} ${resolution} submitted as ${r.job.id}, about $${r.estimateUsd}.\n${r.refMapping.join("\n")}\n${next}`, data);
  };

  tool(
    "draft_scene",
    {
      title: "Draft scene",
      description:
        "Spends kie credits. A scene's draft: Seedance 2.5 at 480p in draft mode, with sound (get_scene_prompt shows the price). " +
        "Only when the user agreed to this draft. Refused, with nothing spent, while get_scene_prompt shows problems.",
      inputSchema: { run, id },
      outputSchema: Made,
      annotations: SPEND,
    },
    async ({ run, id }, extra) => make(run, id, "draft", "480p", extra),
  );

  tool(
    "final_scene",
    {
      title: "Final scene",
      description:
        "Spends kie credits. A scene's final at 720p or 1080p: the same prompt and images as the draft, so the motion will differ from it " +
        "(get_scene_prompt shows the price). Only when the user agreed to this final.",
      inputSchema: { run, id, resolution: z.enum(FINALS) },
      outputSchema: Made,
      annotations: SPEND,
    },
    async ({ run, id, resolution }, extra) => make(run, id, "final", resolution, extra),
  );
}
