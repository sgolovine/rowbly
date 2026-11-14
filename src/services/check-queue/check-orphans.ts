import { setTimeout as sleep } from "node:timers/promises";
import { mapInOrder } from "../in-order/in-order.js";
import type { ProjectPaths } from "../workspace/workspace.js";
import { isFinalCheck } from "./check-order.js";
import { readCheckJobs, writeCheckJobs } from "./check-records.js";
import type { CheckJob, CheckQueueDeps } from "./check-types.js";
import { realCheckDeps } from "./proc-readers.js";

type OrphanDeps = Pick<CheckQueueDeps, "readStartTicks" | "kill" | "now" | "timing">;

const POLL_MS = 100;

/** Tells if the leader of the group of a job is the same process that the queue started. */
async function leaderAlive(deps: OrphanDeps, job: CheckJob): Promise<boolean> {
  if (job.pgid === undefined || job.startTicks === undefined) {
    return false;
  }

  return (await deps.readStartTicks(job.pgid)) === job.startTicks;
}

/** Waits until the leader is gone, or until the grace time ends. */
async function waitForExit(deps: OrphanDeps, job: CheckJob, deadline: number): Promise<boolean> {
  while (deps.now() < deadline) {
    if (!(await leaderAlive(deps, job))) {
      return true;
    }

    await sleep(POLL_MS);
  }

  return !(await leaderAlive(deps, job));
}

/** Sends SIGTERM to the group of an orphan job, then SIGKILL after the grace time. */
async function stopOrphan(deps: OrphanDeps, job: CheckJob): Promise<void> {
  if (!(await leaderAlive(deps, job))) {
    return;
  }

  const pgid = job.pgid as number;

  deps.kill(pgid, "SIGTERM");

  if (!(await waitForExit(deps, job, deps.now() + deps.timing.killGraceMs))) {
    deps.kill(pgid, "SIGKILL");
  }
}

/**
 * Stops the check processes of a dead owner. Each group stops only while its leader still has the recorded
 * start ticks, so that a new process with the same ID does not get a signal. The jobs become `cancelled`.
 */
export async function stopOrphanChecks(
  paths: ProjectPaths,
  ownerToken: string,
  deps: OrphanDeps = realCheckDeps(),
): Promise<number> {
  const jobs = await readCheckJobs(paths);
  const orphans = jobs.filter((job) => !isFinalCheck(job.status) && job.ownerToken !== ownerToken);

  if (!orphans.length) {
    return 0;
  }

  await mapInOrder(orphans, (job) => stopOrphan(deps, job));

  const endedAt = new Date(deps.now()).toISOString();
  const ids = new Set(orphans.map((job) => job.id));
  const kept = jobs.map((job) => (ids.has(job.id) ? { ...job, status: "cancelled" as const, endedAt } : job));

  await writeCheckJobs(paths, kept, []);

  return orphans.length;
}
