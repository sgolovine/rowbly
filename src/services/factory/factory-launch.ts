import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { ValidationError } from "../errors/errors.js";
import { runtimePath } from "../runtime-files/runtime-files.js";
import type { Store } from "../store/store.js";
import type { ProjectPaths } from "../workspace/workspace.js";

export interface FactoryLaunch {
  executable: string;
  execArgv: string[];
  entry: string;
}

/** What the detached daemon process reported before it became ready. */
export interface LaunchState {
  readonly childError: string | undefined;
  readonly exited: boolean;
}

export interface DaemonOptions {
  readonly launch: FactoryLaunch;
  readonly maxWorkers?: number;
  readonly adoptExternal?: boolean;
}

/** The kept arguments, and whether the next argument is the value of a removed flag. */
interface ArgvFilter {
  readonly kept: readonly string[];
  readonly skipNext: boolean;
}

const DEBUG_FLAG = /^--(?:inspect|test|experimental-test)/;
const DEBUG_FLAG_WITH_VALUE =
  /^--(?:inspect-port|test-(?:name-pattern|skip-pattern|reporter|reporter-destination|concurrency|timeout|shard))$/;

function filterArg(filter: ArgvFilter, arg: string): ArgvFilter {
  if (filter.skipNext) {
    return { ...filter, skipNext: false };
  }

  if (DEBUG_FLAG.test(arg)) {
    return { ...filter, skipNext: !arg.includes("=") && DEBUG_FLAG_WITH_VALUE.test(arg) };
  }

  return { kept: [...filter.kept, arg], skipNext: false };
}

/** Removes inspector and test-runner flags, and their values, so that the daemon does not inherit them. */
function daemonExecArgv(execArgv: readonly string[]): string[] {
  return [...execArgv.reduce(filterArg, { kept: [], skipNext: false }).kept];
}

function daemonArgs(paths: ProjectPaths, options: DaemonOptions): string[] {
  const d = options.launch;

  return [
    ...daemonExecArgv(d.execArgv),
    d.entry,
    "-C",
    paths.root,
    "factory",
    "run",
    ...(options.maxWorkers !== undefined ? ["--max-workers", String(options.maxWorkers)] : []),
    ...(options.adoptExternal ? ["--adopt-external"] : []),
  ];
}

/** Starts a detached daemon with its output in a new log. The state records a launch error and the exit. */
export async function launchDaemon(
  paths: ProjectPaths,
  options: DaemonOptions,
  state: Store<LaunchState>,
): Promise<void> {
  const d = options.launch;

  if (!isAbsolute(d.executable) || !isAbsolute(d.entry)) {
    throw new ValidationError("Factory launch paths must be absolute");
  }

  const args = daemonArgs(paths, options);
  const logPath = await runtimePath(paths, `logs/${randomUUID()}.jsonl`);
  const log = await open(logPath, "a", 0o600);

  try {
    const child = spawn(d.executable, args, {
      cwd: paths.root,
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
      windowsHide: true,
    });

    child.on("error", (error) => state.update(() => ({ childError: error.message })));
    child.on("exit", () => state.update(() => ({ exited: true })));
    child.unref();
  } finally {
    await log.close();
  }
}
