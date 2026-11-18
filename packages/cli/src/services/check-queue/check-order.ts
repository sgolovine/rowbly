import type { CheckJob, CheckStatus } from "./check-types.js";

const FINAL_STATUSES: readonly CheckStatus[] = ["passed", "failed", "timed_out", "cancelled", "error"];
const TAIL_LINES = 200;
const TAIL_CHARACTERS = 20_000;
/** The output that a running job keeps in memory. The log file has the full output. */
const KEPT_CHARACTERS = 2 * TAIL_CHARACTERS;
const HISTORY_RUNS = 10;

/** Tells if a job status is final. */
export function isFinalCheck(status: CheckStatus): boolean {
  return FINAL_STATUSES.includes(status);
}

/** Gives the queued jobs in the order of admission: nearest to the last Stage first, then by arrival. */
export function waitingJobs(jobs: readonly CheckJob[]): readonly CheckJob[] {
  return jobs.filter((job) => job.status === "queued").toSorted((a, b) => b.rank - a.rank || a.seq - b.seq);
}

export function runningJobs(jobs: readonly CheckJob[]): readonly CheckJob[] {
  return jobs.filter((job) => job.status === "running");
}

/** The memory estimate of a job: the larger of its `memoryMb` and the peak of the last 10 runs of its key and scope. */
export function estimateMb(jobs: readonly CheckJob[], job: CheckJob): number {
  const peaks = jobs
    .filter((other) => other.key === job.key && other.scope === job.scope && isFinalCheck(other.status))
    .slice(-HISTORY_RUNS)
    .map((other) => other.peakMb ?? 0);

  return Math.max(job.memoryMb, ...peaks);
}

/** Tells if the queue can start a job. Without a running job, the next job always starts. */
export function canAdmit(input: {
  readonly running: number;
  readonly availableMb: number | undefined;
  readonly reserveMb: number;
  readonly estimateMb: number;
}): boolean {
  if (input.running === 0) {
    return true;
  }

  return input.availableMb !== undefined && input.availableMb - input.reserveMb >= input.estimateMb;
}

/** Adds output to the kept text of a running job, and drops the start of a long text. */
export function keepOutput(kept: string, chunk: string): string {
  return `${kept}${chunk}`.slice(-KEPT_CHARACTERS);
}

/** Gives the last 200 lines of the output, with a maximum of 20000 characters. */
export function outputTail(text: string): string {
  const lines = text.replace(/\n$/, "").split("\n");

  return lines.slice(-TAIL_LINES).join("\n").slice(-TAIL_CHARACTERS);
}

/** Writes a duration as `1m40s` or `12s`. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);

  return minutes > 0 ? `${minutes}m${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}

/** Gives the progress text of a job, for example `queued, position 2` or `running, 1m40s`. */
export function progressText(jobs: readonly CheckJob[], id: string, now: number): string {
  const job = jobs.find((current) => current.id === id);

  if (!job) {
    return "unknown";
  }

  if (job.status === "queued") {
    return `queued, position ${waitingJobs(jobs).findIndex((current) => current.id === id) + 1}`;
  }

  if (job.status === "running") {
    return `running, ${formatDuration(now - Date.parse(job.startedAt ?? new Date(now).toISOString()))}`;
  }

  return job.status;
}

/** Gives the duration of a job that started, in whole seconds. */
export function durationSeconds(job: CheckJob, now: number): number | undefined {
  if (!job.startedAt) {
    return undefined;
  }

  const end = job.endedAt ? Date.parse(job.endedAt) : now;

  return Math.max(0, Math.round((end - Date.parse(job.startedAt)) / 1000));
}
