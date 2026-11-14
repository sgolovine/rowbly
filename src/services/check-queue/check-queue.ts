import { randomUUID } from "node:crypto";
import { ConflictError } from "../errors/errors.js";
import { DEFAULT_CHECKS } from "../factory-settings/check-settings.js";
import { mapInOrder } from "../in-order/in-order.js";
import { Store, withEntry } from "../store/store.js";
import { canAdmit, estimateMb, isFinalCheck, progressText, runningJobs, waitingJobs } from "./check-order.js";
import { finishJob, startJob, terminateJob } from "./check-process.js";
import { readCheckJobs } from "./check-records.js";
import { changeJob, findJob, getQueue, persistJobs, setQueue } from "./check-state.js";
import type { CheckJob, CheckOutcome, CheckQueue, CheckQueueStatus, CheckRequest, QueueState } from "./check-types.js";

export type {
  CheckJob,
  CheckOutcome,
  CheckQueue,
  CheckQueueDeps,
  CheckQueueStatus,
  CheckRequest,
} from "./check-types.js";

type QueueEnv = Omit<CheckQueue, "store">;

/** The options of one request: the abort signal of the tool and the receiver of the progress text. */
export interface SubmitOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (text: string) => void;
}

/** Makes the queue of a factory. It loads the earlier records, so that the estimates use their peaks. */
export async function createCheckQueue(env: QueueEnv): Promise<CheckQueue> {
  const jobs = await readCheckJobs(env.paths);
  const initial: QueueState = {
    jobs,
    tickets: new Map(),
    live: new Map(),
    seq: Math.max(0, ...jobs.map((job) => job.seq ?? 0)) + 1,
    stopping: false,
    admitting: Promise.resolve(),
    writes: Promise.resolve(),
  };
  const queue: CheckQueue = { ...env, store: new Store(initial) };
  const timer = setInterval(() => void admitIfWaiting(queue), env.deps.timing.admitMs);

  timer.unref();
  setQueue(queue, () => ({ timer }));

  return queue;
}

function limitsOf(queue: CheckQueue) {
  const limits = queue.limits();

  return {
    maxConcurrent: limits?.maxConcurrent ?? DEFAULT_CHECKS.maxConcurrent,
    reserveMemoryMb: limits?.reserveMemoryMb ?? DEFAULT_CHECKS.reserveMemoryMb,
  };
}

function admitIfWaiting(queue: CheckQueue): Promise<void> {
  return waitingJobs(getQueue(queue).jobs).length > 0 ? admit(queue) : Promise.resolve();
}

/** Runs one admission after the earlier admissions. It starts jobs while a slot and memory are free. */
function admit(queue: CheckQueue): Promise<void> {
  const next = getQueue(queue)
    .admitting.then(() => admitWaiting(queue))
    .catch(() => {});

  setQueue(queue, () => ({ admitting: next }));

  return next;
}

async function admitWaiting(queue: CheckQueue): Promise<void> {
  const { stopping, jobs } = getQueue(queue);
  const limits = limitsOf(queue);
  const next = waitingJobs(jobs)[0];
  const running = runningJobs(jobs).length;

  if (stopping || !next || running >= limits.maxConcurrent) {
    return;
  }

  const availableMb = await queue.deps.readMemAvailableMb().catch(() => undefined);
  const estimate = estimateMb(getQueue(queue).jobs, next);

  setQueue(queue, () => ({ availableMb }));

  const current = findJob(queue, next.id);
  const runningNow = runningJobs(getQueue(queue).jobs).length;

  if (current?.status !== "queued" || getQueue(queue).stopping) {
    return admitWaiting(queue);
  }

  if (!canAdmit({ running: runningNow, availableMb, reserveMb: limits.reserveMemoryMb, estimateMb: estimate })) {
    return;
  }

  startJob(queue, current, estimate, () => void admit(queue));

  return admitWaiting(queue);
}

function newJob(queue: CheckQueue, request: CheckRequest, id: string): CheckJob {
  const { env: _env, ...fields } = request;

  return {
    ...fields,
    id,
    ownerToken: queue.ownerToken,
    seq: getQueue(queue).seq,
    status: "queued",
    queuedAt: new Date(queue.deps.now()).toISOString(),
  };
}

function sendProgress(queue: CheckQueue, id: string, onProgress: (text: string) => void): void {
  onProgress(progressText(getQueue(queue).jobs, id, queue.deps.now()));
}

/** Gives the abort listener of one job. The same function must go to `addEventListener` and `removeEventListener`. */
function cancelOnAbort(queue: CheckQueue, id: string): () => void {
  return () => void cancelCheck(queue, id);
}

/** Sends the progress text when the job starts or at each interval. It gives the function that stops it. */
function trackProgress(queue: CheckQueue, id: string, onProgress?: (text: string) => void): () => void {
  if (!onProgress) {
    return () => {};
  }

  const timer = setInterval(() => sendProgress(queue, id, onProgress), queue.deps.timing.progressMs);

  timer.unref();
  sendProgress(queue, id, onProgress);

  return () => clearInterval(timer);
}

/** Puts a check in the queue and waits for its result. An abort of the signal cancels the job. */
export async function submitCheck(
  queue: CheckQueue,
  request: CheckRequest,
  options: SubmitOptions = {},
): Promise<CheckOutcome> {
  if (getQueue(queue).stopping) {
    throw new ConflictError("Factory is stopping");
  }

  const id = randomUUID();
  const outcome = new Promise<CheckOutcome>((resolve) => {
    setQueue(queue, (state) => ({
      jobs: [...state.jobs, newJob(queue, request, id)],
      tickets: withEntry(state.tickets, id, { env: request.env, resolve }),
      seq: state.seq + 1,
    }));
  });
  const cancel = cancelOnAbort(queue, id);

  changeJob(queue, id, {});
  options.signal?.addEventListener("abort", cancel, { once: true });

  if (options.signal?.aborted) {
    cancel();
  }

  const stopProgress = trackProgress(queue, id, options.onProgress);

  void admit(queue);

  return outcome.finally(() => {
    stopProgress();
    options.signal?.removeEventListener("abort", cancel);
  });
}

/** Cancels one job: a queued job leaves the queue, and a running job stops. */
async function cancelCheck(queue: CheckQueue, id: string): Promise<void> {
  const job = findJob(queue, id);

  if (job?.status === "queued") {
    await finishJob(queue, id, { status: "cancelled" });
    return;
  }

  if (job?.status === "running") {
    await terminateJob(queue, id, "cancelled");
  }
}

function activeJobs(queue: CheckQueue): readonly CheckJob[] {
  return getQueue(queue).jobs.filter((job) => !isFinalCheck(job.status));
}

/** Cancels the queued and running jobs of one Thread. */
export async function cancelThreadChecks(queue: CheckQueue, threadId: string): Promise<void> {
  const jobs = activeJobs(queue).filter((job) => job.threadId === threadId);

  await Promise.all(jobs.map((job) => cancelCheck(queue, job.id)));
}

/** Cancels the queued jobs, stops each running process group, and waits for the last record write. */
export async function stopCheckQueue(queue: CheckQueue): Promise<void> {
  const state = setQueue(queue, () => ({ stopping: true }));

  clearInterval(state.timer);

  const queued = activeJobs(queue).filter((job) => job.status === "queued");

  await mapInOrder(queued, (job) => cancelCheck(queue, job.id));
  await Promise.all(activeJobs(queue).map((job) => cancelCheck(queue, job.id)));
  await persistJobs(queue);
}

/** Gives the checks part of `status.json`: the counts, the free memory and the jobs that run or wait. */
export function checkQueueStatus(queue: CheckQueue): CheckQueueStatus {
  const { jobs, availableMb } = getQueue(queue);
  const running = runningJobs(jobs);
  const waiting = waitingJobs(jobs);

  return {
    running: running.length,
    queued: waiting.length,
    ...(availableMb !== undefined ? { availableMb } : {}),
    maxConcurrent: limitsOf(queue).maxConcurrent,
    jobs: [...running, ...waiting].slice(0, 50).map((job) => ({
      id: job.id,
      threadId: job.threadId,
      storyId: job.storyId,
      stage: job.stage,
      key: job.key,
      scope: job.scope,
      status: job.status,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt,
      estimateMb: job.estimateMb,
    })),
  };
}
