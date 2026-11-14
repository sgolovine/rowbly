import { setTimeout as sleep } from "node:timers/promises";
import { ConflictError } from "../errors/errors.js";
import { probeOwner } from "../factory-ownership/factory-ownership.js";
import {
  activeWatchdog,
  CRASH_LIMIT_KEY,
  crashLimitText,
  type WatchdogState,
} from "../factory-watchdog/factory-watchdog.js";
import type { ProjectPaths } from "../workspace/workspace.js";

/** The restart fields of the factory status. */
export interface RestartFields {
  /** The count of daemon crashes in a row. The watchdog restarted the daemon after each crash below the limit. */
  readonly restarts: number;
  readonly lastCrashAt?: string;
}

/** The restart fields from the watchdog state. No state gives 0 restarts. */
export function restartFields(state: WatchdogState | undefined): RestartFields {
  return state?.lastCrashAt === undefined
    ? { restarts: state?.crashCount ?? 0 }
    : { restarts: state.crashCount, lastCrashAt: state.lastCrashAt };
}

/** The attention entry of a watchdog that stopped at the crash limit. */
export function crashLimitAttention(state: WatchdogState): [string, { text: string }] {
  return [CRASH_LIMIT_KEY, { text: crashLimitText(state) }];
}

/** True when an active watchdog process is alive or uncertain, so that it can still start a daemon. */
export async function watchdogLive(paths: ProjectPaths): Promise<boolean> {
  return (await activeWatchdog(paths)) !== undefined;
}

/** Waits until the watchdog process of `state` is dead. A timeout is an error. */
async function waitForWatchdogExit(state: WatchdogState, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if ((await probeOwner(state.process)) === "dead") {
      return;
    }

    await sleep(50);
  }

  throw new ConflictError(`Factory watchdog did not stop: pid ${state.pid}`);
}

/**
 * Stops an active watchdog with `SIGTERM` and waits until it exits. The process identity must match, so that the
 * signal never goes to a different process with a reused pid. An uncertain identity is an error.
 */
export async function stopWatchdog(paths: ProjectPaths, timeoutMs: number): Promise<boolean> {
  const active = await activeWatchdog(paths);

  if (!active) {
    return false;
  }

  if (active.liveness !== "alive") {
    throw new ConflictError("Factory watchdog is uncertain", {
      hint: `Make sure that process ${active.state.pid} is the Rowbly watchdog, then stop it by hand.`,
    });
  }

  try {
    process.kill(active.state.pid, "SIGTERM");
  } catch {
    // The watchdog stopped after the probe.
    return true;
  }

  await waitForWatchdogExit(active.state, timeoutMs);

  return true;
}

/** Waits until a watchdog that is active exits, for example after its daemon stopped with code 0. */
export async function waitForActiveWatchdogExit(paths: ProjectPaths, timeoutMs: number): Promise<void> {
  const active = await activeWatchdog(paths);

  if (active?.liveness === "alive") {
    await waitForWatchdogExit(active.state, timeoutMs);
  }
}
