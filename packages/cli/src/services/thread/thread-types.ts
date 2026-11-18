import type { ModelChoice } from "../factory-settings/factory-settings.js";

/** The host ID of the main machine of the Project. All current work runs on it. */
export const LOCAL_HOST = "local";

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

/** A short record of one check that the worker of the Thread asked for. `runtime/checks/` has the full record. */
export interface ThreadCheck {
  readonly id: string;
  readonly key: string;
  readonly scope: "full" | "narrow";
  readonly status: string;
  readonly head?: string;
  readonly durationSeconds?: number;
}

/** Why a remote Thread became abandoned: a cancel while its host was offline, or a release. */
export type AbandonReason = "cancel" | "release";

/**
 * The note of a remote Thread that the user cancelled or released while its host was offline. The main machine holds
 * each later outbox entry of the Thread and does not apply it automatically.
 */
interface ThreadAbandon {
  readonly at: string;
  readonly reason: AbandonReason;
  /** The last applied `seq` of the host at the time of the abandon. Only the entries after it are held. */
  readonly appliedSeq: number;
}

/** The end of the last run of an abandoned Thread on its host. It does not change the status of the Thread. */
export interface RemoteOutcome {
  readonly endReason: "completed" | "failed" | "stopped" | "cancelled";
  readonly endedAt?: string;
  readonly result?: WorkerResult;
  readonly failure?: { readonly code: string; readonly message: string };
}

export interface ThreadRecord {
  // Identity
  readonly version: 1;
  readonly id: string;
  readonly revision: number;
  readonly role: "supervisor" | "worker";
  readonly storyId?: string;
  /** The `uid` of the Story of a worker Thread. An old Thread, or a Thread of a Story without a `uid`, has none. */
  readonly storyUid?: string;
  readonly stage?: string;
  readonly attemptNumber?: number;
  readonly parentThreadId?: string;
  readonly model?: ModelChoice;
  /** The host ID of the machine that runs the Thread. A read gives `LOCAL_HOST` for a file without it. */
  readonly host?: string;

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
  /** The last checks of the worker, oldest first. */
  readonly checks?: readonly ThreadCheck[];

  // Remote abandon
  /** Set when the user cancelled or released the remote Thread while its host was offline. */
  readonly abandoned?: ThreadAbandon;
  /** The end of the run on the host, after the Thread became abandoned. */
  readonly remoteOutcome?: RemoteOutcome;
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
    | "checks"
    | "abandoned"
    | "remoteOutcome"
  >
>;

/** Tells if a status is final: a pending or running Thread is not. */
export function isTerminal(status: ThreadStatus): boolean {
  return status !== "pending" && status !== "running";
}

/** Tells if the Thread is an abandoned remote Thread. A later step drops the inbound updates of such a Thread. */
export function isAbandoned(thread: Pick<ThreadRecord, "abandoned">): boolean {
  return thread.abandoned !== undefined;
}
