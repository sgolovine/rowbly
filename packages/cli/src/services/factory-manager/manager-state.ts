import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { CheckQueue, CheckQueueDeps } from "../check-queue/check-queue.js";
import { assertFactoryOwnership, type Owner } from "../factory-ownership/factory-ownership.js";
import type { FactorySettings, ModelChoice } from "../factory-settings/factory-settings.js";
import { isHostTransportError } from "../host-transport/host-errors.js";
import type { HostConnection, RemoteExecutor } from "../remote-executor/remote-executor.js";
import type { HeartbeatLimits, HostHealth } from "../remote-executor/remote-heartbeat.js";
import { type Store, withEntry, withoutEntry } from "../store/store.js";
import type { Story } from "../story/story.js";
import { getThread, projectNativeAttempt, type ThreadRecord, transitionThread } from "../thread/thread.js";
import type { LocalWorktreeFacts } from "../worker-worktree/worker-worktree.js";
import type { ProjectPaths, ServiceContext } from "../workspace/workspace.js";
import { isAuthenticationError, isConnectivityError, isQuotaError, networkPauseDelay } from "./connectivity.js";
import type { WorkerHostView } from "./host-slots.js";
import type { WorkerControl, WorkerExecutor } from "./worker-executor.js";

export interface FactoryDependencies {
  runtime: ModelRuntime;
  ownership?: { owner: Owner; deadToken?: string };
  adoptExternal?: boolean;
  agentDir: string;
  shim: string;
  maxWorkers?: number;
  beforeLaunch?: (thread: ThreadRecord) => Promise<void>;
  onModel?: (role: string, model: ModelChoice) => void;
  /** The readers, spawn and clock of the check queue. Tests give fakes. */
  checkDeps?: CheckQueueDeps;
  /** Runs the workers. Without a value, the manager runs each worker in a Pi session of this process. */
  executor?: WorkerExecutor;
  /** The worker hosts that the manager can use. Without a value, the manager uses only `local`. */
  workerHosts?: () => Promise<readonly WorkerHostView[]>;
  /**
   * Gives the connection of a worker host: the transport, the path of `rowbly` and the clone of the Project. Without
   * it, the manager cannot send a worker to a worker host.
   */
  hostConnection?: (host: string) => Promise<HostConnection>;
  /** The limits and the clock of the heartbeat of the worker hosts. Tests give a short interval. */
  hostHeartbeat?: Partial<HeartbeatLimits> & { readonly now?: () => number };
  /** The time that a factory stop waits for the runs of the connected worker hosts. */
  remoteStopTimeoutMs?: number;
  /** Reads the Git facts of the local worktree of a Story. Tests give fakes. */
  worktreeFacts?: (root: string, story: Story) => Promise<LocalWorktreeFacts | undefined>;
}

export interface Attention {
  readonly text: string;
  readonly storyId?: string;
}

export interface ProviderPause {
  readonly reason: string;
  readonly retryAt?: string;
  /** The number of network pauses in a row of the provider, for a `network` pause. */
  readonly failures?: number;
}

interface ActiveWorker {
  readonly task: Promise<void>;
  /** The host ID of the machine that runs the worker. */
  readonly host: string;
  /** The operations of the executor for the worker. The manager sets it when the session opens. */
  readonly control?: WorkerControl;
}

/**
 * The refusal of the last dispatch of one launch decision. The status shows it while the decision of the Story stays the
 * same: the same Stage, action and attempt.
 */
export interface DispatchRefusal {
  readonly stage: string;
  readonly action: string;
  readonly attempt?: number;
  /** The message of the `ConflictError` that refused the dispatch. */
  readonly message: string;
}

/** The state of one factory manager. Each change replaces the whole value in the store. */
export interface ManagerState {
  // Lifecycle
  readonly queue: Promise<unknown>;
  readonly phase: string;
  readonly revision: number;
  readonly stopping: boolean;
  readonly dirty: boolean;
  readonly loopStarted: boolean;
  readonly loopDone: Promise<void>;
  readonly finishLoop: () => void;
  readonly wake?: () => void;
  readonly shutdownTask?: Promise<void>;

  // Settings
  readonly settings: FactorySettings;
  /** The worker limit of `local`. */
  readonly limit: number;
  readonly authStamp: number;
  /** The worker hosts from the last read of `workerHosts`. */
  readonly hosts: readonly WorkerHostView[];
  /** The heartbeat facts of each worker host, after its first heartbeat. */
  readonly hostHealth: ReadonlyMap<string, HostHealth>;
  /** The heartbeat of all worker hosts that runs now. */
  readonly heartbeatTask?: Promise<void>;

  // Workers
  readonly active: ReadonlyMap<string, ActiveWorker>;
  readonly promptClaims: ReadonlyMap<string, string>;
  readonly requests: ReadonlyMap<string, string>;
  /** The Stories of the remote worker Threads that are not synchronized: their outbox or final status did not arrive. */
  readonly hostSync: ReadonlySet<string>;
  /** The dispatch refusals of the last dispatch step, by Story ID. The manager keeps them only in memory. */
  readonly dispatchRefusals: ReadonlyMap<string, DispatchRefusal>;

  // Status
  readonly attention: ReadonlyMap<string, Attention>;
  readonly providers: ReadonlyMap<string, ProviderPause>;
  /** The number of network pauses in a row of each provider. A successful prompt removes the entry. */
  readonly networkFailures: ReadonlyMap<string, number>;

  // Git sync of the canonical checkout
  readonly lastSyncAt: number;
  readonly syncTask?: Promise<void>;

  // Timers
  readonly unwatch?: () => void;
  readonly timer?: NodeJS.Timeout;
  readonly heartbeat?: NodeJS.Timeout;
  /** The timer of the heartbeat of the worker hosts. */
  readonly hostHeartbeat?: NodeJS.Timeout;
  readonly deadlineTimer?: NodeJS.Timeout;
}

/** The provider pauses and the network failure counts of the state. */
export type ProviderState = Pick<ManagerState, "providers" | "networkFailures">;

/** The fixed environment of one factory manager, and the store of its state. */
export interface Manager {
  readonly deps: FactoryDependencies;
  readonly paths: ProjectPaths;
  readonly ctx: ServiceContext;
  readonly owner: Owner;
  readonly checks: CheckQueue;
  /** The local executor. */
  readonly executor: WorkerExecutor;
  /** The executor of the worker hosts. Only a manager with `hostConnection` has it. */
  readonly remote?: RemoteExecutor;
  readonly store: Store<ManagerState>;
}

/** Gives the current state. Read it again after each `await`, because other tasks can replace it. */
export function getState(manager: Manager): Readonly<ManagerState> {
  return manager.store.current;
}

/** Replaces the state with a copy that has the changes from `change`. */
export function setState(
  manager: Manager,
  change: (state: Readonly<ManagerState>) => Partial<ManagerState>,
): Readonly<ManagerState> {
  return manager.store.update(change);
}

/** Runs one lifecycle change at a time, and only while this manager owns the Project. */
export function serial<T>(manager: Manager, call: () => Promise<T>): Promise<T> {
  const next = getState(manager).queue.then(async () => {
    await assertFactoryOwnership(manager.paths, manager.owner.token);

    return call();
  });

  setState(manager, () => ({ queue: next.catch(() => {}) }));

  return next;
}

/** Marks the Project as changed and wakes the factory loop. */
export function notify(manager: Manager): void {
  const { wake } = setState(manager, () => ({ dirty: true }));

  wake?.();
}

/** Moves a Thread to a new status and projects the change into the policy state. */
export async function changeThread(
  manager: Manager,
  id: string,
  status: ThreadRecord["status"],
  patch?: Parameters<typeof transitionThread>[1]["patch"],
): Promise<ThreadRecord> {
  const thread = await getThread(id, manager.ctx);
  const next = await transitionThread(id, { expectedRevision: thread.revision, status, patch }, manager.ctx);

  await projectNativeAttempt(id, manager.ctx);

  return next;
}

/**
 * Gives the provider pauses with a new pause when an error shows a quota, an authentication or a connectivity
 * problem. `failures` is the number of earlier network pauses in a row of the provider.
 */
export function pausedProviders(
  providers: ReadonlyMap<string, ProviderPause>,
  provider: string | undefined,
  error: unknown,
  failures = 0,
): ReadonlyMap<string, ProviderPause> {
  // A failure of the connection to a worker host does not pause the provider of the model.
  if (!provider || isHostTransportError(error)) {
    return providers;
  }

  if (isQuotaError(error)) {
    const retryAt = new Date(Date.now() + 15 * 60_000).toISOString();

    return withEntry(providers, provider, { reason: "quota", retryAt });
  }

  if (isAuthenticationError(error)) {
    return withEntry(providers, provider, { reason: "authentication" });
  }

  if (isConnectivityError(error)) {
    return withNetworkPause(providers, provider, failures);
  }

  return providers;
}

/**
 * Adds a network pause. A network pause that still holds does not change, because the workers of one outage
 * fail at about the same time. They must not make the delay longer.
 */
function withNetworkPause(
  providers: ReadonlyMap<string, ProviderPause>,
  provider: string,
  failures: number,
): ReadonlyMap<string, ProviderPause> {
  const current = providers.get(provider);

  if (current?.reason === "network" && Date.parse(current.retryAt ?? "") > Date.now()) {
    return providers;
  }

  const count = failures + 1;
  const retryAt = new Date(Date.now() + networkPauseDelay(count)).toISOString();

  return withEntry(providers, provider, { reason: "network", retryAt, failures: count });
}

/** Gives the provider pauses and the network failure counts after an error of the provider. */
export function pauseProvider(
  state: Readonly<ProviderState>,
  provider: string | undefined,
  error: unknown,
): ProviderState {
  const failures = provider ? (state.networkFailures.get(provider) ?? 0) : 0;
  const providers = pausedProviders(state.providers, provider, error, failures);
  const pause = provider ? providers.get(provider) : undefined;

  if (!provider || pause?.reason !== "network" || pause.failures === undefined) {
    return { providers, networkFailures: state.networkFailures };
  }

  return { providers, networkFailures: withEntry(state.networkFailures, provider, pause.failures) };
}

/** Gives the network failure counts after a successful prompt of the provider. The next pause starts at 1 minute. */
export function providerSucceeded(
  state: Readonly<ProviderState>,
  provider: string | undefined,
): Pick<ManagerState, "networkFailures"> {
  if (!provider || !state.networkFailures.has(provider)) {
    return { networkFailures: state.networkFailures };
  }

  return { networkFailures: withoutEntry(state.networkFailures, provider) };
}

/** Tells if a provider pause still holds: it has no retry time, or the retry time is in the future. */
export function isProviderPaused(manager: Manager, provider: string): boolean {
  const pause = getState(manager).providers.get(provider);

  return !!pause && (!pause.retryAt || Date.parse(pause.retryAt) > Date.now());
}

/** Tells if a Thread status is active: pending or running. A final status is not active. */
export function isActiveStatus(status: ThreadRecord["status"]): boolean {
  return status === "pending" || status === "running";
}

/** Reads the change time of the Pi credentials file, or 0 when the file is absent. */
export function readAuthStamp(agentDir: string): Promise<number> {
  return stat(join(agentDir, "auth.json")).then(
    (stats) => stats.mtimeMs,
    () => 0,
  );
}
