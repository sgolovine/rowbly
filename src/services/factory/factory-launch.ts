import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type FileHandle, open } from "node:fs/promises";
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
export function daemonExecArgv(execArgv: readonly string[]): string[] {
  return [...execArgv.reduce(filterArg, { kept: [], skipNext: false }).kept];
}

/** The arguments of a detached `factory watchdog` or of the `factory run` child of a watchdog. */
export function daemonArgs(paths: ProjectPaths, options: DaemonOptions, command: "watchdog" | "run"): string[] {
  const d = options.launch;

  return [
    ...daemonExecArgv(d.execArgv),
    d.entry,
    "-C",
    paths.root,
    "factory",
    command,
    ...(options.maxWorkers !== undefined ? ["--max-workers", String(options.maxWorkers)] : []),
    ...(options.adoptExternal ? ["--adopt-external"] : []),
  ];
}

/** Checks that the executable and the entry of a launch are absolute paths. */
export function assertAbsoluteLaunch(launch: FactoryLaunch): void {
  if (!isAbsolute(launch.executable) || !isAbsolute(launch.entry)) {
    throw new ValidationError("Factory launch paths must be absolute");
  }
}

/** Opens a new operational log below `.rowbly/runtime/logs/` with mode 0600, and gives its path and handle. */
export async function openFactoryLog(paths: ProjectPaths): Promise<{ path: string; file: FileHandle }> {
  const path = await runtimePath(paths, `logs/${randomUUID()}.jsonl`);

  return { path, file: await open(path, "a", 0o600) };
}

/**
 * Starts a detached watchdog with its output in a new log. The watchdog starts the daemon as its child.
 * The state records a launch error and the exit of the watchdog.
 */
export async function launchDaemon(
  paths: ProjectPaths,
  options: DaemonOptions,
  state: Store<LaunchState>,
): Promise<void> {
  assertAbsoluteLaunch(options.launch);

  const args = daemonArgs(paths, options, "watchdog");
  const log = await openFactoryLog(paths);

  try {
    const child = spawn(options.launch.executable, args, {
      cwd: paths.root,
      detached: true,
      stdio: ["ignore", log.file.fd, log.file.fd],
      windowsHide: true,
    });

    child.on("error", (error) => state.update(() => ({ childError: error.message })));
    child.on("exit", () => state.update(() => ({ exited: true })));
    child.unref();
  } finally {
    await log.file.close();
  }
}
