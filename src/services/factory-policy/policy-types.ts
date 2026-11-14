export type AttemptStatus = "preparing" | "running" | "completed" | "failed" | "blocked" | "interrupted";

export interface PolicyStory {
  id: string;
  stage: string;
  title?: string;
  description?: string;
  fields?: Record<string, unknown>;
}

export interface PolicyStage {
  key: string;
  enabled: boolean;
  promptClass?: string;
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
  stage: string;
  workerId: string;
  status: AttemptStatus;
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
  stage: string;
  action: "start" | "retry" | "skip";
  reason: string;
  attempt?: number;
  retryAt?: string;
  previous?: { workerId: string; status: string; result: unknown };
}

export interface PolicyReport {
  story: string;
  event: "started" | "stopped" | "parked";
  workerId?: string;
  result?: unknown;
  stage?: string;
  reason?: string;
}

/**
 * - `attempts`: the workers that can finish for one Story in one Stage before the factory parks the Story.
 * - `retryMinutes`, `retryCapMinutes`: the delay after the second failure in a row, and its maximum. It doubles each time.
 * - `stallMinutes`: the run time after which the supervisor examines a worker.
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
