/** The time that the watchdog waits before it starts the daemon again. The value at index `n` follows crash `n + 1`. */
export const BACKOFF_MS: readonly number[] = [1000, 2000, 4000, 8000, 16_000];

/** After this number of crashes in a row, the watchdog does not start the daemon again. */
export const CRASH_LIMIT = 5;

/** A daemon that stays up for this time sets the count of crashes in a row to 0. */
export const STABLE_MS = 5 * 60 * 1000;

/** The timing of a watchdog. Tests give shorter values. Production uses the constants. */
export interface WatchdogTiming {
  readonly backoffMs: readonly number[];
  readonly crashLimit: number;
  readonly stableMs: number;
}

export const DEFAULT_TIMING: WatchdogTiming = { backoffMs: BACKOFF_MS, crashLimit: CRASH_LIMIT, stableMs: STABLE_MS };

/** How the daemon stopped: a `clean` exit and a requested `stop` do not cause a restart. A `crash` does. */
export type ExitKind = "clean" | "stop" | "crash";

/** The exit code or the signal of a daemon that stopped. */
export interface DaemonExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  /** The error of a daemon that did not start, for example a missing executable. */
  readonly error?: string;
}

/** Classifies a daemon exit. Exit code 0 is clean. A stop request of the watchdog is never a crash. */
export function classifyExit(exit: DaemonExit, stopRequested: boolean): ExitKind {
  if (stopRequested) {
    return "stop";
  }

  return exit.code === 0 && exit.signal === null && exit.error === undefined ? "clean" : "crash";
}

/** The wait before the restart that follows crash number `crashCount`. The last value is the limit. */
export function backoffMs(crashCount: number, timing: WatchdogTiming = DEFAULT_TIMING): number {
  const values = timing.backoffMs;
  const index = Math.min(Math.max(crashCount, 1), values.length) - 1;

  return values[index] ?? 0;
}

/** The count of crashes in a row after a crash. A daemon that stayed up for the stable period starts a new count. */
export function crashCountAfter(count: number, uptimeMs: number, timing: WatchdogTiming = DEFAULT_TIMING): number {
  return (uptimeMs >= timing.stableMs ? 0 : count) + 1;
}

/** True when the count of crashes in a row is at the limit, so that the watchdog stops. */
export function crashLimitReached(count: number, timing: WatchdogTiming = DEFAULT_TIMING): boolean {
  return count >= timing.crashLimit;
}

/** The exit code or the signal as text, for example `code 1` or `signal SIGKILL`. */
export function exitText(exit: DaemonExit): string {
  if (exit.error !== undefined) {
    return `launch error ${exit.error}`;
  }

  return exit.signal ? `signal ${exit.signal}` : `code ${exit.code ?? "unknown"}`;
}
