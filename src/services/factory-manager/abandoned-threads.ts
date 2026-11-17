// The abandoned remote Threads of the manager: the abandon note on a cancel that cannot reach the host, the Threads
// whose later outbox entries the apply holds, the remote outcome, and the resume gate.

import { ConflictError } from "../errors/errors.js";
import type { HostRunState } from "../host-agent/host-run-state.js";
import { hasHeldEntries } from "../outbox-apply/held-actions.js";
import { readAppliedSeq } from "../outbox-apply/host-files.js";
import type { AbandonedHold } from "../outbox-apply/outbox-apply.js";
import type { AbandonedThread } from "../remote-executor/remote-executor.js";
import {
  getThread,
  isAbandoned,
  LOCAL_HOST,
  listThreads,
  type RemoteOutcome,
  type ThreadRecord,
} from "../thread/thread.js";
import type { ProjectPaths } from "../workspace/workspace.js";
import { type HostState, withHeartbeatStates } from "./host-slots.js";
import { changeThread, getState, type Manager, serial } from "./manager-state.js";

/** Gives the remote worker Threads with an abandoned note. */
async function abandonedRecords(manager: Manager): Promise<ThreadRecord[]> {
  const { threads } = await listThreads({ role: "worker" }, manager.ctx);

  return threads.filter((thread) => isAbandoned(thread) && thread.host && thread.host !== LOCAL_HOST);
}

/** Writes the abandoned note on a cancelled remote Thread. The note keeps the last applied `seq` of the host. */
async function writeAbandon(manager: Manager, threadId: string, host: string): Promise<void> {
  const thread = await getThread(threadId, manager.ctx);

  if (thread.status !== "cancelled" || thread.abandoned) {
    return;
  }

  const appliedSeq = await readAppliedSeq(manager.paths, host);
  const at = (manager.ctx.now?.() ?? new Date()).toISOString();

  await changeThread(manager, threadId, "cancelled", { abandoned: { at, reason: "cancel", appliedSeq } });
}

/** Makes the cancelled remote Thread abandoned, because its cancel cannot reach the host now. */
export function abandonThread(manager: Manager, threadId: string, host: string): Promise<void> {
  return serial(manager, () => writeAbandon(manager, threadId, host));
}

/** Gives the abandoned remote Threads that have no remote outcome. */
export async function pendingAbandoned(manager: Manager): Promise<AbandonedThread[]> {
  const records = await abandonedRecords(manager);

  return records
    .filter((thread) => !thread.remoteOutcome)
    .map((thread) => ({ threadId: thread.id, host: thread.host as string }));
}

/** One abandoned Thread of a host, with its Story for the attention entry. */
export interface ManagerHold extends AbandonedHold {
  readonly storyId?: string;
}

/** Gives the abandoned Threads of the host, whose later outbox entries the apply holds. */
export async function abandonedHolds(manager: Manager, host: string): Promise<ManagerHold[]> {
  const records = await abandonedRecords(manager);

  return records
    .filter((thread) => thread.host === host)
    .map((thread) => ({ threadId: thread.id, appliedSeq: thread.abandoned?.appliedSeq ?? 0, storyId: thread.storyId }));
}

/** Gives the remote outcome of the last run frame: the end reason, the end time, the result and the failure. */
export function outcomeOf(run: HostRunState): RemoteOutcome {
  const failure = run.failure ? { failure: { code: run.failure.code, message: run.failure.message } } : {};

  return {
    endReason: run.endReason ?? "completed",
    ...(run.endedAt ? { endedAt: run.endedAt } : {}),
    ...(run.result ? { result: run.result } : {}),
    ...failure,
  };
}

/** Writes the remote outcome on an abandoned Thread one time. The status, the result and the Story do not change. */
async function saveOutcome(manager: Manager, threadId: string, run: HostRunState): Promise<void> {
  const thread = await getThread(threadId, manager.ctx);

  if (!thread.abandoned || thread.remoteOutcome) {
    return;
  }

  await changeThread(manager, threadId, thread.status, { remoteOutcome: outcomeOf(run) });
}

/** Writes the remote outcome of an abandoned Thread from its last run frame, in the lifecycle order. */
export function writeRemoteOutcome(manager: Manager, threadId: string, run: HostRunState): Promise<void> {
  return serial(manager, () => saveOutcome(manager, threadId, run));
}

/** Gives the state of the host that the manager uses, or `undefined` for a host that is not in the list. */
export function hostStateOf(manager: Manager, host: string | undefined): HostState | undefined {
  const state = getState(manager);

  return withHeartbeatStates(state.hosts, state.hostHealth).find((entry) => entry.id === host)?.state;
}

/**
 * Checks the resume of an abandoned Thread: it must have no held entries, and its host must be connected. A Thread
 * that is not abandoned passes.
 */
export async function checkAbandonedResume(
  paths: ProjectPaths,
  thread: ThreadRecord,
  hostState: HostState | undefined,
): Promise<void> {
  if (!thread.abandoned) {
    return;
  }

  if (await hasHeldEntries(paths, thread)) {
    throw new ConflictError(`Thread ${thread.id} has held entries. Apply or discard them first`, {
      details: { threadId: thread.id },
    });
  }

  if (hostState !== "connected") {
    throw new ConflictError(`The host ${thread.host} of Thread ${thread.id} is not connected`, {
      details: { threadId: thread.id, host: thread.host },
    });
  }
}
