// The factory loop. Each pass reconciles the Project, runs the side steps and starts the workers.
import { ConflictError } from "../errors/errors.js";
import { type PolicyDecision, STOP_CONFIRMED_REASON } from "../factory-policy/factory-policy.js";
import { readFactoryState, updateFactoryState, updateFactoryStateIfChanged } from "../factory-state/factory-state.js";
import { withEntry, withoutEntry } from "../store/store.js";
import { searchStories } from "../story/story.js";
import { watchStories } from "../story-watch/story-watch.js";
import { listThreads, projectAttempts } from "../thread/thread.js";
import { shutdownFactory } from "./factory-shutdown.js";
import { failureText, runSideSteps, runStep } from "./factory-steps.js";
import { getState, type Manager, notify, serial, setState } from "./manager-state.js";
import { classifiedStages, persistStatus, scan } from "./manager-status.js";
import { resumeNetworkThreads } from "./network-resume.js";
import { syncRemoteHosts } from "./remote-dispatch.js";
import { upstreamAttention, withUpstreamAttention } from "./upstream-attention.js";
import { pullUpstreamStories } from "./upstream-pull-step.js";
import { withoutStaleWorkerAttention } from "./worker-attention.js";
import { dispatchWorkers } from "./worker-dispatch.js";

/** Runs the factory loop until the factory stops, then shuts the factory down. */
export async function runFactory(manager: Manager): Promise<void> {
  const { stopping, loopStarted } = getState(manager);

  if (stopping) {
    return;
  }

  if (loopStarted) {
    throw new ConflictError("Factory loop is already running");
  }

  const loopDone = new Promise<void>((resolve) => {
    setState(manager, () => ({ finishLoop: resolve }));
  });

  setState(manager, () => ({ loopStarted: true, loopDone }));

  try {
    await runUntilStopped(manager);
  } finally {
    getState(manager).finishLoop();
    await shutdownFactory(manager);
  }
}

async function runUntilStopped(manager: Manager): Promise<void> {
  const heartbeat = setInterval(() => {
    void serial(manager, () => persistStatus(manager)).catch(() => {});
  }, 5000);

  heartbeat.unref();
  setState(manager, () => ({ phase: "ready", heartbeat }));

  if (getState(manager).stopping) {
    return;
  }

  const unwatch = await watchStories(() => notify(manager), manager.ctx, { includeState: false });
  const timer = setInterval(() => notify(manager), 30_000);

  timer.unref();
  setState(manager, () => ({ unwatch, timer }));

  await serial(manager, () => persistStatus(manager));

  while (!getState(manager).stopping) {
    if (!getState(manager).dirty) {
      await waitForWake(manager);
      continue;
    }

    setState(manager, () => ({ dirty: false }));

    try {
      await passOnce(manager);
    } catch (error) {
      await recordReconcileFailure(manager, error);
    }
  }
}

async function waitForWake(manager: Manager): Promise<void> {
  await new Promise<void>((resolve) => {
    const { dirty, stopping } = setState(manager, () => ({ wake: resolve }));

    if (dirty || stopping) {
      resolve();
    }
  });

  setState(manager, () => ({ wake: undefined }));
}

async function recordReconcileFailure(manager: Manager, error: unknown): Promise<void> {
  if (getState(manager).stopping) {
    return;
  }

  const text = failureText("Project reconciliation failed; retry on the next scan", error);

  setState(manager, (state) => ({ attention: withEntry(state.attention, "reconcile", { text }) }));
  await serial(manager, () => persistStatus(manager)).catch(() => {});
}

/**
 * Reconciles the Project, runs the side steps, then starts a worker for each `start` and `retry` decision.
 * Only a failed scan stops the pass. The other steps record their failures as attention. A pass makes no model call.
 */
async function passOnce(manager: Manager): Promise<void> {
  const decisions = await reconcilePolicy(manager);

  await runStep(manager, "pull-upstream", "Upstream Story move failed", () => pullUpstreamStories(manager));
  await refreshUpstreamAttention(manager);
  await removeStaleWorkerAttention(manager);
  setState(manager, (state) => ({ attention: withoutEntry(state.attention, "reconcile") }));
  await runSideSteps(manager);
  // After the provider pause check, so that a pause that ended lets its network Threads resume.
  await runStep(manager, "network-resume", "Automatic resume failed", () => resumeNetworkThreads(manager));

  if (getState(manager).stopping) {
    return;
  }

  // After the network resume, because a resume can change the decisions.
  await runStep(manager, "dispatch", "Worker dispatch failed", () => dispatchWorkers(manager));
  requestPassAfterStop(manager, decisions);

  if (getState(manager).stopping) {
    return;
  }

  await serial(manager, () => persistStatus(manager));
}

/** Asks for one more pass when the scan confirmed a worker stop, so that the next worker of the Story can start. */
function requestPassAfterStop(manager: Manager, decisions: readonly PolicyDecision[]): void {
  if (decisions.some((decision) => decision.reason === STOP_CONFIRMED_REASON)) {
    notify(manager);
  }
}

/**
 * Applies the outbox of the worker hosts with active remote Threads, then writes the current policy decisions to the
 * factory state, and gives them back. The sync runs before the lifecycle queue, because the apply uses the queue.
 */
export async function reconcilePolicy(manager: Manager) {
  await syncRemoteHosts(manager);

  return serial(manager, async () => {
    await projectWorkerThreads(manager);

    const policy = await scan(manager);

    await updateFactoryState(manager.paths.root, () => policy.state, manager.ctx);

    return policy.decisions;
  });
}

/**
 * Projects each worker Thread into its attempt again. A Thread change projects its attempt only after the Thread file
 * changed, so a failed projection leaves an attempt that does not stop, and its Story waits with
 * `worker stop unconfirmed`. The Threads are read under the state lock, so that the projection uses their last status.
 */
async function projectWorkerThreads(manager: Manager): Promise<void> {
  await updateFactoryStateIfChanged(
    manager.paths.root,
    async (state) => {
      const { threads } = await listThreads({ role: "worker" }, manager.ctx);
      const projected = projectAttempts(state, threads);

      return projected.changed ? projected.state : undefined;
    },
    manager.ctx,
  );
}

/** Replaces the `upstream-stuck:` attention entries with the upstream Stories that cannot progress now. */
async function refreshUpstreamAttention(manager: Manager): Promise<void> {
  const stories = await searchStories({}, manager.ctx);
  const stages = await classifiedStages(manager);
  const state = await readFactoryState(manager.paths.root, manager.ctx);

  const entries = upstreamAttention(stories, stages, state.parked ?? {});

  setState(manager, (current) => ({ attention: withUpstreamAttention(current.attention, entries) }));
}

/** Removes the `worker:` attention entries of the Stories that are deleted or that left the Stage of their worker. */
async function removeStaleWorkerAttention(manager: Manager): Promise<void> {
  const stories = await searchStories({}, manager.ctx);
  const { threads } = await listThreads({ role: "worker" }, manager.ctx);

  setState(manager, (current) => ({
    attention: withoutStaleWorkerAttention(current.attention, stories, threads),
  }));
}
