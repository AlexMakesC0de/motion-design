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
  /** The local day (YYYY-MM-DD) the job counts against. */
  day: string | null;
  /** Core's instruction for an uncertain job, with the `kie job resolve` commands when no task id came back. */
  uncertainMessage: string | null;
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

export interface FilmSummary extends RunSummary {
  cover: { kind: "video" | "image"; url: string } | null;
  progress: FilmProgress | null;
}

export type FilmStep = "brief" | "references" | "shots" | "finish";
export type StepState = "done" | "current" | "todo" | "locked";

export interface FilmProgress {
  step: FilmStep;
  steps: Record<FilmStep, StepState>;
  next: { text: string; step: FilmStep };
  counts: { shots: number; stills: number; takes: number; outputs: number };
  spentUsd: number;
  legacy: boolean;
  updatedAt?: string;
  cover?: { kind: "video" | "image"; url: string } | null;
}

export type FileKind = "video" | "image" | "audio" | "srt";
/** What made a file, from its default name: a generated take, or a finishing tool's output. */
export type FileOrigin = "take" | "film" | "captioned" | "variant" | "card";

export interface FilmFile {
  name: string;
  kind: FileKind;
  origin: FileOrigin | null;
  url: string | null;
  bytes: number;
  modified: string;
  /** The job that made this take, when there is one. */
  job: JobView | null;
}

export interface FilmDetail {
  run: string;
  prompt: string | null;
  /** Oldest first. */
  files: FilmFile[];
  /** Shot names in the order of the film's last assembly. */
  order: string[];
}

export interface TaskView {
  id: string;
  run: string;
  tool: "assemble" | "caption" | "variants" | "card";
  label: string;
  state: "running" | "done" | "failed";
  startedAt: string;
  endedAt: string | null;
  /** Seconds of output ffmpeg has written so far. */
  outS: number | null;
  outputs: { name: string; url: string | null }[];
  warnings: string[];
  error: string | null;
}

export interface TemplateField {
  name: string;
  type: "text" | "lines" | "choice" | "image" | "json";
  label: string;
  required?: boolean;
  hint?: string;
  choices?: string[];
  example?: unknown;
}

export interface TemplateInfo {
  id: string;
  description: string;
  durationS: number | null;
  fields: TemplateField[];
}

export interface ToolState {
  ok: boolean;
  /** Core's message saying how to install it, when missing. */
  install: string | null;
}

export interface FinishInfo {
  tools: { ffmpeg: ToolState; render: ToolState };
  templates: TemplateInfo[];
  ratios: string[];
  transitions: string[];
  captionStyles: string[];
  variantModes: string[];
}

export interface SavedAudio {
  name: string;
  kind: "audio";
  url: string | null;
  bytes: number;
}

export interface SavedSrt {
  name: string;
  url: string | null;
  cues: number;
  problems: string[];
  lastEndS: number;
}

export interface LimitsView {
  dailyUsd: number;
  perJobUsd: number | null;
  file: string;
}

export interface ProviderInfo {
  name: string;
  label: string;
  keyConfigured: boolean;
  keyEnv: string;
  keyFile: string;
  signup: string;
  balanceReadable: boolean;
}

export interface SettingsView {
  limits: LimitsView;
  providers: ProviderInfo[];
}

export interface DoctorResult {
  checks: { level: "ok" | "warn" | "fail" | "info"; text: string }[];
  failures: number;
  ranAt: string;
}

/** One line of a film's chat, the same whichever backend answered (web/server/chat/transcript.mjs). */
export type ChatEntry =
  | { id: string; kind: "user"; at: string; text: string }
  | { id: string; kind: "assistant"; at: string; text: string; streaming: boolean }
  | { id: string; kind: "tool"; at: string; name: string; args: string; result: string | null; state: "running" | "done" | "failed" }
  | { id: string; kind: "notice"; at: string; text: string; tone: "error" | "info" };

export interface ChatView {
  film: string;
  busy: boolean;
  entries: ChatEntry[];
}

export type ChatBackend = "codex" | "openai";

export interface ChatSettingsView {
  backend: ChatBackend | null;
  model: string | null;
  openai: { keySaved: boolean; keySource: "env" | "file" | null; keyFile: string; keyEnv: string };
}

export interface CodexStatus {
  installed: boolean;
  loggedIn: boolean;
  plan: string | null;
  message: string | null;
}

export type StudioEvent =
  | { event: "hello"; data: { at: string } }
  | { event: "job"; data: JobView }
  | { event: "spend"; data: SpendView }
  | { event: "library"; data: AssetSummary[] }
  | { event: "task"; data: TaskView }
  /** A chat entry was added or changed (entry), or a turn began or ended (busy). */
  | { event: "chat"; data: { film: string; busy: boolean; entry: ChatEntry | null } };

// ---------------------------------------------------------------- director

export interface MenuEntry {
  id: string;
  label: string;
  when: string;
  words?: string;
}

export interface DirectorMenu {
  menu: Record<string, MenuEntry[]>;
  groups: string[];
  aspects: string[];
  maxFilmS: number;
  videoModels: { id: string; label: string }[];
  imageModels: { id: string; label: string }[];
}

export interface Brief {
  takeaway: string;
  durationS: number;
  aspectRatio: string;
  filmType: string;
  audience?: string;
  tone?: string;
  mustShow?: string[];
  copy?: string[];
  sound?: { music?: string; voice?: string; sfx?: string };
}

export interface Shot {
  id: string;
  durationS: number;
  purpose: string;
  subject: string;
  action: string;
  why: string;
  size: string;
  angle: string;
  lens: string;
  depth: string;
  move: { type: string; speed?: string };
  light: string;
  cut: string;
  job: string;
  screenDirection: string;
  checks: string[];
  cast?: string[];
  copy?: string[];
  model?: string;
  modelReason?: string;
  stillModel?: string;
  stillReason?: string;
  keyLightSide?: string;
  line?: string;
  still?: string;
  take?: string;
}

export interface Plan {
  version: number;
  look: { palette: string; grade: string; filmLook: string; lensFamily: string; keyLightSide: string; styleStill?: string };
  shots: Shot[];
}

export interface Finding {
  shot: string | null;
  rule: string;
  message: string;
}

/** One still or take attempt of a shot. */
export interface Attempt {
  jobId: string;
  state: JobState;
  file: string | null;
  url: string | null;
  model: string;
  estimateUsd: number | null;
  actualUsd: number | null;
  error: string | null;
  createdAt: string;
  /** Stills: made from older wording than the shot's current one. */
  stale?: boolean;
  /** Takes: the frame it started from. */
  from?: string | null;
  generatedS?: number | null;
  job?: JobView | null;
}

export interface Review {
  take: string;
  verdict: "pass" | "redo";
  checks: { check: string; ok: boolean; note?: string }[];
  bestWindow?: { startS: number };
  at: string;
}

export interface BoardShot {
  id: string;
  durationS: number;
  continuesFrom: string | null;
  still: string | null;
  stillUrl: string | null;
  stillStale: boolean;
  take: string | null;
  takeUrl: string | null;
  filming: string[];
  failed: { jobId: string; state: JobState; error: string | null } | null;
  review: Review | null;
  /** Takes filmed for this shot, leaving out those that failed free. */
  tries: number;
  stills: Attempt[];
  takes: Attempt[];
}

export interface BoardView {
  film: string;
  brief: Brief | null;
  plan: Plan | null;
  shots: BoardShot[];
  check: { errors: Finding[]; warnings: Finding[] };
  cost: {
    shots: { id: string | null; stillModel: string | null; stillUsd: number | null; continuesFrom?: string; model: string | null; generatedS: number | null; takeUsd: number | null }[];
    stillsUsd: number;
    filmUsd: number;
    totalUsd: number;
    complete: boolean;
    availableTodayUsd: number | null;
  };
  left: { stills: string[]; stillsUsd: number; takes: string[]; takesUsd: number };
  production: { autoRedo: boolean; maxUsd: number | null; takesSpentUsd: number };
  queue: { kind: "stills" | "film"; waiting: string[]; maxUsd: number | null; stopped: { shot: string | null; message: string; code?: number | null } | null } | null;
  cut: { out: string; totalS: number; url: string | null; notes: string[] } | null;
}

/** What auto-redo did after a review: refilmed the shot, or held back and why. */
export interface RedoResult {
  submitted: boolean;
  shot: string;
  jobId?: string | null;
  redo?: number;
  estimateUsd?: number;
  reason?: string;
}

export interface ReviewFrames {
  shot: string;
  take: string;
  durationS: number;
  checks: string[];
  sheetUrl: string;
  firstUrl: string;
  lastUrl: string;
}
