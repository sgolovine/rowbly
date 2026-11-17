import type { ModelChoice } from "../factory-settings/factory-settings.js";
import type { Story } from "../story/story.js";
import type { ThreadRecord, WorkerResult } from "../thread/thread.js";

/** The token counts and the cost of a worker session. */
export type WorkerUsage = NonNullable<ThreadRecord["usage"]>;

/** The worktree of a worker. A detached worktree has no branch. */
export interface WorkerWorktree {
  readonly path: string;
  readonly branch: string | undefined;
}

/** The session of a worker after it opens. `file` is relative to the runtime folder. */
export interface WorkerSession {
  readonly model: ModelChoice;
  readonly file: string;
}

/** The last activity of a worker and the usage of its session. */
export interface WorkerActivity {
  readonly lastActivityAt: string;
  readonly lastTool?: string;
  readonly usage: WorkerUsage;
}

/** A failure of a worker run. `sessionOpened` tells if the failure came after the session opened. */
export interface WorkerFailure {
  readonly error: unknown;
  readonly sessionOpened: boolean;
}

/**
 * The place of a worker run for its message: the Project root of `-C`, the CLI shim and the lock of the command
 * prefix. A remote run gives the copy, the shim and the `write.lock` of the host.
 */
export interface RunLocation {
  readonly root: string;
  readonly shim: string;
  readonly lock: string;
  /** True when the message has the checks block. A remote worker has no checks. */
  readonly checks: boolean;
}

/** How a run that completed stopped: a stop of the worker or a cancel. */
export type RunStop = "stopped" | "cancelled";

/**
 * One reserved worker run. The Thread record tells if the run is new or a resume: a resume has more than one run
 * and keeps the worktree of the Thread.
 */
export interface WorkerLaunch {
  readonly thread: ThreadRecord;
  readonly story: Story;
}

/**
 * The events of one worker run, from the executor to the manager. The executor awaits each event before the next
 * step. An event that throws, for example "Factory is stopping", stops the run. Only the manager changes the Thread.
 */
export interface WorkerEvents {
  // Steps of the launch
  readonly worktreeReady: (worktree: WorkerWorktree) => Promise<void>;
  readonly sessionOpened: (session: WorkerSession) => Promise<void>;
  /**
   * Gives the worker message. The message needs the worktree path and the model of the session. Without a location,
   * the message has the canonical Project root, the shim of the daemon and the Project write lock.
   */
  readonly message: (worktree: string, model: ModelChoice, location?: RunLocation) => Promise<string>;
  /** The first prompt of the worker completed without a provider error. */
  readonly prompted: (model: ModelChoice) => void;

  // Progress of the run
  readonly activity: (activity: WorkerActivity) => Promise<void>;
  readonly resultReported: (result: WorkerResult) => Promise<void>;
  /** Tells if the factory stops. A stopping factory does not ask the worker again for a result. */
  readonly stopping: () => boolean;

  // End of the run
  /**
   * The worker run ended. `result` is undefined when the worker did not report a result. `stop` tells that a stop or a
   * cancel ended the run, for example on a worker host.
   */
  readonly completed: (result: WorkerResult | undefined, stop?: RunStop) => Promise<void>;
  readonly failed: (failure: WorkerFailure) => Promise<void>;
  /** The session closes. Only a run with an open session sends it, with the final activity and usage. */
  readonly finished: (activity: WorkerActivity) => Promise<void>;
}

/**
 * Runs the workers of one manager. The manager keeps the slots, the Thread changes and all decisions.
 * `launch` reports each error as a `failed` event, and resolves when the run ends.
 */
export interface WorkerExecutor {
  readonly launch: (launch: WorkerLaunch, events: WorkerEvents) => Promise<void>;
  /** Stops the worker. The manager makes the Thread `interrupted`. */
  readonly stop: (threadId: string) => Promise<void>;
  /** Stops the worker. The manager makes the Thread `cancelled`. */
  readonly cancel: (threadId: string) => Promise<void>;
  /**
   * Stops a remote worker as a cancel, but the Thread becomes abandoned with the reason `release`. Only the remote
   * executor has it.
   */
  readonly release?: (threadId: string) => Promise<void>;
  /** Gives a steering message to a worker that works now. Otherwise throws "Worker is not working now". */
  readonly steer: (threadId: string, message: string) => Promise<void>;
}

/** The operations of one worker run. The manager keeps it on the active worker after the session opens. */
export interface WorkerControl {
  readonly stop: () => Promise<void>;
  readonly cancel: () => Promise<void>;
  /** Releases a remote worker. A control without a release cannot release its worker. */
  readonly release?: () => Promise<void>;
  readonly steer: (message: string) => Promise<void>;
}

/** Gives the operations of the executor for one Thread. */
export function workerControl(executor: WorkerExecutor, threadId: string): WorkerControl {
  return {
    stop: () => executor.stop(threadId),
    cancel: () => executor.cancel(threadId),
    release: () => (executor.release ? executor.release(threadId) : executor.cancel(threadId)),
    steer: (message) => executor.steer(threadId, message),
  };
}
