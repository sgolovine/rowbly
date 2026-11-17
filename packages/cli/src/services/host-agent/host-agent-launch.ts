import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ValidationError } from "../errors/errors.js";
import { assertAbsoluteLaunch, daemonExecArgv, type FactoryLaunch } from "../factory/factory-launch.js";
import { type Owner, type OwnerProbe, probeOwner } from "../factory-ownership/ownership-lock.js";
import { HostTimeoutError } from "../host-transport/host-errors.js";
import { Store } from "../store/store.js";
import { liveAgent, readAgentState } from "./host-agent-claim.js";
import { type HostAgentPaths, hostAgentPaths, prepareAgentDirs, validateProjectId } from "./host-agent-paths.js";
import { writeSlotLimit } from "./host-slots.js";

/** The default time that `host serve --detach` waits for a live agent: 15 seconds. */
export const DEFAULT_START_TIMEOUT_MS = 15_000;

/** The input of `host serve --detach`, from the main machine. */
export interface HostServeInput {
  readonly projectId: string;
  readonly maxWorkers: number;
}

/** The result of `host serve --detach`. `started` is `false` when a live agent already held the claim. */
export interface HostServeResult {
  readonly started: boolean;
  readonly owner: Owner;
}

export interface StartHostAgentOptions {
  /** The Node executable, its flags and the Rowbly entry file of the detached agent. */
  readonly launch: FactoryLaunch;
  readonly home?: string;
  readonly timeoutMs?: number;
  readonly probe?: OwnerProbe;
}

/** What the detached process reported. */
interface ChildState {
  readonly pid: number | undefined;
  readonly exited: boolean;
  readonly error: string | undefined;
}

/** Checks the input of `host serve --detach`. The worker limit is checked when it is written. */
export function parseServeInput(value: unknown): HostServeInput {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError('The input must be { "projectId": "<id>", "maxWorkers": <n> }');
  }

  const record = value as Record<string, unknown>;

  return { projectId: validateProjectId(record.projectId), maxWorkers: record.maxWorkers as number };
}

/** Starts `rowbly host serve <project-id>` in a new session, with its output in a new log of `logs/`. */
async function spawnAgent(
  paths: HostAgentPaths,
  options: StartHostAgentOptions,
  home: string,
): Promise<Store<ChildState>> {
  const { launch } = options;
  const log = await open(join(paths.logs, `${randomUUID()}.log`), "a", 0o600);
  const state = new Store<ChildState>({ pid: undefined, exited: false, error: undefined });

  try {
    const child = spawn(
      launch.executable,
      [...daemonExecArgv(launch.execArgv), launch.entry, "host", "serve", paths.projectId],
      { cwd: home, env: { ...process.env, HOME: home }, detached: true, stdio: ["ignore", log.fd, log.fd] },
    );

    state.update(() => ({ pid: child.pid }));
    child.on("error", (error) => state.update(() => ({ error: error.message, exited: true })));
    child.on("exit", () => state.update(() => ({ exited: true })));
    child.unref();
  } finally {
    await log.close();
  }

  return state;
}

/** Waits until a live agent holds the claim. The detached child, or a different agent that won the race. */
async function waitForAgent(
  paths: HostAgentPaths,
  child: Store<ChildState>,
  probe: OwnerProbe,
  deadline: number,
): Promise<Owner> {
  const owner = await liveAgent(paths, probe);

  if (owner) {
    return owner;
  }

  const { exited, error, pid } = child.current;
  const state = exited ? await readAgentState(paths) : undefined;

  // The child can run a queued `stop` and exit before this check. It started, so its owner is the result.
  if (state && state.owner.pid === pid) {
    return state.owner;
  }

  if (exited || Date.now() >= deadline) {
    throw new HostTimeoutError(`The host agent of ${paths.projectId} did not start.`, {
      details: { projectId: paths.projectId, exited, error, logs: paths.logs },
    });
  }

  await sleep(50);

  return waitForAgent(paths, child, probe, deadline);
}

/**
 * Writes the machine limit and starts a detached host agent for the Project, unless a live agent holds the claim.
 * The agent continues when the SSH session stops. Gives the owner of the live agent.
 */
export async function startHostAgent(input: unknown, options: StartHostAgentOptions): Promise<HostServeResult> {
  const serve = parseServeInput(input);
  const home = options.home ?? homedir();
  const probe = options.probe ?? probeOwner;
  const paths = hostAgentPaths(serve.projectId, home);

  assertAbsoluteLaunch(options.launch);
  await writeSlotLimit(serve.maxWorkers, home);
  await prepareAgentDirs(paths);

  const running = await liveAgent(paths, probe);

  if (running) {
    return { started: false, owner: running };
  }

  const child = await spawnAgent(paths, options, home);
  const owner = await waitForAgent(paths, child, probe, Date.now() + (options.timeoutMs ?? DEFAULT_START_TIMEOUT_MS));

  return { started: owner.pid === child.current.pid, owner };
}
