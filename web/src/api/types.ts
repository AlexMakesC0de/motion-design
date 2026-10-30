export type JobState =
  | "reserved" | "sending" | "submitted" | "uncertain" | "succeeded"
  | "failed-charged" | "failed-unconfirmed" | "failed-confirmed-free" | "refused";

export interface JobView {
  id: string;
  state: JobState;
  run: string;
  model: string;
  provider: string;
  providerModel: string | null;
  upstreamTaskId: string | null;
  estimateUsd: number | null;
  actualUsd: number | null;
  countedUsd: number;
  costSource: string;
  capability: "video" | "image" | "audio" | null;
  prompt: string | null;
  /** Some routes record the duration as text ("5"); show it with Number(). */
  durationS: number | string | null;
  resolution: string | null;
  aspectRatio: string | null;
  failedOver: boolean;
  error: string | null;
  media: string[];
  createdAt: string;
  updatedAt: string;
  /** The studio server is waiting on this job right now. */
  following: boolean;
}

export interface SpendView {
  capUsd: number;
  spentUsd: number;
  availableUsd: number;
  perJobUsd: number | null;
  unsettled: number;
  days: { day: string; usd: number }[];
}

export interface AssetSummary {
  name: string;
  kind: string;
  description: string;
  imageCount: number;
  updatedAt: string;
  /** Only from GET /api/library; the SSE library event sends core's list without them. */
  cover?: string | null;
  usedIn?: string[];
}

export interface AssetDetail {
  name: string;
  kind: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  images: { n: number; file: string; width: number | null; height: number | null; bytes: number; mime: string | null; url: string | null }[];
  /** Film (run) slugs, from the asset record. */
  usedIn: string[];
  /** Jobs whose refs used this asset, newest first. */
  takes: JobView[];
}

export interface IncomingFile {
  token: string;
  name: string;
  kind: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
}

export interface Vocab {
  kinds: string[];
  roles: string[];
}

export interface ModelInfo {
  id: string;
  capability: "video" | "image" | "audio";
  durationsS: number[];
  aspectRatios: string[];
  resolutions: string[];
  resolutionOptions: string[];
  defaultResolution: string | null;
  refRoles: string[];
  nativeAudio: boolean;
  notes: string | null;
  routes: { provider: string; price: string; verified: boolean; usable: boolean; skipReason: string | null }[];
}

export interface Estimate {
  model: string;
  provider: string | null;
  providerModel: string | null;
  routeUsable: boolean;
  estimateUsd: number | null;
  basis: string | null;
  budgetUsd: number | null;
  withinBudget: boolean;
  perJobUsd: number | null;
  withinPerJob: boolean;
  availableTodayUsd: number;
  withinDailyCap: boolean;
  problems: string[];
  allowed: boolean;
}

export interface RunSummary {
  run: string;
  modified: string;
  files: number;
  takes: number;
}

export interface PresetInfo {
  id: string;
  title: string;
  tagline: string | null;
  bestFor: string | null;
  durationS: number | null;
  aspectRatio: string | null;
  model: string | null;
  fidelity: string | null;
  hasPrompt: boolean;
  still: string | null;
}

export interface PresetDetail extends PresetInfo {
  prompt: string | null;
}

export interface SubmitResult {
  localJobId: string;
  upstreamTaskId: string | null;
  state: JobState;
  provider: string;
  providerModel: string;
  failedOver: boolean;
  estimateUsd: number;
  basis: string;
  refMapping: string[];
  warnings: string[];
  job: JobView;
}

export interface CheckResult {
  outcome: "succeeded" | "failed" | "pending" | "no-artifact";
  following: boolean;
  message: string;
  job: JobView;
}

export interface FramesResult {
  sheet: string | null;
  first: string | null;
  last: string | null;
  firstPath: string;
  lastPath: string;
  times: number[];
  durationS: number;
}

export type StudioEvent =
  | { event: "hello"; data: { at: string } }
  | { event: "job"; data: JobView }
  | { event: "spend"; data: SpendView }
  | { event: "library"; data: AssetSummary[] };
