import type { ModelChoice } from "../factory-settings/factory-settings.js";

export type ThreadStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

/** One run of a Thread. A resume adds a run; the last run has the status of the Thread. */
export interface ThreadRun {
  id: string;
  ownerToken: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  status: ThreadStatus;
  reason?: string;
}

export interface WorkerResult {
  outcome: string;
  summary: string;
  branch?: string;
  commits?: string[];
  pullRequest?: string;
  blockers: string[];
  problems: string[];
}

export interface ThreadRecord {
  // Identity
  version: 1;
  id: string;
  revision: number;
  role: "supervisor" | "worker";
  storyId?: string;
  stage?: string;
  attemptNumber?: number;
  parentThreadId?: string;
  model?: ModelChoice;

  // Lifecycle
  status: ThreadStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  session: { id: string; file: string | null; formatVersion?: number; leafId?: string };
  cwd: string;
  worktree?: string;
  branch?: string;
  runs: ThreadRun[];

  // Outcome
  result?: WorkerResult;
  error?: {
    class: "auth" | "quota" | "transient" | "launch" | "storage" | "configuration" | "unknown";
    code: string;
    message: string;
    retryAt?: string;
  };
  resumable: boolean;

  // Activity
  lastActivityAt?: string;
  lastTool?: string;
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
}

export interface ThreadList {
  threads: ThreadRecord[];
  issues: { file: string; message: string }[];
}

/** The fields that a transition can change, in addition to the status. */
export type ThreadPatch = Partial<
  Pick<
    ThreadRecord,
    | "cwd"
    | "session"
    | "model"
    | "result"
    | "error"
    | "resumable"
    | "worktree"
    | "branch"
    | "lastActivityAt"
    | "lastTool"
    | "usage"
  >
>;

/** Tells if a status is final: a pending or running Thread is not. */
export function isTerminal(status: ThreadStatus): boolean {
  return status !== "pending" && status !== "running";
}
