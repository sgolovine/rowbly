import { stopCheckQueue } from "../check-queue/check-queue.js";
import { releaseFactoryOwnership } from "../factory-ownership/factory-ownership.js";
import { LOCAL_HOST } from "../thread/thread-types.js";
import { getState, type Manager, serial, setState } from "./manager-state.js";
import { persistStatus } from "./manager-status.js";

/** Stops the factory one time. Later calls get the same task. */
export function shutdownFactory(manager: Manager): Promise<void> {
  const { shutdownTask } = getState(manager);

  if (shutdownTask) {
    return shutdownTask;
  }

  const task = stopFactory(manager);

  setState(manager, () => ({ shutdownTask: task }));

  return task;
}

async function stopFactory(manager: Manager): Promise<void> {
  const state = setState(manager, () => ({ stopping: true, phase: "stopping" }));

  state.unwatch?.();
  clearInterval(state.timer);
  clearInterval(state.heartbeat);
  clearInterval(state.hostHeartbeat);
  clearTimeout(state.deadlineTimer);
  state.wake?.();

  // The remote executor stops the workers of the worker hosts. It waits for each run on a connected host.
  const workers = [...state.active.values()].filter((worker) => worker.host === LOCAL_HOST);

  await Promise.all([
    ...workers.map((a) => a.control?.stop()),
    manager.remote?.shutdown(manager.deps.remoteStopTimeoutMs),
  ]);
  // No check process stays alive after a stop.
  await stopCheckQueue(manager.checks);
  await getState(manager).loopDone;
  // A Git merge or push must complete before the write lock goes away with this process.
  await getState(manager).syncTask;
  await getState(manager).heartbeatTask;
  await Promise.all([...getState(manager).active.values()].map((a) => a.task));

  await serial(manager, async () => {
    setState(manager, () => ({ phase: "stopped" }));
    await persistStatus(manager);
  });

  await manager.deps.runtime.settleCredentialWrites();
  await releaseFactoryOwnership(manager.paths, manager.owner.token);
}
