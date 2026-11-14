import type { CheckSpec } from "../factory-settings/check-settings.js";

/** The shell of a worker: the canonical Project root and the exact Rowbly CLI shim. */
export interface WorkerShell {
  readonly root: string;
  readonly shim: string;
}

/** Gives the environment of the worker shell. It finds the exact Rowbly CLI shim first on the PATH. */
export function workerShellEnv(
  worker: WorkerShell,
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return {
    ...env,
    PATH: `${worker.shim.slice(0, worker.shim.lastIndexOf("/"))}:${env.PATH ?? ""}`,
    ROWBLY_ROOT: worker.root,
    ROWBLY_CLI: worker.shim,
  };
}

/**
 * Gives the key of the first check whose `command` or `block` text is in the command, or undefined.
 * The gate compares text only. A check that runs through a script file is not found.
 */
export function blockedCheck(checks: readonly CheckSpec[], command: string): string | undefined {
  return checks.find((check) => [check.command, ...check.block].some((text) => command.includes(text)))?.key;
}
