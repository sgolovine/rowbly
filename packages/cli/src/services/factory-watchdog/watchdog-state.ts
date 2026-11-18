import { readFile } from "node:fs/promises";
import { type Owner, type OwnerProbe, probeOwner } from "../factory-ownership/factory-ownership.js";
import { writeFileAtomic } from "../files/files.js";
import { runtimePath } from "../runtime-files/runtime-files.js";
import type { ProjectPaths } from "../workspace/workspace.js";

/** What the watchdog does: it watches a daemon, waits before a restart, stopped at the crash limit, or stopped. */
export type WatchdogPhase = "running" | "backoff" | "failed" | "stopped";

/** The content of `.rowbly/runtime/watchdog.json`. Only the watchdog process writes it. */
export interface WatchdogState {
  readonly version: 1;
  readonly pid: number;
  /** The process identity of the watchdog. It is not a daemon owner. */
  readonly process: Owner;
  readonly phase: WatchdogPhase;

  // The crashes in a row, and the last crash.
  readonly crashCount: number;
  readonly lastCrashAt?: string;
  readonly lastExit?: string;

  /** The log of the last daemon that the watchdog started. */
  readonly lastLog?: string;
  /** A problem that stopped the watchdog without a crash, for example a live owner before a restart. */
  readonly problem?: string;
  readonly updatedAt: string;
}

const PHASES: readonly string[] = ["running", "backoff", "failed", "stopped"];

/** The attention key of the crash limit. The next `factory start` clears it. */
export const CRASH_LIMIT_KEY = "watchdog:crash-limit";

function validState(value: unknown): value is WatchdogState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    record.version === 1 &&
    Number.isSafeInteger(record.pid) &&
    typeof record.process === "object" &&
    record.process !== null &&
    typeof record.phase === "string" &&
    PHASES.includes(record.phase) &&
    Number.isSafeInteger(record.crashCount)
  );
}

function parseState(text: string): WatchdogState | undefined {
  try {
    const value: unknown = JSON.parse(text);

    return validState(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Reads the watchdog state. A missing or corrupt file gives `undefined`. */
export async function readWatchdogState(paths: ProjectPaths): Promise<WatchdogState | undefined> {
  const path = await runtimePath(paths, "watchdog.json");

  return readFile(path, "utf8").then(parseState, () => undefined);
}

/** Writes the watchdog state with mode 0600. */
export async function writeWatchdogState(paths: ProjectPaths, state: WatchdogState): Promise<void> {
  const path = await runtimePath(paths, "watchdog.json");

  await writeFileAtomic(path, `${JSON.stringify(state)}\n`, { mode: 0o600, durable: true });
}

/** True for a phase in which the watchdog process runs and can start a daemon. */
export function watchdogActive(state: WatchdogState | undefined): boolean {
  return state?.phase === "running" || state?.phase === "backoff";
}

/** Tells if the watchdog process of the state is alive. The process identity prevents a match with a reused pid. */
export async function probeWatchdog(
  state: WatchdogState,
  probe: OwnerProbe = probeOwner,
): Promise<"alive" | "dead" | "uncertain"> {
  return probe(state.process);
}

/** Gives the state when an active watchdog process is alive or uncertain, and its liveness. */
export async function activeWatchdog(
  paths: ProjectPaths,
  probe: OwnerProbe = probeOwner,
): Promise<{ state: WatchdogState; liveness: "alive" | "uncertain" } | undefined> {
  const state = await readWatchdogState(paths);

  if (!state || !watchdogActive(state)) {
    return undefined;
  }

  const liveness = await probeWatchdog(state, probe);

  return liveness === "dead" ? undefined : { state, liveness };
}

/** The text of the crash-limit attention entry: the count, the last exit and the path of the last log. */
export function crashLimitText(state: WatchdogState): string {
  const exit = state.lastExit ? ` The last exit was ${state.lastExit}.` : "";
  const log = state.lastLog ? ` Log: ${state.lastLog}.` : "";

  return `The factory daemon crashed ${state.crashCount} times in a row and stays stopped.${exit}${log} Run rowbly factory start to start it again.`;
}
