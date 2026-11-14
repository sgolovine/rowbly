import type { CheckLimits } from "../factory-settings/check-settings.js";
import type { Store } from "../store/store.js";
import type { ProjectPaths } from "../workspace/workspace.js";

type CheckScope = "full" | "narrow";
export type CheckStatus = "queued" | "running" | "passed" | "failed" | "timed_out" | "cancelled" | "error";
export type StopReason = "timed_out" | "cancelled";
export type ShellEnv = Readonly<Record<string, string | undefined>>;

/** The record of one check job in `runtime/checks/jobs.json`. */
export interface CheckJob {
  // Identity
  readonly id: string;
  readonly ownerToken: string;
  readonly threadId: string;
  readonly storyId: string;
  readonly stage: string;
  /** The index of the Stage on the board. A larger index is nearer to the last Stage and goes first. */
  readonly rank: number;
  readonly seq: number;

  // Check
  readonly key: string;
  readonly scope: CheckScope;
  readonly files: readonly string[];
  readonly command: string;
  readonly cwd: string;
  readonly memoryMb: number;
  readonly timeoutMinutes: number;

  // Lifecycle
  readonly status: CheckStatus;
  readonly queuedAt: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly exitCode?: number | null;
  readonly head?: string;
  readonly error?: string;

  // Process and memory
  readonly estimateMb?: number;
  readonly peakMb?: number;
  readonly pgid?: number;
  readonly startTicks?: string;
}

/** A request for one check from the `run_check` tool of a worker. */
export interface CheckRequest {
  readonly threadId: string;
  readonly storyId: string;
  readonly stage: string;
  readonly rank: number;
  readonly key: string;
  readonly scope: CheckScope;
  readonly files: readonly string[];
  readonly command: string;
  readonly cwd: string;
  readonly env: ShellEnv;
  readonly memoryMb: number;
  readonly timeoutMinutes: number;
}

/** The result of one check for the worker. */
export interface CheckOutcome {
  readonly job: CheckJob;
  /** The last 200 lines of the output, with a maximum of 20000 characters. */
  readonly output: string;
  /** The absolute path of the full output. */
  readonly log: string;
}

/** One started check process. Its process group has the ID of the leader. */
export interface CheckProcess {
  readonly pid: number | undefined;
  /** Gives the exit code, or null after a signal. It rejects when the process cannot start. */
  readonly exited: Promise<number | null>;
  readonly onOutput: (listener: (chunk: string) => void) => void;
}

/** The times of the queue. Tests make them short. */
interface CheckTiming {
  readonly sampleMs: number;
  readonly admitMs: number;
  readonly progressMs: number;
  readonly killGraceMs: number;
  readonly minuteMs: number;
}

/** The parts of the queue that touch the machine. Tests give fakes, so that no real check starts. */
export interface CheckQueueDeps {
  readonly readMemAvailableMb: () => Promise<number>;
  readonly readGroupRssMb: (pgid: number) => Promise<number>;
  /** Gives the Linux start ticks of a process, or undefined when the process does not exist. */
  readonly readStartTicks: (pid: number) => Promise<string | undefined>;
  readonly readHead: (cwd: string) => Promise<string | undefined>;
  readonly spawn: (command: string, options: { cwd: string; env: ShellEnv }) => CheckProcess;
  /** Sends a signal to a process group. A group that does not exist is not an error. */
  readonly kill: (pgid: number, signal: NodeJS.Signals) => void;
  readonly now: () => number;
  readonly timing: CheckTiming;
}

/** The waiter of one job, and the values that do not go into the record. */
interface Ticket {
  readonly env: ShellEnv;
  readonly resolve: (outcome: CheckOutcome) => void;
}

/** One job with a process. */
export interface LiveJob {
  readonly process?: CheckProcess;
  readonly tail: string;
  readonly stopReason?: StopReason;
  readonly sampler?: NodeJS.Timeout;
  readonly timeout?: NodeJS.Timeout;
  readonly killTimer?: NodeJS.Timeout;
  readonly done: Promise<void>;
}

/** The state of the queue. Each change replaces the whole value in the store. */
export interface QueueState {
  readonly jobs: readonly CheckJob[];
  readonly tickets: ReadonlyMap<string, Ticket>;
  readonly live: ReadonlyMap<string, LiveJob>;
  readonly availableMb?: number;
  readonly seq: number;
  readonly stopping: boolean;
  readonly admitting: Promise<void>;
  readonly writes: Promise<void>;
  readonly timer?: NodeJS.Timeout;
}

/** The fixed environment of one queue, and the store of its state. */
export interface CheckQueue {
  readonly paths: ProjectPaths;
  readonly ownerToken: string;
  /** Gives the current checks of `factory.json`. A change applies to the next admission. */
  readonly limits: () => CheckLimits | undefined;
  readonly deps: CheckQueueDeps;
  /** Gets each change of a job status. */
  readonly onChange: (job: CheckJob) => void;
  readonly store: Store<QueueState>;
}

/** The checks part of `status.json`. */
export interface CheckQueueStatus {
  readonly running: number;
  readonly queued: number;
  readonly availableMb?: number;
  readonly maxConcurrent: number;
  readonly jobs: readonly Pick<
    CheckJob,
    "id" | "threadId" | "storyId" | "stage" | "key" | "scope" | "status" | "queuedAt" | "startedAt" | "estimateMb"
  >[];
}
