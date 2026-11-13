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
} from "../factoryOwnership/factoryOwnership.js";
import { recoverFactory } from "../factoryRecovery/factoryRecovery.js";
import { type FactorySettings, getFactorySettings } from "../factorySettings/factorySettings.js";
import { runtimePath } from "../runtimeFiles/runtimeFiles.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";
import { type FactoryDependencies, type ManagerState, notify, readAuthStamp, serial } from "./managerState.js";
import { buildSnapshot, loadStoredStatus, persistStatus } from "./managerStatus.js";
import { reconcilePolicy, runFactory, shutdownFactory } from "./supervisorLoop.js";
import { createSupervisorTools } from "./supervisorTools.js";
import { cancelWorker, type ReserveWorkerInput, reserveWorker, resumeWorker } from "./workerReservation.js";

export type { FactoryDependencies } from "./managerState.js";
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

  let recovered: RecoveredFactory;

  try {
    recovered = await recoverAndConfigure(deps, ctx, owner, deadToken);
  } catch (error) {
    await releaseFactoryOwnership(paths, owner.token);
    throw error;
  }

  const manager: ManagerState = {
    deps,
    paths,
    ctx,
    owner,

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
    authStamp: await readAuthStamp(deps.agentDir),

    active: new Map(),
    promptClaims: new Map(),
    requests: new Map(),

    tools: [],
    supervisorBorn: Date.now(),
    wakeCount: 0,

    nextWakeAt: 0,
    unanswered: 0,
    deliveredReportIds: [],

    holds: new Map(),
    attention: new Map(),
    providers: new Map(),
  };

  manager.tools = createSupervisorTools(manager);

  if (recovered.externalActive) {
    manager.attention.set("external", {
      text: `${recovered.externalActive} external attempts remain protected. Stop external workers before --adopt-external.`,
    });
  }

  await loadStoredStatus(manager);

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

function retryProvider(manager: ManagerState, provider: string): Promise<void> {
  return serial(manager, async () => {
    manager.providers.delete(provider);
    manager.nextWakeAt = 0;
    manager.attemptedHash = undefined;
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
