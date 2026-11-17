// Shared test data for page tests. Not a test file itself, so importing it runs no tests.
import type { ChatEntry, ChatSettingsView, Estimate, FilmDetail, FilmFile, FinishInfo, JobView, ModelInfo, SettingsView, SpendView, TaskView } from "./api/types";

export const job = (over: Partial<JobView> = {}): JobView => ({
  id: "j-20261031-abc123",
  state: "succeeded",
  run: "zed",
  model: "seedance-2-5",
  provider: "kie",
  providerModel: "bytedance/seedance-2-5",
  upstreamTaskId: "task-1",
  estimateUsd: 0.56,
  actualUsd: 0.5,
  countedUsd: 0.5,
  costSource: "task-record",
  capability: "video",
  prompt: "A fox runs.",
  durationS: 4,
  resolution: "480p",
  aspectRatio: "16:9",
  failedOver: false,
  error: null,
  media: ["/media/runs/zed/out.mp4"],
  createdAt: "2026-10-31T10:00:00.000Z",
  updatedAt: "2026-10-31T10:01:00.000Z",
  following: false,
  day: "2026-10-31",
  uncertainMessage: null,
  picks: null,
  typedPrompt: null,
  ...over,
});

export const estimate = (over: Partial<Estimate> = {}): Estimate => ({
  model: "seedance-2-5",
  provider: "kie",
  providerModel: "bytedance/seedance-2-5",
  routeUsable: true,
  estimateUsd: 0.56,
  basis: "4s × $0.14/s",
  budgetUsd: 3,
  withinBudget: true,
  perJobUsd: null,
  withinPerJob: true,
  availableTodayUsd: 9.44,
  withinDailyCap: true,
  problems: [],
  allowed: true,
  ...over,
});

export const model = (over: Partial<ModelInfo> = {}): ModelInfo => ({
  id: "seedance-2-5",
  capability: "video",
  durationsS: [4, 5, 6, 8, 10],
  aspectRatios: ["16:9", "9:16", "1:1"],
  resolutions: [],
  resolutionOptions: ["480p", "720p", "1080p"],
  defaultResolution: "720p",
  refRoles: ["identity", "style", "first_frame", "last_frame"],
  nativeAudio: true,
  notes: null,
  routes: [{ provider: "kie", price: "480p $0.14/s", verified: true, usable: true, skipReason: null }],
  ...over,
});

export const filmFile = (over: Partial<FilmFile> = {}): FilmFile => ({
  name: "out.mp4",
  kind: "video",
  origin: "take",
  url: "/media/runs/zed/out.mp4",
  bytes: 1_200_000,
  modified: "2026-10-31T10:01:00.000Z",
  job: null,
  ...over,
});

export const film = (over: Partial<FilmDetail> = {}): FilmDetail => ({
  run: "zed",
  prompt: "A fox runs.",
  files: [
    filmFile({ job: job() }),
    filmFile({ name: "out-2.mp4", url: "/media/runs/zed/out-2.mp4", modified: "2026-10-31T10:05:00.000Z" }),
    filmFile({ name: "bed.mp3", kind: "audio", origin: null, url: "/media/runs/zed/bed.mp3" }),
    filmFile({ name: "film.mp4", origin: "film", url: "/media/runs/zed/film.mp4", modified: "2026-10-31T10:09:00.000Z" }),
  ],
  order: [],
  ...over,
});

export const task = (over: Partial<TaskView> = {}): TaskView => ({
  id: "t-0a1b2c3d",
  run: "zed",
  tool: "assemble",
  label: "Assemble",
  state: "running",
  startedAt: "2026-10-31T10:10:00.000Z",
  endedAt: null,
  outS: null,
  outputs: [],
  warnings: [],
  error: null,
  ...over,
});

export const finishInfo = (over: Partial<FinishInfo> = {}): FinishInfo => ({
  tools: { ffmpeg: { ok: true, install: null }, render: { ok: true, install: null } },
  templates: [
    {
      id: "kinetic-type",
      description: "Headline builds word by word. Use when the copy must be exactly right.",
      durationS: 6,
      fields: [
        { name: "lines", type: "lines", label: "Lines", required: true, hint: "One line of the headline per row." },
        { name: "kicker", type: "text", label: "Kicker" },
        { name: "granularity", type: "choice", label: "Builds by", choices: ["word", "line"] },
      ],
    },
    {
      id: "stat-reveal",
      description: "Animated counters and bars from real numbers you supply.",
      durationS: 7,
      fields: [{ name: "stats", type: "json", label: "Stats", required: true, example: [{ label: "Replies", value: 128 }] }],
    },
  ],
  ratios: ["16:9", "9:16", "1:1", "4:5", "4:3", "21:9"],
  transitions: ["fade", "dissolve"],
  captionStyles: ["social", "subtle"],
  variantModes: ["blur", "crop", "pad"],
  ...over,
});

export const spend = (over: Partial<SpendView> = {}): SpendView => ({
  capUsd: 10,
  spentUsd: 2.1,
  availableUsd: 7.9,
  perJobUsd: null,
  unsettled: 0,
  days: Array.from({ length: 14 }, (_, i) => ({ day: `2026-10-${String(18 + i).padStart(2, "0")}`, usd: i === 13 ? 2.1 : i % 3 === 0 ? 0 : 0.5 + i / 10 })),
  ...over,
});

export const settings = (over: Partial<SettingsView> = {}): SettingsView => ({
  limits: { dailyUsd: 10, perJobUsd: null, file: "/Users/x/.config/kie/limits.json" },
  providers: [
    { name: "kie", label: "kie.ai", keyConfigured: true, keyEnv: "KIE_API_KEY", keyFile: "~/.config/kie/key", signup: "https://kie.ai/api-key", balanceReadable: true },
    { name: "wavespeed", label: "WaveSpeed", keyConfigured: false, keyEnv: "WAVESPEED_API_KEY", keyFile: "~/.config/wavespeed/key", signup: "https://wavespeed.ai", balanceReadable: false },
  ],
  ...over,
});

export const chatSettings = (over: Partial<ChatSettingsView> = {}): ChatSettingsView => ({
  backend: null,
  model: null,
  openai: { keySaved: false, keySource: null, keyFile: "/Users/x/.config/kie/openai.key", keyEnv: "OPENAI_API_KEY" },
  ...over,
});

export const userLine = (text: string, id = "c-user"): ChatEntry => ({ id, kind: "user", at: "2026-10-31T10:00:00.000Z", text });
export const assistantLine = (text: string, streaming = false, id = "c-assistant"): ChatEntry => ({ id, kind: "assistant", at: "2026-10-31T10:00:01.000Z", text, streaming });
export const toolLine = (over: Partial<Extract<ChatEntry, { kind: "tool" }>> = {}): ChatEntry => ({
  id: "c-tool",
  kind: "tool",
  at: "2026-10-31T10:00:02.000Z",
  name: "estimate",
  args: "seedance-2-5 4s 480p",
  result: "$0.56",
  state: "done",
  ...over,
});

/** Answers with `status` and the server's error body ({ error: { message, ...extra } }). */
export const errorResponse = (status: number, message: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ error: { message, ...extra } }), { status });

/** A fetch stub that answers by path. Unlisted paths never resolve, like a slow server. */
export function routes(table: Record<string, (init?: RequestInit) => unknown>) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split("?")[0];
    const answer = table[path];
    if (!answer) return new Promise<Response>(() => {});
    const value = answer(init);
    if (value instanceof Response) return Promise.resolve(value);
    return Promise.resolve(new Response(JSON.stringify(value), { status: 200 }));
  };
}
