import { isTerminal, type ThreadRecord } from "./thread-types.js";

/** The worker Threads of the Stories, in the groups of the Factory view. Each group is newest first. */
export interface ThreadGroups {
  /** The Threads that take a worker slot: `pending` or `running`. */
  readonly active: readonly ThreadRecord[];
  /** The Threads that stopped: `completed`, `failed`, `cancelled` or `interrupted`. */
  readonly inactive: readonly ThreadRecord[];
}

/** A worker Thread of a Story, in the Stage `stage` when a Stage is given. */
function shown(thread: ThreadRecord, stage: string | undefined): boolean {
  return thread.role === "worker" && thread.storyId !== undefined && (stage === undefined || thread.stage === stage);
}

function newestFirst(a: ThreadRecord, b: ThreadRecord): number {
  return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
}

/**
 * Groups the worker Threads of the Stories into active and inactive Threads, newest first. Supervisor Threads
 * and Threads without a Story are not in a group. With `stage`, only the Threads of that Stage are in a group.
 */
export function groupThreads(threads: readonly ThreadRecord[], stage?: string): ThreadGroups {
  const sorted = threads.filter((thread) => shown(thread, stage)).toSorted(newestFirst);

  return {
    active: sorted.filter((thread) => !isTerminal(thread.status)),
    inactive: sorted.filter((thread) => isTerminal(thread.status)),
  };
}
