import { readdir, readFile } from "node:fs/promises";
import { NotFoundError, ValidationError } from "../errors/errors.js";
import type { WorkerActivity, WorkerSession, WorkerUsage, WorkerWorktree } from "../factory-manager/worker-executor.js";
import { writeFileAtomic } from "../files/files.js";
import type { ThreadCheck, WorkerResult } from "../thread/thread.js";
import { ensurePrivateDir, type HostAgentPaths, threadPaths, validRequestId } from "./host-agent-paths.js";

/** The phase of a run. A run in `ended` has an end reason. */
export type HostRunPhase = "starting" | "running" | "ended";

/** Why a run ended. The host reports facts. The main machine maps them to the Thread status. */
export type HostRunEndReason = "completed" | "failed" | "stopped" | "cancelled";

/** The error of a failed run. */
export interface HostRunFailure {
  readonly code: string;
  readonly message: string;
  /** True when the failure came after the session opened. */
  readonly sessionOpened: boolean;
}

/** The content of `threads/<thread-id>/run.json`. Only the runner of the agent writes it. */
export interface HostRunState {
  // Identity
  readonly version: 1;
  readonly threadId: string;
  readonly requestId: string;
  readonly kind: "launch" | "resume";

  // Progress
  readonly phase: HostRunPhase;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly worktree?: WorkerWorktree;
  readonly session?: WorkerSession;
  readonly activity?: WorkerActivity;
  /** The last checks of the worker on this host, oldest first. The list keeps the last 20 checks. */
  readonly checks?: readonly ThreadCheck[];

  // End
  readonly result?: WorkerResult;
  /** The usage of the session when it closed. */
  readonly usage?: WorkerUsage;
  readonly failure?: HostRunFailure;
  readonly endReason?: HostRunEndReason;
  readonly endedAt?: string;
}

function validRun(value: unknown, threadId: string): value is HostRunState {
  const run = value as Partial<HostRunState> | null;

  return run?.version === 1 && run.threadId === threadId && ["starting", "running", "ended"].includes(run.phase ?? "");
}

/** Reads the run state of the Thread. A missing file gives `undefined`. A bad file gives a ValidationError. */
export async function readHostRun(paths: HostAgentPaths, threadId: string): Promise<HostRunState | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(threadPaths(paths, threadId).run, "utf8"));

    if (!validRun(value, threadId)) {
      throw new ValidationError(`Invalid run state of Thread ${threadId}`);
    }

    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

/** Reads the run state of the Thread, or throws a NotFoundError. */
export async function requireHostRun(paths: HostAgentPaths, threadId: string): Promise<HostRunState> {
  const run = await readHostRun(paths, threadId);

  if (!run) {
    throw new NotFoundError(`Thread ${threadId} has no run on this host`);
  }

  return run;
}

/** Writes the run state with mode 0600. A durable write syncs the file and its folder. */
export async function writeHostRun(paths: HostAgentPaths, run: HostRunState, durable: boolean): Promise<void> {
  const files = threadPaths(paths, run.threadId);

  await ensurePrivateDir(files.dir);
  await writeFileAtomic(files.run, `${JSON.stringify(run)}\n`, { mode: 0o600, durable });
}

/** The ids of the Thread folders, in order. A folder without a valid id is skipped. */
export async function hostThreadIds(paths: HostAgentPaths): Promise<string[]> {
  const entries = await readdir(paths.threads, { withFileTypes: true }).catch(() => []);

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter(validRequestId)
    .toSorted();
}
