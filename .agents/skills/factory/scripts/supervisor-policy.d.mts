export type AttemptStatus = "preparing" | "running" | "completed" | "failed" | "blocked" | "interrupted";
export interface PolicyStory { id: string; stage: string; title?: string; description?: string; fields?: Record<string, unknown> }
export interface PolicyStage { key: string; enabled: boolean; promptClass?: string }
export interface PolicyWorker {
  workerId?: string; threadId?: string; taskId?: string; story?: string; status?: string;
  startedAt?: string; stoppedAt?: string | null; result?: unknown; workerType?: string;
  [key: string]: unknown;
}
export interface PolicyAttempt extends PolicyWorker {
  story: string; stage: string; workerId: string; status: AttemptStatus;
  reported?: boolean; startReported?: boolean; budgetReset?: boolean; observedStageDeparture?: boolean; stoppedScan?: number;
}
export interface PolicyState {
  version: 1; updatedAt?: string | null;
  scan: { stages: Record<string, string>; count?: number };
  attempts: PolicyAttempt[];
  parked?: Record<string, { stage: string; reason: string; hash: string; since: string; reported: boolean }>;
  launchFailures?: Record<string, { count: number; at: string; error: unknown }>;
  [key: string]: unknown;
}
export interface PolicyDecision {
  story: string; stage: string; action: "start" | "retry" | "skip"; reason: string; attempt?: number; retryAt?: string;
  previous?: { workerId: string; status: string; result: unknown };
}
export interface PolicyReport { story: string; event: "started" | "stopped" | "parked"; workerId?: string; result?: unknown; stage?: string; reason?: string }
export const DEFAULT_LIMITS: { attempts: number; retryMinutes: number; retryCapMinutes: number; stallMinutes: number };
export function normalizeStatus(status: unknown): AttemptStatus | undefined;
export function storyHash(story: PolicyStory): string;
export function evaluateScan(previous: PolicyState, input: {
  stories: PolicyStory[]; stages: PolicyStage[]; harnessWorkers?: PolicyWorker[]; now?: Date | string;
  maxActive?: number; limits?: Partial<typeof DEFAULT_LIMITS>;
}): { state: PolicyState; decisions: PolicyDecision[]; stalled: { story: string; stage: string; workerId: string; minutes: number }[] };
export function recordStart(previous: PolicyState, story: string, stage: string, worker: PolicyWorker): PolicyState;
export function recordLaunchFailure(previous: PolicyState, story: string, error: unknown, now?: Date | string): PolicyState;
export function releaseStory(previous: PolicyState, story: string): PolicyState;
export function pendingReports(state: PolicyState): PolicyReport[];
export function markReported(previous: PolicyState, report: PolicyReport): PolicyState;
