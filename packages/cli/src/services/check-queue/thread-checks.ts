import type { ThreadCheck } from "../thread/thread.js";
import { durationSeconds } from "./check-order.js";
import type { CheckJob } from "./check-types.js";

/** The short check list of a Thread keeps the last 20 checks. */
const THREAD_CHECKS = 20;

/** Gives the short record of one job for the check list of its Thread. */
export function threadCheck(job: CheckJob, now: number): ThreadCheck {
  return {
    id: job.id,
    key: job.key,
    scope: job.scope,
    status: job.status,
    ...(job.head ? { head: job.head } : {}),
    ...(job.startedAt ? { durationSeconds: durationSeconds(job, now) } : {}),
  };
}

/** Gives the short check list of a Thread with the change of one job. The list keeps its order. */
export function withCheck(checks: readonly ThreadCheck[], entry: ThreadCheck): readonly ThreadCheck[] {
  if (checks.some((check) => check.id === entry.id)) {
    return checks.map((check) => (check.id === entry.id ? entry : check));
  }

  return [...checks, entry].slice(-THREAD_CHECKS);
}
