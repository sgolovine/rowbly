import type { FactoryStatus } from "../../../services/factory/factory.js";
import { isAbandoned, LOCAL_HOST, type ThreadRecord } from "../../../services/thread/thread.js";
import {
  connectionLostText,
  type HostFacts,
  liveHosts,
  type ThreadConnection,
  threadConnection,
} from "../../../services/thread-connection/thread-connection.js";

/** The host facts and the host column of a list of Threads. */
export interface ThreadHostView {
  /** The hosts of the live factory, or `undefined` when the factory is not live. */
  readonly hosts: readonly HostFacts[] | undefined;
  /** The list has a remote Thread, so that each row shows the host column. */
  readonly hostColumn: boolean;
}

/** The host of a Thread: its worker host, or `local`. */
export function threadHost(thread: ThreadRecord): string {
  return thread.host ?? LOCAL_HOST;
}

/** Gives the hosts of the live factory, and shows the host column when a Thread of the list is remote. */
export function threadHostView(threads: readonly ThreadRecord[], status: FactoryStatus | undefined): ThreadHostView {
  return {
    hosts: status ? liveHosts(status) : undefined,
    hostColumn: threads.some((thread) => threadHost(thread) !== LOCAL_HOST),
  };
}

/** The props of a `ThreadRow` for the host column and the lost connection. */
export function threadHostProps(
  view: ThreadHostView,
  thread: ThreadRecord,
): { readonly host?: string; readonly connection?: ThreadConnection } {
  const connection = threadConnection(thread, view.hosts);

  return {
    ...(view.hostColumn ? { host: threadHost(thread) } : {}),
    ...(connection ? { connection } : {}),
  };
}

/** Gives `· connection lost (…)` for a Thread with a lost connection, or undefined. */
export function lostText(connection: ThreadConnection | undefined, now: number): string | undefined {
  return connection ? ` · ${connectionLostText(connection, now)}` : undefined;
}

/** Gives `· abandoned` with the number of held entries when it is known, or undefined for a Thread that is not abandoned. */
export function abandonedText(thread: ThreadRecord, held: number | undefined): string | undefined {
  if (!isAbandoned(thread)) {
    return undefined;
  }

  return held === undefined ? " · abandoned" : ` · abandoned (${held} held)`;
}
