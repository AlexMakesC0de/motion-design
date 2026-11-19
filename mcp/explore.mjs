// Explore's cinema studio: the chat plans a take and fills the prompt bar;
// the user presses Generate. propose_take is the one tool the chat uses to
// hand its plan over. It is free: it checks the plan against the catalog,
// the menu, the looks and the Library, prices it with core's estimate, and
// spends nothing. The page reads its structured result and fills the bar.
import { z } from "zod";
import { resolveModel } from "../cli/lib/models.mjs";
import { estimate } from "../cli/core/views.mjs";
import { cleanVideoPicks } from "../cli/director/video-picks.mjs";
import { findLook } from "../cli/director/looks.mjs";
import { ok } from "./results.mjs";

export const MAX_COUNT = 4;

/** The tools Explore's chat gets: free ones that only read, and propose_take. */
export const EXPLORE_TOOLS = new Set(["status", "list_models", "list_presets", "list_looks", "estimate", "list_assets", "get_asset", "get_menu", "list_voices", "list_skills", "get_skill", "propose_take"]);

/** The MCP instructions in Explore mode, where nothing the chat can call spends money. */
export const EXPLORE_INSTRUCTIONS =
  "Shard, a motion-design studio over kie.ai, in Explore mode. Nothing you can call spends money: " +
  "you plan one take (a picture or a video), and the user presses Generate, which shows the price. " +
  "Look first (list_models, list_looks, get_menu, list_assets, estimate), then call propose_take with the whole plan. " +
  "propose_take fills the user's prompt bar; call it again to change the plan. " +
  "The user keeps a skill library (list_skills): when a request matches a skill's description, load it with get_skill and follow it.";

const Picks = z
  .object({
    move: z.string().optional().describe("An id from get_menu's moves."),
    speed: z.string().optional().describe("An id from get_menu's speeds; needs a move other than static."),
    size: z.string().optional().describe("An id from get_menu's sizes."),
    angle: z.string().optional().describe("An id from get_menu's angles."),
    lens: z.string().optional().describe("An id from get_menu's lenses."),
    light: z.string().optional().describe("An id from get_menu's lights."),
  })
  .passthrough();

const Proposal = z.object({
  kind: z.enum(["image", "video"]),
  prompt: z.string(),
  model: z.string(),
  aspectRatio: z.string().nullable(),
  durationS: z.number().nullable(),
  resolution: z.string().nullable(),
  look: z.string().nullable(),
  picks: z.record(z.string(), z.string()),
  refs: z.array(z.object({ source: z.string(), role: z.string() })),
  sound: z.boolean(),
  count: z.number().int(),
});

const usd = (v) => `$${v.toFixed(2)}`;

/** The route field that turns a model's sound off, or null when it has no switch. */
export const audioOffParam = (model) => model?.promptProfile?.audioOff ?? null;

export function registerExplore(tool, { catalog, ctx }) {
  tool(
    "propose_take",
    {
      title: "Propose a take",
      description:
        "Free; spends nothing. Fills the user's prompt bar in Explore with one take: the prompt, the model and its settings, a look, " +
        "camera and lighting picks from get_menu, Library references, sound and how many takes. Returns the price of each take and " +
        "of them all, and any problem with the plan. The user checks the bar and presses Generate; you cannot generate. " +
        "Write the prompt the model will read, in full: name each Library reference in it the way the user did.",
      inputSchema: {
        kind: z.enum(["image", "video"]),
        prompt: z.string().min(1).describe("The full prompt the model will read."),
        model: z.string().describe("A model id from list_models of this kind."),
        aspect_ratio: z.string().optional(),
        duration_s: z.number().int().positive().optional().describe("Video only."),
        resolution: z.string().optional(),
        look: z.string().optional().describe("An id from list_looks. Video only."),
        picks: Picks.optional().describe("Camera and lighting from get_menu. Video only."),
        refs: z
          .array(z.object({ source: z.string().describe("A Library item's name."), role: z.string() }))
          .optional()
          .describe("Library references with the role each plays (identity, style, first_frame...)."),
        sound: z.boolean().optional().describe("Video only: false turns the model's own sound off, where it has a switch."),
        count: z.number().int().min(1).max(MAX_COUNT).optional().describe(`How many takes, 1 to ${MAX_COUNT}.`),
      },
      outputSchema: {
        proposal: Proposal,
        estimateUsd: z.number().nullable(),
        totalUsd: z.number().nullable(),
        allowed: z.boolean(),
        problems: z.array(z.string()),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (a) => {
      const model = resolveModel(catalog, a.model, a.kind);
      const video = a.kind === "video";
      const problems = [];
      const picks = video ? (cleanVideoPicks(a.picks ?? null) ?? {}) : {};
      const look = video && a.look ? findLook(a.look).id : null;
      const { library, store, limits } = ctx();
      const refs = (a.refs ?? []).filter((r) => {
        try {
          library.get(r.source);
        } catch {
          problems.push(`No Library item "${r.source}".`);
          return false;
        }
        if (!catalog.roles.includes(r.role)) {
          problems.push(`"${r.role}" is not a reference role. Roles: ${catalog.roles.join(", ")}.`);
          return false;
        }
        return true;
      });
      const audioOff = video ? audioOffParam(model) : null;
      const sound = video && audioOff ? a.sound !== false : video ? Boolean(model.nativeAudio) : false;
      if (video && a.sound === false && !audioOff) problems.push(`${model.id} has no sound switch.`);
      const count = a.count ?? 1;
      const est = estimate(
        catalog,
        {
          model: model.id,
          durationS: video ? a.duration_s : undefined,
          resolution: a.resolution,
          aspectRatio: a.aspect_ratio,
          refs,
          params: video && audioOff && !sound ? { [audioOff.param]: audioOff.value } : {},
        },
        { store, limits },
      );
      problems.push(...est.problems);
      const proposal = {
        kind: a.kind,
        prompt: a.prompt,
        model: model.id,
        aspectRatio: a.aspect_ratio ?? null,
        durationS: video ? (a.duration_s ?? null) : null,
        resolution: a.resolution ?? null,
        look,
        picks,
        refs,
        sound,
        count,
      };
      const each = est.estimateUsd;
      const total = each == null ? null : Math.round(each * count * 100) / 100;
      const head =
        each == null
          ? `Filled the bar: ${model.id}, no price yet.`
          : `Filled the bar: ${model.id}, ${usd(each)} a take${count > 1 ? `, ${usd(total)} for ${count}` : ""}.`;
      const tail = problems.length ? ` Problems: ${problems.join(" ")}` : " Nothing was spent: the user presses Generate.";
      return ok(head + tail, { proposal, estimateUsd: each, totalUsd: total, allowed: est.allowed && !problems.length, problems });
    },
  );
}
