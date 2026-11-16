import { randomUUID } from "node:crypto";
import { ConflictError } from "../errors/errors.js";
import { mapInOrder } from "../in-order/in-order.js";
import { searchStories } from "../story/story.js";
import { listThreads, type ThreadRecord } from "../thread/thread.js";
import { getState, isProviderPaused, type Manager } from "./manager-state.js";
import { networkWaitingThreads } from "./network-wait.js";
import { failureText, type StepResult } from "./supervisor-steps.js";
import { resumeWorker } from "./worker-reservation.js";

/**
 * Resumes each worker Thread that failed with a connectivity error when the pause of its provider has ended.
 * The resume adds a new run to the same Thread and session. It does not wait for the supervisor.
 * A Thread that cannot resume now, for example because no slot is free, tries again on the next scan.
 */
export async function resumeNetworkThreads(manager: Manager): Promise<StepResult> {
  if (getState(manager).stopping) {
    return undefined;
  }

  const stories = await searchStories({}, manager.ctx);
  const { threads } = await listThreads({ role: "worker" }, manager.ctx);
  const waiting = await networkWaitingThreads(threads, stories);

  const ready = waiting.filter((thread) => !thread.model || !isProviderPaused(manager, thread.model.provider));
  const problems = await mapInOrder(ready, (thread) => resumeOne(manager, thread));

  return problems.find((problem) => problem !== undefined);
}

/** Resumes one Thread. A conflict, for example a full worker capacity, is not a problem. */
async function resumeOne(manager: Manager, thread: ThreadRecord): Promise<string | undefined> {
  const lastRun = thread.runs.at(-1)?.id;

  if (!lastRun || getState(manager).stopping) {
    return undefined;
  }

  try {
    await resumeWorker(manager, thread.id, lastRun, `network-${randomUUID()}`);

    return undefined;
  } catch (error) {
    return error instanceof ConflictError ? undefined : failureText(`Automatic resume of ${thread.id} failed`, error);
  }
}
