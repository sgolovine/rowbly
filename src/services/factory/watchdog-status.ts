import { setTimeout as sleep } from "node:timers/promises";
import { ConflictError } from "../errors/errors.js";
import { type Owner, probeOwner } from "../factory-ownership/factory-ownership.js";
import {
  CRASH_LIMIT_KEY,
  claimHeld,
  crashLimitText,
  liveWatchdog,
  readWatchdogClaim,
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

/** True when a watchdog process is alive or uncertain and can still start a daemon. */
export async function watchdogLive(paths: ProjectPaths): Promise<boolean> {
  return (await liveWatchdog(paths)) !== undefined;
}

/** Waits until the watchdog process is dead. A timeout is an error. */
async function waitForWatchdogExit(watchdog: Owner, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if ((await probeOwner(watchdog)) === "dead") {
      return;
    }

    await sleep(50);
  }

  throw new ConflictError(`Factory watchdog did not stop: pid ${watchdog.pid}`);
}

/**
 * Stops a live watchdog with `SIGTERM` and waits until it exits. The process identity must match, so that the
 * signal never goes to a different process with a reused pid. An uncertain identity is an error.
 */
export async function stopWatchdog(paths: ProjectPaths, timeoutMs: number): Promise<boolean> {
  const live = await liveWatchdog(paths);

  if (!live) {
    return false;
  }

  if (live.liveness !== "alive") {
    throw new ConflictError("Factory watchdog is uncertain", {
      hint: `Make sure that process ${live.process.pid} is the Rowbly watchdog, then stop it by hand.`,
    });
  }

  try {
    process.kill(live.process.pid, "SIGTERM");
  } catch {
    // The watchdog stopped after the probe.
    return true;
  }

  await waitForWatchdogExit(live.process, timeoutMs);

  return true;
}

/** Waits until the claim holder is dead or released the claim. */
async function waitForClaimRelease(paths: ProjectPaths, holder: Owner, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if ((await readWatchdogClaim(paths))?.token !== holder.token || (await probeOwner(holder)) === "dead") {
      return;
    }

    await sleep(50);
  }

  throw new ConflictError(`Factory watchdog did not stop: pid ${holder.pid}`);
}

/**
 * Waits until a live watchdog releases its claim, for example after its daemon stopped with code 0. Then the next
 * start can take the claim at once.
 */
export async function waitForActiveWatchdogExit(paths: ProjectPaths, timeoutMs: number): Promise<void> {
  const holder = await claimHeld(paths);

  if (holder && (await probeOwner(holder)) === "alive") {
    await waitForClaimRelease(paths, holder, timeoutMs);
  }
}
