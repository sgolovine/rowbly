import { createWriteStream, type WriteStream } from "node:fs";
import { withEntry, withoutEntry } from "../store/store.js";
import { keepOutput, outputTail } from "./check-order.js";
import { checkLogPath } from "./check-records.js";
import { changeJob, findJob, getQueue, patchJob, setQueue } from "./check-state.js";
import type { CheckJob, CheckProcess, CheckQueue, CheckStatus, LiveJob, StopReason } from "./check-types.js";

function nowText(queue: CheckQueue): string {
  return new Date(queue.deps.now()).toISOString();
}

function patchLive(queue: CheckQueue, id: string, patch: Partial<LiveJob>): void {
  setQueue(queue, (state) => {
    const live = state.live.get(id);

    return live ? { live: withEntry(state.live, id, { ...live, ...patch }) } : {};
  });
}

function closeLog(log: WriteStream): Promise<void> {
  return new Promise((resolve) => log.end(() => resolve()));
}

/** Gives the final status: the stop reason, or the exit code of the check. */
function finalStatus(live: LiveJob | undefined, code: number | null): CheckStatus {
  if (live?.stopReason) {
    return live.stopReason;
  }

  return code === 0 ? "passed" : "failed";
}

/** Ends a job: clears its timers, records the result, gives the outcome to the waiter and admits the next job. */
export async function finishJob(
  queue: CheckQueue,
  id: string,
  result: { readonly status?: CheckStatus; readonly code?: number | null; readonly error?: string },
): Promise<void> {
  const live = getQueue(queue).live.get(id);

  clearInterval(live?.sampler);
  clearTimeout(live?.timeout);
  clearTimeout(live?.killTimer);

  const status = result.status ?? finalStatus(live, result.code ?? null);
  const job = changeJob(queue, id, {
    status,
    endedAt: nowText(queue),
    ...(result.code !== undefined ? { exitCode: result.code } : {}),
    ...(result.error ? { error: result.error.slice(0, 1000) } : {}),
  });
  const ticket = getQueue(queue).tickets.get(id);
  const log = await checkLogPath(queue.paths, id).catch(() => "");

  setQueue(queue, (state) => ({ live: withoutEntry(state.live, id), tickets: withoutEntry(state.tickets, id) }));

  if (job) {
    ticket?.resolve({ job, output: outputTail(live?.tail ?? result.error ?? ""), log });
  }
}

/** Sends SIGTERM to a process group, then SIGKILL after the grace time. */
function signalStop(queue: CheckQueue, id: string, pgid: number): void {
  const killTimer = setTimeout(() => queue.deps.kill(pgid, "SIGKILL"), queue.deps.timing.killGraceMs);

  killTimer.unref();
  patchLive(queue, id, { killTimer });
  queue.deps.kill(pgid, "SIGTERM");
}

/** Stops a running job and waits for its end. A job without a process yet stops when the process starts. */
export function terminateJob(queue: CheckQueue, id: string, reason: StopReason): Promise<void> {
  const live = getQueue(queue).live.get(id);
  const pgid = findJob(queue, id)?.pgid;

  if (!live) {
    return Promise.resolve();
  }

  if (live.stopReason) {
    return live.done;
  }

  patchLive(queue, id, { stopReason: reason });

  if (pgid !== undefined) {
    signalStop(queue, id, pgid);
  }

  return live.done;
}

/** Records the peak of the RSS of the group. A sample after the end of the job changes nothing. */
async function sample(queue: CheckQueue, id: string, pgid: number): Promise<void> {
  const rss = await queue.deps.readGroupRssMb(pgid).catch(() => 0);
  const job = findJob(queue, id);

  if (job?.status === "running" && rss > (job.peakMb ?? 0)) {
    patchJob(queue, id, { peakMb: rss });
  }
}

/** Starts the timers of a running job: the memory sample each second and the timeout. */
function startTimers(queue: CheckQueue, job: CheckJob, pgid: number): void {
  const { timing } = queue.deps;
  const sampler = setInterval(() => void sample(queue, job.id, pgid), timing.sampleMs);
  const timeout = setTimeout(() => void terminateJob(queue, job.id, "timed_out"), job.timeoutMinutes * timing.minuteMs);

  sampler.unref();
  timeout.unref();
  patchLive(queue, job.id, { sampler, timeout });
}

function receiveOutput(queue: CheckQueue, id: string, log: WriteStream, chunk: string): void {
  log.write(chunk);
  setQueue(queue, (state) => {
    const live = state.live.get(id);

    return live ? { live: withEntry(state.live, id, { ...live, tail: keepOutput(live.tail, chunk) }) } : {};
  });
}

/** Waits for the exit of the process, then closes the log and finishes the job. */
async function awaitExit(queue: CheckQueue, id: string, child: CheckProcess, log: WriteStream): Promise<void> {
  const exit = await child.exited.then(
    (code) => ({ code }),
    (error: unknown) => ({ status: "error" as const, error: errorText(error) }),
  );

  await closeLog(log);
  await finishJob(queue, id, exit);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Spawns the process of a job, records its process group and start ticks, and waits for its end. */
async function runJob(queue: CheckQueue, job: CheckJob): Promise<void> {
  const ticket = getQueue(queue).tickets.get(job.id);
  const head = await queue.deps.readHead(job.cwd);
  const stopped = getQueue(queue).live.get(job.id)?.stopReason;

  if (stopped) {
    await finishJob(queue, job.id, { status: stopped });
    return;
  }

  const log = createWriteStream(await checkLogPath(queue.paths, job.id), { mode: 0o600 });
  const child = queue.deps.spawn(job.command, { cwd: job.cwd, env: { ...ticket?.env, ROWBLY_CHECK: "1" } });

  child.onOutput((chunk) => receiveOutput(queue, job.id, log, chunk));
  changeJob(queue, job.id, { head, pgid: child.pid });

  if (child.pid !== undefined) {
    await startProcessTimers(queue, job, child.pid);
  }

  await awaitExit(queue, job.id, child, log);
}

/** Records the start ticks, starts the timers, and sends a stop that came before the process started. */
async function startProcessTimers(queue: CheckQueue, job: CheckJob, pgid: number): Promise<void> {
  const startTicks = await queue.deps.readStartTicks(pgid);

  patchJob(queue, job.id, { startTicks });
  startTimers(queue, job, pgid);

  const live = getQueue(queue).live.get(job.id);

  if (live?.stopReason && !live.killTimer) {
    signalStop(queue, job.id, pgid);
  }
}

/** Marks a job running at once, so that the limit counts it, then starts its process. `onEnd` runs after the end. */
export function startJob(queue: CheckQueue, job: CheckJob, estimateMb: number, onEnd: () => void): void {
  setQueue(queue, (state) => ({ live: withEntry(state.live, job.id, { tail: "", done: Promise.resolve() }) }));
  changeJob(queue, job.id, { status: "running", startedAt: nowText(queue), estimateMb });

  const done = new Promise<void>((resolve) => {
    void runJob(queue, job)
      .catch((error: unknown) => finishJob(queue, job.id, { status: "error", error: errorText(error) }))
      .catch(() => {})
      .finally(resolve)
      .then(onEnd);
  });

  patchLive(queue, job.id, { done });
}
