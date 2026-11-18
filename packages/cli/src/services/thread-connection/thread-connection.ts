// The Threads with the connection facts of their worker host. The facts come from the status file of the factory.

import { type FactoryStatus, getFactoryStatus } from "../factory/factory.js";
import { getThread } from "../thread/thread-files.js";
import { listThreads } from "../thread/thread-list.js";
import type { ThreadList, ThreadRecord } from "../thread/thread-types.js";
import type { ServiceContext } from "../workspace/workspace.js";
import { type HostFacts, type ThreadConnection, threadConnection } from "./connection-lost.js";

export {
  connectionLostText,
  contactText,
  type HostFacts,
  hostLost,
  type LostConnection,
  lastContactMs,
  lostConnections,
  type ThreadConnection,
  threadConnection,
} from "./connection-lost.js";

/** A Thread with its lost connection. A Thread without a lost connection has no `connection` field. */
export type ConnectedThread = ThreadRecord & { readonly connection?: ThreadConnection };

/** Gives the hosts of a factory with a live owner. A factory that is not running gives no hosts. */
export function liveHosts(status: FactoryStatus): readonly HostFacts[] | undefined {
  return status.owner && status.liveness !== "dead" ? status.hosts : undefined;
}

/** Reads the hosts of the factory status. The read uses only files: no SSH and no Pi. */
export async function readLiveHosts(ctx: ServiceContext = {}): Promise<readonly HostFacts[] | undefined> {
  return liveHosts(await getFactoryStatus(ctx));
}

function withConnection(thread: ThreadRecord, hosts: readonly HostFacts[] | undefined): ConnectedThread {
  const connection = threadConnection(thread, hosts);

  return connection ? { ...thread, connection } : thread;
}

/** Lists the Threads as `listThreads` does, and adds the lost connection of each remote Thread. */
export async function listThreadsWithConnection(
  input: Parameters<typeof listThreads>[0] = {},
  ctx: ServiceContext = {},
): Promise<Omit<ThreadList, "threads"> & { readonly threads: readonly ConnectedThread[] }> {
  const list = await listThreads(input, ctx);
  const hosts = await readLiveHosts(ctx);

  return { ...list, threads: list.threads.map((thread) => withConnection(thread, hosts)) };
}

/** Reads one Thread as `getThread` does, and adds its lost connection. */
export async function getThreadWithConnection(id: string, ctx: ServiceContext = {}): Promise<ConnectedThread> {
  const thread = await getThread(id, ctx);

  return withConnection(thread, await readLiveHosts(ctx));
}
