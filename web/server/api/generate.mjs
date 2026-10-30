// The two spending endpoints and Check again. They take the MCP tools' argument
// shapes (generate_video, generate_image, wait_job) and do what those tools do:
// expand refs, record the inputs, then reserve and submit through cli/core.
// Pricing, the per-job limit, the daily cap and job states all stay in core.
// Neither endpoint waits: the follower does, and the take reaches the page
// as an SSE job event.
import { resolveModel, validateVideoRequest } from "../../../cli/lib/models.mjs";
import { loadPresets, findPreset, routeFor } from "../../../cli/lib/presets.mjs";
import { RUNS_DIR, runDir, writeRecord } from "../../../cli/lib/run.mjs";
import { uploadFile } from "../../../cli/lib/upload.mjs";
import { unknown, usage } from "../../../cli/lib/errors.mjs";
import { submitJob } from "../../../cli/core/generate.mjs";
import { expandRefs } from "../../../cli/core/refs.mjs";
import { context, jobView } from "../state.mjs";
import * as f from "./fields.mjs";

export function registerGenerate(router, { catalog, deps = {}, follower }) {
  const upload = deps.upload ?? ((path, opts) => uploadFile(catalog, path, opts));

  /** The fields generate_video and generate_image share. */
  function common(body) {
    return {
      run: f.run(body),
      prompt: f.text(body, "prompt", { required: true }),
      refs: f.refs(body),
      resolution: f.text(body, "resolution"),
      aspect_ratio: f.text(body, "aspect_ratio"),
      params: f.params(body),
      budget_usd: f.amount(body, "budget_usd"),
      provider: f.text(body, "provider"),
    };
  }

  async function submit(capability, model, a, values, { promptFile, inputsFile, artifactBase, useI2v, extra = {} }) {
    const dir = runDir(a.run);
    const { store, limits, roots, library } = context();
    const expanded = await expandRefs(a.refs, { catalog, library, roots, baseDir: RUNS_DIR, upload });
    await writeRecord(dir, promptFile, a.prompt);
    await writeRecord(dir, inputsFile, {
      model: model.id,
      ...extra,
      refs: expanded.refs,
      refMapping: expanded.refMapping,
      params: a.params,
      via: "studio",
    });

    const sub = await submitJob(
      catalog,
      {
        capability,
        model,
        run: a.run,
        artifactBase,
        budgetUsd: a.budget_usd,
        only: a.provider,
        values: { ...values, refs: expanded.refs, params: a.params, _useI2v: useI2v(expanded.refs) },
        record: { refMapping: expanded.refMapping, assets: expanded.assets, via: "studio" },
      },
      { store, limits, deps: deps.generate },
    );
    // Submitted and paid for: nothing after this may throw, or the page loses the job id.
    const warnings = [];
    for (const name of expanded.assets) {
      try {
        library.recordUse(name, a.run);
      } catch (err) {
        warnings.push(`Could not record that asset "${name}" was used in ${a.run} (${err.message}); the job is submitted.`);
      }
    }
    follower.follow(sub.job.id);
    return {
      localJobId: sub.job.id,
      upstreamTaskId: sub.job.upstreamTaskId == null ? null : String(sub.job.upstreamTaskId),
      state: sub.job.state,
      provider: sub.job.provider,
      providerModel: sub.job.providerModel,
      failedOver: Boolean(sub.job.failedOver),
      estimateUsd: sub.estimateUsd,
      basis: sub.basis,
      refMapping: expanded.refMapping,
      warnings,
      job: jobView(sub.job),
    };
  }

  router.post("/api/generate/video", async ({ body = {} }) => {
    const a = { ...common(body), model: f.text(body, "model"), preset: f.text(body, "preset"), duration_s: f.wholeNumber(body, "duration_s") };
    let modelId = a.model;
    let durationS = a.duration_s;
    let aspectRatio = a.aspect_ratio;
    let presetId = null;
    if (a.preset) {
      const preset = findPreset(loadPresets(), a.preset);
      const route = routeFor(preset, catalog, { override: a.model });
      modelId ??= route.modelId;
      durationS ??= route.defaults.duration_s;
      aspectRatio ??= route.defaults.aspect_ratio;
      presetId = preset.id;
    }
    if (!modelId) throw f.invalid("model", "Pick a model, or a preset that supplies one.");
    const model = resolveModel(catalog, modelId, "video");
    const problems = validateVideoRequest(catalog, model, { durationS, aspectRatio, refs: a.refs });
    if (problems.length) {
      // Ask core about one setting at a time to name the field at fault.
      const field = validateVideoRequest(catalog, model, { durationS }).length
        ? "duration_s"
        : validateVideoRequest(catalog, model, { aspectRatio }).length
          ? "aspect_ratio"
          : "refs";
      throw unknown(`Refused before submitting, nothing was spent. ${problems.join(" ")}`, { field, problems });
    }
    return submit(
      "video",
      model,
      a,
      { prompt: a.prompt, duration: durationS, aspect_ratio: aspectRatio, resolution: a.resolution },
      {
        promptFile: "prompt.txt",
        inputsFile: "inputs.json",
        artifactBase: "out",
        useI2v: (refs) => refs.some((r) => r.role === "first_frame"),
        extra: { preset: presetId, durationS, aspectRatio },
      },
    );
  });

  router.post("/api/generate/image", async ({ body = {} }) => {
    const a = { ...common(body), model: f.text(body, "model"), quality: f.text(body, "quality"), background: f.text(body, "background") };
    const model = resolveModel(catalog, a.model ?? "gpt-image-2", "image");
    if (a.resolution && model.resolutions && !model.resolutions.includes(a.resolution)) {
      throw f.invalid("resolution", `${model.id} supports resolutions ${model.resolutions.join(", ")}.`);
    }
    if (a.quality && model.qualities && !model.qualities.includes(a.quality)) {
      throw f.invalid("quality", `${model.id} supports qualities ${model.qualities.join(", ")}.`);
    }
    return submit(
      "image",
      model,
      a,
      { prompt: a.prompt, resolution: a.resolution, quality: a.quality, aspect_ratio: a.aspect_ratio, background: a.background },
      { promptFile: "image-prompt.txt", inputsFile: "image-inputs.json", artifactBase: "ref", useI2v: (refs) => refs.length > 0 },
    );
  });

}
