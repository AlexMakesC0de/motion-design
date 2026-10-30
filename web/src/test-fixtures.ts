// Shared test data for page tests. Not a test file itself, so importing it runs no tests.
import type { Estimate, JobView, ModelInfo } from "./api/types";

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
