import { type FSWatcher, watch } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pruneFactoryCommands } from "../../services/factory-control/factory-control.js";
import { createFactoryManager, type FactoryManager } from "../../services/factory-manager/factory-manager.js";
import {
  acquireFactoryOwnership,
  newOwner,
  type Owner,
  probeOwner,
  readFactoryOwner,
  releaseFactoryOwnership,
} from "../../services/factory-ownership/factory-ownership.js";
import { preflightFactory, recoverFactory } from "../../services/factory-recovery/factory-recovery.js";
import { writeFileAtomic } from "../../services/files/files.js";
import { createFactoryRuntime } from "../../services/pi-runtime/factory-runtime.js";
import { runtimePath } from "../../services/runtime-files/runtime-files.js";
import { bundledSkills } from "../../services/skill/skill.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../../services/workspace/workspace.js";
import { createCliShim } from "./cli-shim.js";
import { type ControlPoller, createControlPoller, pollControl, settledControl } from "./control-poller.js";

export { createCliShim, type LaunchDescriptor } from "./cli-shim.js";

type FactoryRuntime = Awaited<ReturnType<typeof createFactoryRuntime>>;

interface ForegroundInput {
  readonly maxWorkers?: number;
  readonly adoptExternal?: boolean;
}

/** The last status file. The text is not checked: only the owner token of the previous run is read. */
interface PriorStatus {
  readonly owner?: { readonly token?: unknown };
}

/** The facts of one foreground run, after this process owns the factory. */
interface ForegroundRun {
  readonly paths: ProjectPaths;
  readonly ctx: ServiceContext;
  readonly input: ForegroundInput;

  // The owner of this run, and the owners before it.
  readonly owner: Owner;
  readonly previousToken: string | undefined;
  readonly deadToken: string | undefined;

  // The status file, and its content before this run.
  readonly statusPath: string;
  readonly priorStatus: PriorStatus;
}

/** How often the daemon reads the control folder, also when the folder watch gives no event. */
const POLL_MS = 1000;

/** A missing or corrupt status file gives an empty status. */
async function readPriorStatus(statusPath: string): Promise<PriorStatus> {
  return readFile(statusPath, "utf8").then(
    (text) => parseStatus(text),
    () => ({}),
  );
}

function parseStatus(text: string): PriorStatus {
  try {
    return JSON.parse(text) as PriorStatus;
  } catch {
    return {};
  }
}

async function writeStartingStatus(run: ForegroundRun): Promise<void> {
  const status = { ...run.priorStatus, version: 1, owner: run.owner, phase: "starting" };

  await writeFileAtomic(run.statusPath, `${JSON.stringify({ ...status, heartbeatAt: new Date().toISOString() })}\n`, {
    mode: 0o600,
    durable: true,
  });
}

async function writeFailedStatus(statusPath: string, owner: Owner, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 1000) : "Factory failed";

  await writeFileAtomic(statusPath, `${JSON.stringify({ version: 1, owner, phase: "failed", error: message })}\n`, {
    mode: 0o600,
    durable: true,
  });
}

/** Recovers the runs of a dead owner, and keeps only the commands of this owner and the previous owner. */
async function recover(run: ForegroundRun): Promise<void> {
  const previous = run.previousToken ?? run.priorStatus.owner?.token;
  const tokens = [run.owner.token, previous].filter((token): token is string => typeof token === "string");

  await recoverFactory(run.owner.token, run.deadToken, !!run.input.adoptExternal, run.ctx);
  await pruneFactoryCommands(run.paths, tokens);
}

async function createManager(run: ForegroundRun, factory: FactoryRuntime): Promise<FactoryManager> {
  const shim = await createCliShim(
    { executable: process.execPath, execArgv: process.execArgv, entry: resolve(process.argv[1] as string) },
    run.ctx,
  );
  const skillsDir = (await bundledSkills(run.ctx)).dir;

  return createFactoryManager(
    {
      runtime: factory.runtime,
      ownership: { owner: run.owner, deadToken: run.deadToken },
      adoptExternal: run.input.adoptExternal,
      agentDir: factory.agentDir,
      shim,
      skillsDir,
      maxWorkers: run.input.maxWorkers,
      onModel: (role, model) => console.error(`${role}: ${model.provider}/${model.modelId}`),
    },
    run.ctx,
  );
}

/** A signal handler that asks the manager to stop. The same function must go to `process.on` and `process.off`. */
function stopOnSignal(manager: FactoryManager): () => void {
  return () => void manager.shutdown();
}

async function stopSupervision(
  poller: ControlPoller,
  controlWatch: FSWatcher,
  timer: NodeJS.Timeout,
  stop: () => void,
  factory: FactoryRuntime,
): Promise<void> {
  clearInterval(timer);
  controlWatch.close();
  await settledControl(poller);
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  await poller.manager.shutdown();
  await factory.runtime.settleCredentialWrites();
}

/** Runs the manager until it stops. Control commands and process signals can stop it. */
async function supervise(run: ForegroundRun, manager: FactoryManager, factory: FactoryRuntime): Promise<void> {
  const poller = createControlPoller(run.paths, run.owner.token, manager);
  const controlWatch = watch(await runtimePath(run.paths, "control"), () => pollControl(poller));
  const timer = setInterval(() => pollControl(poller), POLL_MS);
  const stop = stopOnSignal(manager);

  pollControl(poller);
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  try {
    await manager.run();
  } finally {
    await stopSupervision(poller, controlWatch, timer, stop, factory);
  }
}

/** The part of the run that holds the ownership. */
async function runOwned(run: ForegroundRun): Promise<{ phase: string }> {
  await writeStartingStatus(run);
  await recover(run);

  const factory = await createFactoryRuntime();
  const manager = await createManager(run, factory);
  const log = await runtimePath(run.paths, `logs/${run.owner.token}.jsonl`);

  await appendFile(
    log,
    `${JSON.stringify({ event: "starting", at: new Date().toISOString(), ownerToken: run.owner.token })}\n`,
    { mode: 0o600 },
  );
  await supervise(run, manager, factory);
  await appendFile(log, `${JSON.stringify({ event: "stopped", at: new Date().toISOString() })}\n`);

  return { phase: "stopped" };
}

/** Owns process signals and output. Services contain no process handlers. */
export async function runFactoryForeground(
  input: ForegroundInput,
  ctx: ServiceContext = {},
): Promise<{ phase: string }> {
  const paths = await findProject(ctx);

  await preflightFactory(ctx);

  const previous = await readFactoryOwner(paths);
  const owner = await newOwner();

  if (!(await acquireFactoryOwnership(paths, owner)).acquired) {
    return { phase: "already-running" };
  }

  const deadToken = previous && (await probeOwner(previous)) === "dead" ? previous.token : undefined;
  const statusPath = await runtimePath(paths, "status.json");
  const priorStatus = await readPriorStatus(statusPath);
  const run = { paths, ctx, input, owner, previousToken: previous?.token, deadToken, statusPath, priorStatus };

  try {
    return await runOwned(run);
  } catch (error) {
    await writeFailedStatus(statusPath, owner, error);
    throw error;
  } finally {
    await releaseFactoryOwnership(paths, owner.token);
  }
}
