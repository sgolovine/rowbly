// The manager side of the end of one worker run: the final Thread status and the worker attention entry.
import { getStory } from "../story/story.js";
import { getThread, type ThreadRecord, type WorkerResult } from "../thread/thread.js";
import {
  changeThread,
  getState,
  isActiveStatus,
  type Manager,
  pauseProvider,
  serial,
  setState,
} from "./manager-state.js";
import { workerFailure } from "./network-wait.js";
import { withFailureAttention, withResultAttention } from "./worker-attention.js";
import type { RunStop, WorkerFailure } from "./worker-executor.js";

/** The end of one worker run. `stop` is set when a stop or a cancel on a worker host ended the run. */
export interface Completion {
  readonly id: string;
  readonly intent: ThreadRecord;
  readonly storyId: string;
  readonly result: WorkerResult | undefined;
  readonly stop?: RunStop;
}

/** The launch of a worker that failed. The provider comes from the session, when the session opened. */
interface FailedLaunch {
  readonly id: string;
  readonly provider?: string;
}

/**
 * Records the end of a worker run. A completed run applies the result that the worker reported to the attention
 * entry `worker:<storyId>`. The problem that the manager adds for a Story that did not move does not count.
 */
export async function completeWorker(manager: Manager, completion: Completion): Promise<void> {
  const { id, intent, storyId, result: reported, stop } = completion;
  const thread = await getThread(id, manager.ctx);

  if (["interrupted", "cancelled"].includes(thread.status)) {
    return;
  }

  if (stop) {
    await stopWorkerThread(manager, thread, reported, stop);
    return;
  }

  const fresh = await getStory({ id: storyId }, manager.ctx).catch(() => undefined);
  const result = reported ?? {
    outcome: "unknown",
    summary: "Worker stopped without a result",
    blockers: [],
    problems: [],
  };
  const problems =
    fresh?.stage === intent.stage
      ? [...result.problems.slice(0, 9), "Story remains in the assigned Stage"]
      : result.problems;
  const { stopping } = getState(manager);

  await changeThread(manager, id, stopping ? "interrupted" : "completed", {
    result: { ...result, problems },
    resumable: stopping,
  });

  if (!stopping) {
    setState(manager, (state) => ({ attention: withResultAttention(state.attention, thread, reported) }));
  }
}

/** A run that a stop ends is `interrupted`, and a run that a cancel ends is `cancelled`. Both can resume. */
async function stopWorkerThread(
  manager: Manager,
  thread: ThreadRecord,
  result: WorkerResult | undefined,
  stop: RunStop,
): Promise<void> {
  await changeThread(manager, thread.id, stop === "cancelled" ? "cancelled" : "interrupted", {
    resumable: !!thread.session.file,
    ...(result ? { result } : {}),
  });
}

/** Records a worker failure. A failure that is not a connectivity failure sets the attention entry of the Story. */
export async function failWorker(manager: Manager, launch: FailedLaunch, failure: WorkerFailure): Promise<void> {
  await serial(manager, async () => {
    const thread = await getThread(launch.id, manager.ctx);
    const provider = launch.provider ?? thread.model?.provider;
    const { providers } = setState(manager, (state) => pauseProvider(state, provider, failure.error));

    if (!isActiveStatus(thread.status)) {
      return;
    }

    const { stopping } = getState(manager);
    const pause = provider ? providers.get(provider) : undefined;
    const error = workerFailure(failure.error, { launched: failure.sessionOpened, stopping, retryAt: pause?.retryAt });

    await changeThread(manager, launch.id, stopping ? "interrupted" : "failed", {
      resumable: !!thread.session.file,
      error,
    });

    if (!stopping) {
      setState(manager, (state) => ({ attention: withFailureAttention(state.attention, thread, error) }));
    }
  });
}
