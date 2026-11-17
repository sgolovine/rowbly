import { stat } from "node:fs/promises";
import { isHostTransportError } from "../host-transport/host-errors.js";
import { RemoteRunError } from "../remote-executor/run-frames.js";
import type { Story } from "../story/story.js";
import { LOCAL_HOST, type ThreadRecord } from "../thread/thread.js";
import { isConnectivityError } from "./connectivity.js";

/** The error code of a worker Thread that failed because the connection to its provider failed. */
export const NETWORK_ERROR_CODE = "NETWORK";

/** The maximum number of runs of one Thread. A resume adds a run. */
const MAX_RUNS = 3;

/** The facts of a worker failure that select its Thread error. */
interface FailureFacts {
  /** True when the worker had a Pi session. */
  readonly launched: boolean;
  readonly stopping: boolean;
  /** The retry time of the network pause of the provider. */
  readonly retryAt?: string;
}

/**
 * Gives the Thread error of a failed worker. A connectivity error gives the class `transient` and the code
 * `NETWORK`, so that the manager can resume the Thread when the pause of its provider ends. A failure on a worker host,
 * or of the connection to a worker host, keeps the error code of the host.
 */
export function workerFailure(error: unknown, facts: FailureFacts): NonNullable<ThreadRecord["error"]> {
  const message = (error instanceof Error ? error.message : "Worker failed").slice(0, 1000);
  const transport = isHostTransportError(error);

  // A failure of the connection to a worker host is not a failure of the provider, so it is never `NETWORK`.
  if (!transport && !facts.stopping && isConnectivityError(error)) {
    return { class: "transient", code: NETWORK_ERROR_CODE, message, retryAt: facts.retryAt };
  }

  const code = transport || error instanceof RemoteRunError ? (error as RemoteRunError).code : "WORKER_FAILED";

  return { class: facts.launched ? "unknown" : "launch", code, message };
}

/** Tells if a Thread can resume with a new run for the Story in its current Stage. */
export function canResume(thread: ThreadRecord, story: Story): boolean {
  return (
    !!thread.resumable &&
    thread.status !== "completed" &&
    thread.runs.length < MAX_RUNS &&
    thread.storyId === story.id &&
    thread.stage === story.stage &&
    !!thread.worktree
  );
}

/** Gives the last worker Thread of each Story, by Story ID. */
export function lastWorkerThreads(threads: readonly ThreadRecord[]): Map<string, ThreadRecord> {
  const workers = threads
    .filter((t) => t.role === "worker" && !!t.storyId)
    .toSorted((first, second) => first.createdAt.localeCompare(second.createdAt));

  return new Map(workers.map((t) => [t.storyId as string, t]));
}

/**
 * Gives the worker Threads that failed with a connectivity error and that can resume: each is the last worker
 * Thread of its Story. This function does not examine the worktree.
 */
export function resumableNetworkThreads(threads: readonly ThreadRecord[], stories: readonly Story[]): ThreadRecord[] {
  const last = lastWorkerThreads(threads);

  return stories.flatMap((story) => {
    const thread = last.get(story.id);

    return thread && thread.status === "failed" && thread.error?.code === NETWORK_ERROR_CODE && canResume(thread, story)
      ? [thread]
      : [];
  });
}

/** Tells if a path is a directory that exists. */
function isDirectory(path: string | undefined): Promise<boolean> {
  if (!path) {
    return Promise.resolve(false);
  }

  return stat(path).then(
    (stats) => stats.isDirectory(),
    () => false,
  );
}

/** Tells if the worktree of a local Thread exists. The worktree of a Thread on a worker host is on that host. */
function worktreePresent(thread: ThreadRecord): Promise<boolean> {
  if ((thread.host ?? LOCAL_HOST) !== LOCAL_HOST) {
    return Promise.resolve(true);
  }

  return isDirectory(thread.worktree);
}

/**
 * Gives the network Threads that the manager can resume, also after a check of the worktree. The policy starts
 * no new Thread for their Stories. A Thread that cannot resume lets the normal policy retry start.
 */
export async function networkWaitingThreads(
  threads: readonly ThreadRecord[],
  stories: readonly Story[],
): Promise<ThreadRecord[]> {
  const candidates = resumableNetworkThreads(threads, stories);
  const present = await Promise.all(candidates.map((thread) => worktreePresent(thread)));

  return candidates.filter((_, index) => present[index]);
}
