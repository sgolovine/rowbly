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
import { type FactorySettings, getFactorySettings } from "../factory-settings/factory-settings.js";
import { runtimePath } from "../runtime-files/runtime-files.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";
import { shutdownFactory } from "./factory-shutdown.js";
import {
  type Attention,
  type FactoryDependencies,
  type Manager,
  type ManagerState,
  notify,
  readAuthStamp,
  serial,
  setState,
} from "./manager-state.js";
import { buildSnapshot, loadStoredStatus, persistStatus, type StoredStatus } from "./manager-status.js";
import { Store, withoutEntry } from "./store.js";
import { reconcilePolicy, runFactory } from "./supervisor-loop.js";
import { cancelWorker, type ReserveWorkerInput, reserveWorker, resumeWorker } from "./worker-reservation.js";

export type { FactoryDependencies } from "./manager-state.js";
export type FactoryManager = Awaited<ReturnType<typeof createFactoryManager>>;

interface RecoveredFactory {
  externalActive: number;
  settings: FactorySettings;
  limit: number;
}

/** Serializes lifecycle changes and reserves worker slots before asynchronous preparation. */
export async function createFactoryManager(deps: FactoryDependencies, context: ServiceContext = {}) {
  const paths = await findProject(context);
  const ctx = { ...context, cwd: paths.root };

  const deadToken = await findDeadToken(deps, paths);
  const owner = deps.ownership?.owner ?? (await newOwner());

  await takeOwnership(deps, paths, owner);

  const recovered = await recoverOrRelease(deps, paths, ctx, owner, deadToken);
  const authStamp = await readAuthStamp(deps.agentDir);
  const stored = await loadStoredStatus(paths);

  const manager: Manager = {
    deps,
    paths,
    ctx,
    owner,
    store: new Store(initialState(recovered, authStamp, stored)),
  };

  return {
    owner,
    run: () => runFactory(manager),
    reserveWorker: (input: ReserveWorkerInput) => reserveWorker(manager, input),
    cancelWorker: (id: string, expectedRunId: string) => cancelWorker(manager, id, expectedRunId),
    resumeWorker: (id: string, expectedRunId: string, requestId: string) =>
      resumeWorker(manager, id, expectedRunId, requestId),
    retryProvider: (provider: string) => retryProvider(manager, provider),
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

    active: new Map(),
    promptClaims: new Map(),
    requests: new Map(),

    supervisorBorn: Date.now(),
    wakeCount: 0,

    nextWakeAt: stored.nextWakeAt ?? 0,
    unanswered: stored.unanswered ?? 0,
    attemptedHash: stored.attemptedHash,
    deliveredReportIds: stored.deliveredReportIds ?? [],

    holds: stored.holds ?? new Map(),
    attention: new Map([...external, ...(stored.attention ?? [])]),
    providers: stored.providers ?? new Map(),
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

  return { externalActive, settings, limit };
}

function retryProvider(manager: Manager, provider: string): Promise<void> {
  return serial(manager, async () => {
    setState(manager, (state) => ({
      providers: withoutEntry(state.providers, provider),
      nextWakeAt: 0,
      attemptedHash: undefined,
    }));
    await persistStatus(manager);
    notify(manager);
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
