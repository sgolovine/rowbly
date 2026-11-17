// The adoption of the remote worker Threads of a previous daemon. The run of such a Thread continues on its worker host
// after a restart. The new manager follows that run: it sends no new `launch` or `resume` command.

import { mapInOrder } from "../in-order/in-order.js";
import { Store, withEntry } from "../store/store.js";
import { getStory, type Story } from "../story/story.js";
import { adoptThreadRun, LOCAL_HOST, listThreads, type ThreadRecord } from "../thread/thread.js";
import { isActiveStatus, type Manager, serial, setState } from "./manager-state.js";
import { hostSynced, waitForHostSync } from "./remote-dispatch.js";
import { type WorkerEvents, type WorkerLaunch, workerControl } from "./worker-executor.js";
import { type LaunchState, releaseWorker, workerEvents } from "./worker-launch.js";

/** True when the Thread is an active worker on a worker host. */
function isAdoptable(thread: ThreadRecord): boolean {
  return (
    thread.role === "worker" &&
    isActiveStatus(thread.status) &&
    !!thread.storyId &&
    !!thread.host &&
    thread.host !== LOCAL_HOST
  );
}

/** Follows the adopted run until it ends, then frees the slot and the host sync of the Story. */
async function runAdopted(manager: Manager, request: WorkerLaunch, events: WorkerEvents): Promise<void> {
  try {
    await manager.remote?.adopt(request, events);
  } finally {
    hostSynced(manager, request.story.id);
    await releaseWorker(manager, request.thread.id);
  }
}

/**
 * Registers the active worker of the adopted Thread on its host, so that its slot counts at once, and starts the task
 * that follows its run. The Story waits for the host sync until the run ended and its outbox is applied.
 */
function startAdoptedTask(manager: Manager, thread: ThreadRecord, story: Story): void {
  const provider = thread.model ? { provider: thread.model.provider } : {};
  const launch = new Store<LaunchState>({ id: thread.id, ...provider });
  const request: WorkerLaunch = { thread, story };
  const events = workerEvents(manager, launch, request);
  const control = manager.remote ? { control: workerControl(manager.remote, thread.id) } : {};
  const task = Promise.resolve().then(() => runAdopted(manager, request, events));

  waitForHostSync(manager, story.id);
  setState(manager, (state) => ({
    active: withEntry(state.active, thread.id, { task, host: thread.host ?? LOCAL_HOST, ...control }),
  }));
}

/** Takes the ownership of the last run of the Thread, then follows its run. A Thread without its Story stays. */
async function adoptThread(manager: Manager, thread: ThreadRecord): Promise<void> {
  const story = await getStory({ id: thread.storyId as string }, manager.ctx).catch(() => undefined);

  if (!story) {
    return;
  }

  const input = { expectedRevision: thread.revision, ownerToken: manager.owner.token };
  const adopted = await serial(manager, () => adoptThreadRun(thread.id, input, manager.ctx));

  startAdoptedTask(manager, adopted, story);
}

/**
 * Adopts each active worker Thread on a worker host, before the first factory pass. Only a manager with remote
 * dispatch adopts. A Thread that cannot be adopted keeps its status.
 */
export async function adoptRemoteThreads(manager: Manager): Promise<void> {
  if (!manager.remote) {
    return;
  }

  const { threads } = await listThreads({ role: "worker" }, manager.ctx);

  await mapInOrder(threads.filter(isAdoptable), (thread) => adoptThread(manager, thread).catch(() => undefined));
}
