import { readFile } from "node:fs/promises";
import { ConflictError } from "../errors/errors.js";
import {
  acquireFactoryOwnership,
  assertFactoryOwnership,
  newOwner,
  type Owner,
  probeOwner,
  readFactoryOwner,
  releaseFactoryOwnership,
} from "../factory-ownership/factory-ownership.js";
import { recoverFactory } from "../factory-recovery/factory-recovery.js";
import {
  assertNoLegacyFactorySettings,
  type FactorySettings,
  getFactorySettings,
} from "../factory-settings/factory-settings.js";
import { runtimePath } from "../runtime-files/runtime-files.js";
import { Store, withoutEntry } from "../store/store.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";
import { shutdownFactory } from "./factory-shutdown.js";
import { startHostHeartbeat } from "./host-heartbeat.js";
import type { WorkerHostView } from "./host-slots.js";
import { createLocalExecutor } from "./local-executor.js";
import {
  type Attention,
  type FactoryDependencies,
  getState,
  type Manager,
  type ManagerState,
  notify,
  readAuthStamp,
  serial,
  setState,
} from "./manager-state.js";
import { buildSnapshot, loadStoredStatus, persistStatus, type StoredStatus } from "./manager-status.js";
import { createManagerRemote } from "./remote-dispatch.js";
import { releaseParkedStory } from "./story-release.js";
import { reconcilePolicy, runFactory } from "./supervisor-loop.js";
import { adoptRemoteThreads } from "./worker-adopt.js";
import { openCheckQueue } from "./worker-checks.js";
import { cancelWorker, type ReserveWorkerInput, reserveWorker, resumeWorker } from "./worker-reservation.js";
import { steerWorker } from "./worker-steer.js";

export type { FactoryDependencies } from "./manager-state.js";
export type FactoryManager = Awaited<ReturnType<typeof createFactoryManager>>;

interface RecoveredFactory {
  externalActive: number;
  settings: FactorySettings;
  limit: number;
  hosts: readonly WorkerHostView[];
}

/** Serializes lifecycle changes and reserves worker slots before asynchronous preparation. */
export async function createFactoryManager(deps: FactoryDependencies, context: ServiceContext = {}) {
  const paths = await findProject(context);
  const ctx = { ...context, cwd: paths.root };

  await assertNoLegacyFactorySettings(paths);

  const deadToken = await findDeadToken(deps, paths);
  const owner = deps.ownership?.owner ?? (await newOwner());

  await takeOwnership(deps, paths, owner);

  const recovered = await recoverOrRelease(deps, paths, ctx, owner, deadToken);
  const authStamp = await readAuthStamp(deps.agentDir);
  const stored = await loadStoredStatus(paths);

  const checks = await openCheckQueue(paths, owner.token, () => manager, deps.checkDeps);
  const executor =
    deps.executor ??
    createLocalExecutor({
      paths,
      ctx,
      runtime: deps.runtime,
      agentDir: deps.agentDir,
      shim: deps.shim,
      checks,
      settings: () => getState(manager).settings,
    });
  const manager: Manager = {
    deps,
    paths,
    ctx,
    owner,
    checks,
    executor,
    remote: createManagerRemote(deps, paths, ctx, () => manager),
    store: new Store(initialState(recovered, authStamp, stored)),
  };

  // Before the first factory pass, so that the remote runs of a previous daemon count and are not started again.
  await adoptRemoteThreads(manager);
  startHostHeartbeat(manager);

  return {
    owner,
    run: () => runFactory(manager),
    reserveWorker: (input: ReserveWorkerInput) => reserveWorker(manager, input),
    cancelWorker: (id: string, expectedRunId: string) => cancelWorker(manager, id, expectedRunId),
    resumeWorker: (id: string, expectedRunId: string, requestId: string) =>
      resumeWorker(manager, id, expectedRunId, requestId),
    steerWorker: (id: string, expectedRunId: string, message: string) =>
      steerWorker(manager, id, expectedRunId, message),
    retryProvider: (provider: string) => retryProvider(manager, provider),
    dismissAttention: (key: string) => dismissAttention(manager, key),
    releaseStory: (storyId: string) => releaseParkedStory(manager, storyId),
    snapshot: () => serial(manager, () => buildSnapshot(manager)),
    reconcile: () => reconcilePolicy(manager),
    shutdown: () => shutdownFactory(manager),
  };
}

/** Builds the first state. The attention of the status file replaces a new entry with the same key. */
function initialState(recovered: RecoveredFactory, authStamp: number, stored: StoredStatus): ManagerState {
  const external: [string, Attention][] = recovered.externalActive
    ? [
        [
          "external",
          {
            text: `${recovered.externalActive} external attempts remain protected. Stop external workers before --adopt-external.`,
          },
        ],
      ]
    : [];

  return {
    queue: Promise.resolve(),
    phase: "starting",
    revision: 0,
    stopping: false,
    dirty: true,
    loopStarted: false,
    loopDone: Promise.resolve(),
    finishLoop: () => {},

    settings: recovered.settings,
    limit: recovered.limit,
    authStamp,
    hosts: recovered.hosts,
    hostHealth: new Map(),

    active: new Map(),
    promptClaims: new Map(),
    requests: new Map(),
    hostSync: new Set(),

    attention: new Map([...external, ...(stored.attention ?? [])]),
    providers: stored.providers ?? new Map(),
    networkFailures: stored.networkFailures ?? new Map(),

    lastSyncAt: 0,
  };
}

/** Gives the token of a previous owner that is dead, so that recovery can take over its runs. */
async function findDeadToken(deps: FactoryDependencies, paths: ProjectPaths): Promise<string | undefined> {
  if (deps.ownership) {
    return deps.ownership.deadToken;
  }

  const previous = await readFactoryOwner(paths);

  if (previous && (await probeOwner(previous)) === "dead") {
    return previous.token;
  }

  return undefined;
}

async function takeOwnership(deps: FactoryDependencies, paths: ProjectPaths, owner: Owner): Promise<void> {
  if (deps.ownership) {
    await assertFactoryOwnership(paths, owner.token);
    return;
  }

  if (!(await acquireFactoryOwnership(paths, owner)).acquired) {
    throw new ConflictError("Another factory owns this Project");
  }
}

/** Recovers the factory. A failure releases the new ownership before the error goes to the caller. */
async function recoverOrRelease(
  deps: FactoryDependencies,
  paths: ProjectPaths,
  ctx: ServiceContext,
  owner: Owner,
  deadToken: string | undefined,
): Promise<RecoveredFactory> {
  try {
    return await recoverAndConfigure(deps, ctx, owner, deadToken);
  } catch (error) {
    await releaseFactoryOwnership(paths, owner.token);
    throw error;
  }
}

async function recoverAndConfigure(
  deps: FactoryDependencies,
  ctx: ServiceContext,
  owner: Owner,
  deadToken: string | undefined,
): Promise<RecoveredFactory> {
  const { externalActive } = await recoverFactory(owner.token, deadToken, !!deps.adoptExternal, ctx);
  const settings = await getFactorySettings(ctx);
  const limit = deps.maxWorkers ?? settings.maxWorkers;

  if (!Number.isInteger(limit) || limit < 1) {
    throw new ConflictError("Invalid worker limit");
  }

  const hosts = deps.workerHosts ? await deps.workerHosts() : [];

  return { externalActive, settings, limit, hosts };
}

function retryProvider(manager: Manager, provider: string): Promise<void> {
  return serial(manager, async () => {
    setState(manager, (state) => ({ providers: withoutEntry(state.providers, provider) }));
    await persistStatus(manager);
    notify(manager);
  });
}

/** Removes one attention entry and writes the status file. A key that does not exist changes nothing. */
function dismissAttention(manager: Manager, key: string): Promise<void> {
  return serial(manager, async () => {
    setState(manager, (state) => ({ attention: withoutEntry(state.attention, key) }));
    await persistStatus(manager);
  });
}

/** Reads status without loading Pi or opening histories. */
export async function getFactoryStatus(ctx: ServiceContext = {}) {
  const paths = await findProject(ctx);

  try {
    return JSON.parse(await readFile(await runtimePath(paths, "status.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, phase: "stopped" };
    }

    throw error;
  }
}
