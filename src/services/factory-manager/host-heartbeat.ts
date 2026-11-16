// The heartbeat loop of the worker hosts. It runs on its own timer, not in the supervisor loop. It takes no Project
// write lock and no state lock; only the reconnect of a host applies its outbox.

import { hostProjectId } from "../host-project/host-paths.js";
import {
  DEFAULT_HEARTBEAT_LIMITS,
  type HeartbeatLimits,
  nextHostState,
  type PingOutcome,
  pingHost,
} from "../remote-executor/remote-heartbeat.js";
import { withEntry } from "../store/store.js";
import { getState, type Manager, setState } from "./manager-state.js";

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

/** Sends one heartbeat to the host and records its state. A host that is `connected` again does the reconnect. */
async function beatHost(manager: Manager, host: string, limits: HeartbeatLimits): Promise<void> {
  const outcome = await pingOnce(manager, host, limits);
  const { hostHealth, stopping } = setState(manager, (state) => ({
    hostHealth: withEntry(state.hostHealth, host, nextHostState(state.hostHealth.get(host), outcome, limits)),
  }));

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
