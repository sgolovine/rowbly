// The heartbeat loop of the worker hosts. It runs on its own timer, not in the supervisor loop. It takes no Project
// write lock and no state lock; only the reconnect of a host applies its outbox.

import { hostProjectId } from "../host-project/host-paths.js";
import {
  DEFAULT_HEARTBEAT_LIMITS,
  type HeartbeatLimits,
  type HostHealth,
  nextHostState,
  type PingOutcome,
  pingHost,
} from "../remote-executor/remote-heartbeat.js";
import { withEntry, withoutEntry } from "../store/store.js";
import { type Attention, getState, type Manager, type ManagerState, setState } from "./manager-state.js";

/** The heartbeat states that do not heal without a person or without more failures: they get an attention entry. */
const LOST_STATES: ReadonlySet<HostHealth["state"]> = new Set(["disconnected", "version-mismatch", "auth-failed"]);

/** The key of the attention entry of a worker host. */
export function hostAttentionKey(host: string): string {
  return `host:${host}`;
}

/** Gives the text of the attention entry of a host that is lost: the host, the state and the last contact time. */
export function hostAttentionText(host: string, health: HostHealth): string {
  return `Worker host ${host} is ${health.state}. Last contact: ${health.lastSeenAt ?? "never"}.`;
}

/**
 * Sets the attention entry `host:<id>` when the heartbeat state of the host is lost, and removes it when the host
 * answers again (`connected` or `degraded`).
 */
export function withHostAttention(
  attention: ReadonlyMap<string, Attention>,
  host: string,
  health: HostHealth,
): ReadonlyMap<string, Attention> {
  const key = hostAttentionKey(host);

  return LOST_STATES.has(health.state)
    ? withEntry(attention, key, { text: hostAttentionText(host, health) })
    : withoutEntry(attention, key);
}

/** Gives the limits of the heartbeat: the defaults with the values of the dependencies. */
function limitsOf(manager: Manager): HeartbeatLimits {
  const { now: _now, ...limits } = manager.deps.hostHeartbeat ?? {};

  return { ...DEFAULT_HEARTBEAT_LIMITS, ...limits };
}

/** Sends one heartbeat to the host. A failed connect is a failed heartbeat. */
async function pingOnce(manager: Manager, host: string, limits: HeartbeatLimits): Promise<PingOutcome> {
  const connect = manager.deps.hostConnection;
  const now = manager.deps.hostHeartbeat?.now ?? Date.now;

  if (!connect) {
    return { kind: "failed", error: new Error("Remote dispatch is not available") };
  }

  try {
    const target = { connection: await connect(host), projectId: hostProjectId(manager.paths.root) };

    return await pingHost(target, limits.timeoutMs, now);
  } catch (error) {
    return { kind: "failed", error };
  }
}

/** Gives the next heartbeat facts of the host and its attention entry. */
function recordHealth(
  state: Readonly<ManagerState>,
  host: string,
  outcome: PingOutcome,
  limits: HeartbeatLimits,
): Pick<ManagerState, "hostHealth" | "attention"> {
  const health = nextHostState(state.hostHealth.get(host), outcome, limits);

  return {
    hostHealth: withEntry(state.hostHealth, host, health),
    attention: withHostAttention(state.attention, host, health),
  };
}

/** Sends one heartbeat to the host and records its state. A host that is `connected` again does the reconnect. */
async function beatHost(manager: Manager, host: string, limits: HeartbeatLimits): Promise<void> {
  const outcome = await pingOnce(manager, host, limits);
  const { hostHealth, stopping } = setState(manager, (state) => recordHealth(state, host, outcome, limits));

  if (stopping || hostHealth.get(host)?.state !== "connected") {
    return;
  }

  await manager.remote?.reconnect(host);
}

/** Sends one heartbeat to each worker host of the list that is `connected`. A heartbeat that runs is not repeated. */
export async function beatHosts(manager: Manager): Promise<void> {
  const { heartbeatTask, stopping, hosts } = getState(manager);

  if (heartbeatTask || stopping) {
    return;
  }

  const limits = limitsOf(manager);
  const listed = hosts.filter((host) => host.state === "connected");
  const task = Promise.all(listed.map((host) => beatHost(manager, host.id, limits))).then(
    () => undefined,
    () => undefined,
  );

  setState(manager, () => ({ heartbeatTask: task }));
  await task;
  setState(manager, () => ({ heartbeatTask: undefined }));
}

/** Starts the heartbeat of the worker hosts. Only a manager with remote dispatch and a list of worker hosts has it. */
export function startHostHeartbeat(manager: Manager): void {
  if (!manager.remote || !manager.deps.workerHosts) {
    return;
  }

  const timer = setInterval(() => void beatHosts(manager), limitsOf(manager).intervalMs);

  timer.unref();
  setState(manager, () => ({ hostHeartbeat: timer }));
}
