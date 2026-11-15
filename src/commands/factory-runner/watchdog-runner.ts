import { type ChildProcess, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  assertAbsoluteLaunch,
  daemonArgs,
  type FactoryLaunch,
  openFactoryLog,
} from "../../services/factory/factory-launch.js";
import {
  newOwner,
  type Owner,
  probeOwner,
  readFactoryOwner,
} from "../../services/factory-ownership/factory-ownership.js";
import {
  acquireWatchdogClaim,
  backoffMs,
  classifyExit,
  crashCountAfter,
  crashLimitReached,
  type DaemonExit,
  DEFAULT_TIMING,
  exitText,
  liveWatchdog,
  readWatchdogState,
  releaseWatchdogClaim,
  type WatchdogPhase,
  type WatchdogState,
  type WatchdogTiming,
  watchdogActive,
  writeWatchdogState,
} from "../../services/factory-watchdog/factory-watchdog.js";
import { prepareRuntime } from "../../services/runtime-files/runtime-files.js";
import { Store } from "../../services/store/store.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../../services/workspace/workspace.js";

/** The options of `rowbly factory watchdog`. Tests also give a shorter timing and a stop signal. */
export interface WatchdogInput {
  readonly launch: FactoryLaunch;
  readonly maxWorkers?: number;
  readonly adoptExternal?: boolean;
  readonly timing?: WatchdogTiming;
  /** An abort is a stop request: the watchdog cancels a restart and stops its daemon. */
  readonly signal?: AbortSignal;
}

/** The result of a watchdog: `already-running` when a different watchdog or a live owner exists at the start. */
export interface WatchdogResult {
  readonly phase: WatchdogPhase | "already-running";
  readonly crashCount: number;
  readonly problem?: string;
}

/** The fixed environment of one watchdog process. */
interface Watchdog {
  readonly paths: ProjectPaths;
  readonly input: WatchdogInput;
  readonly timing: WatchdogTiming;
  readonly signal: AbortSignal;
  readonly self: Owner;
}

/** The record that the watchdog writes. It holds only the changed fields of each step. */
type RecordChange = Partial<Omit<WatchdogState, "version" | "pid" | "process" | "updatedAt">>;

/** The state of the watchdog file that this process wrote last. Only this process changes it. */
interface Written {
  readonly state: WatchdogState;
}

/** The record of this watchdog, with the changes. */
function nextRecord(w: Watchdog, previous: WatchdogState | undefined, change: RecordChange): WatchdogState {
  return {
    version: 1,
    pid: w.self.pid,
    process: w.self,
    phase: "running",
    crashCount: 0,
    ...previous,
    ...change,
    updatedAt: new Date().toISOString(),
  };
}

/** Writes a change to the watchdog file and gives the new record. Only the holder of the watchdog claim calls it. */
async function record(w: Watchdog, written: Written, change: RecordChange): Promise<Written> {
  const state = nextRecord(w, written.state, change);

  await writeWatchdogState(w.paths, state);

  return { state };
}

/** Tells if a daemon owner is alive or uncertain. Only a missing or dead owner permits a start. */
async function ownerBlocks(paths: ProjectPaths): Promise<boolean> {
  const owner = await readFactoryOwner(paths);

  return owner !== undefined && owner !== null && (await probeOwner(owner)) !== "dead";
}

/** A listener that sends `SIGTERM` to the daemon. The same function must go to `addEventListener` and `removeEventListener`. */
function stopChild(child: ChildProcess): () => void {
  return () => void child.kill("SIGTERM");
}

/** Resolves when the child stops. A spawn error is an exit with the error text. */
function childExit(child: ChildProcess): Promise<DaemonExit> {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", (error) => resolve({ code: null, signal: null, error: error.message }));
  });
}

/** A started daemon. The exit promise exists from the spawn, so that no early exit or error is lost. */
interface Spawned {
  readonly child: ChildProcess;
  readonly exit: Promise<DaemonExit>;
  readonly written: Written;
}

/** Spawns one `factory run` daemon with a new log. The log path goes to the watchdog file. */
async function spawnDaemon(w: Watchdog, written: Written): Promise<Spawned> {
  const log = await openFactoryLog(w.paths);

  try {
    const child = spawn(w.input.launch.executable, daemonArgs(w.paths, w.input, "run"), {
      cwd: w.paths.root,
      stdio: ["ignore", log.file.fd, log.file.fd],
      windowsHide: true,
    });
    const exit = childExit(child);

    return {
      child,
      exit,
      written: await record(w, written, { phase: "running", lastLog: log.path, problem: undefined }),
    };
  } finally {
    await log.file.close();
  }
}

/** Resolves with `stable` after the stable period. An abort of the timer gives `cancelled`. */
function stablePeriod(w: Watchdog, timer: AbortController): Promise<"stable" | "cancelled"> {
  return sleep(w.timing.stableMs, "stable" as const, { signal: timer.signal }).catch(() => "cancelled" as const);
}

/** Runs one daemon until it stops. A daemon that stays up for the stable period sets the count to 0. */
async function runDaemon(w: Watchdog, written: Written): Promise<{ exit: DaemonExit; written: Written }> {
  const spawned = await spawnDaemon(w, written);
  const stop = stopChild(spawned.child);
  const timer = new AbortController();

  w.signal.addEventListener("abort", stop, { once: true });

  if (w.signal.aborted) {
    stop();
  }

  const first = await Promise.race([spawned.exit, stablePeriod(w, timer)]);
  const next = first === "stable" ? await record(w, spawned.written, { crashCount: 0 }) : spawned.written;
  const exit = await spawned.exit;

  timer.abort();
  w.signal.removeEventListener("abort", stop);

  return { exit, written: next };
}

/** Waits for the back-off. A stop request ends the wait early. */
async function backoff(w: Watchdog, ms: number): Promise<void> {
  await sleep(ms, undefined, { signal: w.signal }).catch(() => undefined);
}

/** Records a crash and gives the new record. At the crash limit, the phase is `failed`. */
async function recordCrash(w: Watchdog, written: Written, exit: DaemonExit, uptimeMs: number): Promise<Written> {
  const crashCount = crashCountAfter(written.state.crashCount, uptimeMs, w.timing);
  const phase = crashLimitReached(crashCount, w.timing) ? "failed" : "backoff";

  console.error(`Factory daemon stopped with ${exitText(exit)} (crash ${crashCount} in a row).`);

  return record(w, written, { phase, crashCount, lastCrashAt: new Date().toISOString(), lastExit: exitText(exit) });
}

/** Records a problem that stops the watchdog without a restart. */
async function recordProblem(w: Watchdog, written: Written, problem: string): Promise<Written> {
  console.error(problem);

  return record(w, written, { phase: "stopped", problem });
}

const OWNER_PROBLEM = "The factory owner is alive or uncertain. The watchdog does not start a second daemon.";

/** One pass of the loop: start the daemon, watch its exit, and record the result. */
async function watchOnce(w: Watchdog, written: Written): Promise<Written> {
  if (await ownerBlocks(w.paths)) {
    return recordProblem(w, written, OWNER_PROBLEM);
  }

  if (w.signal.aborted) {
    return record(w, written, { phase: "stopped" });
  }

  const startedAt = Date.now();
  const run = await runDaemon(w, written);
  const kind = classifyExit(run.exit, w.signal.aborted);

  if (kind !== "crash") {
    return record(w, run.written, { phase: "stopped" });
  }

  const crashed = await recordCrash(w, run.written, run.exit, Date.now() - startedAt);

  if (crashed.state.phase === "backoff") {
    await backoff(w, backoffMs(crashed.state.crashCount, w.timing));
  }

  return crashed;
}

/** Starts the daemon again after each crash, until a clean exit, a stop, a problem or the crash limit. */
async function watchLoop(w: Watchdog, first: Written): Promise<Written> {
  const current = new Store<{ written: Written }>({ written: first });

  while (watchdogActive(current.current.written.state)) {
    if (w.signal.aborted) {
      return record(w, current.current.written, { phase: "stopped" });
    }

    const written = await watchOnce(w, current.current.written);

    current.update(() => ({ written }));
  }

  return current.current.written;
}

/** A new watchdog starts with a count of 0, but keeps the time and the exit of the last crash. */
function keptCrash(previous: WatchdogState | undefined): RecordChange {
  return { lastCrashAt: previous?.lastCrashAt, lastExit: previous?.lastExit };
}

/** The longest wait for the claim of a watchdog that wrote its last phase and is about to exit. */
const CLAIM_WAIT_MS = 5000;

/**
 * Takes the exclusive watchdog claim. A different live watchdog gives `false` at once. A holder that wrote its last
 * phase releases the claim when it exits, so the wait continues until the deadline.
 */
async function takeClaim(paths: ProjectPaths, self: Owner, deadline: number): Promise<boolean> {
  const claim = await acquireWatchdogClaim(paths, self);

  if (claim.acquired) {
    return true;
  }

  if (Date.now() >= deadline || (await liveWatchdog(paths)) !== undefined) {
    return false;
  }

  await sleep(50);

  return takeClaim(paths, self, deadline);
}

/** Writes the first record of this watchdog and runs the loop. The caller holds the claim. */
async function watchWithClaim(w: Watchdog): Promise<WatchdogResult> {
  const previous = await readWatchdogState(w.paths);
  const first = await record(w, { state: nextRecord(w, undefined, {}) }, keptCrash(previous));
  const last = await watchLoop(w, first);

  return { phase: last.state.phase, crashCount: last.state.crashCount, problem: last.state.problem };
}

/**
 * Runs the watchdog until it stops. Only the holder of the exclusive watchdog claim continues. A different live
 * watchdog or a live owner at the start gives `already-running`, and this watchdog does not write the state file.
 */
export async function runWatchdog(input: WatchdogInput, ctx: ServiceContext = {}): Promise<WatchdogResult> {
  assertAbsoluteLaunch(input.launch);

  const paths = await findProject(ctx);

  await prepareRuntime(paths);

  const self = await newOwner();
  const w: Watchdog = {
    paths,
    input,
    self,
    timing: input.timing ?? DEFAULT_TIMING,
    signal: input.signal ?? new AbortController().signal,
  };

  if (!(await takeClaim(paths, self, Date.now() + CLAIM_WAIT_MS))) {
    return { phase: "already-running", crashCount: 0 };
  }

  try {
    return (await ownerBlocks(paths)) ? { phase: "already-running", crashCount: 0 } : await watchWithClaim(w);
  } finally {
    await releaseWatchdogClaim(paths, self.token).catch(() => false);
  }
}

/** A signal handler that requests a stop. The same function must go to `process.on` and `process.off`. */
function abortOnSignal(controller: AbortController): () => void {
  return () => controller.abort();
}

/** Owns the process signals of the watchdog. `SIGTERM` and `SIGINT` stop it and its daemon. */
export async function runFactoryWatchdog(
  input: Omit<WatchdogInput, "signal" | "timing">,
  ctx: ServiceContext = {},
): Promise<WatchdogResult> {
  const controller = new AbortController();
  const stop = abortOnSignal(controller);

  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  try {
    return await runWatchdog({ ...input, signal: controller.signal }, ctx);
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}
