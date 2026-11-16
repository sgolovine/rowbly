import { ConflictError } from "../errors/errors.js";
import { steeringMessage } from "../messages/messages.js";
import { getThread } from "../thread/thread.js";
import { getState, type Manager, serial } from "./manager-state.js";
import type { WorkerControl } from "./worker-executor.js";

/** Gives the executor control of the expected run of a running worker. Otherwise throws the reason. */
async function steerableWorker(manager: Manager, id: string, expectedRunId: string): Promise<WorkerControl> {
  const thread = await getThread(id, manager.ctx);
  const lastRun = thread.runs.at(-1);

  if (lastRun?.id !== expectedRunId || lastRun?.ownerToken !== manager.owner.token) {
    throw new ConflictError("Worker run changed");
  }

  const worker = getState(manager).active.get(id);

  if (!worker || thread.status !== "running") {
    throw new ConflictError("Worker is not running");
  }

  if (!worker.control) {
    throw new ConflictError("Worker has no session");
  }

  return worker.control;
}

/**
 * Gives a message of a person to the expected run of a running worker. The executor refuses a worker that does not
 * work now, because a new prompt outside the worker run can break its result.
 */
export async function steerWorker(manager: Manager, id: string, expectedRunId: string, message: string): Promise<void> {
  const control = await serial(manager, () => steerableWorker(manager, id, expectedRunId));

  await control.steer(steeringMessage(message));
}
