import { releaseFactoryOwnership } from "../factoryOwnership/factoryOwnership.js";
import { getThread } from "../thread/thread.js";
import { changeThread, getState, isActiveStatus, type Manager, serial, setState } from "./managerState.js";
import { persistStatus } from "./managerStatus.js";

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
  clearTimeout(state.deadlineTimer);
  state.wake?.();

  const workers = [...state.active.values()];

  await Promise.all([state.supervisor?.session.abort(), ...workers.map((a) => a.session?.session.abort())]);
  await getState(manager).loopDone;
  await Promise.all([...getState(manager).active.values()].map((a) => a.task));
  await getState(manager).supervisor?.close();

  await serial(manager, async () => {
    await interruptSupervisor(manager);
    setState(manager, () => ({ phase: "stopped" }));
    await persistStatus(manager);
  });

  await manager.deps.runtime.settleCredentialWrites();
  await releaseFactoryOwnership(manager.paths, manager.owner.token);
}

async function interruptSupervisor(manager: Manager): Promise<void> {
  const { supervisorId } = getState(manager);

  if (!supervisorId) {
    return;
  }

  const thread = await getThread(supervisorId, manager.ctx);

  if (isActiveStatus(thread.status)) {
    await changeThread(manager, thread.id, "interrupted", { resumable: !!thread.session.file });
  }
}
