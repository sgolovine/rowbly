import { LOCAL_HOST } from "../thread/thread-types.js";

/**
 * The state of a host. Only a `connected` host gets new work. The heartbeat gives `connected`, `degraded`,
 * `disconnected`, `version-mismatch` and `auth-failed`. `not-ready` comes only from the list of worker hosts.
 */
export type HostState = "connected" | "degraded" | "disconnected" | "version-mismatch" | "auth-failed" | "not-ready";

/** One worker host that the manager can use, as the manager dependency `workerHosts` gives it. */
export interface WorkerHostView {
  readonly id: string;
  readonly maxWorkers: number;
  readonly state: HostState;
  /** The providers that the host can use. Without a list, the providers are not known. */
  readonly providers?: readonly string[];
}

/** The worker slots of one host. */
export interface HostSlots {
  readonly id: string;
  readonly state: HostState;
  readonly max: number;
  readonly used: number;
  readonly free: number;
  /** The time of the last good heartbeat of a worker host, as an ISO text. `local` has no value. */
  readonly lastSeenAt?: string;
  /** The latency of the last good heartbeat of a worker host, in milliseconds. `local` has no value. */
  readonly latencyMs?: number;
}

/** The heartbeat facts of a host that the status shows. */
export interface HostContact {
  readonly lastSeenAt?: string;
  readonly latencyMs?: number;
}

/** Counts the entries of each host in a list of host IDs. */
export function countByHost(hosts: readonly string[]): ReadonlyMap<string, number> {
  const ids = [...new Set(hosts)];

  return new Map(ids.map((id) => [id, hosts.filter((host) => host === id).length]));
}

function slots(id: string, state: HostState, max: number, used: number): HostSlots {
  return { id, state, max, used, free: Math.max(0, max - used) };
}

/**
 * Gives the slots of `local` and of each worker host, in this order. `local` is always connected, and its limit is
 * `localMax`. `used` gives the number of active workers on each host.
 */
export function hostSlots(
  localMax: number,
  hosts: readonly WorkerHostView[],
  used: ReadonlyMap<string, number>,
): HostSlots[] {
  return [
    slots(LOCAL_HOST, "connected", localMax, used.get(LOCAL_HOST) ?? 0),
    ...hosts.map((host) => slots(host.id, host.state, host.maxWorkers, used.get(host.id) ?? 0)),
  ];
}

/** Gives the total slots of the hosts that can take work. Without worker hosts, it is the local limit. */
export function placementCapacity(localMax: number, hosts: readonly WorkerHostView[]): number {
  return hosts.filter((host) => host.state === "connected").reduce((total, host) => total + host.maxWorkers, localMax);
}

/**
 * Gives the hosts with the state that the manager uses: the state of the list when it is not `connected`, else the
 * heartbeat state of the host. Before the first heartbeat of a host, the state of the list.
 */
export function withHeartbeatStates(
  hosts: readonly WorkerHostView[],
  heartbeat: ReadonlyMap<string, { readonly state: HostState }>,
): WorkerHostView[] {
  return hosts.map((host) =>
    host.state === "connected" ? { ...host, state: heartbeat.get(host.id)?.state ?? host.state } : host,
  );
}

/** Adds the time and the latency of the last good heartbeat to the slots of each worker host that has them. */
export function withContactFacts(
  slots: readonly HostSlots[],
  heartbeat: ReadonlyMap<string, HostContact>,
): HostSlots[] {
  return slots.map((entry) => (entry.id === LOCAL_HOST ? entry : { ...entry, ...contactOf(heartbeat.get(entry.id)) }));
}

function contactOf(contact: HostContact | undefined): HostContact {
  return {
    ...(contact?.lastSeenAt === undefined ? {} : { lastSeenAt: contact.lastSeenAt }),
    ...(contact?.latencyMs === undefined ? {} : { latencyMs: contact.latencyMs }),
  };
}
