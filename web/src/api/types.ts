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
  durationS: number | null;
  resolution: string | null;
  aspectRatio: string | null;
  failedOver: boolean;
  error: string | null;
  media: string[];
  createdAt: string;
  updatedAt: string;
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
}

export type StudioEvent =
  | { event: "hello"; data: { at: string } }
  | { event: "job"; data: JobView }
  | { event: "spend"; data: SpendView }
  | { event: "library"; data: AssetSummary[] };
