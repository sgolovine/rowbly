export type AttemptStatus = "preparing" | "running" | "completed" | "failed" | "blocked" | "interrupted";

export interface PolicyStory {
  id: string;
  /** The permanent `uid` of the Story, when it has one. */
  uid?: string;
  stage: string;
  title?: string;
  description?: string;
  fields?: Record<string, unknown>;
  /** The IDs of the upstream Stories. */
  dependsOn?: readonly string[];
}

/** The class of a Stage prompt. `missing` is for a Stage without a prompt file. */
type PromptClass = "work" | "hold" | "invalid" | "missing";

export interface PolicyStage {
  key: string;
  enabled: boolean;
  promptClass?: PromptClass;
}

export interface PolicyWorker {
  workerId?: string;
  threadId?: string;
  taskId?: string;
  story?: string;
  status?: string;
  startedAt?: string;
  stoppedAt?: string | null;
  result?: unknown;
  workerType?: string;
  [key: string]: unknown;
}

export interface PolicyAttempt extends PolicyWorker {
  story: string;
  /** The `uid` of the Story. An old attempt, or an attempt of a Story without a `uid`, has none. */
  storyUid?: string;
  stage: string;
  workerId: string;
  status: AttemptStatus;
  /** The host ID of the machine that runs the attempt. An attempt without it ran on the local host. */
  host?: string;
  reported?: boolean;
  startReported?: boolean;
  budgetReset?: boolean;
  observedStageDeparture?: boolean;
  stoppedScan?: number;
}

interface ParkedStory {
  stage: string;
  reason: string;
  hash: string;
  since: string;
  reported: boolean;
}

export interface LaunchFailure {
  count: number;
  at: string;
  error: unknown;
}

export interface PolicyState {
  version: 1;
  updatedAt?: string | null;
  scan: { stages: Record<string, string>; count?: number };
  attempts: PolicyAttempt[];
  parked?: Record<string, ParkedStory>;
  launchFailures?: Record<string, LaunchFailure>;
  [key: string]: unknown;
}

export interface PolicyDecision {
  story: string;
  /** The `uid` of the Story, when it has one. */
  storyUid?: string;
  stage: string;
  action: "start" | "retry" | "skip";
  reason: string;
  attempt?: number;
  retryAt?: string;
  previous?: { workerId: string; status: string; result: unknown };
  /** The upstream Stories that are not complete, for a Story that the gate skips. */
  waitingFor?: string[];
}

/**
 * - `attempts`: the workers that can finish for one Story in one Stage before the factory parks the Story.
 * - `retryMinutes`, `retryCapMinutes`: the delay after the second failure in a row, and its maximum. It doubles each time.
 * - `stallMinutes`: the run time after which the policy reports a stalled worker.
 */
export interface PolicyLimits {
  attempts: number;
  retryMinutes: number;
  retryCapMinutes: number;
  stallMinutes: number;
}

export interface ScanInput {
  stories: PolicyStory[];
  stages: PolicyStage[];
  harnessWorkers?: PolicyWorker[];
  now?: Date | string;
  maxActive?: number;
  limits?: Partial<PolicyLimits>;
  /** The Stories whose remote worker Thread is not synchronized. The policy skips them before all other rules. */
  hostSync?: readonly string[];
}

export interface StalledWorker {
  story: string;
  stage: string;
  workerId: string;
  minutes: number;
}

export interface ScanResult {
  state: PolicyState;
  decisions: PolicyDecision[];
  stalled: StalledWorker[];
}
