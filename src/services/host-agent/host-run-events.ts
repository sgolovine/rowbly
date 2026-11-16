import { isFinalCheck } from "../check-queue/check-order.js";
import type { CheckJob } from "../check-queue/check-types.js";
import { threadCheck, withCheck } from "../check-queue/thread-checks.js";
import { ConflictError, RowblyError } from "../errors/errors.js";
import type {
  WorkerActivity,
  WorkerEvents,
  WorkerExecutor,
  WorkerFailure,
  WorkerSession,
  WorkerWorktree,
} from "../factory-manager/worker-executor.js";
import type { Store } from "../store/store.js";
import type { WorkerResult } from "../thread/thread.js";
import type { HostAgentPaths } from "./host-agent-paths.js";
import { type HostRunEndReason, type HostRunState, writeHostRun } from "./host-run-state.js";

const FAILURE_MESSAGE_LIMIT = 1000;

/** The short-lived state of one run. */
export interface RunProgress {
  readonly state: HostRunState;
  /** The reason of a `stop-thread`, a `cancel-thread` or a stop of the agent. The first request wins. */
  readonly stopReason?: "stopped" | "cancelled";
  readonly executor?: WorkerExecutor;
  /** The last write of `run.json`. Each write waits for the write before it, so that the last state wins. */
  readonly writes: Promise<void>;
}

/** The fixed environment of one run, and the store of its state. */
export interface HostRun {
  readonly paths: HostAgentPaths;
  readonly threadId: string;
  readonly message: string;
  readonly store: Store<RunProgress>;
}

/** Writes the current state after the earlier writes. */
function persist(run: HostRun, durable: boolean): Promise<void> {
  const next = run.store.current.writes
    .catch(() => undefined)
    .then(() => writeHostRun(run.paths, run.store.current.state, durable));

  run.store.update(() => ({ writes: next }));

  return next;
}

/** Changes the state and writes it. */
export function changeRun(run: HostRun, patch: Partial<HostRunState>, durable = true): Promise<void> {
  const updatedAt = new Date().toISOString();

  run.store.update(({ state }) => ({ state: { ...state, ...patch, updatedAt } }));

  return persist(run, durable);
}

/** True after a stop or a cancel of the run. */
export function runStopping(run: HostRun): boolean {
  return run.store.current.stopReason !== undefined;
}

/** Stops the next step of a run that has a stop request. The executor then reports a failure. */
export function throwIfStopping(run: HostRun): void {
  if (runStopping(run)) {
    throw new ConflictError(`The run of Thread ${run.threadId} was ${run.store.current.stopReason}`);
  }
}

/** The code and the message of an error, for `run.json`. */
export function failureOf(failure: WorkerFailure) {
  const { error, sessionOpened } = failure;
  const code = error instanceof RowblyError ? error.code : "WORKER_FAILED";
  const message = (error instanceof Error ? error.message : String(error)).slice(0, FAILURE_MESSAGE_LIMIT);

  return { code, message, sessionOpened };
}

async function worktreeReady(run: HostRun, worktree: WorkerWorktree): Promise<void> {
  throwIfStopping(run);
  await changeRun(run, { worktree });
}

async function sessionOpened(run: HostRun, session: WorkerSession): Promise<void> {
  throwIfStopping(run);
  await changeRun(run, { session, phase: "running" });
}

function workerMessage(run: HostRun): Promise<string> {
  throwIfStopping(run);

  return Promise.resolve(run.message);
}

function completed(run: HostRun, result: WorkerResult | undefined): Promise<void> {
  return changeRun(run, result ? { result } : {});
}

function finished(run: HostRun, activity: WorkerActivity): Promise<void> {
  return changeRun(run, { activity, usage: activity.usage });
}

/** The events of the executor. Each event writes `run.json`. Only the activity writes without a sync. */
export function runEvents(run: HostRun): WorkerEvents {
  return {
    worktreeReady: (worktree) => worktreeReady(run, worktree),
    sessionOpened: (session) => sessionOpened(run, session),
    message: () => workerMessage(run),
    prompted: () => undefined,
    activity: (activity) => changeRun(run, { activity }, false),
    resultReported: (result) => changeRun(run, { result }),
    stopping: () => runStopping(run),
    completed: (result) => completed(run, result),
    failed: (failure) => changeRun(run, { failure: failureOf(failure) }),
    finished: (activity) => finished(run, activity),
  };
}

/**
 * Writes a job change to the `checks` list of `run.json`. A final status writes durably. A change after the end of
 * the run also writes. A failed write waits for the next change.
 */
export function recordRunCheck(run: HostRun, job: CheckJob, now: number): void {
  const checks = withCheck(run.store.current.state.checks ?? [], threadCheck(job, now));

  void changeRun(run, { checks }, isFinalCheck(job.status)).catch(() => undefined);
}

/** The end reason: the stop request, else `failed` after a failure, else `completed`. */
function endReason(progress: RunProgress): HostRunEndReason {
  if (progress.stopReason) {
    return progress.stopReason;
  }

  return progress.state.failure ? "failed" : "completed";
}

/** Writes the end of the run. */
export function endRun(run: HostRun): Promise<void> {
  const reason = endReason(run.store.current);

  return changeRun(run, { phase: "ended", endReason: reason, endedAt: new Date().toISOString() });
}

/** Records the stop request and asks the executor to stop the session. A run without a session stops at its next step. */
export async function requestStop(run: HostRun, reason: "stopped" | "cancelled"): Promise<void> {
  const { stopReason } = run.store.current;

  if (!stopReason) {
    run.store.update(() => ({ stopReason: reason }));
  }

  const { executor } = run.store.current;
  const effective = run.store.current.stopReason;

  if (!executor) {
    return;
  }

  await (effective === "cancelled" ? executor.cancel(run.threadId) : executor.stop(run.threadId));
}
