import type { ModelChoice } from "../factory-settings/factory-settings.js";

export type ThreadStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

/** One run of a Thread. A resume adds a run; the last run has the status of the Thread. */
export interface ThreadRun {
  readonly id: string;
  readonly ownerToken: string;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly status: ThreadStatus;
  readonly reason?: string;
}

export interface WorkerResult {
  readonly outcome: string;
  readonly summary: string;
  readonly branch?: string;
  readonly commits?: readonly string[];
  readonly pullRequest?: string;
  readonly blockers: readonly string[];
  readonly problems: readonly string[];
}

export interface ThreadRecord {
  // Identity
  readonly version: 1;
  readonly id: string;
  readonly revision: number;
  readonly role: "supervisor" | "worker";
  readonly storyId?: string;
  readonly stage?: string;
  readonly attemptNumber?: number;
  readonly parentThreadId?: string;
  readonly model?: ModelChoice;

  // Lifecycle
  readonly status: ThreadStatus;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly session: {
    readonly id: string;
    readonly file: string | null;
    readonly formatVersion?: number;
    readonly leafId?: string;
  };
  readonly cwd: string;
  readonly worktree?: string;
  readonly branch?: string;
  readonly runs: readonly ThreadRun[];

  // Outcome
  readonly result?: WorkerResult;
  readonly error?: {
    readonly class: "auth" | "quota" | "transient" | "launch" | "storage" | "configuration" | "unknown";
    readonly code: string;
    readonly message: string;
    readonly retryAt?: string;
  };
  readonly resumable: boolean;

  // Activity
  readonly lastActivityAt?: string;
  readonly lastTool?: string;
  readonly usage?: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly cost: number;
  };
}

export interface ThreadList {
  readonly threads: readonly ThreadRecord[];
  readonly issues: readonly { readonly file: string; readonly message: string }[];
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
