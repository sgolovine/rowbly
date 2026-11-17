// The dispatch of workers to worker hosts: the remote executor of the manager, the executor of each host, and the
// outbox sync and the inbound updates of the hosts with active remote Threads.

import { ConflictError } from "../errors/errors.js";
import { hostProjectId } from "../host-project/host-paths.js";
import { transportOutboxSource } from "../outbox-apply/outbox-source.js";
import { projectWrite } from "../project-write/project-write.js";
import { createRemoteExecutor, type RemoteExecutor } from "../remote-executor/remote-executor.js";
import { withMember, withoutMember } from "../store/store.js";
import { LOCAL_HOST } from "../thread/thread-types.js";
import type { ProjectPaths, ServiceContext } from "../workspace/workspace.js";
import { type Attention, type FactoryDependencies, getState, type Manager, serial, setState } from "./manager-state.js";
import { syncHostOutbox } from "./outbox-attention.js";
import type { WorkerExecutor } from "./worker-executor.js";

/** The prefix of the attention key of a host whose outbox sync failed. */
const SYNC_KEY = "host-sync:";

/** Applies the outbox of the host to the canonical files. A failure of the transport throws. */
async function syncHost(manager: Manager, host: string): Promise<void> {
  const connect = manager.deps.hostConnection;

  if (!connect) {
    throw new ConflictError("Remote dispatch is not available");
  }

  const connection = await connect(host);
  const source = transportOutboxSource({
    transport: connection.transport,
    rowbly: connection.rowbly,
    projectId: hostProjectId(manager.paths.root),
  });

  await syncHostOutbox(manager, host, source);
}

/**
 * Makes the remote executor of a manager with `hostConnection`. It gets the manager later, because the manager is
 * made after its executors.
 */
export function createManagerRemote(
  deps: FactoryDependencies,
  paths: ProjectPaths,
  ctx: ServiceContext,
  manager: () => Manager,
): RemoteExecutor | undefined {
  const { hostConnection } = deps;

  if (!hostConnection) {
    return undefined;
  }

  return createRemoteExecutor({
    paths,
    ctx,
    projectId: hostProjectId(paths.root),
    connect: hostConnection,
    maxWorkers: (host) => getState(manager()).hosts.find((entry) => entry.id === host)?.maxWorkers ?? 1,
    model: (launch) => launch.thread.model ?? getState(manager()).settings.workerModel,
    sync: (host) => syncHost(manager(), host),
    readLocked: (read) => serial(manager(), () => projectWrite(paths.root, read)),
  });
}

/** Gives the executor of a host: the local executor for `local`, else the remote executor. */
export function executorFor(manager: Manager, host: string | undefined): WorkerExecutor {
  if (host === undefined || host === LOCAL_HOST) {
    return manager.executor;
  }

  if (!manager.remote) {
    throw new ConflictError("Remote dispatch is not available", { details: { host } });
  }

  return manager.remote;
}

/** Gives the attention entries with one `host-sync:<host>` entry for each problem, and without the other entries. */
export function withSyncAttention(
  attention: ReadonlyMap<string, Attention>,
  problems: ReadonlyMap<string, string>,
): ReadonlyMap<string, Attention> {
  const kept = [...attention].filter(([key]) => !key.startsWith(SYNC_KEY));
  const added = [...problems].map(([host, problem]): [string, Attention] => [
    `${SYNC_KEY}${host}`,
    { text: `Outbox sync of host ${host} failed: ${problem}`.slice(0, 500) },
  ]);

  return new Map([...kept, ...added]);
}

/**
 * Applies the outbox of each host with an active remote Thread, and ends the remote runs that wait for it. Each host
 * whose sync failed gets the attention entry `host-sync:<host>`. Call it outside the lifecycle queue, because the
 * apply uses the queue.
 */
export async function syncRemoteHosts(manager: Manager): Promise<void> {
  if (!manager.remote) {
    return;
  }

  const problems = await manager.remote.syncHosts();

  setState(manager, (state) => ({ attention: withSyncAttention(state.attention, problems) }));
}

/** Adds the Story of a remote Thread to the Stories that wait for the host sync. */
export function waitForHostSync(manager: Manager, storyId: string): void {
  setState(manager, (state) => ({ hostSync: withMember(state.hostSync, storyId) }));
}

/** Removes the Story of a remote Thread from the Stories that wait for the host sync. */
export function hostSynced(manager: Manager, storyId: string): void {
  setState(manager, (state) => ({ hostSync: withoutMember(state.hostSync, storyId) }));
}
