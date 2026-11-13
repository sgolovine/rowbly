import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { assertFactoryOwnership, type Owner } from "../factoryOwnership/factoryOwnership.js";
import type { FactorySettings, ModelChoice } from "../factorySettings/factorySettings.js";
import type { FactorySessionOptions } from "../piRuntime/factorySession.js";
import type { PiSession } from "../piRuntime/piRuntime.js";
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
  stage: string;
  reason: string;
  reconsiderAt: string;
}

interface Attention {
  text: string;
  storyId?: string;
}

export interface ProviderPause {
  reason: string;
  retryAt?: string;
}

export interface ActiveWorker {
  task: Promise<void>;
  session?: PiSession;
}

/** The mutable state of one factory manager. The manager modules share it in place of closures. */
export interface ManagerState {
  // Project and ownership
  deps: FactoryDependencies;
  paths: ProjectPaths;
  ctx: ServiceContext;
  owner: Owner;

  // Lifecycle
  queue: Promise<unknown>;
  phase: string;
  revision: number;
  stopping: boolean;
  dirty: boolean;
  loopStarted: boolean;
  loopDone: Promise<void>;
  finishLoop: () => void;
  wake?: () => void;
  shutdownTask?: Promise<void>;

  // Settings
  settings: FactorySettings;
  limit: number;
  authStamp: number;

  // Workers
  active: Map<string, ActiveWorker>;
  promptClaims: Map<string, string>;
  requests: Map<string, string>;

  // Supervisor
  tools: FactorySessionOptions["tools"];
  supervisor?: PiSession;
  supervisorId?: string;
  supervisorChoice?: ModelChoice;
  supervisorBorn: number;
  wakeCount: number;

  // Digest delivery
  acknowledgedHash?: string;
  attemptedHash?: string;
  nextWakeAt: number;
  unanswered: number;
  deliveredReportIds: string[];

  // Status
  holds: Map<string, Hold>;
  attention: Map<string, Attention>;
  providers: Map<string, ProviderPause>;

  // Timers
  unwatch?: () => void;
  timer?: NodeJS.Timeout;
  heartbeat?: NodeJS.Timeout;
  deadlineTimer?: NodeJS.Timeout;
}

/** Runs one lifecycle change at a time, and only while this manager owns the Project. */
export function serial<T>(manager: ManagerState, call: () => Promise<T>): Promise<T> {
  const next = manager.queue.then(async () => {
    await assertFactoryOwnership(manager.paths, manager.owner.token);

    return call();
  });

  manager.queue = next.catch(() => {});

  return next;
}

/** Marks the Project as changed and wakes the supervisor loop. */
export function notify(manager: ManagerState): void {
  manager.dirty = true;
  manager.wake?.();
}

/** Moves a Thread to a new status and projects the change into the policy state. */
export async function changeThread(
  manager: ManagerState,
  id: string,
  status: ThreadRecord["status"],
  patch?: Parameters<typeof transitionThread>[1]["patch"],
): Promise<ThreadRecord> {
  const thread = await getThread(id, manager.ctx);
  const next = await transitionThread(id, { expectedRevision: thread.revision, status, patch }, manager.ctx);

  await projectNativeAttempt(id, manager.ctx);

  return next;
}

/** Pauses a provider when an error shows a quota or an authentication problem. */
export function pauseForError(manager: ManagerState, provider: string | undefined, error: unknown): void {
  if (!provider) {
    return;
  }

  const message = error instanceof Error ? error.message : "";

  if (/quota|usage.limit|billing|429/i.test(message)) {
    manager.providers.set(provider, { reason: "quota", retryAt: new Date(Date.now() + 15 * 60_000).toISOString() });
  } else if (/oauth|unauthorized|authentication|401/i.test(message)) {
    manager.providers.set(provider, { reason: "authentication" });
  }
}

export function isProviderPaused(manager: ManagerState, provider: string): boolean {
  const pause = manager.providers.get(provider);

  return !!pause && (!pause.retryAt || Date.parse(pause.retryAt) > Date.now());
}

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
