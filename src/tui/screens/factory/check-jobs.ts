import type { FactoryStatus } from "../../../services/factory/factory.js";
import { formatDuration } from "../stories/thread-text.js";
import { factoryLive } from "./factory-status.js";

type Checks = NonNullable<FactoryStatus["checks"]>;

/** One running or queued job of the check queue, as `status.json` records it. */
export type CheckQueueJob = Checks["jobs"][number];

/** The text of one row of the Checks Modal. */
export interface CheckJobRow {
  /** The ID of the job. */
  readonly value: string;
  /** The Story ID, the Stage label and the check key. */
  readonly label: string;
  /** The scope, the status and the time since the job started or since it was queued. */
  readonly description: string;
}

/** The check queue of a live factory, or `undefined` when the factory is not live or has no `checks` section. */
export function liveChecks(status: FactoryStatus | undefined): Checks | undefined {
  return factoryLive(status) ? status?.checks : undefined;
}

/** The note of the Checks Button: the running count, then the queued count, for example `2/1`. */
export function checksCount(checks: Checks): string {
  return `${checks.running}/${checks.queued}`;
}

/** The running jobs first, then the queued jobs, each group in the order of the queue. */
export function orderedCheckJobs(checks: Checks): CheckQueueJob[] {
  return [
    ...checks.jobs.filter((job) => job.status === "running"),
    ...checks.jobs.filter((job) => job.status === "queued"),
  ];
}

/** The time since a running job started, or since a queued job was queued. */
export function checkJobTime(job: CheckQueueJob, now: number): string {
  const since = job.status === "running" && job.startedAt ? job.startedAt : job.queuedAt;
  const at = Date.parse(since);

  return Number.isNaN(at) ? "—" : formatDuration(now - at);
}

/** The row of `job`: `ROW-25 · In Development · test` and `full · running · 1m 4s`. */
export function checkJobRow(job: CheckQueueJob, stages: Readonly<Record<string, string>>, now: number): CheckJobRow {
  return {
    value: job.id,
    label: `${job.storyId} · ${stages[job.stage] ?? job.stage} · ${job.key}`,
    description: `${job.scope} · ${job.status} · ${checkJobTime(job, now)}`,
  };
}
