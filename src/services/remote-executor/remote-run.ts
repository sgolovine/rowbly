// The events of one remote run: the frames of the host, the outbox sync after the end, and the end of the wait.

import type { WorkerEvents, WorkerFailure } from "../factory-manager/worker-executor.js";
import type { HostReceipt } from "../host-agent/host-agent-control.js";
import type { HostRunState } from "../host-agent/host-run-state.js";
import { mapInOrder } from "../in-order/in-order.js";
import { Store } from "../store/store.js";
import type { ThreadRecord } from "../thread/thread.js";
import type { RemoteRun, RemoteRunState } from "./remote-types.js";
import { finalActivity, hasEnded, newFacts, type RunFact, receiptFailure, runEnd } from "./run-frames.js";

/** Makes the state of a new remote run. */
export function newRemoteRun(thread: ThreadRecord, host: string, events: WorkerEvents): RemoteRun {
  return {
    threadId: thread.id,
    host,
    events,
    store: new Store<RemoteRunState>({ sent: {}, sessionOpened: false, closed: false, chain: Promise.resolve() }),
    done: new AbortController(),
  };
}

/** Resolves when the signal aborts. */
export function waitForAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/** Runs a step after the earlier steps of the run. A step that throws does not stop the later steps. */
function enqueue(run: RemoteRun, step: () => Promise<void>): void {
  run.store.update((state) => ({ chain: state.chain.then(step).catch(() => undefined) }));
}

/** Ends the wait of the launch without an event. The Thread keeps its last status. */
export function endWait(run: RemoteRun): void {
  run.store.update(() => ({ closed: true }));
  run.done.abort();
}

/** Sends the failure of the run one time, and ends the wait. */
export async function failRun(run: RemoteRun, failure: WorkerFailure): Promise<void> {
  if (run.store.current.closed) {
    return;
  }

  run.store.update(() => ({ closed: true }));

  try {
    await run.events.failed(failure);
  } finally {
    run.done.abort();
  }
}

async function sendFact(run: RemoteRun, fact: RunFact): Promise<void> {
  if (fact.kind === "worktree") {
    await run.events.worktreeReady(fact.worktree);
    return;
  }

  if (fact.kind === "session") {
    await run.events.sessionOpened(fact.session);
    run.store.update(() => ({ sessionOpened: true }));
    return;
  }

  await (fact.kind === "activity" ? run.events.activity(fact.activity) : run.events.resultReported(fact.result));
}

/** Sends the end of the run: the completion or the failure, then the final usage when the session opened. */
async function sendEnd(run: RemoteRun, ended: HostRunState): Promise<void> {
  const end = runEnd(ended);

  await (end.kind === "failed" ? run.events.failed(end.failure) : run.events.completed(end.result, end.stop));

  const activity = finalActivity(ended);

  if (activity) {
    await run.events.finished(activity);
  }
}

/** Ends a run that ended on the host and whose outbox is applied. A run that is closed does nothing. */
export async function endRun(run: RemoteRun): Promise<void> {
  const { ended, closed } = run.store.current;

  if (closed || !ended) {
    return;
  }

  run.store.update(() => ({ closed: true }));

  try {
    await sendEnd(run, ended);
  } finally {
    run.done.abort();
  }
}

/**
 * Applies the outbox of the host, then ends the run. When the sync fails, the run waits: the next scan applies the
 * outbox and ends it.
 */
async function syncAndEnd(run: RemoteRun, sync: (host: string) => Promise<void>): Promise<void> {
  try {
    await sync(run.host);
  } catch {
    return;
  }

  await endRun(run);
}

/** Sends the new values of the frame. An event that throws fails the run, and `stopHost` stops the work on the host. */
async function applyRunFrame(run: RemoteRun, frame: HostRunState, hooks: RunHooks): Promise<void> {
  const { closed, ended } = run.store.current;

  if (closed || ended) {
    return;
  }

  try {
    const { sent, facts } = newFacts(run.store.current.sent, frame);

    await mapInOrder(facts, (fact) => sendFact(run, fact));
    run.store.update(() => ({ sent }));
  } catch (error) {
    await hooks.stopHost(run).catch(() => undefined);
    await failRun(run, { error, sessionOpened: run.store.current.sessionOpened });

    return;
  }

  if (hasEnded(frame)) {
    run.store.update(() => ({ ended: frame }));
    await syncAndEnd(run, hooks.sync);
  }
}

/** The actions of the executor that a run uses. */
export interface RunHooks {
  readonly sync: (host: string) => Promise<void>;
  readonly stopHost: (run: RemoteRun) => Promise<void>;
  /** Takes a run frame of a Thread without an active run, for example the end of an abandoned Thread. */
  readonly otherRun?: (host: string, frame: HostRunState) => void;
}

/** Takes a `run` frame of the host. Only a frame of the command of the run belongs to it. */
export function takeRunFrame(run: RemoteRun, frame: HostRunState, hooks: RunHooks): void {
  if (frame.requestId !== run.store.current.commandId) {
    return;
  }

  enqueue(run, () => applyRunFrame(run, frame, hooks));
}

/** Takes a receipt of the command of the run. A rejected command fails the run. */
export function takeReceipt(run: RemoteRun, receipt: HostReceipt): void {
  const failure = receiptFailure(receipt);

  if (failure) {
    enqueue(run, () => failRun(run, failure));
  }
}

/** True when the run waits for the outbox sync of its host. */
export function waitsForSync(run: RemoteRun): boolean {
  const { ended, closed } = run.store.current;

  return !!ended && !closed;
}

/**
 * Ends each run of the list that waits for the sync. The caller applied the outbox after the runs ended. An event that
 * throws does not stop the end of the other runs.
 */
export async function endSyncedRuns(runs: readonly RemoteRun[]): Promise<void> {
  await mapInOrder(runs, (run) => endRun(run).catch(() => undefined));
}
