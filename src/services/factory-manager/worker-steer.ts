import { ConflictError } from "../errors/errors.js";
import { steeringMessage } from "../messages/messages.js";
import type { PiSession } from "../pi-runtime/pi-runtime.js";
import { getThread } from "../thread/thread.js";
import { getState, type Manager, serial } from "./manager-state.js";

/** Gives the Pi session of the expected run of a running worker. Otherwise throws the reason. */
async function steerableSession(manager: Manager, id: string, expectedRunId: string): Promise<PiSession> {
  const thread = await getThread(id, manager.ctx);
  const lastRun = thread.runs.at(-1);

  if (lastRun?.id !== expectedRunId || lastRun?.ownerToken !== manager.owner.token) {
    throw new ConflictError("Worker run changed");
  }

  const worker = getState(manager).active.get(id);

  if (!worker || thread.status !== "running") {
    throw new ConflictError("Worker is not running");
  }

  if (!worker.session) {
    throw new ConflictError("Worker has no session");
  }

  return worker.session;
}

/**
 * Gives a message of a person to the expected run of a running worker. Pi delivers it after the current tool calls.
 * A session that does not stream gets no message, because a new prompt outside the worker run can break its result.
 */
export async function steerWorker(manager: Manager, id: string, expectedRunId: string, message: string): Promise<void> {
  const session = await serial(manager, () => steerableSession(manager, id, expectedRunId));

  if (!session.session.isStreaming) {
    throw new ConflictError("Worker is not working now");
  }

  await session.session.steer(steeringMessage(message));
}
