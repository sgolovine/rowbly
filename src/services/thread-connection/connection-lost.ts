// The pure rules of a lost connection of a remote Thread. They use only the `hosts` list of the factory status, so a
// status read never opens SSH and never loads Pi.

import { formatDuration } from "../check-queue/check-order.js";
import type { HostSlots, HostState } from "../factory-manager/host-slots.js";
import { LOCAL_HOST, type ThreadRecord } from "../thread/thread-types.js";

/** The host facts of the factory status that the rules use. */
export type HostFacts = Pick<HostSlots, "id" | "state" | "lastSeenAt">;

/** The state of a host that is not in the `hosts` list of the factory status. */
export const UNKNOWN_HOST_STATE = "unknown";

/** The lost connection of one remote Thread. */
export interface ThreadConnection {
  readonly state: "lost";
  readonly host: string;
  readonly hostState: HostState | typeof UNKNOWN_HOST_STATE;
  /** The time of the last good heartbeat of the host, as an ISO text. */
  readonly lastSeenAt?: string;
}

/** One remote Thread with a lost connection, for the Project status. */
export interface LostConnection {
  readonly threadId: string;
  readonly storyId?: string;
  readonly host: string;
  readonly hostState: ThreadConnection["hostState"];
  readonly lastSeenAt?: string;
  /** The time since the last good heartbeat of the host, in milliseconds. */
  readonly lastContactMs?: number;
}

/** The host states that answer a heartbeat. A remote Thread on such a host keeps its connection. */
const LIVE_STATES: ReadonlySet<HostState> = new Set(["connected", "degraded"]);

/**
 * True when `host` is a worker host with a lost connection: its state in `hosts` does not answer a heartbeat, or `hosts`
 * does not have it. Without a `hosts` list (no running factory), no host is lost. `local` is never lost.
 */
export function hostLost(host: string, hosts: readonly HostFacts[] | undefined): boolean {
  if (!hosts || host === LOCAL_HOST) {
    return false;
  }

  const facts = hosts.find((entry) => entry.id === host);

  return !(facts && LIVE_STATES.has(facts.state));
}

/** True for a Thread on a worker host that is `running` or `pending`. */
function isActiveRemote(thread: ThreadRecord): boolean {
  return (thread.host ?? LOCAL_HOST) !== LOCAL_HOST && ["running", "pending"].includes(thread.status);
}

/**
 * Gives the lost connection of a Thread, or undefined. Without a `hosts` list (no running factory), no Thread has a
 * lost connection. A `local` Thread and a Thread with a final status never have one.
 */
export function threadConnection(
  thread: ThreadRecord,
  hosts: readonly HostFacts[] | undefined,
): ThreadConnection | undefined {
  const host = thread.host ?? LOCAL_HOST;

  if (!isActiveRemote(thread) || !hostLost(host, hosts)) {
    return undefined;
  }

  const facts = hosts?.find((entry) => entry.id === host);

  return {
    state: "lost",
    host,
    hostState: facts?.state ?? UNKNOWN_HOST_STATE,
    ...(facts?.lastSeenAt === undefined ? {} : { lastSeenAt: facts.lastSeenAt }),
  };
}

/** Gives the time since the last contact in milliseconds, or undefined without a valid contact time. */
export function lastContactMs(lastSeenAt: string | undefined, now: number): number | undefined {
  const at = lastSeenAt === undefined ? Number.NaN : Date.parse(lastSeenAt);

  return Number.isFinite(at) ? Math.max(0, now - at) : undefined;
}

/** Gives the remote Threads with a lost connection, in the order of the list. */
export function lostConnections(
  threads: readonly ThreadRecord[],
  hosts: readonly HostFacts[] | undefined,
  now: number,
): LostConnection[] {
  return threads.flatMap((thread) => {
    const connection = threadConnection(thread, hosts);

    return connection ? [lostEntry(thread, connection, now)] : [];
  });
}

function lostEntry(thread: ThreadRecord, connection: ThreadConnection, now: number): LostConnection {
  const ago = lastContactMs(connection.lastSeenAt, now);

  return {
    threadId: thread.id,
    ...(thread.storyId === undefined ? {} : { storyId: thread.storyId }),
    host: connection.host,
    hostState: connection.hostState,
    ...(connection.lastSeenAt === undefined ? {} : { lastSeenAt: connection.lastSeenAt }),
    ...(ago === undefined ? {} : { lastContactMs: ago }),
  };
}

/** Gives `last contact 1m40s ago`, or `no contact` without a contact time. */
export function contactText(ms: number | undefined): string {
  return ms === undefined ? "no contact" : `last contact ${formatDuration(ms)} ago`;
}

/** Gives `connection lost (last contact 1m40s ago)` or `connection lost (no contact)`. */
export function connectionLostText(connection: ThreadConnection, now: number): string {
  return `connection lost (${contactText(lastContactMs(connection.lastSeenAt, now))})`;
}
