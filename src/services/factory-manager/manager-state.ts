import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { assertFactoryOwnership, type Owner } from "../factory-ownership/factory-ownership.js";
import type { FactorySettings, ModelChoice } from "../factory-settings/factory-settings.js";
import type { PiSession } from "../pi-runtime/pi-runtime.js";
import { type Store, withEntry } from "../store/store.js";
import { getThread, projectNativeAttempt, type ThreadRecord, transitionThread } from "../thread/thread.js";
import type { ProjectPaths, ServiceContext } from "../workspace/workspace.js";

export interface FactoryDependencies {
  runtime: ModelRuntime;
  ownership?: { owner: Owner; deadToken?: string };
  adoptExternal?: boolean;
  agentDir: string;
  shim: string;
  skillsDir: string;
  maxWorkers?: number;
  beforeLaunch?: (thread: ThreadRecord) => Promise<void>;
  onModel?: (role: string, model: ModelChoice) => void;
}

export interface Hold {
  readonly stage: string;
  readonly reason: string;
  readonly reconsiderAt: string;
}

export interface Attention {
  readonly text: string;
  readonly storyId?: string;
}

export interface ProviderPause {
  readonly reason: string;
  readonly retryAt?: string;
}

interface ActiveWorker {
  readonly task: Promise<void>;
  readonly session?: PiSession;
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
  readonly limit: number;
  readonly authStamp: number;

  // Workers
  readonly active: ReadonlyMap<string, ActiveWorker>;
  readonly promptClaims: ReadonlyMap<string, string>;
  readonly requests: ReadonlyMap<string, string>;

  // Supervisor
  readonly supervisor?: PiSession;
  readonly supervisorId?: string;
  readonly supervisorChoice?: ModelChoice;
  readonly supervisorBorn: number;
  readonly wakeCount: number;

  // Digest delivery
  readonly acknowledgedHash?: string;
  readonly attemptedHash?: string;
  readonly nextWakeAt: number;
  readonly unanswered: number;
  readonly deliveredReportIds: readonly string[];

  // Status
  readonly holds: ReadonlyMap<string, Hold>;
  readonly attention: ReadonlyMap<string, Attention>;
  readonly providers: ReadonlyMap<string, ProviderPause>;

  // Git sync of the canonical checkout
  readonly lastSyncAt: number;
  readonly syncTask?: Promise<void>;

  // Timers
  readonly unwatch?: () => void;
  readonly timer?: NodeJS.Timeout;
  readonly heartbeat?: NodeJS.Timeout;
  readonly deadlineTimer?: NodeJS.Timeout;
}

/** The fixed environment of one factory manager, and the store of its state. */
export interface Manager {
  readonly deps: FactoryDependencies;
  readonly paths: ProjectPaths;
  readonly ctx: ServiceContext;
  readonly owner: Owner;
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

/** Marks the Project as changed and wakes the supervisor loop. */
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

/** Gives the provider pauses with a new pause when an error shows a quota or an authentication problem. */
export function pausedProviders(
  providers: ReadonlyMap<string, ProviderPause>,
  provider: string | undefined,
  error: unknown,
): ReadonlyMap<string, ProviderPause> {
  if (!provider) {
    return providers;
  }

  const message = error instanceof Error ? error.message : "";

  if (/quota|usage.limit|billing|429/i.test(message)) {
    const retryAt = new Date(Date.now() + 15 * 60_000).toISOString();

    return withEntry(providers, provider, { reason: "quota", retryAt });
  }

  if (/oauth|unauthorized|authentication|401/i.test(message)) {
    return withEntry(providers, provider, { reason: "authentication" });
  }

  return providers;
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
