import { keptJobs, writeCheckJobs } from "./check-records.js";
import type { CheckJob, CheckQueue, QueueState } from "./check-types.js";

/** Gives the current state. Read it again after each `await`, because other tasks can replace it. */
export function getQueue(queue: CheckQueue): Readonly<QueueState> {
  return queue.store.current;
}

/** Replaces the state with a copy that has the changes from `change`. */
export function setQueue(
  queue: CheckQueue,
  change: (state: Readonly<QueueState>) => Partial<QueueState>,
): Readonly<QueueState> {
  return queue.store.update(change);
}

export function findJob(queue: CheckQueue, id: string): CheckJob | undefined {
  return getQueue(queue).jobs.find((job) => job.id === id);
}

/** Replaces the record of one job with the changes from `patch`, and gives the new record. */
export function patchJob(queue: CheckQueue, id: string, patch: Partial<CheckJob>): CheckJob | undefined {
  const { jobs } = setQueue(queue, (state) => ({
    jobs: state.jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)),
  }));

  return jobs.find((job) => job.id === id);
}

async function writeKept(queue: CheckQueue): Promise<void> {
  const before = getQueue(queue).jobs;
  const { jobs } = setQueue(queue, (state) => ({ jobs: keptJobs(state.jobs) }));

  await writeCheckJobs(
    queue.paths,
    jobs,
    before.filter((job) => !jobs.includes(job)),
  );
}

/** Writes `jobs.json` after the earlier writes. A failed write does not stop the queue. */
export function persistJobs(queue: CheckQueue): Promise<void> {
  const write = getQueue(queue)
    .writes.then(() => writeKept(queue))
    .catch(() => {});

  setQueue(queue, () => ({ writes: write }));

  return write;
}

/** Records a status change of a job, writes the records and tells the owner of the queue. */
export function changeJob(queue: CheckQueue, id: string, patch: Partial<CheckJob>): CheckJob | undefined {
  const job = patchJob(queue, id, patch);

  if (job) {
    void persistJobs(queue);
    queue.onChange(job);
  }

  return job;
}
